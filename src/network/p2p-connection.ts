import { MeteredPeer,type RemotePeer } from '@metered-ca/realtime';
import { parseInvite,preferTcpRelays } from './config.js';
import type { GameConnection } from './connection.js';
import { randomHex,type RoomMessage } from './host-room.js';
import type { HostInput,HostOutput } from './host-worker.js';
import { DataLink } from './data-link.js';

const CONTROL='fudancraft-control-v1',SNAPSHOT='fudancraft-snapshot-v1';
const REQUESTS=new Set(['join','resume','leave','start','select-map','select-race','rematch','command']);
const RESPONSES=new Set(['lobby','started','state','error','resume-error','notice','left']);
type Remote={peer:RemotePeer;link?:DataLink;updates?:DataLink;control?:RTCDataChannel;snapshot?:RTCDataChannel;ready:boolean};
export type P2POptions={key:string;relayOnly:boolean};

/** Metered 仅用于信令及 ICE 凭据；权威战局在房主 Worker，通信在数据通道。 */
export class P2PConnection implements GameConnection {
  readyState=0;
  onopen:GameConnection['onopen']=null;
  onerror:GameConnection['onerror']=null;
  onmessage:GameConnection['onmessage']=null;
  onclose:GameConnection['onclose']=null;
  private peer:MeteredPeer|null=null;
  private worker:Worker|null=null;
  private remotes=new Map<string,Remote>();
  private role:'host'|'guest'|null=null;
  private hostId='';
  private code='';
  private initial:RoomMessage|null=null;
  private joined=false;
  private failureTimer:ReturnType<typeof setTimeout>|undefined;
  private statsTimer:ReturnType<typeof setInterval>|undefined;
  private heartbeatTimer:ReturnType<typeof setInterval>|undefined;
  private lastHostMessage=0;
  private statsBusy=false;
  private epoch=0;

