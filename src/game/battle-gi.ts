import {
  DepthTexture, GLSL3, HalfFloatType, LinearFilter, Matrix4, NearestFilter, ShaderMaterial,
  UnsignedIntType, Vector2, Vector3, Vector4, WebGLRenderTarget,
  type OrthographicCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export type LightingQuality = 'off' | 'balanced' | 'high' | 'cinematic';

export interface BattleDynamicLight {
  x: number;
  y: number;
  z: number;
  radius: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
}

export const MAX_BATTLE_LIGHTS = 32;

interface QualityPreset {
  scale: number;
  samples: number;
  reflectionSteps: number;
  atrousPasses: number;
  maxHistory: number;
  multiBounce: number;
  maxLights: number;
  contactShadows: boolean;
  msaa: number;
  pcss: number;
}

const presets: Record<Exclude<LightingQuality, 'off'>, QualityPreset> = {
  balanced: {
    scale: .42, samples: 12, reflectionSteps: 20, atrousPasses: 2,
    maxHistory: 8, multiBounce: .34, maxLights: 16, contactShadows: false, msaa: 0, pcss: .65,
  },
  high: {
    scale: .56, samples: 20, reflectionSteps: 32, atrousPasses: 3,
    maxHistory: 10, multiBounce: .46, maxLights: 24, contactShadows: true, msaa: 2, pcss: 1.0,
  },
  cinematic: {
    scale: .72, samples: 28, reflectionSteps: 40, atrousPasses: 3,
    maxHistory: 12, multiBounce: .56, maxLights: 32, contactShadows: true, msaa: 2, pcss: 1.0,
  },
};

const bounceRadius = 86;

const vertexShader = `varying vec2 vUv;
  void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const vertexShaderGLSL3 = `out vec2 vUv;
  void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const reconstruction = `
  uniform sampler2D sceneDepth, sceneNormal, sceneSurface, battleFog;
  uniform float battleExtent;
  uniform mat4 inverseProjection, cameraWorld;
  uniform vec2 pixelSize;
  varying vec2 vUv;
  vec3 positionAt(vec2 uv){
    uv=(floor(uv/pixelSize)+.5)*pixelSize;
    vec4 p=inverseProjection*vec4(uv*2.0-1.0,texture2D(sceneDepth,uv).r*2.0-1.0,1.0);
    return p.xyz/p.w;
  }
  // 选取深度差较小的一侧，避免轮廓处把背景误当成斜面。
  vec3 normalAt(vec2 uv,vec3 p){
    vec3 surfaceNormal=texture2D(sceneNormal,uv).xyz;
    if(dot(surfaceNormal,surfaceNormal)>.64)return normalize(surfaceNormal);
    uv=(floor(uv/pixelSize)+.5)*pixelSize;
    vec3 l=p-positionAt(uv-vec2(pixelSize.x,0.0)),r=positionAt(uv+vec2(pixelSize.x,0.0))-p;
    vec3 b=p-positionAt(uv-vec2(0.0,pixelSize.y)),t=positionAt(uv+vec2(0.0,pixelSize.y))-p;
    vec3 n=cross(abs(l.z)<abs(r.z)?l:r,abs(b.z)<abs(t.z)?b:t);
    return length(n)>.00001?normalize(n):vec3(0.0,0.0,1.0);
  }
  float visibility(vec3 p){
    vec2 uv=(cameraWorld*vec4(p,1.0)).xz/battleExtent;
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 0.0;
    return 1.0-smoothstep(.02,.32,texture2D(battleFog,uv).r);
  }
  float ign(vec2 frag){
    return fract(52.9829189*fract(dot(floor(frag),vec2(.06711056,.00583715))));
  }
`;

const reconstructionGLSL3 = `
  uniform sampler2D sceneDepth, sceneNormal, sceneSurface, battleFog;
  uniform float battleExtent;
  uniform mat4 inverseProjection, cameraWorld;
  uniform vec2 pixelSize;
  in vec2 vUv;
  vec3 positionAt(vec2 uv){
    uv=(floor(uv/pixelSize)+.5)*pixelSize;
    vec4 p=inverseProjection*vec4(uv*2.0-1.0,texture(sceneDepth,uv).r*2.0-1.0,1.0);
    return p.xyz/p.w;
  }
  vec3 normalAt(vec2 uv,vec3 p){
    vec3 surfaceNormal=texture(sceneNormal,uv).xyz;
    if(dot(surfaceNormal,surfaceNormal)>.64)return normalize(surfaceNormal);
    uv=(floor(uv/pixelSize)+.5)*pixelSize;
    vec3 l=p-positionAt(uv-vec2(pixelSize.x,0.0)),r=positionAt(uv+vec2(pixelSize.x,0.0))-p;
    vec3 b=p-positionAt(uv-vec2(0.0,pixelSize.y)),t=positionAt(uv+vec2(0.0,pixelSize.y))-p;
    vec3 n=cross(abs(l.z)<abs(r.z)?l:r,abs(b.z)<abs(t.z)?b:t);
    return length(n)>.00001?normalize(n):vec3(0.0,0.0,1.0);
  }
  float visibility(vec3 p){
    vec2 uv=(cameraWorld*vec4(p,1.0)).xz/battleExtent;
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0))))return 0.0;
    return 1.0-smoothstep(.02,.32,texture(battleFog,uv).r);
  }
`;

/**
 * 战场实时全局光照（路线 A）：
 * - 时序重投影 + 3×3 方差钳制 + 多级 À-Trous SVGF 边缘保持降噪；
 * - 受战争迷雾严格裁剪的上一帧二次反弹反馈（近似多次漫反射 GI）；
 * - 粗糙度感知时序屏幕空间反射（SSR）；
 * - 延迟 PBR 动态战火/光束/自发光照明池（32 盏实时光源 + 局部接触阴影）与全分辨率日光接触阴影。
 */
export class BattleGI {
  readonly supported: boolean;
  private mode: LightingQuality = 'off';
  private color = new WebGLRenderTarget(1, 1, {
    count: 3, type: HalfFloatType, depthTexture: new DepthTexture(1, 1, UnsignedIntType),
    minFilter: NearestFilter, magFilter: NearestFilter,
  });
  private indirect = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter,
  });
  // MRT 历史双缓冲：tex[0]=累积 GI/AO，tex[1]=世界法线与世界高度 Y（精确反重影与脱遮挡检验）
  private history: [WebGLRenderTarget, WebGLRenderTarget];
  private filtered: [WebGLRenderTarget, WebGLRenderTarget];
  private reflectionRaw = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType, depthBuffer: false, minFilter: NearestFilter, magFilter: NearestFilter,
  });
  private reflectionHistory: [WebGLRenderTarget, WebGLRenderTarget];

  private gather: ShaderMaterial;
  private temporal: ShaderMaterial;
  private atrous: ShaderMaterial;
  private reflect: ShaderMaterial;
  private reflectTemporal: ShaderMaterial;
  private resolve: ShaderMaterial;
  private quad: FullScreenQuad;
  private size = new Vector2();
  private giWidth = 0;
  private giHeight = 0;
  private frameIndex = 0;
  private historySlot = 0;
  private hasHistory = false;
  private prevViewProjection = new Matrix4();
  private currentViewProjection = new Matrix4();
  private sunWorldDir = new Vector3(-598, 1150, -462).normalize();
  private sunViewDir = new Vector3(0, 1, 0);

  private lightPosRad: Vector4[] = Array.from({ length: MAX_BATTLE_LIGHTS }, () => new Vector4());
  private lightColInt: Vector4[] = Array.from({ length: MAX_BATTLE_LIGHTS }, () => new Vector4());
  private activeLights = 0;

  constructor(private renderer: WebGLRenderer, fog: { value: Texture }, extent: { value: number }) {
    this.supported = renderer.extensions.has('EXT_color_buffer_float');
    const makeHistory = () => new WebGLRenderTarget(1, 1, {
      count: 2, type: HalfFloatType, depthBuffer: false,
      minFilter: LinearFilter, magFilter: LinearFilter,
    });
    const makeTarget = () => new WebGLRenderTarget(1, 1, {
      type: HalfFloatType, depthBuffer: false,
      minFilter: LinearFilter, magFilter: LinearFilter,
    });
    this.history = [makeHistory(), makeHistory()];
    this.filtered = [makeTarget(), makeTarget()];
    this.reflectionHistory = [makeTarget(), makeTarget()];

    const shared = {
      sceneDepth: { value: this.color.depthTexture },
      battleFog: fog,
      battleExtent: extent,
      sceneNormal: { value: this.color.textures[1] },
      sceneSurface: { value: this.color.textures[2] },
      inverseProjection: { value: new Matrix4() },
      cameraWorld: { value: new Matrix4() },
      pixelSize: { value: new Vector2() },
    };
    const indirectSize = { value: new Vector2(1, 1) };
    const prevViewProjUniform = { value: this.prevViewProjection };
    const hasHistoryUniform = { value: 0 };
    const framePhaseUniform = { value: 0 };

    // 1) 多反弹屏幕空间全局光采样（含时序黄金角旋转与迷雾裁剪的二次反弹反馈）
    this.gather = new ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        ...shared,
        sceneColor: { value: this.color.texture },
        prevIndirect: { value: this.history[0].textures[0] },
        prevViewProjection: prevViewProjUniform,
        hasHistory: hasHistoryUniform,
        framePhase: framePhaseUniform,
        sampleCount: { value: 16 },
        multiBounce: { value: .38 },
        radiusUv: { value: new Vector2() },
      },
      vertexShader,
      fragmentShader: reconstruction + `
        uniform sampler2D sceneColor, prevIndirect;
        uniform mat4 prevViewProjection;
        uniform float hasHistory, framePhase, multiBounce;
        uniform int sampleCount;
        uniform vec2 radiusUv;
        const float bounceRadius = ${bounceRadius.toFixed(1)};
        void main(){
          vec3 p = positionAt(vUv);
          float visible = visibility(p);
          if(visible == 0.0 || texture2D(sceneDepth, vUv).r >= .999999){
            gl_FragColor = vec4(0.0);
            return;
          }
          vec3 n = normalAt(vUv, p), bounce = vec3(0.0);
          float occlusion = 0.0;
          // 黄金角逐帧旋转 + 交错梯度噪声：配合时序 SVGF 在 8–12 帧内累积出百级有效采样。
          float rotation = 6.2831853 * fract(ign(gl_FragCoord.xy) + framePhase);
          for(int i = 0; i < 32; i++){
            if(i >= sampleCount) break;
            float fraction = (float(i) + .5) / float(sampleCount);
            float angle = float(i) * 2.39996323 + rotation;
            vec2 uv = vUv + vec2(cos(angle), sin(angle)) * sqrt(fraction) * radiusUv;
            if(any(lessThan(uv, pixelSize)) || any(greaterThan(uv, 1.0 - pixelSize))) continue;
            if(texture2D(sceneDepth, uv).r >= .999999) continue;
            vec3 q = positionAt(uv), delta = q - p;
            float d2 = dot(delta, delta), d = sqrt(d2);
            if(d < .75 || d > bounceRadius) continue;
            vec3 direction = delta / d;
            float receive = max(0.0, dot(n, direction) - .03);
            float falloff = pow(1.0 - d / bounceRadius, 1.85);
            float sourceVisible = visibility(q);
            occlusion += receive * pow(1.0 - min(1.0, d / 46.0), 1.8) * sourceVisible;
            if(receive == 0.0 || sourceVisible == 0.0) continue;
            // 两点深度遮挡检验，抑制跨过前景单位／建筑的漏光。
            vec3 mid1 = positionAt(mix(vUv, uv, .38));
            vec3 mid2 = positionAt(mix(vUv, uv, .68));
            if(mid1.z > mix(p.z, q.z, .38) + 2.6 || mid2.z > mix(p.z, q.z, .68) + 2.6) continue;
            vec3 sourceNormal = normalAt(uv, q);
            float emit = max(0.0, dot(sourceNormal, -direction));
            float form = min(4.2, (bounceRadius * bounceRadius * .48) / max(d2, 18.0)) * receive * emit / max(.32, sourceNormal.z);
            vec3 radiance = min(texture2D(sceneColor, uv).rgb, vec3(4.5));
            // 二次反弹反馈：叠加源表面上一帧已受照间接光（严格受当前迷雾 sourceVisible 裁剪，能量有界）。
            if(hasHistory > .5 && multiBounce > .01){
              vec4 qWorld = cameraWorld * vec4(q, 1.0);
              vec4 qPrev = prevViewProjection * qWorld;
              vec2 qPrevUv = qPrev.xy / qPrev.w * .5 + .5;
              if(all(greaterThan(qPrevUv, vec2(.002))) && all(lessThan(qPrevUv, vec2(.998)))){
                vec4 qSurf = texture2D(sceneSurface, uv);
                vec3 qAlbedo = clamp(qSurf.rgb, 0.0, 1.0) * (1.0 - qSurf.a);
                vec3 prevBounce = min(texture2D(prevIndirect, qPrevUv).rgb, vec3(.95));
                radiance += prevBounce * qAlbedo * multiBounce;
              }
            }
            bounce += min(radiance, vec3(5.5)) * form * falloff * sourceVisible;
          }
          bounce *= visible / float(sampleCount);
          gl_FragColor = vec4(min(bounce, vec3(1.15)), min(.28, occlusion * 3.1 / float(sampleCount)) * visible);
        }`,
    });

    // 2) 时序重投影 + 3×3 方差钳制 + 几何引导写入（GLSL3 MRT 2 附件）
    this.temporal = new ShaderMaterial({
      glslVersion: GLSL3,
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        ...shared,
        currentIndirect: { value: this.indirect.texture },
        prevIndirect: { value: this.history[0].textures[0] },
        prevGeo: { value: this.history[0].textures[1] },
        prevViewProjection: prevViewProjUniform,
        indirectSize,
        hasHistory: hasHistoryUniform,
        maxHistory: { value: 8.0 },
      },
      vertexShader: vertexShaderGLSL3,
      fragmentShader: reconstructionGLSL3 + `
        uniform sampler2D currentIndirect, prevIndirect, prevGeo;
        uniform mat4 prevViewProjection;
        uniform vec2 indirectSize;
        uniform float hasHistory, maxHistory;
        layout(location = 0) out vec4 outGI;
        layout(location = 1) out vec4 outGeo;
        void main(){
          vec3 p = positionAt(vUv);
          float depth = texture(sceneDepth, vUv).r;
          vec3 n = normalAt(vUv, p);
          vec3 worldPos = (cameraWorld * vec4(p, 1.0)).xyz;
          vec3 worldNorm = normalize(mat3(cameraWorld) * n);
          outGeo = vec4(worldNorm, worldPos.y);
          float visible = visibility(p);
          if(visible < .01 || depth >= .999999){
            outGI = vec4(0.0);
            return;
          }
          vec4 cur = texture(currentIndirect, vUv);
          // 3×3 空间邻域统计，用于 SVGF 方差钳制（抑制移动单位／战火闪变重影）。
          vec4 m1 = vec4(0.0), m2 = vec4(0.0);
          float wSum = 0.0;
          vec2 texel = 1.0 / indirectSize;
          for(int dy = -1; dy <= 1; dy++) for(int dx = -1; dx <= 1; dx++){
            vec2 suv = clamp(vUv + vec2(float(dx), float(dy)) * texel, texel * .5, 1.0 - texel * .5);
            vec3 q = positionAt(suv);
            vec3 qn = normalAt(suv, q);
            float w = exp(-abs(dot(n, q - p)) / 2.2) * pow(max(0.0, dot(n, qn)), 6.0);
            w = (dx == 0 && dy == 0) ? 1.0 : w;
            vec4 s = texture(currentIndirect, suv);
            m1 += s * w;
            m2 += s * s * w;
            wSum += w;
          }
          vec4 mean = m1 / max(wSum, .0001);
          vec4 variance = max(vec4(0.0), m2 / max(wSum, .0001) - mean * mean);
          vec4 stdDev = sqrt(variance);

          if(hasHistory > .5){
            vec4 prevClip = prevViewProjection * vec4(worldPos, 1.0);
            vec2 prevUv = prevClip.xy / prevClip.w * .5 + .5;
            if(all(greaterThan(prevUv, texel)) && all(lessThan(prevUv, 1.0 - texel))){
              vec4 pGeo = texture(prevGeo, prevUv);
              float nMatch = dot(worldNorm, normalize(pGeo.xyz + vec3(0.0, 0.0, 1e-5)));
              float hDiff = abs(worldPos.y - pGeo.w);
              if(nMatch > .86 && hDiff < 2.6){
                vec4 hist = texture(prevIndirect, prevUv);
                vec4 clamped = clamp(hist, mean - stdDev * 1.45, mean + stdDev * 1.45);
                // 战火瞬间闪亮时自动提高当前帧权重，保证照明即时响应。
                float curLum = dot(cur.rgb, vec3(.299, .587, .114));
                float histLum = dot(clamped.rgb, vec3(.299, .587, .114));
                float shock = smoothstep(.10, .42, abs(curLum - histLum));
                float alpha = mix(1.0 / max(2.0, maxHistory), .34, shock);
                outGI = mix(clamped, cur, alpha) * visible;
                return;
              }
            }
          }
          outGI = cur * visible;
        }`,
    });

    // 3) 多级 À-Trous SVGF 边缘保持小波滤波（步长 1 → 2 → 4）
    this.atrous = new ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        ...shared,
        indirectLight: { value: this.history[0].textures[0] },
        indirectSize,
        stepSize: { value: 1.0 },
      },
      vertexShader,
      fragmentShader: reconstruction + `
        uniform sampler2D indirectLight;
        uniform vec2 indirectSize;
        uniform float stepSize;
        float luma(vec3 c){return dot(c, vec3(.299, .587, .114));}
        void main(){
          vec3 p = positionAt(vUv), n = normalAt(vUv, p);
          vec4 center = texture2D(indirectLight, vUv);
          float cLum = luma(center.rgb);
          vec4 acc = center;
          float total = 1.0;
          vec2 stepUv = stepSize / indirectSize;
          for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
            if(x == 0 && y == 0) continue;
            vec2 uv = clamp(vUv + vec2(float(x), float(y)) * stepUv, vec2(.001), vec2(.999));
            vec3 q = positionAt(uv), qn = normalAt(uv, q);
            vec4 sampleVal = texture2D(indirectLight, uv);
            float k = (abs(x) + abs(y) == 1) ? .5 : .25;
            float wGeo = exp(-abs(dot(n, q - p)) / (1.8 + stepSize * .35));
            float wNorm = pow(max(0.0, dot(n, qn)), 12.0);
            float wLum = exp(-abs(cLum - luma(sampleVal.rgb)) / (.16 + cLum * .50));
            float w = k * wGeo * wNorm * wLum;
            acc += sampleVal * w;
            total += w;
          }
          gl_FragColor = acc / max(total, .00001);
        }`,
    });

    // 4) 粗糙度感知屏幕空间反射（SSR）+ 抖动步进 + 二分精修
    this.reflect = new ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false, vertexShader,
      uniforms: {
        ...shared,
        sceneColor: { value: this.color.texture },
        projection: { value: new Matrix4() },
        stepCount: { value: 20 },
        framePhase: framePhaseUniform,
      },
      fragmentShader: reconstruction + `
        uniform sampler2D sceneColor;
        uniform mat4 projection;
        uniform int stepCount;
        uniform float framePhase;
        vec2 projectPoint(vec3 p){vec4 clip = projection * vec4(p, 1.0); return clip.xy / clip.w * .5 + .5;}
        void main(){
          gl_FragColor = vec4(0.0);
          if(texture2D(sceneDepth, vUv).r >= .999999) return;
          vec4 material = texture2D(sceneSurface, vUv), normalRough = texture2D(sceneNormal, vUv);
          float roughness = normalRough.a;
          if(dot(normalRough.xyz, normalRough.xyz) < .64 || roughness > .82) return;
          vec3 p = positionAt(vUv), n = normalize(normalRough.xyz);
          float visible = visibility(p);
          if(visible == 0.0) return;

          // 按表面粗糙度做微锥角时序扰动，让陶瓷装甲与拉丝枪钢呈现柔和真实高光反射。
          float noise = fract(ign(gl_FragCoord.xy) + framePhase);
          float coneAng = 6.2831853 * fract(ign(gl_FragCoord.xy + 19.3) + framePhase * 1.618);
          vec3 tangent = normalize(abs(n.y) < .9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
          vec3 bitangent = cross(n, tangent);
          float spread = roughness * roughness * .16;
          vec3 glossyN = normalize(n + (tangent * cos(coneAng) + bitangent * sin(coneAng)) * spread);

          vec3 ray = reflect(vec3(0.0, 0.0, -1.0), glossyN);
          vec3 start = p + n * 1.25;
          float maxRange = 220.0;
          float previousT = 0.0, previousGap = -1.0;
          for(int i = 1; i <= 40; i++){
            if(i > stepCount) break;
            float t = maxRange * (float(i) - 1.0 + noise) / float(stepCount);
            vec3 point = start + ray * t;
            vec2 uv = projectPoint(point);
            if(any(lessThan(uv, pixelSize)) || any(greaterThan(uv, 1.0 - pixelSize))) break;
            if(texture2D(sceneDepth, uv).r >= .999999){ previousT = t; continue; }
            vec3 surface = positionAt(uv);
            float gap = surface.z - point.z;
            if(gap > 0.0 && previousGap <= 0.0){
              float lower = previousT, upper = t;
              for(int refine = 0; refine < 4; refine++){
                float middle = (lower + upper) * .5;
                vec3 q = start + ray * middle;
                vec2 midUv = projectPoint(q);
                if(positionAt(midUv).z - q.z > 0.0) upper = middle; else lower = middle;
              }
              point = start + ray * upper;
              uv = projectPoint(point);
              surface = positionAt(uv);
              float thickness = surface.z - point.z;
              if(thickness >= 0.0 && thickness < 4.2 && distance(p, surface) > 2.0){
                float hitVisible = visibility(surface);
                if(hitVisible == 0.0) break;
                float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
                float fade = smoothstep(0.0, .08, edge) * (1.0 - upper / (maxRange * 1.1)) * hitVisible * visible;
                vec3 f0 = mix(vec3(.04), clamp(material.rgb, 0.0, 1.0), material.a);
                vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - max(0.0, n.z), 5.0);
                vec3 reflected = min(texture2D(sceneColor, uv).rgb, vec3(6.0));
                float energy = pow(1.0 - roughness, 1.85) * .72;
                gl_FragColor = vec4(reflected * fresnel, fade * energy);
                break;
              }
            }
            previousGap = gap;
            previousT = t;
          }
        }`,
    });

    // 5) 反射时序平滑 + 粗糙度感知空间双边滤波（彻底消除水面与金属反射闪烁）
    this.reflectTemporal = new ShaderMaterial({
      depthTest: false, depthWrite: false, toneMapped: false, vertexShader,
      uniforms: {
        ...shared,
        currentRefl: { value: this.reflectionRaw.texture },
        prevRefl: { value: this.reflectionHistory[0].texture },
        prevGeo: { value: this.history[0].textures[1] },
        prevViewProjection: prevViewProjUniform,
        indirectSize,
        hasHistory: hasHistoryUniform,
      },
      fragmentShader: reconstruction + `
        uniform sampler2D currentRefl, prevRefl, prevGeo;
        uniform mat4 prevViewProjection;
        uniform vec2 indirectSize;
        uniform float hasHistory;
        void main(){
          vec3 p = positionAt(vUv);
          float visible = visibility(p);
          if(visible < .01 || texture2D(sceneDepth, vUv).r >= .999999){
            gl_FragColor = vec4(0.0);
            return;
          }
          vec3 n = normalAt(vUv, p);
          float rough = texture2D(sceneNormal, vUv).a;
          vec2 texel = 1.0 / indirectSize;
          // 粗糙度越大空间模糊稍宽，镜面水面保持清晰倒影。
          float blurSpan = mix(.65, 1.45, clamp(rough, 0.0, 1.0));
          vec4 acc = vec4(0.0);
          float wSum = 0.0;
          for(int dy = -1; dy <= 1; dy++) for(int dx = -1; dx <= 1; dx++){
            vec2 suv = clamp(vUv + vec2(float(dx), float(dy)) * texel * blurSpan, texel * .5, 1.0 - texel * .5);
            vec3 q = positionAt(suv), qn = normalAt(suv, q);
            float w = exp(-float(dx * dx + dy * dy) * .45) * exp(-abs(dot(n, q - p)) / 2.4) * pow(max(0.0, dot(n, qn)), 10.0);
            acc += texture2D(currentRefl, suv) * w;
            wSum += w;
          }
          vec4 cur = acc / max(wSum, .0001);
          if(hasHistory > .5){
            vec3 worldPos = (cameraWorld * vec4(p, 1.0)).xyz;
            vec3 worldNorm = normalize(mat3(cameraWorld) * n);
            vec4 prevClip = prevViewProjection * vec4(worldPos, 1.0);
            vec2 prevUv = prevClip.xy / prevClip.w * .5 + .5;
            if(all(greaterThan(prevUv, texel)) && all(lessThan(prevUv, 1.0 - texel))){
              vec4 pGeo = texture2D(prevGeo, prevUv);
              if(dot(worldNorm, normalize(pGeo.xyz + vec3(0.0, 0.0, 1e-5))) > .88 && abs(worldPos.y - pGeo.w) < 2.2){
                vec4 prev = texture2D(prevRefl, prevUv);
                gl_FragColor = mix(prev, cur, .22) * visible;
                return;
              }
            }
          }
          gl_FragColor = cur * visible;
        }`,
    });

    // 6) 全分辨率合成：双边上采样 SVGF GI + SSR + 32 盏延迟 PBR 动态战火光源 + 日光屏幕空间接触阴影
    this.resolve = new ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        ...shared,
        sceneColor: { value: this.color.texture },
        indirectLight: { value: this.filtered[0].texture },
        reflectionLight: { value: this.reflectionHistory[0].texture },
        projection: { value: new Matrix4() },
        indirectSize,
        bounceStrength: { value: 1.28 },
        occlusionStrength: { value: 1.05 },
        sunViewDir: { value: this.sunViewDir },
        contactShadows: { value: 0.0 },
        uLightCount: { value: 0 },
        uLightPosRad: { value: this.lightPosRad },
        uLightColInt: { value: this.lightColInt },
      },
      vertexShader,
      fragmentShader: reconstruction + `
        uniform sampler2D sceneColor, indirectLight, reflectionLight;
        uniform mat4 projection;
        uniform vec2 indirectSize;
        uniform float bounceStrength, occlusionStrength, contactShadows;
        uniform vec3 sunViewDir;
        uniform int uLightCount;
        uniform vec4 uLightPosRad[${MAX_BATTLE_LIGHTS}];
        uniform vec4 uLightColInt[${MAX_BATTLE_LIGHTS}];

        vec2 projectPoint(vec3 p){vec4 clip = projection * vec4(p, 1.0); return clip.xy / clip.w * .5 + .5;}

        // 轻量 GGX 局部 PBR 着色（供炮火爆炸、光束、单位灯带实时照亮周边装甲与地形）
        vec3 evalDynamicLight(vec3 worldPos, vec3 worldN, vec3 viewDirW, vec3 albedo, float rough, float metal, vec4 posRad, vec4 colInt){
          vec3 toLight = posRad.xyz - worldPos;
          float d2 = dot(toLight, toLight);
          float r = posRad.w;
          if(d2 >= r * r) return vec3(0.0);
          float d = sqrt(max(d2, .01));
          vec3 L = toLight / d;
          float ndl = max(0.0, dot(worldN, L));
          if(ndl <= 0.0) return vec3(0.0);
          float ratio = d / r;
          float win = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
          float att = (win * win) / (d2 * .0014 + 1.0);
          vec3 radiance = colInt.rgb * colInt.a * att;

          vec3 F0 = mix(vec3(.04), albedo, metal);
          vec3 H = normalize(L + viewDirW);
          float ndh = max(0.0, dot(worldN, H));
          float ndv = max(.02, dot(worldN, viewDirW));
          float vdh = max(0.0, dot(viewDirW, H));
          float a = max(.06, rough * rough);
          float a2 = a * a;
          float denom = ndh * ndh * (a2 - 1.0) + 1.0;
          float D = a2 / (3.14159265 * denom * denom + 1e-4);
          vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
          float k = (rough + 1.0) * (rough + 1.0) * .125;
          float G = (ndv / (ndv * (1.0 - k) + k)) * (ndl / (ndl * (1.0 - k) + k));
          vec3 spec = (D * G * F) / max(4.0 * ndv * ndl, .05);
          vec3 kd = (1.0 - F) * (1.0 - metal);
          return (kd * albedo * .31830989 + min(spec, vec3(2.2))) * radiance * ndl;
        }

        // 全分辨率微距屏幕空间接触阴影（沿太阳光方向捕捉靴尖、装甲缝、履带底的微阴影）
        float sunContactShadow(vec3 p, vec3 n){
          if(contactShadows < .5 || dot(n, sunViewDir) <= .05) return 1.0;
          float j = ign(gl_FragCoord.xy);
          float occ = 0.0;
          for(int i = 1; i <= 5; i++){
            float t = (float(i) - .4 + j * .45) * 1.95;
            vec3 sampleP = p + sunViewDir * t;
            vec2 suv = projectPoint(sampleP);
            if(any(lessThan(suv, pixelSize)) || any(greaterThan(suv, 1.0 - pixelSize))) break;
            float depthDiff = positionAt(suv).z - sampleP.z;
            if(depthDiff > .45 && depthDiff < 7.5){
              occ = max(occ, 1.0 - float(i) * .16);
            }
          }
          return 1.0 - occ * .34;
        }

        void main(){
          vec3 color = texture2D(sceneColor, vUv).rgb;
          float depth = texture2D(sceneDepth, vUv).r;
          if(depth >= .999999){
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }
          vec3 p = positionAt(vUv), n = normalAt(vUv, p);
          vec2 texel = vUv * indirectSize - .5, base = floor(texel);
          vec4 lighting = vec4(0.0);
          vec3 reflected = vec3(0.0);
          float total = 0.0;
          for(int y = 0; y < 2; y++) for(int x = 0; x < 2; x++){
            vec2 cell = base + vec2(float(x), float(y)), uv = (cell + .5) / indirectSize;
            vec3 q = positionAt(uv), qn = normalAt(uv, q);
            vec2 blend = 1.0 - abs(texel - cell);
            float weight = blend.x * blend.y * exp(-abs(dot(n, q - p)) / 1.7) * pow(max(0.0, dot(n, qn)), 8.0);
            lighting += texture2D(indirectLight, uv) * weight;
            vec4 refl = texture2D(reflectionLight, uv);
            reflected += refl.rgb * refl.a * weight;
            total += weight;
          }
          lighting /= max(total, .00001);
          float visible = visibility(p);
          vec4 normalRough = texture2D(sceneNormal, vUv);
          bool hasPbr = dot(normalRough.xyz, normalRough.xyz) >= .64;
          vec4 surface = texture2D(sceneSurface, vUv);
          vec3 albedo = clamp(surface.rgb, 0.0, 1.0);
          float metalness = clamp(surface.a, 0.0, 1.0);
          float roughness = clamp(normalRough.a, .04, 1.0);
          vec3 reflectance = hasPbr ? albedo * (1.0 - metalness) : vec3(0.0);

          float contact = hasPbr ? sunContactShadow(p, n) : 1.0;
          float aoFactor = 1.0 - lighting.a * occlusionStrength * visible;
          color = color * aoFactor * mix(1.0, contact, visible)
                + lighting.rgb * reflectance * bounceStrength * visible;
          color += reflected / max(total, .00001) * visible;

          // 延迟 PBR 动态战火与自发光照亮（严格受战争迷雾 visible 遮蔽）
          if(hasPbr && visible > .01 && uLightCount > 0){
            vec3 worldPos = (cameraWorld * vec4(p, 1.0)).xyz;
            vec3 worldN = normalize(mat3(cameraWorld) * n);
            vec3 viewDirW = normalize(mat3(cameraWorld) * vec3(0.0, 0.0, 1.0));
            vec3 dyn = vec3(0.0);
            for(int i = 0; i < ${MAX_BATTLE_LIGHTS}; i++){
              if(i >= uLightCount) break;
              dyn += evalDynamicLight(worldPos, worldN, viewDirW, albedo, roughness, metalness, uLightPosRad[i], uLightColInt[i]);
            }
            color += min(dyn, vec3(3.2)) * visible;
          }

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });

    this.quad = new FullScreenQuad(this.gather);
  }

  get quality() { return this.mode; }
  get pcssStrength() { return this.mode === 'off' ? 0 : presets[this.mode].pcss; }

  set quality(value: LightingQuality) {
    const mode = this.supported ? value : 'off';
    if (mode === this.mode) return;
    this.mode = mode;
    this.resetHistory();
    const samples = mode === 'off' ? 0 : Math.min(presets[mode].msaa, this.renderer.capabilities.maxSamples);
    if (this.color.samples !== samples) {
      this.color.dispose();
      this.color.samples = samples;
    }
    if (this.mode === 'off') {
      this.color.setSize(1, 1);
      this.indirect.setSize(1, 1);
      this.reflectionRaw.setSize(1, 1);
      for (const target of [...this.history, ...this.filtered, ...this.reflectionHistory]) target.setSize(1, 1);
      this.giWidth = this.giHeight = 0;
    }
  }

  resetHistory() {
    this.hasHistory = false;
    this.frameIndex = 0;
  }

  setSunDirection(worldDir: Vector3) {
    this.sunWorldDir.copy(worldDir).normalize();
  }

  setDynamicLights(lights: readonly BattleDynamicLight[], count: number) {
    const cap = this.mode === 'off' ? 0 : Math.min(count, presets[this.mode].maxLights, MAX_BATTLE_LIGHTS);
    this.activeLights = cap;
    for (let i = 0; i < cap; i++) {
      const l = lights[i];
      this.lightPosRad[i].set(l.x, l.y, l.z, l.radius);
      this.lightColInt[i].set(l.r, l.g, l.b, l.intensity);
    }
  }

  render(scene: Scene, camera: OrthographicCamera) {
    const gl = this.renderer;
    if (this.mode === 'off') {
      gl.render(scene, camera);
      return;
    }
    const preset = presets[this.mode];
    gl.getDrawingBufferSize(this.size);
    this.color.setSize(this.size.x, this.size.y);
    const width = Math.max(1, Math.round(this.size.x * preset.scale));
    const height = Math.max(1, Math.round(this.size.y * preset.scale));
    if (width !== this.giWidth || height !== this.giHeight) {
      this.giWidth = width;
      this.giHeight = height;
      this.indirect.setSize(width, height);
      this.reflectionRaw.setSize(width, height);
      for (const target of [...this.history, ...this.filtered, ...this.reflectionHistory]) target.setSize(width, height);
      this.hasHistory = false;
    }

    camera.updateMatrixWorld();
    this.currentViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.sunViewDir.copy(this.sunWorldDir).transformDirection(camera.matrixWorldInverse).normalize();

    const readSlot = this.historySlot;
    const writeSlot = 1 - this.historySlot;

    this.gather.uniforms.pixelSize.value.set(1 / this.size.x, 1 / this.size.y);
    this.gather.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.gather.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.gather.uniforms.sampleCount.value = preset.samples;
    this.gather.uniforms.multiBounce.value = preset.multiBounce;
    this.gather.uniforms.prevIndirect.value = this.history[readSlot].textures[0];
    this.gather.uniforms.hasHistory.value = this.hasHistory ? 1 : 0;
    this.gather.uniforms.framePhase.value = ((this.frameIndex % 64) * 0.61803398875) % 1;
    this.gather.uniforms.radiusUv.value.set(
      bounceRadius * camera.zoom / (camera.right - camera.left),
      bounceRadius * camera.zoom / (camera.top - camera.bottom),
    );

    this.temporal.uniforms.prevIndirect.value = this.history[readSlot].textures[0];
    this.temporal.uniforms.prevGeo.value = this.history[readSlot].textures[1];
    this.temporal.uniforms.maxHistory.value = preset.maxHistory;

    this.reflect.uniforms.projection.value.copy(camera.projectionMatrix);
    this.reflect.uniforms.stepCount.value = preset.reflectionSteps;
    this.reflectTemporal.uniforms.prevRefl.value = this.reflectionHistory[readSlot].texture;
    this.reflectTemporal.uniforms.prevGeo.value = this.history[readSlot].textures[1];

    this.resolve.uniforms.projection.value.copy(camera.projectionMatrix);
    this.resolve.uniforms.indirectSize.value.set(width, height);
    this.resolve.uniforms.contactShadows.value = preset.contactShadows ? 1 : 0;
    this.resolve.uniforms.uLightCount.value = this.activeLights;
    this.resolve.uniforms.reflectionLight.value = this.reflectionHistory[writeSlot].texture;

    const target = gl.getRenderTarget();
    try {
      // 1) 主场景全分辨率 MRT 渲染
      gl.setRenderTarget(this.color);
      gl.render(scene, camera);

      // 2) 多反弹 SSGI 采样
      this.quad.material = this.gather;
      gl.setRenderTarget(this.indirect);
      this.quad.render(gl);

      // 3) 时序重投影 + 方差钳制 + 写入几何引导
      this.quad.material = this.temporal;
      gl.setRenderTarget(this.history[writeSlot]);
      this.quad.render(gl);

      // 4) 多级 À-Trous SVGF 边缘保持小波降噪（step = 1, 2, 4）
      let srcTex = this.history[writeSlot].textures[0];
      let outIdx = 0;
      for (let pass = 0; pass < preset.atrousPasses; pass++) {
        outIdx = pass & 1;
        this.atrous.uniforms.indirectLight.value = srcTex;
        this.atrous.uniforms.stepSize.value = 1 << pass;
        this.quad.material = this.atrous;
        gl.setRenderTarget(this.filtered[outIdx]);
        this.quad.render(gl);
        srcTex = this.filtered[outIdx].texture;
      }
      this.resolve.uniforms.indirectLight.value = srcTex;

      // 5) 粗糙度感知 SSR + 时序平滑滤波
      this.quad.material = this.reflect;
      gl.setRenderTarget(this.reflectionRaw);
      this.quad.render(gl);

      this.quad.material = this.reflectTemporal;
      gl.setRenderTarget(this.reflectionHistory[writeSlot]);
      this.quad.render(gl);

      // 6) 全分辨率合成（SVGF GI + SSR + 动态战火光源 + 日光接触阴影 + ACES）
      this.quad.material = this.resolve;
      gl.setRenderTarget(target);
      this.quad.render(gl);
    } finally {
      gl.setRenderTarget(target);
    }

    this.prevViewProjection.copy(this.currentViewProjection);
    this.historySlot = writeSlot;
    this.hasHistory = true;
    this.frameIndex++;
  }

  dispose() {
    this.color.dispose();
    this.indirect.dispose();
    this.reflectionRaw.dispose();
    for (const target of [...this.history, ...this.filtered, ...this.reflectionHistory]) target.dispose();
    this.gather.dispose();
    this.temporal.dispose();
    this.atrous.dispose();
    this.reflect.dispose();
    this.reflectTemporal.dispose();
    this.resolve.dispose();
    this.quad.dispose();
  }
}
