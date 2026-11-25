import {
  BufferAttribute, BufferGeometry, Matrix4, Mesh, OrthographicCamera,
  RectAreaLight, Scene, SkinnedMesh, Vector3,
} from 'three';
import type { CinematicBackend, CinematicBackendId } from './cinematic-backend.js';

interface Proxy {source:Mesh;mesh:Mesh;bone?:number;deform?:boolean}
export interface CinematicTracerOptions {forceWebGL?:boolean}
const realtimeSettleTime=120;

/**
 * 与实际模型共用材质和顶点。刚性骨骼拆成实例，运动时直接更新 TLAS 变换矩阵；
 * 动态交互期间启用全分辨率 SVGF 实时降噪与运动矢量时序重投影，
 * 静止后无闪烁无缝切换到完整物理分辨率 6 次反弹渐进精修。
 * 优先使用 WebGPU compute 路径追踪；不可用或失败时自动切换 WebGL 2 BVH 路径追踪。
 */
export class CinematicTracer {
  private backend?:CinematicBackend;
  private scene=new Scene();
  private camera=new OrthographicCamera();
  private proxies:Proxy[]=[];
  private geometries:BufferGeometry[]=[];
  private disposed=false;
  private dirty=true;
  private poseDirty=true;
  private deforming=false;
  private previousCamera=new Matrix4();
  private previousProjection=new Matrix4();
  private lastMotion=0;
  private inStaticPhase=false;
  private hasDisplayed=false;
  private displayedDenoise?:boolean;
  private lastProgressiveSample=-1;
  private lastProgressiveDisplay=0;
  private lastMeasurement=0;
  private measuring=false;
  private revision=0;
  denoise=true;

  constructor(
    private canvas:HTMLCanvasElement,
    private status:HTMLElement,
    private options:CinematicTracerOptions={},
  ){}

  get backendId():CinematicBackendId|undefined{return this.backend?.id;}

  private resetCanvas(){
    const next=document.createElement('canvas');
    next.id=this.canvas.id;
    next.hidden=true;
    const label=this.canvas.getAttribute('aria-label');
    if(label)next.setAttribute('aria-label',label);
    this.canvas.replaceWith(next);
    this.canvas=next;
  }

  async init(){
    const preferWebGL=Boolean(this.options.forceWebGL)||
      (typeof location!=='undefined'&&new URLSearchParams(location.search).get('pathtrace')==='webgl2');
    const canTryWebGPU=!preferWebGL&&typeof navigator!=='undefined'&&'gpu' in navigator&&Boolean(navigator.gpu);
    let webgpuError:unknown;
    if(canTryWebGPU){
      try{
        const {WebGPUCinematicBackend}=await import('./cinematic-webgpu-backend.js');
        if(this.disposed)return;
        const backend=new WebGPUCinematicBackend(this.canvas);
        await backend.init();
        if(this.disposed){backend.dispose();return;}
        this.backend=backend;
      }catch(error){
        webgpuError=error;
        console.warn('WebGPU 光追不可用，自动切换到 WebGL 2 光追后备',error);
        if(this.disposed)return;
        this.resetCanvas();
      }
    }
    if(!this.backend){
      try{
        const {WebGLCinematicBackend}=await import('./cinematic-webgl-backend.js');
        if(this.disposed)return;
        const backend=new WebGLCinematicBackend(this.canvas);
        await backend.init();
        if(this.disposed){backend.dispose();return;}
        this.backend=backend;
      }catch(webglError){
        throw webgpuError
          ?new Error('WebGPU 与 WebGL 2 电影光追均不可用',{cause:{webgpuError,webglError}})
          :webglError;
      }
    }
    this.canvas.dataset.renderer=this.backend.id;
    this.canvas.dataset.bounces='6';
  }

