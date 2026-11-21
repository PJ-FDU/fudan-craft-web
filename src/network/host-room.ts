import { Engine } from '../game/engine.js';
import { validCommand } from '../game/command-validation.js';
import { DEFAULT_MAP_ID,isMapId,mapInfo,supportsPlayers,type MapId } from '../game/maps.js';
import { RACES,isRace,type Race,type Side } from '../game/types.js';

export const RECONNECT_MS=120_000;
export type RoomMessage={type:string;[key:string]:unknown};
type Seat={race?:Race;id:string|null;name:string;side:Side;token:string;deadline:number;host:boolean};
type Client={since:number;last:number;count:number};
const cleanName=(value:unknown)=>(typeof value==='string'?value:'指挥官').trim().slice(0,16)||'指挥官';
export function randomHex(bytes:number):string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}

/** 房主 Worker 与服务器使用同一个 Engine；调用方只提供已认证的通道发送者身份。 */
export class HostRoom {
  engine:Engine|null=null;
  private seats:Seat[]=[];
  private clients=new Map<string,Client>();
  private mapId:MapId=DEFAULT_MAP_ID;
  private mode:'ffa'|'coop'='ffa';
  private created=false;
  private tickCount=0;
  private epoch=0;
  constructor(readonly code:string,readonly hostId:string,private readonly emit:(id:string,message:RoomMessage)=>void){}

