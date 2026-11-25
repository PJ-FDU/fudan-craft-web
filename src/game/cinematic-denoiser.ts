import {
  Color, HalfFloatType, Matrix4, Mesh, NearestFilter, NoBlending, NoToneMapping,
  type Material, type MeshStandardMaterial, type OrthographicCamera, type Scene, type Texture,
} from 'three';
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer } from 'three/webgpu';
import {
  attribute, cameraProjectionMatrix, cameraViewMatrix, float, materialColor, modelWorldMatrix,
  normalWorld, outputStruct, positionLocal, positionView, uniform, uniformTexture, uv, varying, vec2, vec4, wgslFn,
} from 'three/tsl';
import type { CinematicDisplayOptions } from './cinematic-backend.js';

// Pass 2: 全分辨率联合双边解调 + 运动矢量时序重投影 + 3x3 方差邻域钳制。
const temporalAccumulate = wgslFn(`
  fn temporalAccumulate(
    colorTex: texture_2d<f32>,
    guideTex: texture_2d<f32>,
    albedoTex: texture_2d<f32>,
    motionTex: texture_2d<f32>,
    prevGuideTex: texture_2d<f32>,
    prevAlbedoTex: texture_2d<f32>,
    prevHistoryTex: texture_2d<f32>,
    coord: vec2f,
    temporalWeight: f32,
    hasHistory: f32
  ) -> vec4f {
    let fullSize = vec2i(textureDimensions(guideTex, 0));
    let rawSize = vec2i(textureDimensions(colorTex, 0));
    let p = clamp(vec2i(coord * vec2f(fullSize)), vec2i(0), fullSize - 1);
    let guide = textureLoad(guideTex, p, 0);
    let albedo = textureLoad(albedoTex, p, 0);
    let safeAlbedo = max(albedo.rgb, vec3f(0.08));

    // 几何感知联合双边解调上采样（原始低分实时帧 -> 完整物理分辨率光照）
    var currIllum = vec3f(0.0);
    if (rawSize.x == fullSize.x && rawSize.y == fullSize.y) {
      let raw = textureLoad(colorTex, p, 0);
      currIllum = raw.rgb / safeAlbedo;
    } else {
      let rawF = (vec2f(p) + 0.5) / vec2f(fullSize) * vec2f(rawSize) - 0.5;
      let baseR = vec2i(floor(rawF));
      let fracR = fract(rawF);
      var sum = vec3f(0.0);
      var wSum = 0.0;
      for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
          let r = clamp(baseR + vec2i(ox, oy), vec2i(0), rawSize - 1);
          let qFull = clamp(vec2i((vec2f(r) + 0.5) / vec2f(rawSize) * vec2f(fullSize)), vec2i(0), fullSize - 1);
          let qGuide = textureLoad(guideTex, qFull, 0);
          let qAlbedo = textureLoad(albedoTex, qFull, 0);
          let qRaw = textureLoad(colorTex, r, 0);
          let qIllum = qRaw.rgb / max(qAlbedo.rgb, vec3f(0.08));
          let sameObj = abs(albedo.a - qAlbedo.a) < 0.25;
          let nw = select(pow(clamp(dot(guide.xyz, qGuide.xyz), 0.0, 1.0), 32.0), 1.0, guide.w == 0.0 && qGuide.w == 0.0);
          let dw = exp(-abs(guide.w - qGuide.w) / max(0.03, abs(guide.w) * 0.015));
          let d = vec2f(f32(ox), f32(oy)) - fracR;
          let sw = exp(-dot(d, d) / 1.1);
          let w = select(0.0, sw * nw * dw, sameObj);
          sum += qIllum * w;
          wSum += w;
        }
      }
      if (wSum > 0.0001) {
        currIllum = sum / wSum;
      } else {
        let rFallback = clamp(vec2i((vec2f(p) + 0.5) / vec2f(fullSize) * vec2f(rawSize)), vec2i(0), rawSize - 1);
        currIllum = textureLoad(colorTex, rFallback, 0).rgb / safeAlbedo;
      }
    }

    // 防止单样本极端萤火虫污染时序历史
    let lum = dot(currIllum, vec3f(0.2126, 0.7152, 0.0722));
    if (lum > 18.0) {
      currIllum *= 18.0 / lum;
    }

    if (temporalWeight <= 0.0 || hasHistory < 0.5) {
      return vec4f(currIllum, 1.0);
    }

    // 计算局部 3x3 邻域均值与标准差（用于抗拖影方差钳制）
    var m1 = currIllum;
    var m2 = currIllum * currIllum;
    var count = 1.0;
    let stepPx = max(1, fullSize.x / max(rawSize.x, 1));
    for (var ny = -1; ny <= 1; ny++) {
      for (var nx = -1; nx <= 1; nx++) {
        if (nx == 0 && ny == 0) { continue; }
        let np = clamp(p + vec2i(nx * stepPx, ny * stepPx), vec2i(0), fullSize - 1);
        let nGuide = textureLoad(guideTex, np, 0);
        let nAlbedo = textureLoad(albedoTex, np, 0);
        if (abs(albedo.a - nAlbedo.a) >= 0.25) { continue; }
        if (guide.w > 0.0 && (nGuide.w <= 0.0 || dot(guide.xyz, nGuide.xyz) < 0.7)) { continue; }
        let nr = clamp(vec2i((vec2f(np) + 0.5) / vec2f(fullSize) * vec2f(rawSize)), vec2i(0), rawSize - 1);
        var nIllum = textureLoad(colorTex, nr, 0).rgb / max(nAlbedo.rgb, vec3f(0.08));
        let nl = dot(nIllum, vec3f(0.2126, 0.7152, 0.0722));
        if (nl > 18.0) { nIllum *= 18.0 / nl; }
        m1 += nIllum;
        m2 += nIllum * nIllum;
        count += 1.0;
      }
    }
    let mean = m1 / count;
    let variance = max(m2 / count - mean * mean, vec3f(0.0));
    let sigma = sqrt(variance);

    // 抑制 1-spp 极端暗点/萤火虫，同时保留正常阴影过渡
    let denomMean = max(dot(mean, vec3f(0.2126, 0.7152, 0.0722)), 0.001);
    let currLum = dot(currIllum, vec3f(0.2126, 0.7152, 0.0722));
    if (count >= 4.0 && (currLum < denomMean * 0.15 || currLum > denomMean * 4.0)) {
      currIllum = mix(currIllum, mean, 0.65);
    }

    // 按屏幕空间运动矢量重投影上一帧历史
    let motion = textureLoad(motionTex, p, 0).xy;
    let prevCoord = (vec2f(p) + 0.5) / vec2f(fullSize) + motion;
    if (prevCoord.x < 0.0 || prevCoord.x > 1.0 || prevCoord.y < 0.0 || prevCoord.y > 1.0) {
      return vec4f(currIllum, 1.0);
    }

    let prevF = prevCoord * vec2f(fullSize) - 0.5;
    let prevBase = vec2i(floor(prevF));
    let prevFrac = fract(prevF);
    var histSum = vec3f(0.0);
    var lenSum = 0.0;
    var histW = 0.0;
    for (var hy = 0; hy <= 1; hy++) {
      for (var hx = 0; hx <= 1; hx++) {
        let hp = clamp(prevBase + vec2i(hx, hy), vec2i(0), fullSize - 1);
        let pGuide = textureLoad(prevGuideTex, hp, 0);
        let pAlbedo = textureLoad(prevAlbedoTex, hp, 0);
        let sameObj = abs(albedo.a - pAlbedo.a) < 0.25;
        let bgOk = guide.w == 0.0 && pGuide.w == 0.0;
        let geomOk = guide.w > 0.0 && pGuide.w > 0.0 &&
          dot(guide.xyz, pGuide.xyz) > 0.85 &&
          abs(guide.w - pGuide.w) < max(0.08, abs(guide.w) * 0.035);
        if (sameObj && (bgOk || geomOk)) {
          let bw = select(1.0 - prevFrac.x, prevFrac.x, hx == 1) * select(1.0 - prevFrac.y, prevFrac.y, hy == 1);
          let h = textureLoad(prevHistoryTex, hp, 0);
          histSum += h.rgb * bw;
          lenSum += h.a * bw;
          histW += bw;
        }
      }
    }

    if (histW < 0.01) {
      return vec4f(currIllum, 1.0);
    }

    let prevIllum = histSum / histW;
    let prevLen = lenSum / histW;
    let minBox = max(vec3f(0.0), mean - sigma * 1.9 - vec3f(0.03));
    let maxBox = mean + sigma * 1.9 + vec3f(0.03);
    let clampedPrev = clamp(prevIllum, minBox, maxBox);
    let nextLen = min(prevLen + 1.0, 16.0);
    let alpha = max(1.0 / nextLen, 0.08);
    let blended = mix(clampedPrev, currIllum, mix(1.0, alpha, temporalWeight));
    return vec4f(blended, nextLen);
  }
`);

