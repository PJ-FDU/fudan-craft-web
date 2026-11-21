import { FRAME_BYTES,StateAssembler,decodeState,fragmentState } from './snapshot-codec.js';

export type LinkKind='control'|'snapshot';
const MAX_CONTROLS=32;
/** 指令可靠有序；快照可靠无序，每位玩家同时只传一份，确认后发送最新状态。 */
export class DataLink {
  private controls:string[]=[];
  private controlBytes=0;
  private active:ArrayBuffer[]=[];
  private nextState:Uint8Array|null=null;
  private sequence=0;
  private inFlight=0;
  private ackTimer:ReturnType<typeof setTimeout>|undefined;
  private assembler=new StateAssembler();
  private latest:ReturnType<StateAssembler['push']>=null;
  private decoding=false;
  private closed=false;
  constructor(readonly channel:RTCDataChannel,private readonly message:(text:string)=>void,private readonly failed:()=>void,readonly kind:LinkKind='control',private readonly acknowledge?:(sequence:number)=>void){
    channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=8*1024;
    channel.onbufferedamountlow=()=>this.pump();
    channel.onmessage=event=>{
      if(this.closed)return;
      try{
        const data=event.data;
        if(this.kind==='control'){
          if(typeof data!=='string'||new TextEncoder().encode(data).length>FRAME_BYTES)throw Error('无效控制消息');
          JSON.parse(data);this.message(data);return;
        }
        if(!(data instanceof ArrayBuffer))throw Error('无效快照消息');
        const complete=this.assembler.push(data);
        if(complete){this.latest=complete;void this.decode();}
      }catch{this.fail();}
    };
    channel.onclose=channel.onerror=()=>this.fail();
  }
  control(text:string):void {
    const size=new TextEncoder().encode(text).length;
    if(this.closed)return;
    if(this.kind!=='control'||size>FRAME_BYTES||this.controls.length>=MAX_CONTROLS||this.controlBytes+size>64*1024){this.fail();return;}
    this.controls.push(text);this.controlBytes+=size;this.pump();
  }
  snapshot(bytes:Uint8Array):void {if(this.closed||this.kind!=='snapshot')return;this.nextState=bytes;this.pump();}
  ack(sequence:number):void {
    if(this.closed||!this.inFlight||sequence!==this.inFlight||this.active.length)return;
    clearTimeout(this.ackTimer);this.ackTimer=undefined;this.inFlight=0;this.pump();
  }
  // 已进入 SCTP 的旧帧仍须传完并确认；epoch 在接收端隔离跨局状态。
  resetSnapshots():void {this.nextState=null;}
  close():void {
    if(this.closed)return;this.closed=true;
    clearTimeout(this.ackTimer);this.ackTimer=undefined;
    this.controls=[];this.active=[];this.nextState=null;this.latest=null;
    this.channel.onmessage=this.channel.onclose=this.channel.onerror=this.channel.onbufferedamountlow=null;
    this.channel.close();
  }
  private fail():void {if(this.closed)return;this.close();this.failed();}
  private async decode():Promise<void> {
    if(this.decoding)return;this.decoding=true;
    try{
      while(this.latest&&!this.closed){
        const snapshot=this.latest;this.latest=null;
        const text=await decodeState(snapshot.bytes);
        // 已解码帧立即交付；即使新帧持续到达，也不能饿死画面更新。
        if(!this.closed){this.message(text);this.acknowledge?.(snapshot.sequence);}
      }
    }catch{this.fail();}
    finally{this.decoding=false;}
  }
  private pump():void {
    const channel=this.channel;if(this.closed||channel.readyState!=='open')return;
    try{
      // 少量缓冲即可维持吞吐；不把数秒的旧战场提前交给 SCTP。
      while(channel.bufferedAmount<(this.kind==='snapshot'?32*1024:64*1024)){
        if(this.kind==='control'){
          const control=this.controls.shift();if(control===undefined)return;
          this.controlBytes-=new TextEncoder().encode(control).length;channel.send(control);continue;
        }
        if(!this.active.length){
          if(this.inFlight||!this.nextState)return;
          this.inFlight=++this.sequence;
          this.active=fragmentState(this.nextState,this.inFlight);this.nextState=null;
          // 可靠通道断流时进入既有重连流程，不能永久保留一份未确认快照。
          this.ackTimer=setTimeout(()=>this.fail(),15_000);
        }
        const frame=this.active.shift();if(!frame)return;channel.send(frame);
      }
    }catch{this.fail();}
  }
}
