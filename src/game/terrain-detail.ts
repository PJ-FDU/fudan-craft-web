// Detail follows physical screen pixels; a fixed 4K world bitmap cannot do this.
export const TERRAIN_CHUNK=128;
export const TERRAIN_BUDGET=64*1024*1024;
export function terrainLOD(zoom:number,dpr:number) {
  return Math.max(1,Math.min(4,2**Math.ceil(Math.log2(Math.max(.01,zoom*dpr)))));
}
export function fitTerrainLOD(zoom:number,dpr:number,chunks:number,budget=TERRAIN_BUDGET){
  let lod=terrainLOD(zoom,dpr);
  while(lod>1&&chunks*((TERRAIN_CHUNK+2)*lod)**2*4>budget*.8)lod/=2;
  return lod;
}
export class ByteLRU<T> {
  private items=new Map<string,{value:T;bytes:number}>();
  bytes=0;
  constructor(readonly budget:number){}
  get(key:string){const item=this.items.get(key);if(!item)return;this.items.delete(key);this.items.set(key,item);return item.value;}
  set(key:string,value:T,bytes:number){
    const previous=this.items.get(key);if(previous){this.bytes-=previous.bytes;this.items.delete(key);}
    if(bytes>this.budget)return;
    while(this.bytes+bytes>this.budget){const first=this.items.entries().next().value!;this.bytes-=first[1].bytes;this.items.delete(first[0]);}
    this.items.set(key,{value,bytes});this.bytes+=bytes;
  }
}