  connect(id:string,now=Date.now()):void {
    if(!this.clients.has(id))this.clients.set(id,{since:now,last:now,count:0});
  }
  disconnect(id:string,explicit=false,now=Date.now()):void {
    this.clients.delete(id);
    const seat=this.seats.find(s=>s.id===id);if(!seat)return;
    seat.id=null;seat.deadline=now+RECONNECT_MS;
    if(explicit)this.seats=this.seats.filter(s=>s!==seat);
    const player=this.engine?.state.players.find(p=>p.side===seat.side);if(player)player.ai=true;
    if(this.engine)this.broadcast({type:'notice',message:`${seat.name} 已离线，AI 接管其部队${explicit?'':'，120 秒内可重连'}`});
    this.lobby();
  }
  receive(id:string,message:RoomMessage,now=Date.now()):void {
    const client=this.clients.get(id);if(!client)return;
    if(now-client.last>=1000){client.last=now;client.count=0;}
    if(++client.count>40){if(client.count===41)this.error(id,'指令过于频繁');return;}
    const seat=this.seats.find(s=>s.id===id);
    if(message.type==='create'){
      if(id!==this.hostId||this.created){this.error(id,'请先离开当前房间');return;}
      if(message.mapId!==undefined&&!isMapId(message.mapId)){this.error(id,'未知战场');return;}
      if(message.mode!==undefined&&message.mode!=='ffa'&&message.mode!=='coop'){this.error(id,'未知对战模式');return;}
      this.mapId=isMapId(message.mapId)?message.mapId:DEFAULT_MAP_ID;
      this.mode=message.mode==='coop'?'coop':'ffa';this.created=true;
      this.addSeat(id,message.name,true);return;
    }
    if(message.type==='join'){
      if(seat){this.error(id,'请先离开当前房间');return;}
      if(!this.created||this.engine||this.seats.length>=this.capacity()||message.code!==this.code){this.error(id,'房间不存在、已开始或所选地图人数已满');return;}
      this.addSeat(id,message.name,false);return;
    }
    if(message.type==='resume'){
      if(seat)return;
      const saved=this.seats.find(s=>!s.host&&s.token===message.token&&typeof message.token==='string');
      if(message.code!==this.code||!saved||!saved.id&&saved.deadline<=now){
        this.emit(id,{type:'resume-error',message:'重连席位已过期，请创建或加入新的房间'});return;
      }
      if(saved.id){
        const old=saved.id;this.clients.delete(old);saved.id=null;
        this.emit(old,{type:'replaced'});
      }
      saved.id=id;saved.deadline=0;
      const player=this.engine?.state.players.find(p=>p.side===saved.side);if(player)player.ai=false;
      this.lobby();if(this.engine)this.started(saved,true);return;
    }
    if(!seat)return;
    if(message.type==='leave'){this.disconnect(id,true,now);this.emit(id,{type:'left'});return;}
    if(message.type==='select-race'){
      if(this.engine||!isRace(message.race)){this.error(id,'只能在战役开始前选择有效种族');return;}
      seat.race=message.race;this.lobby();return;
    }
    if(message.type==='select-map'){
      if(!seat.host){this.error(id,'只有房主可以选择地图');return;}
      if(this.engine){this.error(id,'战役开始后不能更换地图');return;}
      if(!isMapId(message.mapId)){this.error(id,'未知战场');return;}
      if(this.seats.length>this.capacity(message.mapId)){this.error(id,'所选地图不支持当前人数');return;}
      this.mapId=message.mapId;this.lobby();return;
    }
    if(message.type==='start'){
      if(!seat.host||this.engine)return;
      const error=this.start();if(error)this.error(id,error);return;
    }
    if(message.type==='rematch'){
      if(!seat.host){this.error(id,'只有房主可以发起再战');return;}
      if(!this.engine?.state.winner){this.error(id,'战役结束后才能再战');return;}
      this.engine=null;this.lobby();return;
    }
    if(message.type==='command'&&this.engine&&validCommand(message.command,this.engine.extent)){
      const error=this.engine.command(seat.side,message.command);if(error)this.error(id,error);
    }
  }
  tick(now=Date.now()):void {
    if(this.engine){this.engine.step(.05);if(this.tickCount++%2===0)for(const seat of this.seats)if(seat.id)this.sendState(seat);}
    const count=this.seats.length;
    this.seats=this.seats.filter(s=>s.id||s.deadline>now);
    if(count!==this.seats.length)this.lobby();
    for(const [id,client] of this.clients)if(!this.seats.some(s=>s.id===id)&&now-client.since>=30_000){
      this.clients.delete(id);this.emit(id,{type:'rejected',message:'加入房间超时'});
    }
  }
  private capacity(map=this.mapId){return this.mode==='coop'?Math.min(2,mapInfo(map).maxPlayers-1):mapInfo(map).maxPlayers;}
  private addSeat(id:string,name:unknown,host:boolean):void {
    const side=([1,2,3,4] as Side[]).find(side=>!this.seats.some(s=>s.side===side))!;
    this.seats.push({id,name:cleanName(name),side,host,token:randomHex(32),deadline:0});this.lobby();
  }
  private lobby():void {
    for(const seat of this.seats)if(seat.id)this.emit(seat.id,{
      type:'lobby',code:this.code,mapId:this.mapId,mode:this.mode,side:seat.side,host:seat.host,
      token:seat.token,reconnectMs:RECONNECT_MS,
      players:this.seats.map(s=>({name:s.name,side:s.side,race:s.race??'industrial',connected:!!s.id})),started:!!this.engine,
    });
  }
  private broadcast(message:RoomMessage):void {for(const seat of this.seats)if(seat.id)this.emit(seat.id,message);}
  private error(id:string,message:string):void {this.emit(id,{type:'error',message});}
  private sendState(seat:Seat):void {if(this.engine&&seat.id)this.emit(seat.id,{type:'state',epoch:this.epoch,state:this.engine.view(seat.side)});}
  private started(seat:Seat,resumed=false):void {
    if(!seat.id)return;
    this.emit(seat.id,{type:'started',epoch:this.epoch,side:seat.side,code:this.code,mapId:this.mapId,mode:this.mode,resumed});
    this.sendState(seat);
  }
  private start():string|null {
    if(this.seats.some(s=>!s.id))return '请等待离线指挥官重连或席位超时';
    if(this.mode==='ffa'&&this.seats.length<2)return '至少需要两位指挥官';
    if(!this.seats.length||this.seats.length>this.capacity())return '所选地图不支持当前人数';
    const players=this.seats.map((s,i)=>({name:s.name,ai:false,race:s.race??'industrial' as const,team:this.mode==='coop'?1 as Side:(i+1) as Side}));
    if(this.mode==='coop'){
      const aiTeam=(players.length+1) as Side;
      while(players.length<mapInfo(this.mapId).maxPlayers)players.push({name:`AI 军团 ${players.length-this.seats.length+1}`,ai:true,race:RACES[players.length%RACES.length],team:aiTeam});
    }
    if(!supportsPlayers(this.mapId,players.length))return '所选地图不支持当前人数';
    this.engine=new Engine(players,'normal',this.mapId);
    this.epoch++;
    this.seats.forEach((s,i)=>{s.side=(i+1) as Side;});this.lobby();
    for(const seat of this.seats)this.started(seat);
    return null;
  }
}