  constructor(private readonly options:P2POptions){
    if(!/^pk_live_[A-Za-z0-9_-]+$/.test(options.key))throw Error('Metered 浏览器公钥未配置');
    if(typeof RTCPeerConnection==='undefined'||typeof CompressionStream==='undefined'||typeof Worker==='undefined')throw Error('请使用支持 WebRTC 和压缩流的新版浏览器');
    queueMicrotask(()=>{if(this.readyState===0){this.readyState=1;this.onopen?.(new Event('open'));}});
  }
  send(text:string):void {
    if(this.readyState!==1)return;
    let message:RoomMessage;
    try{
      if(new TextEncoder().encode(text).length>16*1024)throw Error('指令超过大小限制');
      message=JSON.parse(text);if(!message||typeof message.type!=='string')throw Error('无效消息');
    }catch{this.deliver({type:'error',message:'无效消息'});return;}
    if(!this.role){
      if(!['create','join','resume'].includes(message.type))return;
      this.initial=message;void this.enter(message).catch(error=>{
        if(this.readyState!==1)return;
        this.deliver({type:message.type==='resume'?'resume-error':'error',message:(error as Error).message});
        this.finish(1006,'连接失败');
      });return;
    }
    if(!REQUESTS.has(message.type))return;
    if(this.role==='host')this.post({type:'message',id:this.hostId,message});
    else{
      const host=this.remotes.get(this.hostId);
      if(!host?.ready){this.deliver({type:'error',message:'房主连接正在恢复，请稍后重试'});return;}
      host.link?.control(text);
    }
  }
  close():void {this.finish(1000,'主动离开');}
  private async enter(message:RoomMessage):Promise<void> {
    this.role=message.type==='create'?'host':'guest';
    const invite=this.role==='guest'?parseInvite(message.code):null;
    if(this.role==='guest'&&!invite)throw Error('请粘贴完整的 P2P 邀请链接或房间标识');
    const channel=invite?.channel??randomHex(6).toUpperCase();this.hostId=invite?.hostId??'';this.code=invite?.code??'';
    const peer=new MeteredPeer({apiKey:this.options.key,rtcPeerConnectionFactory:config=>new RTCPeerConnection({
      ...preferTcpRelays(config),iceTransportPolicy:this.options.relayOnly?'relay':'all',
    })});
    this.peer=peer;
    peer.on('peer-joined',({peer:remote})=>this.attach(remote));
    peer.on('peer-left',({peer:remote})=>{
      this.remove(remote.id);
      if(this.role==='guest'&&remote.id===this.hostId)this.finish(4004,'房主已离开');
    });
    peer.on('left',()=>{if(this.readyState===1)this.finish(1006,'信令连接已关闭');});
    peer.on('error',({err})=>{if(this.readyState===1)this.deliver({type:'notice',message:`连接异常：${err.message}`});});
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([peer.join(`fudancraft-game-v1-${channel}`),new Promise<never>((_,reject)=>{
        timeout=setTimeout(()=>reject(Error('连接超时，请检查 Metered 权限与网络')),30_000);
      })]);
    }finally{clearTimeout(timeout);}
    if(this.readyState!==1)return;
    this.joined=true;
    if(this.role==='host'){
      if(!peer.peerId)throw Error('房主标识未分配');
      this.hostId=peer.peerId;this.code=`${channel}:${this.hostId}`;
      this.worker=new Worker(new URL('./host-worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data}:MessageEvent<HostOutput>)=>{
        if(this.readyState!==1)return;
        if(data.type==='snapshot'){this.remotes.get(data.id)?.updates?.snapshot(data.bytes);return;}
        if(data.id===this.hostId){this.deliver(data.message);return;}
        if(data.message.type==='rejected'){this.remotes.get(data.id)?.link?.control(JSON.stringify({type:'error',message:data.message.message}));this.remove(data.id);return;}
        if(data.message.type==='started'||data.message.type==='lobby'&&!data.message.started)this.remotes.get(data.id)?.updates?.resetSnapshots();
        this.remotes.get(data.id)?.link?.control(JSON.stringify(data.message));
      };
      this.worker.onerror=()=>{this.deliver({type:'notice',message:'房主模拟已停止，请重新创建房间'});this.finish(1006,'模拟已停止');};
      this.post({type:'init',hostId:this.hostId,code:this.code,message});
      for(const [id,remote] of this.remotes)if(remote.ready)this.post({type:'connect',id});
    }else{
      this.failureTimer=setTimeout(()=>{
        this.deliver({type:'resume-error',message:'无法连接邀请中的房主。请确认房主页面仍然打开。'});this.finish(1006,'房主不可达');
      },30_000);
      const host=this.remotes.get(this.hostId);if(host?.ready)this.guestReady(host);
    }
    this.statsTimer=setInterval(()=>void this.stats(),3000);
    this.heartbeatTimer=setInterval(()=>{
      if(this.role==='host'){
        for(const remote of this.remotes.values())if(remote.ready)remote.link?.control(JSON.stringify({type:'ping'}));
      }else if(this.lastHostMessage&&Date.now()-this.lastHostMessage>15_000)this.finish(1006,'房主连接中断');
    },3000);
  }
  private attach(peer:RemotePeer):void {
    if(this.readyState!==1||this.remotes.has(peer.id)||this.role==='guest'&&peer.id!==this.hostId)return;
    if(this.remotes.size>=8)return;
    const remote:Remote={peer,ready:false};this.remotes.set(peer.id,remote);
    peer.on('data-channel',({channel})=>this.wire(remote,channel));
    peer.on('connection-reset',()=>{
      if(this.remotes.get(peer.id)!==remote)return;
      this.drop(remote);this.createChannel(remote);
    });
    this.createChannel(remote);
  }
  private createChannel(remote:Remote):void {
    if(remote.peer.polite||this.readyState!==1)return;
    this.wire(remote,remote.peer.pc.createDataChannel(CONTROL,{ordered:true}));
    this.wire(remote,remote.peer.pc.createDataChannel(SNAPSHOT,{ordered:false}));
  }
  private wire(remote:Remote,channel:RTCDataChannel):void {
    if(![CONTROL,SNAPSHOT].includes(channel.label)||this.readyState!==1||this.remotes.get(remote.peer.id)!==remote){channel.close();return;}
    const slot=channel.label===CONTROL?'control':'snapshot';
    if(remote[slot]&&remote[slot]!==channel){this.drop(remote);}
    remote[slot]=channel;
    channel.onopen=()=>{
      if(remote[slot]!==channel||this.readyState!==1)return;
      const link=new DataLink(channel,text=>this.receive(remote,text,slot),()=>this.drop(remote),slot,sequence=>{
        if(this.role==='guest')remote.link?.control(JSON.stringify({type:'state-ack',sequence}));
      });
      if(slot==='control')remote.link=link;else remote.updates=link;
      if(!remote.ready&&remote.link&&remote.updates){
        remote.ready=true;
        if(this.role==='host')this.post({type:'connect',id:remote.peer.id});
        else if(this.joined)this.guestReady(remote);
      }
      void this.stats();
    };
    channel.onclose=channel.onerror=()=>{if(remote[slot]===channel)this.drop(remote);};
    if(channel.readyState==='open')channel.onopen(new Event('open'));
  }
  private guestReady(remote:Remote):void {
    this.lastHostMessage=Date.now();
    // SDK ICE 重启后继续恢复同一个 token，不另占一个席位。
    if(this.initial)remote.link?.control(JSON.stringify({...this.initial,code:this.code}));
  }
  private receive(remote:Remote,text:string,slot:'control'|'snapshot'):void {
    const message=JSON.parse(text) as RoomMessage;
    if(this.role==='host'){
      if(slot==='control'&&message.type==='state-ack'&&Number.isSafeInteger(message.sequence))remote.updates?.ack(message.sequence as number);
      if(slot==='control'&&REQUESTS.has(message.type))this.post({type:'message',id:remote.peer.id,message});
      return;
    }
    if(remote.peer.id!==this.hostId)return;
    this.lastHostMessage=Date.now();
    if(message.type==='ping')return;
    if(message.type==='replaced'){this.finish(4001,'席位已在另一个连接恢复');return;}
    if(!RESPONSES.has(message.type))return;
    if(message.type==='started')this.epoch=message.epoch as number;
    if(message.type==='lobby'&&!message.started)this.epoch=0;
    if((slot==='snapshot')!==(message.type==='state')||message.type==='state'&&message.epoch!==this.epoch)return;
    if(message.type==='lobby'){
      clearTimeout(this.failureTimer);this.failureTimer=undefined;
      this.initial={type:'resume',code:this.code,token:message.token};
    }
    this.deliver(message);
  }
  private drop(remote:Remote):void {
    const ready=remote.ready;remote.ready=false;remote.link?.close();remote.updates?.close();remote.link=remote.updates=undefined;
    for(const slot of ['control','snapshot'] as const){
      const channel=remote[slot];
      if(channel){channel.onopen=channel.onclose=channel.onerror=null;channel.close();remote[slot]=undefined;}
    }
    if(ready&&this.role==='host')this.post({type:'disconnect',id:remote.peer.id});
    if(ready&&this.role==='guest')this.deliver({type:'transport',message:'P2P 连接中断 · 正在恢复'});
  }
  private remove(id:string):void {const remote=this.remotes.get(id);if(!remote)return;this.drop(remote);this.remotes.delete(id);}
  private post(message:HostInput):void {this.worker?.postMessage(message);}
  private deliver(message:RoomMessage):void {if(this.readyState===1)this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(message)}));}
  private finish(code:number,reason:string):void {
    if(this.readyState===3)return;this.readyState=3;
    clearTimeout(this.failureTimer);clearInterval(this.statsTimer);clearInterval(this.heartbeatTimer);
    this.worker?.terminate();this.worker=null;
    for(const id of this.remotes.keys())this.remove(id);
    void this.peer?.close(reason).catch(()=>{});
    this.onclose?.(new CloseEvent('close',{code,reason}));
  }
  private async stats():Promise<void> {
    if(this.statsBusy||this.readyState!==1)return;this.statsBusy=true;
    try{
      const descriptions:string[]=[];
      for(const remote of this.remotes.values()){
        if(!remote.ready)continue;
        const pc=remote.peer.pc as RTCPeerConnection;
        try{
          const report=await pc.getStats();let pair:any;
          report.forEach(stat=>{if(stat.type==='transport'&&stat.selectedCandidatePairId)pair=report.get(stat.selectedCandidatePairId);});
          if(!pair)report.forEach(stat=>{if(stat.type==='candidate-pair'&&stat.nominated&&stat.state==='succeeded')pair=stat;});
          if(!pair)continue;
          const local=report.get(pair.localCandidateId),other=report.get(pair.remoteCandidateId);
          const relay=local?.candidateType==='relay'||other?.candidateType==='relay';
          descriptions.push(`${relay?'TURN 中继':'P2P 直连'}${typeof pair.currentRoundTripTime==='number'?` · RTT ${Math.round(pair.currentRoundTripTime*1000)} ms`:''}`);
        }catch{/* ICE 重启期间下一轮读取。 */}
      }
      this.deliver({type:'transport',message:descriptions.length?descriptions.join(' / '):this.role==='host'?'P2P 房主 · 等待连接':'P2P 连接中 · 正在恢复'});
    }finally{this.statsBusy=false;}
  }
}