// Pass 3: 多尺度边缘保持 À-Trous 小波空间滤波（仅过滤解调光照，保留全分辨率贴图与锐利轮廓）。
const atrousFilter = wgslFn(`
  fn atrousFilter(
    illumTex: texture_2d<f32>,
    guideTex: texture_2d<f32>,
    albedoTex: texture_2d<f32>,
    coord: vec2f,
    stepSize: f32,
    illumSigma: f32
  ) -> vec4f {
    let size = vec2i(textureDimensions(illumTex, 0));
    let p = clamp(vec2i(coord * vec2f(size)), vec2i(0), size - 1);
    let center = textureLoad(illumTex, p, 0);
    let guide = textureLoad(guideTex, p, 0);
    let albedo = textureLoad(albedoTex, p, 0);
    let step = i32(stepSize);
    let sigmaSq = max(0.01, illumSigma * illumSigma);
    let centerLen = length(center.rgb);

    var sum = vec3f(0.0);
    var total = 0.0;
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let q = clamp(p + vec2i(x * step, y * step), vec2i(0), size - 1);
        let sample = textureLoad(illumTex, q, 0);
        let neighbor = textureLoad(guideTex, q, 0);
        let base = textureLoad(albedoTex, q, 0);
        let sameObj = abs(albedo.a - base.a) < 0.25;
        let nw = select(pow(clamp(dot(guide.xyz, neighbor.xyz), 0.0, 1.0), 64.0), 1.0, guide.w == 0.0 && neighbor.w == 0.0);
        let dw = exp(-abs(guide.w - neighbor.w) / max(0.02, abs(guide.w) * 0.008 * stepSize));
        let sampleLen = length(sample.rgb);
        let diff = length(sample.rgb - center.rgb) / (0.22 + 0.5 * (centerLen + sampleLen));
        let lw = exp(-(diff * diff) / sigmaSq);
        let kx = select(0.5, 1.0, x == 0);
        let ky = select(0.5, 1.0, y == 0);
        let weight = select(0.0, kx * ky * nw * dw * lw, sameObj);
        sum += sample.rgb * weight;
        total += weight;
      }
    }
    return vec4f(sum / max(total, 0.00001), center.a);
  }
`);