  capture(source:Scene,span:number){
    if(!this.backend||this.disposed)return;
    this.canvas.hidden=true;this.backend.resetScene();this.scene.clear();
    for(const geometry of this.geometries)geometry.dispose();
    this.geometries=[];this.proxies=[];this.deforming=false;
    this.scene.background=source.background;this.scene.environment=source.environment;
    this.scene.environmentIntensity=source.environmentIntensity;
    source.updateMatrixWorld(true);
    source.traverseVisible(object=>{
      if(object instanceof Mesh)this.addMesh(object);
    });
    // 真正参与 BVH 路径积分的面积光：软阴影、装甲高光和多次间接反弹。
    const key=new RectAreaLight(0xffdcc0,18,span*.75,span*.8);
    key.position.set(-span*1.4,span*1.2,span*.25);key.lookAt(0,span*.2,0);
    const rim=new RectAreaLight(0x8cbbff,12,span*.65,span);
    rim.position.set(span*.9,span*.75,-span);rim.lookAt(0,span*.25,0);
    const fill=new RectAreaLight(0xadc3d6,2.5,span,span*1.2);
    fill.position.set(span,span*.5,span*1.4);fill.lookAt(0,span*.2,0);
    this.scene.add(key,rim,fill);
    this.dirty=true;this.poseDirty=true;this.inStaticPhase=false;
    this.hasDisplayed=false;this.displayedDenoise=undefined;this.lastProgressiveSample=-1;
    this.revision++;
    this.canvas.dataset.samples='0';this.canvas.dataset.instances=String(this.proxies.length);
    this.status.textContent='初始化高清实时光追…';
  }

  private addMesh(source:Mesh){
    if(!(source instanceof SkinnedMesh)){
      const mesh=new Mesh(source.geometry,source.material);mesh.matrixAutoUpdate=false;
      this.scene.add(mesh);this.proxies.push({source,mesh});return;
    }
    const geometry:BufferGeometry=source.geometry,skin=geometry.getAttribute('skinIndex'),weights=geometry.getAttribute('skinWeight');
    const index=geometry.index,vertexCount=geometry.getAttribute('position').count;
    const bones=new Map<number,number[]>();let rigid=!!skin&&!!weights;
    if(rigid)for(let i=0;i<vertexCount;i++){
      if(Math.abs(weights.getX(i)-1)>.0001||weights.getY(i)||weights.getZ(i)||weights.getW(i)){rigid=false;break;}
    }
    if(rigid)for(let i=0;i<(index?.count??vertexCount);i+=3){
      const a=index?index.getX(i):i,b=index?index.getX(i+1):i+1,c=index?index.getX(i+2):i+2;
      const bone=skin.getX(a);
      if(skin.getX(b)!==bone||skin.getX(c)!==bone){rigid=false;break;}
      const triangles=bones.get(bone)??[];triangles.push(a,b,c);bones.set(bone,triangles);
    }
    if(rigid){
      for(const [bone,triangles] of bones){
        const part=new BufferGeometry();
        // 保留原始 UV 和法线，不引入第二份模型或贴图烘焙。
        for(const [name,attribute] of Object.entries(geometry.attributes)){
          if(name==='skinIndex'||name==='skinWeight')continue;
          const array=new Float32Array(triangles.length*attribute.itemSize);
          for(let i=0;i<triangles.length;i++)for(let c=0;c<attribute.itemSize;c++)
            array[i*attribute.itemSize+c]=attribute.getComponent(triangles[i],c);
          part.setAttribute(name,new BufferAttribute(array,attribute.itemSize));
        }
        const mesh=new Mesh(part,source.material);mesh.matrixAutoUpdate=false;
        this.geometries.push(part);this.scene.add(mesh);this.proxies.push({source,mesh,bone});
      }
    }else{
      const part=geometry.clone();part.deleteAttribute('skinIndex');part.deleteAttribute('skinWeight');
      const pos=part.getAttribute('position');
      part.setAttribute('prevPosition',new BufferAttribute(new Float32Array(pos.array),3));
      const mesh=new Mesh(part,source.material);mesh.matrixAutoUpdate=false;
      this.geometries.push(part);this.scene.add(mesh);this.proxies.push({source,mesh,deform:true});this.deforming=true;
    }
  }

