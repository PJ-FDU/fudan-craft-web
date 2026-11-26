import type { Side } from './types.js';
import type { VoicePeer,VoiceSignal } from '../network/room-comms.js';

type Meter={source:MediaStreamAudioSourceNode;analyser:AnalyserNode;data:Uint8Array<ArrayBuffer>};
type Link={pc:RTCPeerConnection;session:string;audio:HTMLAudioElement;candidates:RTCIceCandidateInit[];work:Promise<void>;timer?:ReturnType<typeof setTimeout>;retries:number;meter?:Meter;gain?:GainNode};
export type VoiceStatus={active:boolean;pending:boolean;muted:boolean;connected:number;blocked:boolean;error:string;pushToTalk?:boolean;talking?:boolean;speaking?:Side[]};
/** 独立音频 mesh，只接受权威服务分发的队友身份和当前媒体会话。 */
export class TeamVoice {
  private stream:MediaStream|null=null;
  private session='';
  private side:Side=1;
  private peers:VoicePeer[]=[];
  private links=new Map<Side,Link>();
  private generation=0;
  private pending=false;
  private muted=false;
  private blocked=false;
  private error='';
  private pushToTalk=false;
  private talking=false;
  private context:AudioContext|null=null;
  private localMeter?:Meter;
  private meterTimer?:ReturnType<typeof setInterval>;
  private speaking:Side[]=[];
  private levels=new Map<Side,{muted:boolean;volume:number}>();
  constructor(private send:(message:Record<string,unknown>)=>void,private ice:()=>RTCIceServer[],private changed:(status:VoiceStatus)=>void){}
  get active(){return !!this.stream;}
  async start(side:Side){
    if(this.stream||this.pending)return;
    const generation=++this.generation;this.side=side;this.pending=true;this.error='';this.report();
    try{
      if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('语音需要 HTTPS 和支持麦克风的浏览器');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==this.generation){stream.getTracks().forEach(track=>track.stop());return;}
      this.stream=stream;this.muted=false;this.applyMic();
      try{
        this.context=new AudioContext();void this.context.resume().catch(()=>{});
        this.localMeter=this.meter(stream);
        this.meterTimer=setInterval(()=>this.measure(),120);
      }catch{/* 无音频分析能力时仍允许正常语音。 */}
      this.session=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      for(const track of stream.getAudioTracks())track.onended=()=>{this.stop();this.error='麦克风已断开，请重新开启语音';this.report();};
      this.send({type:'voice-state',session:this.session});
    }catch(error){
      if(generation!==this.generation)return;
      const name=(error as Error).name;
      this.error=name==='NotAllowedError'?'麦克风权限被拒绝，请在浏览器设置中允许':name==='NotFoundError'?'没有可用的麦克风':(error as Error).message;
    }finally{if(generation===this.generation){this.pending=false;this.report();}}
  }
  stop(notify=true){
    ++this.generation;this.pending=false;
    if(notify&&this.session)this.send({type:'voice-state',session:null});
    this.session='';const stream=this.stream;this.stream=null;
    for(const track of stream?.getTracks()??[]){track.onended=null;track.stop();}
    for(const side of [...this.links.keys()])this.remove(side);
    clearInterval(this.meterTimer);this.meterTimer=undefined;
    this.localMeter?.source.disconnect();this.localMeter?.analyser.disconnect();this.localMeter=undefined;
    if(this.context)void this.context.close().catch(()=>{});this.context=null;this.speaking=[];this.talking=false;
    this.muted=false;this.blocked=false;this.error='';this.report();
  }
  mute(){this.muted=!this.muted;this.applyMic();this.report();}
  setPushToTalk(value:boolean){this.pushToTalk=value;this.talking=false;this.applyMic();this.report();}
  talk(value:boolean){if(this.talking===value)return;this.talking=value;this.applyMic();this.report();}
  private applyMic(){for(const track of this.stream?.getAudioTracks()??[])track.enabled=!this.muted&&(!this.pushToTalk||this.talking);}
  peerLevel(side:Side){return this.levels.get(side)??{muted:false,volume:1};}
  setPeerLevel(side:Side,muted:boolean,volume:number){
    if(!Number.isFinite(volume))return;
    const level={muted,volume:Math.max(0,Math.min(1,volume))};this.levels.set(side,level);
    const link=this.links.get(side);
    if(link){
      link.audio.muted=!!link.gain||level.muted;link.audio.volume=level.volume;
      if(link.gain)this.applyLevel(side,link.gain);
    }
    this.report();
  }
  resetLevels(){this.levels.clear();}
  async play(){
    this.blocked=false;
    if(this.context){await this.context.resume().catch(()=>{});if(this.context.state!=='running')this.blocked=true;}
    for(const link of this.links.values())if(link.audio.srcObject)await link.audio.play().catch(()=>{this.blocked=true;});
    this.report();
  }
  setPeers(peers:VoicePeer[]){
    this.peers=peers;
    for(const [side,link] of this.links)if(!peers.some(p=>p.side===side&&p.session===link.session))this.remove(side);
    if(this.stream&&peers.some(p=>p.side===this.side&&p.session===this.session)){
      for(const peer of peers)if(peer.side!==this.side&&!this.links.has(peer.side)){
        try{
          const link=this.create(peer);
          if(this.side<peer.side)this.enqueue(peer.side,link,()=>this.offer(peer.side,link));
        }catch{this.error='语音网络配置无效，请检查 ICE 服务设置';}
      }
    }
    this.report();
  }
  receive(signal:VoiceSignal){
    const peer=this.peers.find(p=>p.side===signal.from&&p.session===signal.session);
    if(!this.stream||!peer||peer.side===this.side||signal.targetSession!==this.session)return;
    let link:Link;
    try{link=this.links.get(peer.side)??this.create(peer);}
    catch{this.error='语音网络配置无效，请检查 ICE 服务设置';this.report();return;}
    this.enqueue(peer.side,link,async()=>{
      if(signal.description){
        // 按阵营编号固定发起方，避免双方同时 offer 的冲突。
        if(signal.description.type==='offer'&&this.side<peer.side)return;
        await link.pc.setRemoteDescription(signal.description);
        for(const candidate of link.candidates.splice(0))await link.pc.addIceCandidate(candidate);
        if(signal.description.type==='offer'){
          await link.pc.setLocalDescription(await link.pc.createAnswer());
          this.signal(peer.side,link,{description:link.pc.localDescription!.toJSON()});
        }
      }else if(signal.candidate){
        if(link.pc.remoteDescription)await link.pc.addIceCandidate(signal.candidate);
        else if(link.candidates.length<64)link.candidates.push(signal.candidate);
      }
    });
  }
  private create(peer:VoicePeer):Link{
    const pc=new RTCPeerConnection({iceServers:this.ice()}),audio=document.createElement('audio');
    const level=this.peerLevel(peer.side);audio.muted=level.muted;audio.volume=level.volume;
    audio.autoplay=true;audio.setAttribute('playsinline','');document.body.append(audio);
    const link:Link={pc,session:peer.session,audio,candidates:[],work:Promise.resolve(),retries:0};
    this.links.set(peer.side,link);
    for(const track of this.stream!.getAudioTracks())pc.addTrack(track,this.stream!);
    pc.onicecandidate=event=>{if(event.candidate)this.signal(peer.side,link,{candidate:event.candidate.toJSON()});};
    pc.ontrack=event=>{
      audio.srcObject=event.streams[0]??new MediaStream([event.track]);
      link.meter?.source.disconnect();link.meter?.analyser.disconnect();link.gain?.disconnect();link.gain=undefined;
      if(this.context)try{
        // GainNode 在手机上也能调节音量；静音 audio 元素避免两条播放路径叠加。
        link.meter=this.meter(audio.srcObject as MediaStream);link.gain=this.context.createGain();
        this.applyLevel(peer.side,link.gain);link.meter.analyser.connect(link.gain);link.gain.connect(this.context.destination);
        audio.muted=true;
        if(this.context.state!=='running'){this.blocked=true;this.report();}
      }catch{audio.muted=this.peerLevel(peer.side).muted;}
      void audio.play().catch(()=>{if(this.links.get(peer.side)===link){this.blocked=true;this.report();}});
    };
    pc.onconnectionstatechange=()=>{
      if(this.links.get(peer.side)!==link)return;
      clearTimeout(link.timer);
      if(pc.connectionState==='connected'){link.retries=0;this.error='';}
      if(['failed','disconnected'].includes(pc.connectionState))link.timer=setTimeout(()=>{
        if(this.links.get(peer.side)!==link)return;
        if(this.side<peer.side&&link.retries++<2)this.enqueue(peer.side,link,()=>this.offer(peer.side,link,true));
        else{this.error='队友语音连接中断，可关闭后重新开启';this.report();}
      },pc.connectionState==='failed'?1000:8000);
      this.report();
    };
    return link;
  }
  private signal(side:Side,link:Link,payload:Record<string,unknown>){
    if(this.links.get(side)===link&&this.session)this.send({type:'voice-signal',to:side,session:this.session,targetSession:link.session,...payload});
  }
  private async offer(side:Side,link:Link,restart=false){
    await link.pc.setLocalDescription(await link.pc.createOffer({iceRestart:restart}));
    this.signal(side,link,{description:link.pc.localDescription!.toJSON()});
  }
  private enqueue(side:Side,link:Link,action:()=>Promise<void>){
    link.work=link.work.then(async()=>{if(this.links.get(side)===link)await action();}).catch(()=>{
      if(this.links.get(side)===link){this.error='语音协商失败，可关闭后重新开启';this.report();}
    });
  }
  private remove(side:Side){
    const link=this.links.get(side);if(!link)return;this.links.delete(side);clearTimeout(link.timer);
    link.pc.ontrack=link.pc.onicecandidate=link.pc.onconnectionstatechange=null;link.pc.close();
    link.meter?.source.disconnect();link.meter?.analyser.disconnect();
    link.gain?.disconnect();
    link.audio.pause();link.audio.srcObject=null;link.audio.remove();
  }
  private applyLevel(side:Side,gain:GainNode){
    const level=this.peerLevel(side);gain.gain.setValueAtTime(level.muted?0:level.volume,this.context!.currentTime);
  }
  private meter(stream:MediaStream):Meter{
    const source=this.context!.createMediaStreamSource(stream),analyser=this.context!.createAnalyser();
    analyser.fftSize=512;source.connect(analyser);
    return {source,analyser,data:new Uint8Array(512)};
  }
  private measure(){
    const audible=(meter?:Meter)=>{
      if(!meter||this.context?.state!=='running')return false;
      meter.analyser.getByteTimeDomainData(meter.data);
      return Math.sqrt(meter.data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/meter.data.length)>.025;
    };
    const sides:Side[]=[];
    if(this.stream?.getAudioTracks().some(t=>t.enabled)&&audible(this.localMeter))sides.push(this.side);
    for(const [side,link] of this.links)if(link.pc.connectionState==='connected'&&audible(link.meter))sides.push(side);
    if(sides.join()!==this.speaking.join()){this.speaking=sides;this.report();}
  }
  private report(){this.changed({active:this.active,pending:this.pending,muted:this.muted,blocked:this.blocked,error:this.error,
    pushToTalk:this.pushToTalk,talking:this.talking,speaking:this.speaking,
    connected:[...this.links.values()].filter(l=>l.pc.connectionState==='connected').length});}
}