// Pass 4a: 用完整物理分辨率 Albedo 重新调制光照并单次输出 ACES / sRGB。
const remodulateDisplay = wgslFn(`
  fn remodulateDisplay(illumTex: texture_2d<f32>, albedoTex: texture_2d<f32>, coord: vec2f) -> vec4f {
    let size = vec2i(textureDimensions(illumTex, 0));
    let p = clamp(vec2i(coord * vec2f(size)), vec2i(0), size - 1);
    let illum = textureLoad(illumTex, p, 0).rgb;
    let albedo = textureLoad(albedoTex, p, 0).rgb;
    return vec4f(illum * max(albedo, vec3f(0.08)), 1.0);
  }
`);

// Pass 4b: 原始未降噪路径追踪显示（支持动态预览分辨率到画布的映射）。
const rawDisplay = wgslFn(`
  fn rawDisplay(colorTex: texture_2d<f32>, coord: vec2f) -> vec4f {
    let size = vec2i(textureDimensions(colorTex, 0));
    let p = clamp(vec2i(coord * vec2f(size)), vec2i(0), size - 1);
    return vec4f(textureLoad(colorTex, p, 0).rgb, 1.0);
  }
`);

interface GuideRecord {
  material: MeshBasicNodeMaterial;
  prevModel: { value: Matrix4 };
}