  private syncTransforms(initializePrev=false){
    const transform=new Matrix4(),position=new Vector3();
    for(const {source,mesh,bone,deform} of this.proxies){
      source.updateWorldMatrix(true,false);
      if(source instanceof SkinnedMesh){
        source.skeleton.update();
        if(bone!==undefined){
          transform.copy(source.bindMatrixInverse).multiply(source.skeleton.bones[bone].matrixWorld)
            .multiply(source.skeleton.boneInverses[bone]).multiply(source.bindMatrix);
          mesh.matrix.copy(source.matrixWorld).multiply(transform);
        }else if(deform){
          const original=source.geometry.getAttribute('position');
          const baked=mesh.geometry.getAttribute('position');
          const prevPos=mesh.geometry.getAttribute('prevPosition');
          if(!initializePrev&&prevPos){
            (prevPos.array as Float32Array).set(baked.array as Float32Array);
            prevPos.needsUpdate=true;
          }
          for(let i=0;i<original.count;i++){
            position.fromBufferAttribute(original,i);source.applyBoneTransform(i,position);
            baked.setXYZ(i,position.x,position.y,position.z);
          }
          if(initializePrev&&prevPos){
            (prevPos.array as Float32Array).set(baked.array as Float32Array);
            prevPos.needsUpdate=true;
          }
          baked.needsUpdate=true;mesh.geometry.computeVertexNormals();
          mesh.geometry.boundsTree?.refit();mesh.matrix.copy(source.matrixWorld);
        }
      }else mesh.matrix.copy(source.matrixWorld);
      mesh.matrixWorldNeedsUpdate=true;
    }
  }

  private labelPrefix(backend:CinematicBackend){
    return backend.id==='webgl2-bvh'?'高清实时光追 (WebGL 2)':'高清实时光追';
  }

  render(sourceCamera:OrthographicCamera,changing:boolean,now:number,poseChanged=true){
    const backend=this.backend;
    if(!backend||this.disposed)return;
    const preview=this.canvas.parentElement?.querySelector<HTMLCanvasElement>('#model-preview');
    if(!preview)return;
    const rect=preview.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height);
    // 与光栅预览共用 DPR 上限；比较物理像素，避免 Retina 下每帧误判尺寸变化而清空采样。
    const pixelRatio=Math.min(devicePixelRatio,2);
    const resized=backend.setSize(width,height,pixelRatio);
    if(resized){
      this.canvas.dataset.samples='0';
      this.hasDisplayed=false;
      this.inStaticPhase=false;
      this.lastProgressiveSample=-1;
    }
    this.canvas.dataset.pixelRatio=String(pixelRatio);
    sourceCamera.updateMatrixWorld();
    const cameraMoved=resized||!this.previousCamera.equals(sourceCamera.matrixWorld)||!this.previousProjection.equals(sourceCamera.projectionMatrix);
    this.previousCamera.copy(sourceCamera.matrixWorld);this.previousProjection.copy(sourceCamera.projectionMatrix);
    if(poseChanged)this.poseDirty=true;
    const moving=changing||cameraMoved;
    this.canvas.dataset.motion=String(moving);

    // 首次捕获模型：构建 BVH 并进入异步编译。
    if(this.dirty){
      backend.setRealtimeMode(moving&&!(this.deforming&&!backend.supportsRealtimeDeform&&poseChanged));
      backend.prepareCamera(sourceCamera,this.camera);
      this.syncTransforms(true);
      backend.setScene(this.scene,this.camera,false);
      this.dirty=false;this.poseDirty=false;this.inStaticPhase=!moving;
      this.revision++;this.lastProgressiveSample=-1;
      if(moving)this.lastMotion=now;
    }

