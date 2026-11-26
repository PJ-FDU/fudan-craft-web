import type { Side } from '../game/types.js';
import { PINGS,QUICK_MESSAGES,type PingKind,type QuickMessage } from '../game/comms-presets.js';

export type ChatChannel='all'|'team';
export type CommsMember={side:Side;name:string;team:number;connected:boolean};
export type VoicePeer={side:Side;name:string;session:string};
export type ChatMessage={type:'chat';id:string;time:number;side:Side;name:string;channel:ChatChannel;text:string;quick?:QuickMessage};
export type PingMessage={type:'map-ping';id:string;time:number;side:Side;name:string;kind:PingKind;x:number;y:number};
export type VoiceSignal={type:'voice-signal';from:Side;session:string;targetSession:string;description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};
export type CommsMessage=ChatMessage|PingMessage|VoiceSignal|{type:'voice-peers';peers:VoicePeer[];members:CommsMember[]}|{type:'comms-error';message:string};
const isSession=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);

/** 信任连接身份，不信任消息中的姓名、阵营或发送者。聊天与媒体状态不进入战役存档。 */
export class RoomComms {
  private members:CommsMember[]=[];
  private voices=new Map<Side,string>();
  private chats=new Map<Side,number[]>();
  private pings=new Map<Side,number>();
  private extent=0;
  private sequence=0;
  private instance=crypto.randomUUID();
  constructor(private emit:(side:Side,message:CommsMessage)=>void){}
  update(members:CommsMember[],extent=0){
    for(const previous of this.members){
      const next=members.find(m=>m.side===previous.side);
      if(!next?.connected||next.team!==previous.team)this.voices.delete(previous.side);
      if(!next){this.chats.delete(previous.side);this.pings.delete(previous.side);}
    }
    this.members=members;this.extent=extent;this.publish();
  }
  disconnect(side:Side){this.voices.delete(side);this.publish();}
  resetVoice(){this.voices.clear();this.publish();}
  private publish(){
    for(const member of this.members)if(member.connected)this.emit(member.side,{
      type:'voice-peers',members:this.members.filter(m=>m.connected).map(m=>({...m})),peers:this.members.filter(m=>m.connected&&m.team===member.team&&this.voices.has(m.side))
        .map(m=>({side:m.side,name:m.name,session:this.voices.get(m.side)!})),
    });
  }
  receive(side:Side,message:Record<string,unknown>,now=Date.now()){
    const sender=this.members.find(m=>m.side===side&&m.connected);if(!sender)return;
    const error=(text:string)=>this.emit(side,{type:'comms-error',message:text});
    if(message.type==='map-ping'){
      if(!this.extent||typeof message.kind!=='string'||!Object.hasOwn(PINGS,message.kind)
        ||typeof message.x!=='number'||typeof message.y!=='number'||!Number.isFinite(message.x)||!Number.isFinite(message.y)
        ||message.x<0||message.y<0||message.x>this.extent||message.y>this.extent){error('地图标记无效');return;}
      if(now-(this.pings.get(side)??-Infinity)<2000){error('标记冷却中，请等待 2 秒');return;}
      this.pings.set(side,now);
      const outgoing:PingMessage={type:'map-ping',id:`${this.instance}:${++this.sequence}`,time:now,side,name:sender.name,kind:message.kind as PingKind,x:message.x,y:message.y};
      for(const member of this.members)if(member.connected&&member.team===sender.team)this.emit(member.side,outgoing);
    }else if(message.type==='chat'||message.type==='quick-chat'){
      let quick:QuickMessage|undefined;
      if(message.type==='quick-chat'){
        if(typeof message.quick!=='string'||!Object.hasOwn(QUICK_MESSAGES,message.quick)){error('快捷消息无效');return;}
        quick=message.quick as QuickMessage;
        message={...message,type:'chat',text:QUICK_MESSAGES[message.quick as QuickMessage][0]};
      }
      if(message.channel!=='all'&&message.channel!=='team'||typeof message.text!=='string'||message.text.length>300){error('聊天消息无效或超过 300 字');return;}
      const text=message.text.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim();if(!text)return;
      const recent=(this.chats.get(side)??[]).filter(time=>now-time<5000);
      if(recent.length>=5){error('聊天过于频繁，请稍后发送');return;}
      recent.push(now);this.chats.set(side,recent);
      const outgoing:ChatMessage={type:'chat',id:`${this.instance}:${++this.sequence}`,time:now,side,name:sender.name,channel:message.channel,text};
      if(quick)outgoing.quick=quick;
      for(const member of this.members)if(member.connected&&(message.channel==='all'||member.team===sender.team))this.emit(member.side,outgoing);
    }else if(message.type==='voice-state'){
      if(message.session===null)this.voices.delete(side);
      else if(isSession(message.session))this.voices.set(side,message.session);
      else return;
      this.publish();
    }else if(message.type==='voice-signal'){
      const target=this.members.find(m=>m.side===message.to&&m.connected);
      if(!target||target.side===side||target.team!==sender.team||!isSession(message.session)||!isSession(message.targetSession)
        ||this.voices.get(side)!==message.session||this.voices.get(target.side)!==message.targetSession)return;
      const outgoing:VoiceSignal={type:'voice-signal',from:side,session:message.session,targetSession:message.targetSession};
      if(message.description&&typeof message.description==='object'){
        const d=message.description as RTCSessionDescriptionInit;
        if(!['offer','answer'].includes(d.type)||typeof d.sdp!=='string'||d.sdp.length>12000)return;
        outgoing.description={type:d.type,sdp:d.sdp};
      }else if(message.candidate&&typeof message.candidate==='object'){
        const c=message.candidate as RTCIceCandidateInit;
        if(typeof c.candidate!=='string'||c.candidate.length>2048||c.sdpMid!==null&&c.sdpMid!==undefined&&typeof c.sdpMid!=='string'
          ||c.sdpMLineIndex!==null&&c.sdpMLineIndex!==undefined&&(!Number.isInteger(c.sdpMLineIndex)||c.sdpMLineIndex<0||c.sdpMLineIndex>8))return;
        outgoing.candidate={candidate:c.candidate,sdpMid:c.sdpMid,sdpMLineIndex:c.sdpMLineIndex};
      }else return;
      this.emit(target.side,outgoing);
    }
  }
}
