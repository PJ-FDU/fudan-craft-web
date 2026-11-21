import { HostRoom,type RoomMessage } from './host-room.js';
import { encodeState } from './snapshot-codec.js';
import type { ViewState } from '../game/types.js';

export type HostInput=
  |{type:'init';code:string;hostId:string;message:RoomMessage}
  |{type:'connect'|'disconnect';id:string}
  |{type:'message';id:string;message:RoomMessage};
export type HostOutput=
  |{type:'message';id:string;message:RoomMessage}
  |{type:'snapshot';id:string;bytes:Uint8Array};
const scope=self as unknown as {
  onmessage:((event:MessageEvent<HostInput>)=>void)|null;
  postMessage:(message:HostOutput,transfer?:Transferable[])=>void;
};
let room:HostRoom|null=null,hostId='';
const pending=new Map<string,{state:ViewState;epoch:number}>(),busy=new Set<string>(),connected=new Set<string>();
const generations=new Map<string,number>();
async function sendSnapshot(id:string):Promise<void> {
  if(busy.has(id))return;busy.add(id);
  try{
    while(pending.has(id)&&connected.has(id)){
      const {state,epoch}=pending.get(id)!;pending.delete(id);
      const generation=generations.get(id);
      const bytes=await encodeState(state,epoch);
      if(connected.has(id)&&generations.get(id)===generation)scope.postMessage({type:'snapshot',id,bytes},[bytes.buffer]);
    }
  }catch(error){scope.postMessage({type:'message',id,message:{type:'rejected',message:(error as Error).message}});}
  finally{busy.delete(id);pending.delete(id);}
}
scope.onmessage=({data})=>{
  if(data.type==='init'){
    if(room)return;hostId=data.hostId;
    room=new HostRoom(data.code,hostId,(id,message)=>{
      if(message.type==='started'||message.type==='lobby'&&!message.started){
        generations.set(id,(generations.get(id)??0)+1);pending.delete(id);
      }
      if(message.type==='state'&&id!==hostId){pending.set(id,{state:message.state as ViewState,epoch:message.epoch as number});void sendSnapshot(id);}
      else scope.postMessage({type:'message',id,message});
    });
    room.connect(hostId);room.receive(hostId,data.message);return;
  }
  if(!room)return;
  if(data.type==='connect'){connected.add(data.id);room.connect(data.id);}
  else if(data.type==='disconnect'){connected.delete(data.id);pending.delete(data.id);generations.set(data.id,(generations.get(data.id)??0)+1);room.disconnect(data.id);}
  else if(data.type==='message')room.receive(data.id,data.message);
};
// 与渲染帧独立；切换菜单、加载 Three.js 和战场特效不会阻塞模拟计时。
setInterval(()=>room?.tick(),50);
