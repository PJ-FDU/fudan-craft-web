import {
  DepthTexture, HalfFloatType, Matrix4, NearestFilter, ShaderMaterial, UnsignedIntType,
  Vector2, WebGLRenderTarget, type OrthographicCamera, type Scene, type Texture, type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export type LightingQuality = 'off' | 'balanced' | 'high';
const settings = {balanced:{scale:.35,samples:16},high:{scale:.5,samples:32}};
const bounceRadius=54;
const vertexShader=`varying vec2 vUv;
  void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const reconstruction=`
  uniform sampler2D sceneDepth, battleFog;
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
    // 半分辨率像素落在全分辨率纹素边界；先对齐中心，防止差分重复采到同一行。
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
`;

/** WebGL 2 单次屏幕空间漫反射反弹；无历史缓存，迷雾更新不会留下残影。 */
export class BattleGI {
  readonly supported:boolean;
  private mode:LightingQuality='off';
  private color=new WebGLRenderTarget(1,1,{
    type:HalfFloatType,depthTexture:new DepthTexture(1,1,UnsignedIntType),
  });
  private indirect=new WebGLRenderTarget(1,1,{type:HalfFloatType,depthBuffer:false,minFilter:NearestFilter,magFilter:NearestFilter});
  private filtered=this.indirect.clone();
  private gather:ShaderMaterial;
  private denoise:ShaderMaterial;
  private resolve:ShaderMaterial;
  private quad:FullScreenQuad;
  private size=new Vector2();

  constructor(private renderer:WebGLRenderer,fog:{value:Texture},extent:{value:number}){
    this.supported=renderer.extensions.has('EXT_color_buffer_float');
    this.color.samples=Math.min(4,renderer.capabilities.maxSamples);
    const shared={
      sceneDepth:{value:this.color.depthTexture},battleFog:fog,battleExtent:extent,
      inverseProjection:{value:new Matrix4()},cameraWorld:{value:new Matrix4()},
      pixelSize:{value:new Vector2()},
    };
    this.gather=new ShaderMaterial({
      depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...shared,sceneColor:{value:this.color.texture},sampleCount:{value:16},radiusUv:{value:new Vector2()}},
      vertexShader,
      fragmentShader:reconstruction+`
        uniform sampler2D sceneColor;
        uniform int sampleCount;
        uniform vec2 radiusUv;
        const float bounceRadius=${bounceRadius.toFixed(1)};
        void main(){
          vec3 p=positionAt(vUv);
          float visible=visibility(p);
          if(visible==0.0||texture2D(sceneDepth,vUv).r>=.999999){gl_FragColor=vec4(0.0);return;}
          vec3 n=normalAt(vUv,p),bounce=vec3(0.0);
          float occlusion=0.0;
          // 空间交错旋转打散低采样条带；固定像素种子，不引入逐帧随机闪烁。
          float rotation=6.2831853*fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
          for(int i=0;i<32;i++){
            if(i>=sampleCount)break;
            float fraction=(float(i)+.5)/float(sampleCount);
            float angle=float(i)*2.39996323+rotation;
            vec2 uv=vUv+vec2(cos(angle),sin(angle))*sqrt(fraction)*radiusUv;
            if(any(lessThan(uv,pixelSize))||any(greaterThan(uv,1.0-pixelSize)))continue;
            if(texture2D(sceneDepth,uv).r>=.999999)continue;
            vec3 q=positionAt(uv),delta=q-p;
            float d2=dot(delta,delta),d=sqrt(d2);
            if(d<.75||d>bounceRadius)continue;
            vec3 direction=delta/d;
            float receive=max(0.0,dot(n,direction)-.035);
            float falloff=pow(1.0-d/bounceRadius,2.0);
            float sourceVisible=visibility(q);
            occlusion+=receive*falloff*sourceVisible;
            if(receive==0.0||sourceVisible==0.0)continue;
            // 中点屏幕深度检验抑制跨越前景遮挡物的漏光。
            vec3 middle=positionAt((uv+vUv)*.5);
            if(middle.z>(p.z+q.z)*.5+2.5)continue;
            vec3 sourceNormal=normalAt(uv,q);
            float emit=max(0.0,dot(sourceNormal,-direction));
            float form=min(4.0,bounceRadius*bounceRadius/max(d2,16.0))*receive*emit/max(.3,sourceNormal.z);
            vec3 radiance=min(texture2D(sceneColor,uv).rgb,vec3(4.0));
            bounce+=radiance*form*falloff*sourceVisible;
          }
          bounce*=visible/float(sampleCount);
          gl_FragColor=vec4(min(bounce,vec3(.8)),min(.24,occlusion*3.0/float(sampleCount))*visible);
        }`,
    });
    const indirectSize={value:new Vector2()};
    this.denoise=new ShaderMaterial({
      depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...shared,indirectLight:{value:this.indirect.texture},indirectSize},
      vertexShader,
      fragmentShader:reconstruction+`
        uniform sampler2D indirectLight;
        uniform vec2 indirectSize;
        void main(){
          vec3 p=positionAt(vUv),n=normalAt(vUv,p);
          vec4 light=vec4(0.0);float total=0.0;
          for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
            vec2 uv=vUv+vec2(float(x),float(y))/indirectSize;
            vec3 q=positionAt(uv),qn=normalAt(uv,q);
            float spatial=exp(-float(x*x+y*y)*.32);
            float weight=spatial*exp(-abs(dot(n,q-p))/1.5)*pow(max(0.0,dot(n,qn)),8.0);
            light+=texture2D(indirectLight,uv)*weight;total+=weight;
          }
          gl_FragColor=light/max(total,.00001);
        }`,
    });
    this.resolve=new ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{...shared,sceneColor:{value:this.color.texture},indirectLight:{value:this.filtered.texture},
        indirectSize,bounceStrength:{value:1.15},occlusionStrength:{value:1}},
      vertexShader,
      fragmentShader:reconstruction+`
        uniform sampler2D sceneColor,indirectLight;
        uniform vec2 indirectSize;
        uniform float bounceStrength,occlusionStrength;
        void main(){
          vec3 color=texture2D(sceneColor,vUv).rgb,p=positionAt(vUv),n=normalAt(vUv,p);
          vec2 texel=vUv*indirectSize-.5,base=floor(texel);
          vec4 lighting=vec4(0.0);float total=0.0;
          // 深度/法线双边上采样，减少低分辨率间接光跨过装甲和地面的轮廓。
          for(int y=0;y<2;y++)for(int x=0;x<2;x++){
            vec2 cell=base+vec2(float(x),float(y)),uv=(cell+.5)/indirectSize;
            vec3 q=positionAt(uv),qn=normalAt(uv,q);
            vec2 blend=1.0-abs(texel-cell);
            float weight=blend.x*blend.y*exp(-abs(dot(n,q-p))/1.5)*pow(max(0.0,dot(n,qn)),8.0);
            lighting+=texture2D(indirectLight,uv)*weight;total+=weight;
          }
          lighting/=max(total,.00001);
          float visible=visibility(p);
          // 当前管线没有独立 albedo G-buffer；用有界色调近似接收面的漫反射率。
          float peak=max(color.r,max(color.g,color.b));
          vec3 reflectance=clamp(color/max(.18,peak)*.65,vec3(.08),vec3(.65));
          color=color*(1.0-lighting.a*occlusionStrength*visible)+lighting.rgb*reflectance*bounceStrength*visible;
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.quad=new FullScreenQuad(this.gather);
  }

  get quality(){return this.mode;}
  set quality(value:LightingQuality){
    this.mode=this.supported?value:'off';
    if(this.mode==='off'){this.color.setSize(1,1);this.indirect.setSize(1,1);this.filtered.setSize(1,1);}
  }

  render(scene:Scene,camera:OrthographicCamera){
    const gl=this.renderer;
    if(this.mode==='off'){gl.render(scene,camera);return;}
    const quality=settings[this.mode];
    gl.getDrawingBufferSize(this.size);
    this.color.setSize(this.size.x,this.size.y);
    const width=Math.max(1,Math.round(this.size.x*quality.scale)),height=Math.max(1,Math.round(this.size.y*quality.scale));
    this.indirect.setSize(width,height);
    this.filtered.setSize(width,height);
    this.gather.uniforms.pixelSize.value.set(1/this.size.x,1/this.size.y);
    this.gather.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    // render() 之前更新矩阵，保证本帧转动镜头时重建位置与主渲染一致。
    camera.updateMatrixWorld();
    this.gather.uniforms.cameraWorld.value.copy(camera.matrixWorld);
    this.gather.uniforms.sampleCount.value=quality.samples;
    this.gather.uniforms.radiusUv.value.set(bounceRadius*camera.zoom/(camera.right-camera.left),bounceRadius*camera.zoom/(camera.top-camera.bottom));
    this.resolve.uniforms.indirectSize.value.set(width,height);
    const target=gl.getRenderTarget();
    try{
      gl.setRenderTarget(this.color);gl.render(scene,camera);
      this.quad.material=this.gather;gl.setRenderTarget(this.indirect);this.quad.render(gl);
      this.quad.material=this.denoise;gl.setRenderTarget(this.filtered);this.quad.render(gl);
      this.quad.material=this.resolve;gl.setRenderTarget(target);this.quad.render(gl);
    }finally{gl.setRenderTarget(target);}
  }

  dispose(){
    this.color.dispose();this.indirect.dispose();this.filtered.dispose();
    this.gather.dispose();this.denoise.dispose();this.resolve.dispose();this.quad.dispose();
  }
}