    // 编译期间保持光栅预览（或已有画布），待管线就绪再显示实时光追。
    if(backend.compiling){
      backend.renderSample();
      if(!this.hasDisplayed)this.canvas.hidden=true;
      this.canvas.dataset.mode='compiling';
      this.status.textContent=`${this.labelPrefix(backend)} · 编译光追管线…`;
      return;
    }

    // WebGPU 柔体蒙皮在播放骨骼动画期间避免逐帧重建 BVH 管线；暂停动作或旋转视角立即切换实时光追。
    if(this.deforming&&!backend.supportsRealtimeDeform&&poseChanged){
      this.canvas.hidden=true;this.hasDisplayed=false;this.inStaticPhase=false;
      this.lastMotion=now;this.revision++;backend.resetHistory();
      this.canvas.dataset.mode='raster';this.canvas.dataset.samples='0';
      this.canvas.dataset.denoise='off';this.canvas.dataset.gpuMs='0';
      this.status.textContent='实时预览 · 柔体播放中，暂停动作后可旋转实时光追';
      return;
    }

    const prefix=this.labelPrefix(backend);

    // 实时动态路径：播放刚性动作、拖动旋转、自动旋转、缩放，以及 WebGL 2 柔体播放均逐帧高清实时光追。
    if(moving){
      this.lastMotion=now;
      const enteredRealtime=this.inStaticPhase;
      if(this.inStaticPhase){
        this.inStaticPhase=false;
        this.displayedDenoise=undefined;
        this.lastProgressiveSample=-1;
        this.revision++;
      }
      backend.setRealtimeMode(true);
      backend.prepareCamera(sourceCamera,this.camera);
      if(this.poseDirty){
        this.syncTransforms(false);
        backend.setScene(this.scene,this.camera,!this.deforming);
        this.poseDirty=false;
      }else if(cameraMoved||enteredRealtime){
        backend.updateCamera(this.camera);
      }
      backend.renderSample();
      this.canvas.dataset.traceSize=`${backend.traceWidth}x${backend.traceHeight}`;
      this.canvas.dataset.gpuMs=backend.gpuMs.toFixed(1);
      if(backend.hasFrame){
        backend.display(this.scene,this.camera,{
          denoise:this.denoise,temporal:true,effectiveSamples:1,updateHistory:true,
        });
        this.canvas.hidden=false;this.hasDisplayed=true;
        this.canvas.dataset.mode='realtime';
        this.canvas.dataset.samples='1';
        this.canvas.dataset.denoise=this.denoise?'svgf':'off';
        this.status.textContent=`${prefix} · 实时追踪 (${backend.traceWidth}×${backend.traceHeight} → ${this.canvas.width}×${this.canvas.height})${this.denoise?' · SVGF 降噪':' · 原始画面'}`;
      }
      return;
    }

    // 刚停止运动后的短暂稳定窗口：继续用实时 SVGF 时序累积降噪，零闪烁、零延迟。
    if(!this.inStaticPhase&&now-this.lastMotion<realtimeSettleTime){
      if(this.hasDisplayed&&backend.isLowRes){
        backend.renderSample();
        if(backend.hasFrame){
          backend.display(this.scene,this.camera,{
            denoise:this.denoise,temporal:true,effectiveSamples:2,updateHistory:true,
          });
          this.canvas.hidden=false;
          this.canvas.dataset.mode='realtime';
          this.canvas.dataset.traceSize=`${backend.traceWidth}x${backend.traceHeight}`;
          this.canvas.dataset.gpuMs=backend.gpuMs.toFixed(1);
        }
        return;
      }
    }

    // 进入静止完整物理分辨率 6 次反弹渐进精修（始终保留当前高清画面，绝不闪回光栅或黑屏）。
    if(!this.inStaticPhase){
      this.inStaticPhase=true;
      this.displayedDenoise=undefined;
      this.lastProgressiveSample=-1;
      this.lastProgressiveDisplay=0;
      this.revision++;
      backend.setRealtimeMode(false);
      backend.prepareCamera(sourceCamera,this.camera);
      if(this.poseDirty){
        this.syncTransforms(!this.hasDisplayed);
        backend.setScene(this.scene,this.camera,!this.deforming);
        this.poseDirty=false;
      }else{
        backend.updateCamera(this.camera);
      }
      this.canvas.dataset.samples='0';
    }

