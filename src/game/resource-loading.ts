/** 一次界面操作的真实进度。下载字节与解码/场景就绪分开，不用计时器伪造百分比。 */
interface ResourceTask {
  loaded:number;total:number;done:boolean;
}
export interface ResourceProgress {
  phase:string;loaded:number;total:number;completed:number;count:number;percent:number|null;
}
const tasks=new Map<string,ResourceTask>();
const listeners=new Set<()=>void>();
const blobs=new Map<string,Promise<Blob>>();
const images=new Map<string,Promise<HTMLImageElement>>();
const notify=()=>{for(const listener of listeners)listener();};
let active=0;
const queue:(()=>void)[]=[];
async function limited<T>(run:()=>Promise<T>){
  if(active>=6)await new Promise<void>(resolve=>queue.push(resolve));
  else active++;
  try{return await run();}
  finally{const next=queue.shift();if(next)next();else active--;}
}

export class ResourceLoad {
  private paths=new Set<string>();
  private phaseName='读取资源清单';
  private listener=()=>this.onProgress(this.snapshot());
  constructor(private onProgress:(progress:ResourceProgress)=>void=()=>{}){listeners.add(this.listener);}
  track(path:string){this.paths.add(path);this.listener();}
  phase(name:string){this.phaseName=name;this.listener();}
  snapshot():ResourceProgress{
    const entries=[...this.paths].map(path=>tasks.get(path)).filter((task):task is ResourceTask=>!!task);
    const loaded=entries.reduce((sum,task)=>sum+task.loaded,0),total=entries.reduce((sum,task)=>sum+task.total,0);
    return {phase:this.phaseName,loaded,total,completed:entries.filter(task=>task.done).length,count:entries.length,
      percent:total&&entries.every(task=>task.total>0)?Math.min(100,loaded/total*100):null};
  }
  dispose(){listeners.delete(this.listener);}
}

export function resourceBlob(path:string,load?:ResourceLoad,size=0):Promise<Blob>{
  let pending=blobs.get(path);
  if(!pending){
    const task:ResourceTask={loaded:0,total:size,done:false};
    tasks.set(path,task);
    pending=limited(async()=>{
      const controller=new AbortController();
      let timeout:ReturnType<typeof setTimeout>;
      const heartbeat=()=>{
        clearTimeout(timeout);
        timeout=setTimeout(()=>controller.abort(Error('下载长时间没有响应，请重试')),30_000);
      };
      heartbeat();
      try{
        const response=await fetch(path,{signal:controller.signal});
        if(!response.ok)throw Error(`资源下载失败 (${response.status})：${path.split('/').pop()}`);
        const length=Number(response.headers.get('Content-Length'));
        if(!response.headers.get('Content-Encoding')&&length>0)task.total=length;
        const chunks:Uint8Array<ArrayBuffer>[]=[];
        if(response.body){
          const reader=response.body.getReader();
          while(true){
            const result=await reader.read();
            if(result.done)break;
            heartbeat();chunks.push(result.value as Uint8Array<ArrayBuffer>);
            task.loaded+=result.value.byteLength;notify();
          }
        }else{
          const buffer=await response.arrayBuffer();
          chunks.push(new Uint8Array(buffer));task.loaded=buffer.byteLength;
        }
        task.total=task.loaded;task.done=true;notify();
        return new Blob(chunks,{type:response.headers.get('Content-Type')??'application/octet-stream'});
      }finally{clearTimeout(timeout!);}
    }).catch(error=>{blobs.delete(path);task.loaded=0;task.done=false;notify();throw error;});
    blobs.set(path,pending);
  }
  load?.track(path);
  return pending;
}

/** 解码或契约校验失败时丢弃该资源，下一次重试重新读取。 */
export function forgetResource(path:string){
  blobs.delete(path);images.delete(path);
}

export function resourceImage(path:string,load?:ResourceLoad,size=0):Promise<HTMLImageElement>{
  const bytes=resourceBlob(path,load,size);
  let pending=images.get(path);
  if(!pending){
    pending=bytes.then(async blob=>{
      const url=URL.createObjectURL(blob),image=new Image();
      try{image.src=url;await image.decode();return image;}
      finally{URL.revokeObjectURL(url);}
    }).catch(error=>{images.delete(path);blobs.delete(path);throw error;});
    images.set(path,pending);
  }
  return pending;
}

/** 原生 progress 在无总大小时保持不确定状态；字节读完后明确标记解析阶段。 */
export function resourceProgressMarkup(){
  return `<div class="resource-progress"><div class="resource-progress-heading"><span data-load-phase>读取资源清单</span><span data-load-percent></span></div><progress aria-label="资源下载进度" max="100"></progress><p data-load-detail>正在准备下载…</p></div>`;
}
export function updateResourceProgress(root:HTMLElement,progress:ResourceProgress){
  const bar=root.querySelector<HTMLProgressElement>('progress');
  if(!bar)return;
  const downloaded=progress.percent===100;
  root.querySelector<HTMLElement>('[data-load-phase]')!.textContent=
    downloaded&&progress.phase==='下载模型与材质'?'解析模型与材质':progress.phase;
  root.querySelector<HTMLElement>('[data-load-percent]')!.textContent=
    progress.percent===null?'':`${Math.floor(progress.percent)}%`;
  if(progress.percent===null)bar.removeAttribute('value');else bar.value=progress.percent;
  const mib=(bytes:number)=>(bytes/1048576).toFixed(1);
  root.querySelector<HTMLElement>('[data-load-detail]')!.textContent=progress.count?
    `已读取 ${mib(progress.loaded)}${progress.total?` / ${mib(progress.total)}`:''} MiB · ${progress.completed} / ${progress.count} 项`:
    '正在准备下载…';
}
