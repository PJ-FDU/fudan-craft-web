import {
  Color, DataTexture, GLSL3, HalfFloatType, Matrix4, Mesh, NearestFilter, NoBlending, NoToneMapping,
  RGBAFormat, ShaderMaterial, UnsignedByteType, WebGLRenderTarget,
  type Material, type MeshStandardMaterial, type OrthographicCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { CinematicDisplayOptions } from './cinematic-backend.js';

const quadVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

const makeGuideVertex = (hasPrevPos: boolean) => `
${hasPrevPos ? 'in vec3 prevPosition;' : ''}
uniform mat4 uCurrViewProj;
uniform mat4 uPrevViewProj;
uniform mat4 uPrevModelMatrix;
out vec3 vWorldNormal;
out vec3 vViewPos;
out vec2 vUv;
out vec4 vCurrClip;
out vec4 vPrevClip;
void main(){
  vUv=uv;
  vec4 worldPos=modelMatrix*vec4(position,1.0);
  vec4 viewPos=viewMatrix*worldPos;
  vViewPos=viewPos.xyz;
  vWorldNormal=normalize(transpose(inverse(mat3(modelMatrix)))*normal);
  vCurrClip=uCurrViewProj*worldPos;
  vec3 prevPos=${hasPrevPos ? 'prevPosition' : 'position'};
  vPrevClip=uPrevViewProj*(uPrevModelMatrix*vec4(prevPos,1.0));
  gl_Position=projectionMatrix*viewPos;
}`;

const guideFragment = `
precision highp float;
uniform vec3 uColor;
uniform float uObjectId;
uniform bool uHasMap;
uniform sampler2D uMap;
in vec3 vWorldNormal;
in vec3 vViewPos;
in vec2 vUv;
in vec4 vCurrClip;
in vec4 vPrevClip;
layout(location=0) out vec4 gGuide;
layout(location=1) out vec4 gAlbedo;
layout(location=2) out vec4 gMotion;
void main(){
  vec3 n=normalize(vWorldNormal);
  if(!gl_FrontFacing)n=-n;
  vec3 albedo=uColor*(uHasMap?texture(uMap,vUv).rgb:vec3(1.0));
  vec2 currUv=vCurrClip.xy/vCurrClip.w*0.5+0.5;
  vec2 prevUv=vPrevClip.xy/vPrevClip.w*0.5+0.5;
  gGuide=vec4(n,-vViewPos.z);
  gAlbedo=vec4(albedo,uObjectId);
  gMotion=vec4(prevUv-currUv,0.0,0.0);
}`;

const temporalFragment = `
uniform sampler2D colorTex;
uniform sampler2D guideTex;
uniform sampler2D albedoTex;
uniform sampler2D motionTex;
uniform sampler2D prevGuideTex;
uniform sampler2D prevAlbedoTex;
uniform sampler2D prevHistoryTex;
uniform float temporalWeight;
uniform float hasHistory;
varying vec2 vUv;
void main(){
  ivec2 fullSize=textureSize(guideTex,0);
  ivec2 rawSize=textureSize(colorTex,0);
  ivec2 p=clamp(ivec2(vUv*vec2(fullSize)),ivec2(0),fullSize-1);
  vec4 guide=texelFetch(guideTex,p,0);
  vec4 albedo=texelFetch(albedoTex,p,0);
  vec3 safeAlbedo=max(albedo.rgb,vec3(0.08));

  vec3 currIllum=vec3(0.0);
  if(rawSize.x==fullSize.x&&rawSize.y==fullSize.y){
    currIllum=texelFetch(colorTex,p,0).rgb/safeAlbedo;
  }else{
    vec2 rawF=(vec2(p)+0.5)/vec2(fullSize)*vec2(rawSize)-0.5;
    ivec2 baseR=ivec2(floor(rawF));
    vec2 fracR=fract(rawF);
    vec3 sum=vec3(0.0);
    float wSum=0.0;
    for(int oy=-1;oy<=1;oy++){
      for(int ox=-1;ox<=1;ox++){
        ivec2 r=clamp(baseR+ivec2(ox,oy),ivec2(0),rawSize-1);
        ivec2 qFull=clamp(ivec2((vec2(r)+0.5)/vec2(rawSize)*vec2(fullSize)),ivec2(0),fullSize-1);
        vec4 qGuide=texelFetch(guideTex,qFull,0);
        vec4 qAlbedo=texelFetch(albedoTex,qFull,0);
        vec3 qIllum=texelFetch(colorTex,r,0).rgb/max(qAlbedo.rgb,vec3(0.08));
        bool sameObj=abs(albedo.a-qAlbedo.a)<0.25;
        float nw=(guide.w==0.0&&qGuide.w==0.0)?1.0:pow(clamp(dot(guide.xyz,qGuide.xyz),0.0,1.0),32.0);
        float dw=exp(-abs(guide.w-qGuide.w)/max(0.03,abs(guide.w)*0.015));
        vec2 d=vec2(float(ox),float(oy))-fracR;
        float sw=exp(-dot(d,d)/1.1);
        float w=sameObj?sw*nw*dw:0.0;
        sum+=qIllum*w;
        wSum+=w;
      }
    }
    if(wSum>0.0001){
      currIllum=sum/wSum;
    }else{
      ivec2 rFallback=clamp(ivec2((vec2(p)+0.5)/vec2(fullSize)*vec2(rawSize)),ivec2(0),rawSize-1);
      currIllum=texelFetch(colorTex,rFallback,0).rgb/safeAlbedo;
    }
  }

  float lum=dot(currIllum,vec3(0.2126,0.7152,0.0722));
  if(lum>18.0)currIllum*=18.0/lum;

  if(temporalWeight<=0.0||hasHistory<0.5){
    gl_FragColor=vec4(currIllum,1.0);
    return;
  }

  vec3 m1=currIllum;
  vec3 m2=currIllum*currIllum;
  float count=1.0;
  int stepPx=max(1,fullSize.x/max(rawSize.x,1));
  for(int ny=-1;ny<=1;ny++){
    for(int nx=-1;nx<=1;nx++){
      if(nx==0&&ny==0)continue;
      ivec2 np=clamp(p+ivec2(nx*stepPx,ny*stepPx),ivec2(0),fullSize-1);
      vec4 nGuide=texelFetch(guideTex,np,0);
      vec4 nAlbedo=texelFetch(albedoTex,np,0);
      if(abs(albedo.a-nAlbedo.a)>=0.25)continue;
      if(guide.w>0.0&&(nGuide.w<=0.0||dot(guide.xyz,nGuide.xyz)<0.7))continue;
      ivec2 nr=clamp(ivec2((vec2(np)+0.5)/vec2(fullSize)*vec2(rawSize)),ivec2(0),rawSize-1);
      vec3 nIllum=texelFetch(colorTex,nr,0).rgb/max(nAlbedo.rgb,vec3(0.08));
      float nl=dot(nIllum,vec3(0.2126,0.7152,0.0722));
      if(nl>18.0)nIllum*=18.0/nl;
      m1+=nIllum;
      m2+=nIllum*nIllum;
      count+=1.0;
    }
  }
  vec3 mean=m1/count;
  vec3 sigma=sqrt(max(m2/count-mean*mean,vec3(0.0)));
  float meanLum=max(dot(mean,vec3(0.2126,0.7152,0.0722)),0.001);
  float currLum=dot(currIllum,vec3(0.2126,0.7152,0.0722));
  if(count>=4.0&&(currLum<meanLum*0.15||currLum>meanLum*4.0)){
    currIllum=mix(currIllum,mean,0.65);
  }

  vec2 motion=texelFetch(motionTex,p,0).xy;
  vec2 prevCoord=(vec2(p)+0.5)/vec2(fullSize)+motion;
  if(prevCoord.x<0.0||prevCoord.x>1.0||prevCoord.y<0.0||prevCoord.y>1.0){
    gl_FragColor=vec4(currIllum,1.0);
    return;
  }

  vec2 prevF=prevCoord*vec2(fullSize)-0.5;
  ivec2 prevBase=ivec2(floor(prevF));
  vec2 prevFrac=fract(prevF);
  vec3 histSum=vec3(0.0);
  float lenSum=0.0;
  float histW=0.0;
  for(int hy=0;hy<=1;hy++){
    for(int hx=0;hx<=1;hx++){
      ivec2 hp=clamp(prevBase+ivec2(hx,hy),ivec2(0),fullSize-1);
      vec4 pGuide=texelFetch(prevGuideTex,hp,0);
      vec4 pAlbedo=texelFetch(prevAlbedoTex,hp,0);
      bool sameObj=abs(albedo.a-pAlbedo.a)<0.25;
      bool bgOk=guide.w==0.0&&pGuide.w==0.0;
      bool geomOk=guide.w>0.0&&pGuide.w>0.0&&
        dot(guide.xyz,pGuide.xyz)>0.85&&
        abs(guide.w-pGuide.w)<max(0.08,abs(guide.w)*0.035);
      if(sameObj&&(bgOk||geomOk)){
        float bw=(hx==1?prevFrac.x:1.0-prevFrac.x)*(hy==1?prevFrac.y:1.0-prevFrac.y);
        vec4 h=texelFetch(prevHistoryTex,hp,0);
        histSum+=h.rgb*bw;
        lenSum+=h.a*bw;
        histW+=bw;
      }
    }
  }
  if(histW<0.01){
    gl_FragColor=vec4(currIllum,1.0);
    return;
  }
  vec3 prevIllum=histSum/histW;
  float prevLen=lenSum/histW;
  vec3 minBox=max(vec3(0.0),mean-sigma*1.9-vec3(0.03));
  vec3 maxBox=mean+sigma*1.9+vec3(0.03);
  vec3 clampedPrev=clamp(prevIllum,minBox,maxBox);
  float nextLen=min(prevLen+1.0,16.0);
  float alpha=max(1.0/nextLen,0.08);
  vec3 blended=mix(clampedPrev,currIllum,mix(1.0,alpha,temporalWeight));
  gl_FragColor=vec4(blended,nextLen);
}`;

const atrousFragment = `
uniform sampler2D illumTex;
uniform sampler2D guideTex;
uniform sampler2D albedoTex;
uniform float stepSize;
uniform float illumSigma;
varying vec2 vUv;
void main(){
  ivec2 size=textureSize(illumTex,0);
  ivec2 p=clamp(ivec2(vUv*vec2(size)),ivec2(0),size-1);
  vec4 center=texelFetch(illumTex,p,0);
  vec4 guide=texelFetch(guideTex,p,0);
  vec4 albedo=texelFetch(albedoTex,p,0);
  int step=int(stepSize);
  float sigmaSq=max(0.01,illumSigma*illumSigma);
  float centerLen=length(center.rgb);
  vec3 sum=vec3(0.0);
  float total=0.0;
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      ivec2 q=clamp(p+ivec2(x*step,y*step),ivec2(0),size-1);
      vec4 sampleCol=texelFetch(illumTex,q,0);
      vec4 neighbor=texelFetch(guideTex,q,0);
      vec4 base=texelFetch(albedoTex,q,0);
      bool sameObj=abs(albedo.a-base.a)<0.25;
      float nw=(guide.w==0.0&&neighbor.w==0.0)?1.0:pow(clamp(dot(guide.xyz,neighbor.xyz),0.0,1.0),64.0);
      float dw=exp(-abs(guide.w-neighbor.w)/max(0.02,abs(guide.w)*0.008*stepSize));
      float sampleLen=length(sampleCol.rgb);
      float diff=length(sampleCol.rgb-center.rgb)/(0.22+0.5*(centerLen+sampleLen));
      float lw=exp(-(diff*diff)/sigmaSq);
      float kx=(x==0)?1.0:0.5;
      float ky=(y==0)?1.0:0.5;
      float weight=sameObj?kx*ky*nw*dw*lw:0.0;
      sum+=sampleCol.rgb*weight;
      total+=weight;
    }
  }
  gl_FragColor=vec4(sum/max(total,0.00001),center.a);
}`;

const remodulateDisplayFragment = `
uniform sampler2D illumTex;
uniform sampler2D albedoTex;
varying vec2 vUv;
void main(){
  ivec2 size=textureSize(illumTex,0);
  ivec2 p=clamp(ivec2(vUv*vec2(size)),ivec2(0),size-1);
  vec3 illum=texelFetch(illumTex,p,0).rgb;
  vec3 albedo=texelFetch(albedoTex,p,0).rgb;
  gl_FragColor=vec4(illum*max(albedo,vec3(0.08)),1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const rawDisplayFragment = `
uniform sampler2D colorTex;
varying vec2 vUv;
void main(){
  ivec2 size=textureSize(colorTex,0);
  ivec2 p=clamp(ivec2(vUv*vec2(size)),ivec2(0),size-1);
  gl_FragColor=vec4(texelFetch(colorTex,p,0).rgb,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 全分辨率 SVGF 实时＋渐进式路径追踪降噪器（WebGL 2 / GLSL 300 es），与 WebGPU 版算法严格对称。 */
export class CinematicWebGLDenoiser {
  private gbuf = [
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, count: 3 }),
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, count: 3 }),
  ];
  private history = [
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
  ];
  private atrous = [
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
    new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false }),
  ];
  private currIdx = 0;
  private hasHistory = false;
  private lastW = 0;
  private lastH = 0;
  private currViewProj = new Matrix4();
  private prevViewProj = new Matrix4();
  private fallbackTexture: DataTexture;
  private guideMaterials = new Map<string, ShaderMaterial>();
  private objects = new Map<Mesh, number>();
  private prevMatrices = new Map<Mesh, Matrix4>();
  private temporalMaterial: ShaderMaterial;
  private atrousMaterial: ShaderMaterial;
  private remodulateMaterial: ShaderMaterial;
  private rawScreenMaterial: ShaderMaterial;
  private quad: FullScreenQuad;
  private clearColor = new Color();

  constructor() {
    this.fallbackTexture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    this.fallbackTexture.needsUpdate = true;
    this.temporalMaterial = new ShaderMaterial({
      toneMapped: false, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: {
        colorTex: { value: null }, guideTex: { value: null }, albedoTex: { value: null }, motionTex: { value: null },
        prevGuideTex: { value: null }, prevAlbedoTex: { value: null }, prevHistoryTex: { value: null },
        temporalWeight: { value: 1 }, hasHistory: { value: 0 },
      },
      vertexShader: quadVertex, fragmentShader: temporalFragment,
    });
    this.atrousMaterial = new ShaderMaterial({
      toneMapped: false, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: {
        illumTex: { value: null }, guideTex: { value: null }, albedoTex: { value: null },
        stepSize: { value: 1 }, illumSigma: { value: 0.45 },
      },
      vertexShader: quadVertex, fragmentShader: atrousFragment,
    });
    this.remodulateMaterial = new ShaderMaterial({
      toneMapped: true, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: { illumTex: { value: null }, albedoTex: { value: null } },
      vertexShader: quadVertex, fragmentShader: remodulateDisplayFragment,
    });
    this.rawScreenMaterial = new ShaderMaterial({
      toneMapped: true, depthTest: false, depthWrite: false, blending: NoBlending,
      uniforms: { colorTex: { value: null } },
      vertexShader: quadVertex, fragmentShader: rawDisplayFragment,
    });
    this.quad = new FullScreenQuad(this.remodulateMaterial);
  }

  resetHistory() {
    this.hasHistory = false;
  }

  resetScene() {
    this.hasHistory = false;
    this.objects.clear();
    this.prevMatrices.clear();
    for (const material of this.guideMaterials.values()) material.dispose();
    this.guideMaterials.clear();
  }

  private guideMaterial(mesh: Mesh, source: Material, slot: number) {
    let id = this.objects.get(mesh);
    if (id === undefined) {
      id = this.objects.size + 1;
      this.objects.set(mesh, id);
    }
    const hasPrevPos = Boolean(mesh.geometry.getAttribute('prevPosition'));
    const key = `${id}:${slot}:${source.uuid}:${hasPrevPos ? 1 : 0}`;
    let material = this.guideMaterials.get(key);
    const original = source as MeshStandardMaterial;
    const prevMat = this.prevMatrices.get(mesh);
    if (!material) {
      material = new ShaderMaterial({
        glslVersion: GLSL3,
        side: source.side,
        toneMapped: false,
        blending: NoBlending,
        fog: false,
        uniforms: {
          uColor: { value: (original.color ? original.color.clone() : new Color(0xffffff)) },
          uObjectId: { value: id },
          uHasMap: { value: Boolean(original.map) },
          uMap: { value: original.map ?? this.fallbackTexture },
          uCurrViewProj: { value: this.currViewProj },
          uPrevViewProj: { value: this.prevViewProj },
          uPrevModelMatrix: { value: (this.hasHistory && prevMat ? prevMat : mesh.matrixWorld).clone() },
        },
        vertexShader: makeGuideVertex(hasPrevPos),
        fragmentShader: guideFragment,
      });
      this.guideMaterials.set(key, material);
    } else {
      if (original.color) (material.uniforms.uColor.value as Color).copy(original.color);
      material.uniforms.uHasMap.value = Boolean(original.map);
      material.uniforms.uMap.value = original.map ?? this.fallbackTexture;
      (material.uniforms.uPrevModelMatrix.value as Matrix4).copy(this.hasHistory && prevMat ? prevMat : mesh.matrixWorld);
    }
    return material;
  }

  render(
    renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera,
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
        this.rawScreenMaterial.uniforms.colorTex.value = raw;
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
        this.prevViewProj.copy(this.currViewProj);
      }

      const curr = this.currIdx;
      const prev = 1 - curr;
      const gbufCurr = this.gbuf[curr];
      const gbufPrev = this.gbuf[prev];
      const histCurr = this.history[curr];
      const histPrev = this.history[prev];

      // Pass 1: 全分辨率 MRT G-Buffer + 屏幕运动矢量
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

      // Pass 2: 联合双边解调上采样 + 时序重投影
      this.temporalMaterial.uniforms.colorTex.value = raw;
      this.temporalMaterial.uniforms.guideTex.value = gbufCurr.textures[0];
      this.temporalMaterial.uniforms.albedoTex.value = gbufCurr.textures[1];
      this.temporalMaterial.uniforms.motionTex.value = gbufCurr.textures[2];
      this.temporalMaterial.uniforms.prevGuideTex.value = gbufPrev.textures[0];
      this.temporalMaterial.uniforms.prevAlbedoTex.value = gbufPrev.textures[1];
      this.temporalMaterial.uniforms.prevHistoryTex.value = histPrev.texture;
      this.temporalMaterial.uniforms.temporalWeight.value = options.temporal ? 1 : 0;
      this.temporalMaterial.uniforms.hasHistory.value = this.hasHistory ? 1 : 0;
      renderer.setRenderTarget(histCurr);
      this.quad.material = this.temporalMaterial;
      this.quad.render(renderer);

      // Pass 3: 自适应多尺度 À-Trous 滤波
      const eff = Math.max(1, options.effectiveSamples);
      const passes = options.temporal ? 4 : eff < 16 ? 3 : eff < 64 ? 2 : 1;
      const baseSigma = options.temporal ? 0.92 : eff < 8 ? 0.65 : eff < 32 ? 0.38 : eff < 128 ? 0.26 : 0.21;
      this.atrousMaterial.uniforms.guideTex.value = gbufCurr.textures[0];
      this.atrousMaterial.uniforms.albedoTex.value = gbufCurr.textures[1];
      let readTex: Texture = histCurr.texture;
      for (let pass = 0; pass < passes; pass++) {
        const writeTarget = this.atrous[pass & 1];
        this.atrousMaterial.uniforms.illumTex.value = readTex;
        this.atrousMaterial.uniforms.stepSize.value = 1 << pass;
        this.atrousMaterial.uniforms.illumSigma.value = baseSigma * (pass === 0 ? 1 : pass === 1 ? 0.88 : pass === 2 ? 0.76 : 0.65);
        renderer.setRenderTarget(writeTarget);
        this.quad.material = this.atrousMaterial;
        this.quad.render(renderer);
        readTex = writeTarget.texture;
      }

      // Pass 4: 全分辨率 Albedo 重调制 + 单次 ACES / sRGB 显示
      this.remodulateMaterial.uniforms.illumTex.value = readTex;
      this.remodulateMaterial.uniforms.albedoTex.value = gbufCurr.textures[1];
      renderer.setRenderTarget(target);
      renderer.toneMapping = toneMapping;
      renderer.setClearColor(this.clearColor, clearAlpha);
      this.quad.material = this.remodulateMaterial;
      this.quad.render(renderer);

      if (options.updateHistory) {
        this.prevViewProj.copy(this.currViewProj);
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
    this.fallbackTexture.dispose();
    this.temporalMaterial.dispose();
    this.atrousMaterial.dispose();
    this.remodulateMaterial.dispose();
    this.rawScreenMaterial.dispose();
    this.quad.dispose();
  }
}