/**
 * 全分辨率 SVGF 实时＋渐进式路径追踪降噪器（WebGPU / TSL）：
 * G-Buffer（法线/深度/全分 Albedo/屏幕运动矢量）-> 联合双边解调 + 时序重投影 -> 多尺度 À-Trous -> 全分 Albedo 重调制。
 */
export class CinematicDenoiser {
  private gbuf = [
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, count: 3 }),
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, count: 3 }),
  ];
  private history = [
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
  ];
  private atrous = [
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
    new RenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
  ];
  private currIdx = 0;
  private hasHistory = false;
  private lastW = 0;
  private lastH = 0;
  private prevViewProj = uniform(new Matrix4());
  private currViewProj = new Matrix4();
  private guideRecords = new Map<string, GuideRecord>();
  private objects = new Map<Mesh, number>();
  private prevMatrices = new Map<Mesh, Matrix4>();

  private rawInput = uniformTexture();
  private guideInput = uniformTexture();
  private albedoInput = uniformTexture();
  private motionInput = uniformTexture();
  private prevGuideInput = uniformTexture();
  private prevAlbedoInput = uniformTexture();
  private prevHistoryInput = uniformTexture();
  private temporalWeight = uniform(1);
  private hasHistoryFlag = uniform(0);

  private atrousInput = uniformTexture();
  private atrousGuideInput = uniformTexture();
  private atrousAlbedoInput = uniformTexture();
  private atrousStep = uniform(1);
  private atrousSigma = uniform(0.45);

  private screenIllumInput = uniformTexture();
  private screenAlbedoInput = uniformTexture();
  private screenRawInput = uniformTexture();

  private temporalMaterial = new MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false, blending: NoBlending });
  private atrousMaterial = new MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false, blending: NoBlending });
  private remodulateMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: NoBlending });
  private rawScreenMaterial = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: NoBlending });
  private quad: QuadMesh;
  private clearColor = new Color();

  constructor() {
    const coord = varying(uv());
    this.temporalMaterial.fragmentNode = temporalAccumulate({
      colorTex: this.rawInput,
      guideTex: this.guideInput,
      albedoTex: this.albedoInput,
      motionTex: this.motionInput,
      prevGuideTex: this.prevGuideInput,
      prevAlbedoTex: this.prevAlbedoInput,
      prevHistoryTex: this.prevHistoryInput,
      coord,
      temporalWeight: this.temporalWeight,
      hasHistory: this.hasHistoryFlag,
    });
    this.atrousMaterial.fragmentNode = atrousFilter({
      illumTex: this.atrousInput,
      guideTex: this.atrousGuideInput,
      albedoTex: this.atrousAlbedoInput,
      coord,
      stepSize: this.atrousStep,
      illumSigma: this.atrousSigma,
    });
    this.remodulateMaterial.fragmentNode = remodulateDisplay({
      illumTex: this.screenIllumInput,
      albedoTex: this.screenAlbedoInput,
      coord,
    });
    this.rawScreenMaterial.fragmentNode = rawDisplay({
      colorTex: this.screenRawInput,
      coord,
    });
    this.quad = new QuadMesh(this.remodulateMaterial);
  }

  resetHistory() {
    this.hasHistory = false;
  }

  resetScene() {
    this.hasHistory = false;
    this.objects.clear();
    this.prevMatrices.clear();
    for (const record of this.guideRecords.values()) record.material.dispose();
    this.guideRecords.clear();
  }

  private guideMaterial(mesh: Mesh, source: Material, slot: number) {
    let id = this.objects.get(mesh);
    if (id === undefined) {
      id = this.objects.size + 1;
      this.objects.set(mesh, id);
    }
    const hasPrevPos = Boolean(mesh.geometry.getAttribute('prevPosition'));
    const key = `${id}:${slot}:${source.uuid}:${hasPrevPos ? 1 : 0}`;
    let record = this.guideRecords.get(key);
    const original = source as MeshStandardMaterial;
    if (!record) {
      const prevModel = uniform(mesh.matrixWorld.clone());
      const material = new MeshBasicNodeMaterial({
        color: original.color ?? 0xffffff,
        map: original.map ?? null,
        side: source.side,
        toneMapped: false,
        blending: NoBlending,
        fog: false,
      });
      const prevPosNode = hasPrevPos ? attribute('prevPosition', 'vec3') : positionLocal;
      const currClip = varying(cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix).mul(vec4(positionLocal, 1)));
      const prevClip = varying(this.prevViewProj.mul(prevModel).mul(vec4(prevPosNode, 1)));
      const currNdc = currClip.xy.div(currClip.w);
      const prevNdc = prevClip.xy.div(prevClip.w);
      // WebGPU 纹理原点在左上角，Y 轴与 NDC 相反。
      const currScreenUv = vec2(currNdc.x.mul(0.5).add(0.5), float(0.5).sub(currNdc.y.mul(0.5)));
      const prevScreenUv = vec2(prevNdc.x.mul(0.5).add(0.5), float(0.5).sub(prevNdc.y.mul(0.5)));
      const motion = prevScreenUv.sub(currScreenUv);
      material.fragmentNode = outputStruct(
        vec4(normalWorld, positionView.z.negate()),
        vec4(materialColor.rgb, float(id)),
        vec4(motion, 0, 0),
      );
      record = { material, prevModel };
      this.guideRecords.set(key, record);
    }
    const prevMat = this.prevMatrices.get(mesh);
    record.prevModel.value.copy(this.hasHistory && prevMat ? prevMat : mesh.matrixWorld);
    return record.material;
  }

  render(
    renderer: WebGPURenderer, scene: Scene, camera: OrthographicCamera,
    raw: Texture, fullWidth: number, fullHeight: number, options: CinematicDisplayOptions,
  ) {
    const target = renderer.getRenderTarget();
    const toneMapping = renderer.toneMapping;
    const autoClear = renderer.autoClear;
    const background = scene.background;
    const override = scene.overrideMaterial;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const originals = new Map<Mesh, Material | Material[]>();

    try {
      renderer.autoClear = true;
      if (!options.denoise) {
        this.screenRawInput.value = raw;
        renderer.setRenderTarget(target);
        renderer.toneMapping = toneMapping;
        renderer.setClearColor(this.clearColor, clearAlpha);
        this.quad.material = this.rawScreenMaterial;
        this.quad.render(renderer);
        return;
      }

      if (this.lastW !== fullWidth || this.lastH !== fullHeight) {
        this.lastW = fullWidth;
        this.lastH = fullHeight;
        this.hasHistory = false;
        for (const rt of this.gbuf) rt.setSize(fullWidth, fullHeight);
        for (const rt of this.history) rt.setSize(fullWidth, fullHeight);
        for (const rt of this.atrous) rt.setSize(fullWidth, fullHeight);
      }

      camera.updateMatrixWorld();
      this.currViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!this.hasHistory) {
        this.prevViewProj.value.copy(this.currViewProj);
      }

      const curr = this.currIdx;
      const prev = 1 - curr;
      const gbufCurr = this.gbuf[curr];
      const gbufPrev = this.gbuf[prev];
      const histCurr = this.history[curr];
      const histPrev = this.history[prev];

      // Pass 1: 全分辨率 MRT G-Buffer + 精确屏幕空间运动矢量
      renderer.toneMapping = NoToneMapping;
      scene.traverseVisible(object => {
        if (!(object instanceof Mesh)) return;
        originals.set(object, object.material);
        object.material = Array.isArray(object.material)
          ? object.material.map((m, slot) => this.guideMaterial(object, m, slot))
          : this.guideMaterial(object, object.material, 0);
      });
      scene.background = null;
      scene.overrideMaterial = null;
      renderer.setClearColor(0, 0);
      renderer.setRenderTarget(gbufCurr);
      renderer.render(scene, camera);
      for (const [object, material] of originals) object.material = material;
      originals.clear();
      scene.background = background;
      scene.overrideMaterial = override;

      // Pass 2: 联合双边解调上采样 + 时序重投影累积
      this.rawInput.value = raw;
      this.guideInput.value = gbufCurr.textures[0];
      this.albedoInput.value = gbufCurr.textures[1];
      this.motionInput.value = gbufCurr.textures[2];
      this.prevGuideInput.value = gbufPrev.textures[0];
      this.prevAlbedoInput.value = gbufPrev.textures[1];
      this.prevHistoryInput.value = histPrev.texture;
      this.temporalWeight.value = options.temporal ? 1 : 0;
      this.hasHistoryFlag.value = this.hasHistory ? 1 : 0;
      renderer.setRenderTarget(histCurr);
      this.quad.material = this.temporalMaterial;
      this.quad.render(renderer);

      // Pass 3: 自适应多尺度 À-Trous 边缘保持滤波
      const eff = Math.max(1, options.effectiveSamples);
      const passes = options.temporal ? 4 : eff < 16 ? 3 : eff < 64 ? 2 : 1;
      const baseSigma = options.temporal ? 0.92 : eff < 8 ? 0.65 : eff < 32 ? 0.38 : eff < 128 ? 0.26 : 0.21;
      this.atrousGuideInput.value = gbufCurr.textures[0];
      this.atrousAlbedoInput.value = gbufCurr.textures[1];
      let readTex: Texture = histCurr.texture;
      for (let pass = 0; pass < passes; pass++) {
        const writeTarget = this.atrous[pass & 1];
        this.atrousInput.value = readTex;
        this.atrousStep.value = 1 << pass;
        this.atrousSigma.value = baseSigma * (pass === 0 ? 1 : pass === 1 ? 0.88 : pass === 2 ? 0.76 : 0.65);
        renderer.setRenderTarget(writeTarget);
        this.quad.material = this.atrousMaterial;
        this.quad.render(renderer);
        readTex = writeTarget.texture;
      }

      // Pass 4: 全分辨率 Albedo 重调制 + 单次 ACES / sRGB 显示
      this.screenIllumInput.value = readTex;
      this.screenAlbedoInput.value = gbufCurr.textures[1];
      renderer.setRenderTarget(target);
      renderer.toneMapping = toneMapping;
      renderer.setClearColor(this.clearColor, clearAlpha);
      this.quad.material = this.remodulateMaterial;
      this.quad.render(renderer);

      if (options.updateHistory) {
        this.prevViewProj.value.copy(this.currViewProj);
        scene.traverseVisible(object => {
          if (!(object instanceof Mesh)) return;
          let saved = this.prevMatrices.get(object);
          if (!saved) {
            saved = new Matrix4();
            this.prevMatrices.set(object, saved);
          }
          saved.copy(object.matrixWorld);
        });
        this.currIdx = prev;
        this.hasHistory = true;
      }
    } finally {
      for (const [object, material] of originals) object.material = material;
      scene.background = background;
      scene.overrideMaterial = override;
      renderer.setRenderTarget(target);
      renderer.toneMapping = toneMapping;
      renderer.autoClear = autoClear;
      renderer.setClearColor(this.clearColor, clearAlpha);
    }
  }

  dispose() {
    this.resetScene();
    for (const rt of this.gbuf) rt.dispose();
    for (const rt of this.history) rt.dispose();
    for (const rt of this.atrous) rt.dispose();
    this.temporalMaterial.dispose();
    this.atrousMaterial.dispose();
    this.remodulateMaterial.dispose();
    this.rawScreenMaterial.dispose();
  }
}
