import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine } from '../src/game/engine.js';
import { DEFAULT_MAP_ID,isMapId,mapInfo,supportsPlayers } from '../src/game/maps.js';
import { validCommand } from '../src/game/command-validation.js';
import { packFog } from '../src/game/protocol.js';
import { RACES, isRace, type Side, type ViewState } from '../src/game/types.js';
import { restoreRooms,saveRooms,expiredRoom,RECONNECT_MS,type Client,type Seat,type Room } from './rooms.js';
import { allowedOrigin,clientAddress,positiveInteger,rejectUpgrade } from './admission.js';
const production=process.env.NODE_ENV==='production'||process.argv[1]?.endsWith('.js');
const port=Number(process.env.PORT)||4320;
const listenHost=process.env.LISTEN_HOST||'0.0.0.0';
const vite=production?null:await (await import('vite')).createServer({server:{middlewareMode:true},appType:'spa'});
const root=resolve('dist');
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
const maxConnections=positiveInteger(process.env.WS_MAX_CONNECTIONS,512);
const maxPerAddress=positiveInteger(process.env.WS_MAX_PER_IP,24);
const roomCreatesPerMinute=positiveInteger(process.env.WS_ROOM_CREATES_PER_MINUTE,12);
const unseatedTimeout=positiveInteger(process.env.WS_UNSEATED_TIMEOUT_MS,60_000);
const clients=new Map<WebSocket,Client>();
const connectionsByAddress=new Map<string,number>();
const roomCreates=new Map<string,{until:number;count:number}>();
let closing=false;
const server=createServer(async(req,res)=>{
  if(req.url==='/api/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return;}
  if(vite){vite.middlewares(req,res);return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  try{
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://localhost:${port}`).pathname);
    let path=resolve(root,'.'+pathname);if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    let file=await stat(path).catch(()=>null);
    if(file?.isDirectory()){path=resolve(path,'index.html');file=null;}
    else if(!file&&!extname(path)&&!pathname.startsWith('/assets/'))path=resolve(root,'index.html');
    file??=await stat(path);
    if(!file.isFile()){res.writeHead(404);res.end('Not found');return;}
    const cache=extname(path)==='.html'?'no-cache':/^[\w-]+-[\w-]{8}\.(?:js|css)$/.test(basename(path))?'public, max-age=31536000, immutable':'public, max-age=3600';
    const tag=`W/"${file.size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}"`;
    const headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':cache,'ETag':tag,'X-Content-Type-Options':'nosniff'};
    if(req.headers['if-none-match']?.split(',').some(value=>value.trim()===tag||value.trim()==='*')){res.writeHead(304,headers);res.end();return;}
    if(req.method==='HEAD'){res.writeHead(200,{...headers,'Content-Length':file.size});res.end();return;}
    const stream=createReadStream(path);
    res.on('close',()=>stream.destroy());
    stream.once('error',()=>{if(res.headersSent)res.destroy();else{res.writeHead(404);res.end('Not found');}});
    stream.once('open',()=>{res.writeHead(200,{...headers,'Content-Length':file.size});stream.pipe(res);});
  }catch{res.writeHead(404);res.end('Not found');}
});
const rooms=await restoreRooms();
const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:{
  serverNoContextTakeover:true,clientNoContextTakeover:true,threshold:1024,concurrencyLimit:4,
}});
server.on('upgrade',(req,socket,head)=>{
  // Vite registers its own upgrade listener in development for HMR.
  if(req.url?.split('?')[0]!=='/ws'){if(production)rejectUpgrade(socket,404,'Not Found');return;}
  if(closing){rejectUpgrade(socket,503,'Service Unavailable');return;}
  if(!allowedOrigin(req)){rejectUpgrade(socket,403,'Forbidden');return;}
  if(clients.size>=maxConnections){rejectUpgrade(socket,503,'Service Unavailable');return;}
  if((connectionsByAddress.get(clientAddress(req))??0)>=maxPerAddress){rejectUpgrade(socket,429,'Too Many Requests');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
const send=(c:Client,data:unknown)=>{
  if(c.ws.readyState!==WebSocket.OPEN)return;
  if(c.ws.bufferedAmount>=1_000_000){c.ws.terminate();return;}
  c.ws.send(JSON.stringify(data));
};
const connected=(r:Room)=>r.seats.filter(s=>s.client);
const host=(r:Room)=>connected(r)[0];
let snapshotTimer:ReturnType<typeof setTimeout>|undefined;
let snapshotRunning=false,snapshotPending=false;
function persist(){
  if(closing)return;
  snapshotPending=true;
  if(snapshotTimer||snapshotRunning)return;
  snapshotTimer=setTimeout(async()=>{
    snapshotTimer=undefined;
    snapshotRunning=true;
    snapshotPending=false;
    try{await saveRooms(rooms);}catch(error){console.error('Room snapshot failed:',error);}
    finally{snapshotRunning=false;if(snapshotPending)persist();}
  },200);
}
function lobby(r:Room){for(const s of connected(r))send(s.client!,{type:'lobby',code:r.code,mapId:r.mapId,mode:r.mode,side:s.side,host:host(r)===s,token:s.token,reconnectMs:RECONNECT_MS,players:r.seats.map(s=>({name:s.name,side:s.side,race:s.race??'industrial',connected:!!s.client})),started:!!r.engine});}
function leave(c:Client,explicit=false){
  const s=c.seat;if(!s)return;const r=rooms.get(s.room);c.seat=undefined;c.unseatedSince=Date.now();s.client=undefined;if(!r)return;
  r.active=Date.now();s.deadline=r.active+RECONNECT_MS;
  if(explicit)r.seats=r.seats.filter(x=>x!==s);
  if(r.engine){const p=r.engine.state.players.find(p=>p.side===s.side);if(p)p.ai=true;
    for(const peer of connected(r))send(peer.client!,{type:'notice',message:`${s.name} 已离线，AI 接管其部队${explicit?'':`，${Math.round(RECONNECT_MS/1000)} 秒内可重连`}`});}
  lobby(r);if(explicit&&!r.seats.length)rooms.delete(r.code);persist();
}
function seat(c:Client,r:Room,name:unknown){
  const s:Seat={name:cleanName(name),side:([1,2,3,4] as Side[]).find(side=>!r.seats.some(s=>s.side===side))!,token:randomBytes(32).toString('hex'),deadline:0,client:c,room:r.code};
  c.seat=s;r.seats.push(s);r.active=Date.now();lobby(r);persist();
}
const capacity=(r:Room)=>r.mode==='coop'?Math.min(2,mapInfo(r.mapId).maxPlayers-1):mapInfo(r.mapId).maxPlayers;
function started(s:Seat,r:Room,resumed=false){send(s.client!,{type:'started',side:s.side,code:r.code,mapId:r.mapId,mode:r.mode,resumed});if(r.engine)sendView(s.client!,r.engine);}
function start(r:Room){
  const humans=connected(r);
  if(humans.length!==(r.seats.length))return '请等待离线指挥官重连或席位超时';
  if(r.mode==='ffa'&&humans.length<2)return '至少需要两位指挥官';
  if(!humans.length||humans.length>capacity(r))return '所选地图不支持当前人数';
  const players=humans.map((s,i)=>({name:s.name,ai:false,race:s.race??'industrial' as const,team:r.mode==='coop'?1 as Side:(i+1) as Side}));
  if(r.mode==='coop'){
    const aiTeam=(humans.length+1) as Side;
    for(let i=humans.length;i<mapInfo(r.mapId).maxPlayers;i++)players.push({name:`AI 军团 ${i-humans.length+1}`,ai:true,race:RACES[i%RACES.length],team:aiTeam});
  }
  if(!supportsPlayers(r.mapId,players.length))return '所选地图不支持当前人数';
  r.engine=new Engine(players,'normal',r.mapId);r.active=Date.now();
  humans.forEach((s,i)=>{s.side=(i+1) as Side;});
  lobby(r);for(const s of humans)started(s,r);persist();return null;
}
wss.on('connection',(ws,req)=>{
  const address=clientAddress(req),now=Date.now();
  const c:Client={ws,address,last:now,unseatedSince:now,count:0,alive:true};
  clients.set(ws,c);
  connectionsByAddress.set(address,(connectionsByAddress.get(address)??0)+1);
  ws.on('pong',()=>{c.alive=true;});
  ws.on('message',raw=>{try{
    const now=Date.now();if(now-c.last>1000){c.last=now;c.count=0;}if(++c.count>40){if(c.count===41)send(c,{type:'error',message:'指令过于频繁'});return;}
    const m=JSON.parse(raw.toString());if(!m||typeof m.type!=='string')return;
    if(c.seat){const r=rooms.get(c.seat.room);if(r)r.active=now;}
    if(m.type==='create'){
      if(c.seat){send(c,{type:'error',message:'请先离开当前房间'});return;}if(rooms.size>=100){send(c,{type:'error',message:'服务器房间已满'});return;}
      if(m.mapId!==undefined&&!isMapId(m.mapId)){send(c,{type:'error',message:'未知战场'});return;}
      if(m.mode!==undefined&&!['ffa','coop'].includes(m.mode)){send(c,{type:'error',message:'未知对战模式'});return;}
      let window=roomCreates.get(c.address);
      if(!window||window.until<=now){
        if(!window&&roomCreates.size>=Math.max(1024,maxConnections*4)){send(c,{type:'error',message:'建房请求过多，请稍后重试'});return;}
        window={until:now+60_000,count:0};roomCreates.set(c.address,window);
      }
      if(window.count>=roomCreatesPerMinute){send(c,{type:'error',message:'建房请求过多，请稍后重试'});return;}
      window.count++;
      let code:string;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
      const r:Room={code,seats:[],mapId:m.mapId??DEFAULT_MAP_ID,mode:m.mode??'ffa',engine:null,created:now,active:now};rooms.set(code,r);seat(c,r,m.name);
    }else if(m.type==='join'){
      if(c.seat){send(c,{type:'error',message:'请先离开当前房间'});return;}const r=rooms.get(String(m.code).toUpperCase());if(!r||r.engine||r.seats.length>=capacity(r)){send(c,{type:'error',message:'房间不存在、已开始或所选地图人数已满'});return;}seat(c,r,m.name);
    }else if(m.type==='resume'){
      if(c.seat)return;const r=rooms.get(String(m.code).toUpperCase()),s=r?.seats.find(s=>s.token===m.token&&typeof m.token==='string');
      if(!r||!s||!s.client&&s.deadline<=now){send(c,{type:'resume-error',message:'重连席位已过期，请创建或加入新的房间'});return;}
      if(s.client){const old=s.client;old.seat=undefined;old.ws.close(4001,'Seat resumed');}
      s.client=c;s.deadline=0;c.seat=s;r.active=now;
      const p=r.engine?.state.players.find(p=>p.side===s.side);if(p)p.ai=false;
      lobby(r);if(r.engine)started(s,r,true);persist();
    }else if(m.type==='select-race'){
      const s=c.seat,r=rooms.get(s?.room||'');
      if(!r||!s)return;
      if(r.engine||!isRace(m.race)){send(c,{type:'error',message:'只能在战役开始前选择有效种族'});return;}
      s.race=m.race;lobby(r);persist();
    }else if(m.type==='select-map'){
      const r=rooms.get(c.seat?.room||'');if(!r)return;
      if(host(r)!==c.seat){send(c,{type:'error',message:'只有房主可以选择地图'});return;}
      if(r.engine){send(c,{type:'error',message:'战役开始后不能更换地图'});return;}
      if(!isMapId(m.mapId)){send(c,{type:'error',message:'未知战场'});return;}
      const max=r.mode==='coop'?Math.min(2,mapInfo(m.mapId).maxPlayers-1):mapInfo(m.mapId).maxPlayers;
      if(r.seats.length>max){send(c,{type:'error',message:`${mapInfo(m.mapId).name}最多支持 ${max} 位指挥官，请选择人数足够的地图`});lobby(r);return;}
      r.mapId=m.mapId;lobby(r);persist();
    }else if(m.type==='leave'){leave(c,true);send(c,{type:'left'});
    }else if(m.type==='start'){
      const r=rooms.get(c.seat?.room||'');if(!r||host(r)!==c.seat||r.engine)return;const error=start(r);if(error)send(c,{type:'error',message:error});
    }else if(m.type==='rematch'){
      const r=rooms.get(c.seat?.room||'');if(!r||!r.engine)return;
      if(host(r)!==c.seat){send(c,{type:'error',message:'只有房主可以发起再战'});return;}
      if(!r.engine.state.winner){send(c,{type:'error',message:'战役结束后才能再战'});return;}
      r.engine=null;lobby(r);persist();
    }else if(m.type==='command'){
      const r=rooms.get(c.seat?.room||'');if(!r?.engine||!c.seat||!validCommand(m.command,r.engine.extent))return;const error=r.engine.command(c.seat.side,m.command);if(error)send(c,{type:'error',message:error});
    }
  }catch{send(c,{type:'error',message:'无效消息'});}});
  ws.on('close',()=>{
    clients.delete(ws);
    const remaining=(connectionsByAddress.get(c.address)??1)-1;
    if(remaining)connectionsByAddress.set(c.address,remaining);else connectionsByAddress.delete(c.address);
    leave(c);
  });
  ws.on('error',()=>ws.terminate());
});
function cleanName(n:unknown){return(typeof n==='string'?n:'指挥官').trim().slice(0,16)||'指挥官';}
// 视野掩码在同一轮视野计算内复用。地图更大时也只封包一次。
const wireFog=new WeakMap<ViewState['visible'],{visible:string;explored:string}>();
function sendView(c:Client,engine:Engine){
  if(!c.seat||c.sendingState||c.ws.readyState!==WebSocket.OPEN||c.ws.bufferedAmount>=256*1024)return;
  const state=engine.view(c.seat.side);
  let fog=wireFog.get(state.visible);
  if(!fog){
    fog={visible:Buffer.from(packFog(state.visible)).toString('base64'),explored:Buffer.from(packFog(state.explored)).toString('base64')};
    wireFog.set(state.visible,fog);
  }
  c.sendingState=true;
  c.ws.send(JSON.stringify({type:'state',state:{...state,...fog}}),()=>{c.sendingState=false;});
}
let broadcast=0;
const tick=setInterval(()=>{for(const r of rooms.values())if(r.engine&&connected(r).length){r.engine.step(.05);if(broadcast%2===0)for(const s of connected(r))sendView(s.client!,r.engine);}broadcast++;},50);
const housekeeping=setInterval(()=>{const now=Date.now();
  for(const c of clients.values())if(!c.seat&&now-c.unseatedSince>=unseatedTimeout)c.ws.terminate();
  for(const [address,window] of roomCreates)if(window.until<=now)roomCreates.delete(address);
  for(const r of rooms.values()){
  const count=r.seats.length;r.seats=r.seats.filter(s=>s.client||s.deadline>now);if(count!==r.seats.length)lobby(r);
  if(!r.seats.length){rooms.delete(r.code);continue;}
  if(expiredRoom(r,now)){for(const s of connected(r)){send(s.client!,{type:'resume-error',message:'房间已超时关闭'});s.client!.seat=undefined;s.client!.unseatedSince=now;}rooms.delete(r.code);}
}},1000);
const heartbeat=setInterval(()=>{for(const c of clients.values()){if(!c.alive){c.ws.terminate();continue;}if(c.ws.readyState===WebSocket.OPEN){c.alive=false;c.ws.ping();}}},30000);
const snapshots=setInterval(persist,10000);
server.listen(port,listenHost,()=>{
  console.log(`FudanCraft → http://localhost:${port}`);
  if(listenHost!=='0.0.0.0')return;
  const addresses=new Set(Object.values(networkInterfaces()).flatMap(interfaces=>
    (interfaces??[]).filter(address=>address.family==='IPv4'&&!address.internal).map(address=>address.address)
  ));
  for(const address of addresses)console.log(`局域网 → http://${address}:${port}`);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;clearInterval(tick);clearInterval(heartbeat);clearInterval(housekeeping);clearInterval(snapshots);clearTimeout(snapshotTimer);try{await saveRooms(rooms);}catch(error){console.error(error);}for(const ws of wss.clients)ws.terminate();wss.close();server.close();await vite?.close();process.exit(0);});