    if(!backend.complete)backend.renderSample();
    this.canvas.dataset.traceSize=`${backend.traceWidth}x${backend.traceHeight}`;
    this.canvas.dataset.gpuMs=backend.gpuMs.toFixed(1);
    const target=backend.targetSamples;

    if(backend.complete){
      if(this.displayedDenoise!==this.denoise){
        backend.display(this.scene,this.camera,{
          denoise:this.denoise,temporal:false,effectiveSamples:target,updateHistory:false,
        });
        this.displayedDenoise=this.denoise;
      }
      this.canvas.hidden=false;this.hasDisplayed=true;
      this.canvas.dataset.mode='complete';this.canvas.dataset.samples=String(target);
      this.canvas.dataset.denoise=this.denoise?'spatial':'off';
      this.status.textContent=`${prefix} · ${target} / ${target} 采样${this.denoise?' · 已降噪':' · 原始画面'}`;
      return;
    }

    // 异步采样统计（WebGPU 首样本预热 120ms 轮询，之后 350ms 节流；WebGL 2 直接同步读取）。
    if(backend.measureSamplesAsync){
      const interval=backend.fullResReady?350:120;
      if(!backend.compiling&&now-this.lastMeasurement>interval&&!this.measuring){
        this.lastMeasurement=now;this.measuring=true;
        const revision=this.revision;
        void backend.measureSamplesAsync().then(counts=>{
          if(this.disposed||revision!==this.revision)return;
          this.canvas.dataset.samples=counts.avg.toFixed(1);
          this.canvas.dataset.gpuMs=backend.gpuMs.toFixed(1);
        }).catch(()=>{/* GPU 丢失由渲染入口回退；测量失败不影响交互。 */}).finally(()=>{this.measuring=false;});
      }
    }else{
      this.canvas.dataset.samples=backend.samples.toFixed(1);
    }

    const shownSamples=Math.floor(Number(this.canvas.dataset.samples));
    if(backend.fullResReady){
      const sampleStepped=shownSamples!==this.lastProgressiveSample;
      const denoiseChanged=this.displayedDenoise!==this.denoise;
      const dueRefresh=backend.measureSamplesAsync?(now-this.lastProgressiveDisplay>=140||this.lastProgressiveDisplay===0):sampleStepped;
      if(denoiseChanged||dueRefresh){
        backend.display(this.scene,this.camera,{
          denoise:this.denoise,temporal:false,effectiveSamples:Math.max(1,shownSamples),updateHistory:false,
        });
        this.displayedDenoise=this.denoise;
        this.lastProgressiveSample=shownSamples;
        this.lastProgressiveDisplay=now;
      }
      this.canvas.hidden=false;this.hasDisplayed=true;
      this.canvas.dataset.mode='progressive';
      this.canvas.dataset.denoise=this.denoise?'svgf':'off';
      this.status.textContent=`${prefix} · 精修 ${Math.max(1,shownSamples)} / ${target}${this.denoise?' · 已降噪':' · 原始画面'}`;
    }else{
      // 全分辨率首样本尚未填满所有像素时，继续保留上一帧高清实时光追画面（首次静止启动则保留光栅直到首样本就绪）。
      if(!this.hasDisplayed)this.canvas.hidden=true;
      this.canvas.dataset.mode='progressive';
      this.status.textContent=`${prefix} · 切换全分辨率精修…`;
    }
  }

  dispose(){
    if(this.disposed)return;this.disposed=true;this.backend?.dispose();this.backend=undefined;
    for(const geometry of this.geometries)geometry.dispose();
    this.scene.clear();this.canvas.remove();
  }
}
