import { cachedMapVersion, cacheMapVersion } from '../game/map-version-cache.js';
import { registerMapSnapshot, validMapVersion, type MapSnapshot, type MapVersion } from '../game/map-versions.js';

export type MapSyncStatus='idle'|'checking'|'downloading'|'validating'|'caching'|'ready'|'error';
/** 版本切换或断线即废弃旧异步任务；就绪只在内容校验、注册地形之后发送。 */
export class MapSynchronizer {
  version:MapVersion|undefined;
  status:MapSyncStatus='idle';
  message='';
  private generation=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  constructor(private readonly send:(message:Record<string,unknown>)=>void,private readonly changed:()=>void,
    private readonly read=cachedMapVersion,private readonly write=cacheMapVersion){}
  select(raw:unknown):void {
    if(raw===undefined){this.reset();return;}
    if(!validMapVersion(raw)){this.reset();this.fail('房间地图版本无效');return;}
    if(this.version&&JSON.stringify(this.version)===JSON.stringify(raw))return;
    this.reset();this.version={...raw};void this.load(++this.generation);
  }
  reset():void {this.generation++;clearTimeout(this.timer);this.version=undefined;this.status='idle';this.message='';}
  retry():void {if(this.version)void this.load(++this.generation);}
  private set(status:MapSyncStatus,message:string):void {this.status=status;this.message=message;this.changed();}
  private fail(message:string):void {clearTimeout(this.timer);this.set('error',message);}
  private async load(generation:number):Promise<void> {
    clearTimeout(this.timer);const version=this.version;if(!version)return;
    this.set('checking','正在检查本地地图版本…');
    try{
      const snapshot=await this.read(version);
      if(generation!==this.generation)return;
      if(snapshot){
        const checked=registerMapSnapshot(snapshot);
        if(JSON.stringify(checked.version)!==JSON.stringify(version))throw Error('本地缓存版本不匹配');
        this.ready(generation,'本地缓存已校验，地图就绪');return;
      }
      this.set('downloading',`正在下载地图 · ${(version.byteLength/1024).toFixed(0)} KiB`);
      this.timer=setTimeout(()=>{if(generation===this.generation)this.fail('地图同步超时，请重试');},30_000);
      this.send({type:'map-request',mapId:version.mapId,contentHash:version.contentHash});
    }catch(error){if(generation===this.generation)this.fail((error as Error).message);}
  }
  async receive(raw:unknown):Promise<void> {
    const snapshot=raw as MapSnapshot;
    if(!this.version||snapshot?.version?.contentHash!==this.version.contentHash||snapshot.version.mapId!==this.version.mapId)return;
    if(this.status==='caching'||this.status==='ready')return;
    const generation=this.generation;
    clearTimeout(this.timer);
    try{
      this.set('validating','正在校验地图内容和版本指纹…');
      const checked=registerMapSnapshot(snapshot);
      if(JSON.stringify(checked.version)!==JSON.stringify(this.version))throw Error('地图版本元信息不匹配');
      this.set('caching','正在保存本地地图版本…');
      const persisted=await this.write(checked);
      if(generation!==this.generation)return;
      this.ready(generation,persisted?'地图已校验并缓存，地图就绪':'地图已校验；浏览器存储不可用，本次可正常对局');
    }catch(error){if(generation===this.generation)this.fail((error as Error).message);}
  }
  private ready(generation:number,message:string):void {
    if(generation!==this.generation||!this.version)return;
    this.set('ready',message);
    this.send({type:'map-ready',mapId:this.version.mapId,contentHash:this.version.contentHash});
  }
}
