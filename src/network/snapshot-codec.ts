import { packFog } from '../game/protocol.js';
import type { ViewState } from '../game/types.js';

export const FRAME_BYTES=16*1024;
export const MAX_COMPRESSED_BYTES=2*1024*1024;
export const MAX_STATE_BYTES=8*1024*1024;
const HEADER=16,MAGIC=0x46435031;
function base64(cells:ArrayLike<number>):string {
  const bytes=packFog(cells);let raw='';
  for(const byte of bytes)raw+=String.fromCharCode(byte);
  return btoa(raw);
}
async function readBounded(stream:ReadableStream<Uint8Array>,limit:number):Promise<Uint8Array> {
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>limit)throw Error('战场快照超过大小限制');
      chunks.push(value);
    }
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  return result;
}
export async function encodeState(state:ViewState,epoch=1):Promise<Uint8Array> {
  const raw=new TextEncoder().encode(JSON.stringify({type:'state',epoch,state:{
    ...state,visible:base64(state.visible),explored:base64(state.explored),
  }}));
  if(raw.length>MAX_STATE_BYTES)throw Error('战场快照超过大小限制');
  return readBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_COMPRESSED_BYTES);
}
export async function decodeState(bytes:Uint8Array):Promise<string> {
  if(bytes.length>MAX_COMPRESSED_BYTES)throw Error('战场快照超过大小限制');
  const raw=await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),MAX_STATE_BYTES);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const message=JSON.parse(text);
  if(message.type!=='state'||!Number.isSafeInteger(message.epoch)||message.epoch<=0||!message.state||typeof message.state.visible!=='string'||typeof message.state.explored!=='string')throw Error('战场快照无效');
  return text;
}
export function fragmentState(bytes:Uint8Array,sequence:number):ArrayBuffer[] {
  if(!bytes.length||bytes.length>MAX_COMPRESSED_BYTES)throw Error('战场快照超过大小限制');
  const payload=FRAME_BYTES-HEADER,count=Math.ceil(bytes.length/payload),frames:ArrayBuffer[]=[];
  for(let index=0;index<count;index++){
    const part=bytes.subarray(index*payload,(index+1)*payload),frame=new ArrayBuffer(HEADER+part.length),header=new DataView(frame);
    header.setUint32(0,MAGIC);header.setUint32(4,sequence);header.setUint16(8,index);header.setUint16(10,count);header.setUint32(12,bytes.length);
    new Uint8Array(frame,HEADER).set(part);frames.push(frame);
  }
  return frames;
}

/** 按片号拼装无序快照，拒绝重复和旧序号；仅保留一份有界的未完成状态。 */
export class StateAssembler {
  private active:{sequence:number;count:number;size:number;received:number;seen:Uint8Array;bytes:Uint8Array;deadline:number}|null=null;
  private last=-1;
  push(frame:ArrayBuffer,now=Date.now()):{sequence:number;bytes:Uint8Array}|null {
    if(frame.byteLength<=HEADER||frame.byteLength>FRAME_BYTES)throw Error('快照片段无效');
    const header=new DataView(frame),sequence=header.getUint32(4),index=header.getUint16(8),count=header.getUint16(10),size=header.getUint32(12);
    const payload=FRAME_BYTES-HEADER;
    if(header.getUint32(0)!==MAGIC||!size||size>MAX_COMPRESSED_BYTES||count!==Math.ceil(size/payload)||index>=count
      ||frame.byteLength-HEADER!==Math.min(payload,size-index*payload))throw Error('快照片段无效');
    if(sequence<=this.last)return null;
    if(this.active&&this.active.deadline<now)this.active=null;
    if(!this.active||sequence>this.active.sequence){
      this.active={sequence,count,size,received:0,seen:new Uint8Array(count),bytes:new Uint8Array(size),deadline:now+10_000};
    }
    const active=this.active;
    if(active.sequence!==sequence)return null;
    if(active.size!==size||active.count!==count)throw Error('快照片段无效');
    if(active.seen[index])return null;
    active.bytes.set(new Uint8Array(frame,HEADER),index*payload);active.seen[index]=1;active.received++;
    if(active.received!==count)return null;
    this.active=null;this.last=sequence;return {sequence,bytes:active.bytes};
  }
}
