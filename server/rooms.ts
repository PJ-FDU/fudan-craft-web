import { mkdir,readdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Engine } from '../src/game/engine.js';
import { isMapId,type MapId } from '../src/game/maps.js';
import { isRace,type Race,type Side } from '../src/game/types.js';
import type { WebSocket } from 'ws';

export type RoomMode='ffa'|'coop';
export interface Client {ws:WebSocket;address:string;seat?:Seat;unseatedSince:number;last:number;count:number;alive:boolean;sendingState?:boolean}
export interface Seat {race?:Race;name:string;side:Side;token:string;deadline:number;client?:Client;room:string}
export interface Room {code:string;seats:Seat[];mapId:MapId;mode:RoomMode;engine:Engine|null;created:number;active:number}
export const RECONNECT_MS=Number(process.env.ROOM_RECONNECT_MS)||120_000;
const directory=resolve(process.env.ROOM_STORE_DIR||'.rooms');
const retained=24*60*60*1000;

/** 房间快照不包含连接对象；只恢复通过 Engine.restore 校验的权威状态。 */
export async function restoreRooms(){
  const rooms=new Map<string,Room>();
  await mkdir(directory,{recursive:true});
  for(const name of (await readdir(directory)).filter(n=>/^[A-F0-9]{6}\.json$/.test(n)).slice(0,100)){
    try{
      const raw=await readFile(resolve(directory,name),'utf8');if(raw.length>8_000_000)continue;
      const r=JSON.parse(raw),now=Date.now();
      if(r.version!==1||r.code!==name.slice(0,6)||!isMapId(r.mapId)||!['ffa','coop'].includes(r.mode)
        ||!Number.isFinite(r.active)||now-r.active>retained||!Number.isFinite(r.created)||!Array.isArray(r.seats)||r.seats.length>4)continue;
      const engine=r.save===null?null:Engine.restore(r.save);
      if(engine&&engine.state.mapId!==r.mapId)continue;
      const seats:Seat[]=r.seats;
      if(seats.some(s=>!s||typeof s.name!=='string'||s.name.length>16||!Number.isInteger(s.side)||s.side<1||s.side>4
        ||typeof s.token!=='string'||!/^[a-f0-9]{64}$/.test(s.token)||!Number.isFinite(s.deadline)||s.room!==r.code||s.race!==undefined&&!isRace(s.race))
        ||new Set(seats.map(s=>s.side)).size!==seats.length||new Set(seats.map(s=>s.token)).size!==seats.length)continue;
      if(engine&&seats.some(s=>!engine.state.players.some(p=>p.side===s.side)))continue;
      const reserved=seats.filter(s=>s.deadline>now);if(!reserved.length)continue;
      for(const p of engine?.state.players??[])p.ai=true;
      rooms.set(r.code,{code:r.code,seats:reserved,mapId:r.mapId,mode:r.mode,engine,created:r.created,active:r.active});
    }catch{/* 单个损坏快照不能阻止服务器启动。 */}
  }
  return rooms;
}
let writing=Promise.resolve();
export function saveRooms(rooms:Map<string,Room>){
  // 串行原子替换，避免周期快照与关服快照交错。
  const snapshots=[...rooms.values()].map(r=>({version:1,code:r.code,mapId:r.mapId,mode:r.mode,created:r.created,active:r.active,
    seats:r.seats.map(({name,side,token,deadline,client,room,race})=>({name,side,token,race,deadline:client?Date.now()+RECONNECT_MS:deadline,room})),
    save:r.engine?.save()??null}));
  writing=writing.catch(()=>{}).then(async()=>{
    await mkdir(directory,{recursive:true});
    for(const r of snapshots){
      const path=resolve(directory,`${r.code}.json`),temp=path+'.tmp';
      await writeFile(temp,JSON.stringify(r),{mode:0o600});await rename(temp,path);
    }
    const codes=new Set(snapshots.map(r=>r.code));
    for(const name of await readdir(directory))if(/^[A-F0-9]{6}\.json$/.test(name)&&!codes.has(name.slice(0,6)))await unlink(resolve(directory,name));
  });
  return writing;
}
export function expiredRoom(r:Room,now:number){
  return now-r.active>(r.engine&&!r.engine.state.winner?retained:30*60*1000);
}
