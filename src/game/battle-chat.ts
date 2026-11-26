import { GameSelect,dropdownMarkup } from './dropdown.js';
import { getLanguage,onLanguageChange,presetText } from './locale.js';
import type { Side } from './types.js';
import type { ChatMessage,ChatChannel,CommsMessage,VoicePeer,CommsMember,PingMessage } from '../network/room-comms.js';
import { TeamVoice,type VoiceStatus } from './team-voice.js';
import { PINGS,QUICK_MESSAGES,type PingKind } from './comms-presets.js';
import type { Point } from './types.js';

const text=(zh:string,en:string)=>getLanguage()==='en'?en:zh;
export class BattleChat {
  private root=document.createElement('section');
  private panel:HTMLElement;
  private log:HTMLElement;
  private input:HTMLInputElement;
  private channel:GameSelect;
  private toggle:HTMLButtonElement;
  private voice:TeamVoice;
  private voiceStatus:VoiceStatus={active:false,pending:false,muted:false,connected:0,blocked:false,error:''};
  private roster:VoicePeer[]=[];
  private side:Side=1;
  private room='';
  private available=false;
  private online=false;
  private teammates=0;
  private unread=0;
  private seen=new Set<string>();
  private messages:ChatMessage[]=[];
  private notice='';
  private configuration='';
  private members:CommsMember[]=[];
  private blocked=new Set<Side>();
  private previews:{message:ChatMessage;expires:number}[]=[];
  private previewTimer?:ReturnType<typeof setTimeout>;
  private pingPoint:Point|null=null;
  private pingCooldown=0;
  private rosterKey='';
  private holds=new Set<string>();
  constructor(host:HTMLElement,private send:(message:Record<string,unknown>)=>boolean,ice:()=>RTCIceServer[],private mark:(message:PingMessage|null,blocked?:Side)=>void=()=>{}){
    this.root.className='battle-chat';this.root.hidden=true;
    this.root.innerHTML=`<button type="button" id="chat-toggle" aria-expanded="false" aria-controls="chat-panel"></button>
      <button type="button" id="chat-quick-toggle" aria-expanded="false" aria-controls="chat-quick"></button>
      <div id="chat-preview" class="chat-preview" data-i18n-ignore aria-live="polite"></div>
      <div id="chat-quick" class="chat-quick" hidden><button type="button" id="chat-quick-channel"></button></div>
      <div id="chat-pings" class="chat-pings" hidden></div>
      <div id="chat-panel" class="chat-panel" hidden>
        <header class="chat-heading"><strong id="chat-title"></strong><button type="button" id="chat-close" aria-label="关闭聊天">×</button></header>
        <details class="chat-people"><summary id="chat-people-title"></summary>
          <div class="chat-voice"><button type="button" id="chat-voice"></button><button type="button" id="chat-mute" hidden></button><button type="button" id="chat-ptt"></button><button type="button" id="chat-talk" hidden></button><button type="button" id="chat-play" hidden></button><output id="chat-voice-status" aria-live="polite"></output></div>
          <div id="chat-people" data-i18n-ignore></div>
        </details>
        <div id="chat-log" class="chat-log" role="log" aria-live="polite" aria-relevant="additions" data-i18n-ignore></div>
        <p id="chat-notice" class="chat-notice" role="status"></p>
        <form id="chat-form"><div class="chat-compose">${dropdownMarkup('chat-channel','聊天频道',[['all','公屏'],['team','仅队友']])}<input id="chat-input" type="text" maxlength="300" autocomplete="off" enterkeyhint="send" aria-label="聊天内容" data-i18n-ignore><button type="submit" id="chat-send"></button></div></form>
      </div>`;
    host.append(this.root);
    const element=<T extends HTMLElement=HTMLElement>(id:string)=>this.root.querySelector<T>('#'+id)!;
    this.panel=element('chat-panel');this.log=element('chat-log');this.input=element('chat-input');this.channel=element<GameSelect>('chat-channel');this.toggle=element('chat-toggle');
    this.voice=new TeamVoice(message=>{this.send(message);},ice,status=>{this.voiceStatus=status;this.labels();});
    this.toggle.onclick=()=>this.open(this.panel.hidden);
    element('chat-close').onclick=()=>this.open(false);
    element('chat-voice').onclick=()=>{
      if(this.voiceStatus.active||this.voiceStatus.pending)this.voice.stop();
      else if(this.available&&this.online&&this.teammates)void this.voice.start(this.side);
    };
    element('chat-mute').onclick=()=>this.voice.mute();element('chat-play').onclick=()=>void this.voice.play();
    element('chat-ptt').onclick=()=>{this.release();this.voice.setPushToTalk(!this.voiceStatus.pushToTalk);};
    const talk=element<HTMLButtonElement>('chat-talk');
    talk.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();talk.setPointerCapture(event.pointerId);this.holds.add('pointer');this.voice.talk(true);};
    talk.onpointerup=talk.onpointercancel=talk.onlostpointercapture=()=>{this.holds.delete('pointer');this.voice.talk(this.holds.size>0);};
    talk.onkeydown=event=>{if(event.code==='Space'){event.preventDefault();this.holds.add('button');this.voice.talk(true);}};
    talk.onkeyup=event=>{if(event.code==='Space'){event.preventDefault();this.holds.delete('button');this.voice.talk(this.holds.size>0);}};
    talk.onblur=()=>this.release();
    element('chat-quick-toggle').onclick=()=>{
      const quick=element('chat-quick');quick.hidden=!quick.hidden;
      element('chat-quick-toggle').setAttribute('aria-expanded',String(!quick.hidden));this.input.blur();
    };
    element('chat-quick-channel').onclick=()=>{this.channel.value=this.channel.value==='team'?'all':'team';this.labels();};
    for(const [key,value] of Object.entries(QUICK_MESSAGES)){
      const button=document.createElement('button');button.type='button';button.dataset.quick=key;button.textContent=presetText(value);
      button.onclick=()=>{if(this.online)this.send({type:'quick-chat',channel:this.channel.value,quick:key});element('chat-quick').hidden=true;element('chat-quick-toggle').setAttribute('aria-expanded','false');};
      element('chat-quick').append(button);
    }
    for(const [key,value] of Object.entries(PINGS)){
      const button=document.createElement('button');button.type='button';button.dataset.ping=key;button.textContent=presetText(value);
      button.onclick=()=>this.sendPing(key as PingKind);element('chat-pings').append(button);
    }
    const cancel=document.createElement('button');cancel.type='button';cancel.id='chat-ping-cancel';cancel.onclick=()=>{element('chat-pings').hidden=true;this.pingPoint=null;};element('chat-pings').append(cancel);
    element<HTMLFormElement>('chat-form').onsubmit=event=>{
      event.preventDefault();
      if(!this.online){this.notice=text('连接已断开，等待重连后发送','Disconnected. Wait for reconnection.');this.labels();return;}
      const content=this.input.value.trim();if(!content)return;
      if(this.send({type:'chat',channel:this.channel.value as ChatChannel,text:content})){this.input.value='';this.notice='';this.labels();}
    };
    this.input.onkeydown=event=>{if(event.isComposing&&event.key==='Enter')event.preventDefault();};
    this.input.onfocus=()=>this.release();
    document.addEventListener('keydown',event=>{
      if(!this.available||document.querySelector('dialog[open]')||event.isComposing)return;
      if(event.code==='KeyV'&&this.voiceStatus.active&&this.voiceStatus.pushToTalk&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!(event.target as HTMLElement).closest('input,textarea,game-select,[contenteditable]')){
        event.preventDefault();event.stopImmediatePropagation();this.holds.add('key');this.voice.talk(true);return;
      }
      if(event.key==='Escape'){element('chat-quick').hidden=true;element('chat-pings').hidden=true;}
      if(event.key==='Escape'&&!this.panel.hidden){event.preventDefault();event.stopImmediatePropagation();this.open(false);return;}
      if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!(event.target as HTMLElement).closest('input,textarea,game-select,button,[contenteditable]')){
        event.preventDefault();event.stopImmediatePropagation();if(event.shiftKey)this.channel.value='team';this.open(true);
      }
    },true);
    document.addEventListener('keyup',event=>{if(event.code==='KeyV'){this.holds.delete('key');this.voice.talk(this.holds.size>0);}},true);
    window.addEventListener('blur',()=>this.release());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.release();});
    window.addEventListener('pagehide',()=>this.voice.stop());
    this.channel.onchange=()=>this.labels();
    const channels=()=>this.channel.setOptions([['all',text('公屏','All')],['team',text('仅队友','Team')]],this.channel.value);
    onLanguageChange(()=>{channels();this.rosterKey='';this.labels();this.renderLog();this.renderPreview();});channels();this.labels();
  }
  configure(room:string,side:Side,available:boolean,online:boolean,teammates:number,coop=false){
    const configuration=[room,side,available,online,teammates,coop].join('|');
    if(configuration===this.configuration)return;this.configuration=configuration;
    if(room!==this.room||side!==this.side){
      this.release();this.voice.stop(false);this.voice.resetLevels();this.blocked.clear();this.members=[];this.rosterKey='';this.mark(null);this.clearPreview();this.pingCooldown=0;this.seen.clear();this.messages=[];this.unread=0;this.roster=[];this.renderLog();this.input.value='';this.notice='';
      this.channel.value=coop?'team':'all';
    }
    this.room=room;this.side=side;this.available=available;this.online=online;this.teammates=teammates;
    this.root.hidden=!available;
    if(!online||!available||!teammates){if(this.voiceStatus.active||this.voiceStatus.pending)this.voice.stop(online);}
    if(!available)this.open(false);
    this.labels();
  }
  disconnect(){this.configuration='';this.online=false;this.release();this.voice.stop(false);this.roster=[];this.close();this.labels();}
  close(){this.open(false);this.root.querySelector<HTMLElement>('#chat-quick')!.hidden=true;this.root.querySelector<HTMLElement>('#chat-pings')!.hidden=true;this.root.querySelector('#chat-quick-toggle')!.setAttribute('aria-expanded','false');}
  private release(){this.holds.clear();this.voice.talk(false);}
  showPings(point:Point,screen:Point){
    if(!this.available||!this.online)return false;
    this.pingPoint=point;const menu=this.root.querySelector<HTMLElement>('#chat-pings')!;
    menu.hidden=false;menu.style.left=Math.max(8,Math.min(innerWidth-224,screen.x-100))+'px';
    menu.style.top=Math.max(64,Math.min(innerHeight-164,screen.y-160))+'px';
    this.input.blur();return true;
  }
  private sendPing(kind:PingKind){
    if(this.pingPoint&&this.online){
      if(performance.now()<this.pingCooldown){this.noticePreview(text('标记冷却中，请等待 2 秒','Ping cooldown: please wait 2 seconds'));return;}
      if(this.send({type:'map-ping',kind,...this.pingPoint}))this.pingCooldown=performance.now()+2000;
    }
    this.root.querySelector<HTMLElement>('#chat-pings')!.hidden=true;this.pingPoint=null;
  }
  receive(message:CommsMessage){
    if(message.type==='map-ping'){
      if(this.blocked.has(message.side)||this.seen.has(message.id))return;
      this.mark(message);
      this.receive({type:'chat',id:message.id,time:message.time,side:message.side,name:message.name,channel:'team',text:`${presetText(PINGS[message.kind])} (${Math.round(message.x)}, ${Math.round(message.y)})`});
    }else if(message.type==='chat'){
      if(this.blocked.has(message.side))return;
      if(this.seen.has(message.id))return;this.seen.add(message.id);this.messages.push(message);
      if(this.messages.length>100){const old=this.messages.shift()!;this.seen.delete(old.id);}
      if(this.panel.hidden)this.unread=Math.min(99,this.unread+1);
      this.append(message);this.previews.push({message,expires:performance.now()+8000});this.previews=this.previews.slice(-3);this.renderPreview();this.labels();
    }else if(message.type==='voice-peers'){this.members=message.members;this.roster=message.peers;this.voice.setPeers(message.peers);this.labels();}
    else if(message.type==='voice-signal')this.voice.receive(message);
    else if(message.type==='comms-error')this.noticePreview(message.message);
  }
  private open(open:boolean){
    this.panel.hidden=!open;this.toggle.setAttribute('aria-expanded',String(open));
    if(open){this.unread=0;this.log.scrollTop=this.log.scrollHeight;this.input.focus({preventScroll:true});}
    else{this.input.blur();if(this.panel.contains(document.activeElement))this.toggle.focus({preventScroll:true});}
    if(!open)this.release();this.renderPreview();this.labels();
  }
  private append(message:ChatMessage){
    const stick=this.log.scrollHeight-this.log.scrollTop-this.log.clientHeight<40;
    const row=document.createElement('p'),label=document.createElement('b'),content=document.createElement('span');
    row.className=message.channel==='team'?'chat-team':'';
    label.textContent=`[${message.channel==='team'?text('队友','Team'):text('公屏','All')}] ${message.name}: `;
    content.textContent=message.quick?presetText(QUICK_MESSAGES[message.quick]):message.text;row.append(label,content);this.log.append(row);
    while(this.log.children.length>100)this.log.firstElementChild!.remove();
    if(stick)this.log.scrollTop=this.log.scrollHeight;
  }
  private renderLog(){this.log.replaceChildren();for(const message of this.messages)if(!this.blocked.has(message.side))this.append(message);}
  private clearPreview(){clearTimeout(this.previewTimer);this.previews=[];this.renderPreview();}
  private noticePreview(value:string){
    this.notice=value;this.previews.push({expires:performance.now()+8000,message:{type:'chat',id:'local-notice',time:Date.now(),side:this.side,name:text('提示','Notice'),text:value,channel:'team'}});
    this.previews=this.previews.slice(-3);this.renderPreview();this.labels();
  }
  private renderPreview(){
    clearTimeout(this.previewTimer);
    this.previews=this.previews.filter(p=>p.expires>performance.now()&&!this.blocked.has(p.message.side));
    const preview=this.root.querySelector<HTMLElement>('#chat-preview')!;preview.replaceChildren();preview.hidden=!this.panel.hidden||!this.previews.length;
    for(const {message} of this.previews){
      const row=document.createElement('p');
      row.textContent=`[${message.channel==='team'?text('队友','Team'):text('公屏','All')}] ${message.name}: ${message.quick?presetText(QUICK_MESSAGES[message.quick]):message.text}`;
      preview.append(row);
    }
    if(this.previews.length)this.previewTimer=setTimeout(()=>this.renderPreview(),Math.max(1,this.previews[0].expires-performance.now()));
  }
  private people(){
    const key=JSON.stringify([this.members,this.roster,this.blocked.size,getLanguage(),this.side]);
    const host=this.root.querySelector<HTMLElement>('#chat-people')!;
    if(key!==this.rosterKey){
      this.rosterKey=key;host.replaceChildren();
      for(const member of this.members){
        const row=document.createElement('div');row.className='chat-person';row.dataset.side=String(member.side);
        const name=document.createElement('span');name.className='chat-person-name';name.textContent=member.name;row.append(name);
        const indicator=document.createElement('output');indicator.className='chat-speaking';row.append(indicator);
        if(member.side!==this.side){
          const block=document.createElement('button');block.type='button';block.dataset.block=String(member.side);
          block.textContent=this.blocked.has(member.side)?text('取消屏蔽','Unblock'):text('屏蔽消息','Block text');
          block.onclick=()=>{
            if(this.blocked.has(member.side))this.blocked.delete(member.side);else{this.blocked.add(member.side);this.mark(null,member.side);}
            this.rosterKey='';this.renderLog();this.renderPreview();this.labels();
          };row.append(block);
          if(this.roster.some(p=>p.side===member.side)){
            const mute=document.createElement('button');mute.type='button';mute.dataset.peerMute=String(member.side);
            mute.onclick=()=>{const level=this.voice.peerLevel(member.side);this.voice.setPeerLevel(member.side,!level.muted,level.volume);};row.append(mute);
            const label=document.createElement('label');label.textContent=text('音量','Volume');
            const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.step='5';volume.value=String(this.voice.peerLevel(member.side).volume*100);volume.dataset.volume=String(member.side);
            volume.setAttribute('aria-label',`${member.name} ${text('语音音量','voice volume')}`);
            volume.oninput=()=>this.voice.setPeerLevel(member.side,this.voice.peerLevel(member.side).muted,Number(volume.value)/100);
            label.append(volume);row.append(label);
          }
        }
        host.append(row);
      }
    }
    for(const row of host.querySelectorAll<HTMLElement>('.chat-person')){
      const side=Number(row.dataset.side) as Side,active=this.voiceStatus.speaking?.includes(side);
      const indicator=row.querySelector<HTMLElement>('.chat-speaking')!;indicator.textContent=active?text('正在说话','Speaking'):'';
      row.classList.toggle('is-speaking',!!active);
      const mute=row.querySelector<HTMLButtonElement>('[data-peer-mute]');
      if(mute){const level=this.voice.peerLevel(side);mute.textContent=level.muted?text('取消静音','Unmute audio'):text('静音语音','Mute audio');mute.setAttribute('aria-pressed',String(level.muted));}
    }
  }
  private labels(){
    const set=(id:string,value:string)=>{this.root.querySelector<HTMLElement>('#'+id)!.textContent=value;};
    this.toggle.textContent=text('聊天','Chat')+(this.unread?` ${this.unread}`:'');
    this.toggle.title=text('Enter 打开聊天 · Shift+Enter 队友频道','Enter: chat · Shift+Enter: team chat');
    set('chat-quick-toggle',text('快捷消息','Quick chat'));set('chat-ping-cancel',text('取消','Cancel'));set('chat-people-title',text('队友语音与玩家','Team voice and players'));
    set('chat-quick-channel',this.channel.value==='team'?text('仅队友 · 点击切换公屏','Team · tap for All'):text('公屏 · 点击切换队友','All · tap for Team'));
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-quick]')){button.textContent=presetText(QUICK_MESSAGES[button.dataset.quick as keyof typeof QUICK_MESSAGES]);button.disabled=!this.online;}
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-ping]'))button.textContent=presetText(PINGS[button.dataset.ping as PingKind]);
    this.root.querySelector<HTMLButtonElement>('#chat-quick-toggle')!.disabled=!this.online;
    set('chat-title',text('战场通讯','Battle communications'));set('chat-send',text('发送','Send'));
    this.input.placeholder=text('输入消息 · 最多 300 字','Message · up to 300 characters');this.input.disabled=!this.online;
    this.root.querySelector<HTMLButtonElement>('#chat-send')!.disabled=!this.online;
    const state=this.voiceStatus;
    const ptt=this.root.querySelector<HTMLButtonElement>('#chat-ptt')!;ptt.textContent=state.pushToTalk?text('模式：按住说话','Mode: push to talk'):text('模式：自由说话','Mode: open mic');ptt.setAttribute('aria-pressed',String(!!state.pushToTalk));
    const talk=this.root.querySelector<HTMLButtonElement>('#chat-talk')!;talk.hidden=!state.active||!state.pushToTalk;talk.disabled=state.muted;talk.textContent=state.talking?text('正在传音…','Transmitting…'):text('按住说话 · V','Hold to talk · V');talk.setAttribute('aria-pressed',String(!!state.talking));
    set('chat-voice',state.pending?text('取消开启','Cancel'):state.active?text('关闭语音','Leave voice'):text('开启队友语音','Join team voice'));
    const button=this.root.querySelector<HTMLButtonElement>('#chat-voice')!;
    button.disabled=!this.online||!this.teammates;button.setAttribute('aria-pressed',String(state.active));
    const mute=this.root.querySelector<HTMLButtonElement>('#chat-mute')!;mute.hidden=!state.active;mute.textContent=state.muted?text('取消静音','Unmute'):text('麦克风静音','Mute mic');mute.setAttribute('aria-pressed',String(state.muted));
    const play=this.root.querySelector<HTMLButtonElement>('#chat-play')!;play.hidden=!state.blocked;play.textContent=text('播放队友语音','Play team audio');
    const names=this.roster.filter(p=>p.side!==this.side).map(p=>p.name).join('、');
    set('chat-voice-status',state.error||(state.pending?text('正在请求麦克风…','Requesting microphone…'):state.active?
      `${state.muted?text('已静音','Muted'):state.pushToTalk&&!state.talking?text('按住按钮或 V 说话','Hold button or V to talk'):text('麦克风开启','Mic on')} · ${state.connected}${text(' 位队友已连接',' teammates connected')}${names?' · '+names:''}`:
      !this.teammates?text('当前没有在线队友','No teammates online'):text('语音默认关闭，仅队友可听见','Voice is off. Teammates only.')));
    this.root.querySelector('#chat-voice-status')!.setAttribute('data-i18n-ignore','');
    if(state.speaking?.length)this.root.querySelector('#chat-voice-status')!.textContent+=` · ${text('正在说话：','Speaking: ')}${this.members.filter(p=>state.speaking!.includes(p.side)).map(p=>p.name).join('、')}`;
    set('chat-notice',this.notice||(!this.online?text('正在重连，消息暂不可发送','Reconnecting. Messages cannot be sent yet.'):this.channel.value==='team'&&!this.teammates?text('队友频道当前只有你','You are alone in the team channel'):''));
    this.people();
  }
}
