export const PAGES_BUILD=typeof __PAGES_BUILD__!=='undefined'&&__PAGES_BUILD__;
export const SEAT_KEY=PAGES_BUILD?'fudancraft-p2p-seat':'fudancraft-seat';

/** 跨网 UDP 中继可能持续丢包；有 TCP / TLS 候选时使用它们，直连和 STUN 不受影响。 */
export function preferTcpRelays(config:RTCConfiguration):RTCConfiguration {
  const tcp=(url:string)=>/^turns?:/i.test(url)&&(
    /[?&]transport=tcp(?:&|$)/i.test(url)||/^turns:/i.test(url)&&!/[?&]transport=udp(?:&|$)/i.test(url));
  const urls=(server:RTCIceServer)=>typeof server.urls==='string'?[server.urls]:server.urls;
  if(!config.iceServers?.some(server=>urls(server).some(tcp)))return config;
  return {...config,iceServers:config.iceServers.flatMap(server=>{
    const selected=urls(server).filter(url=>!/^turns?:/i.test(url)||tcp(url));
    return selected.length?[{...server,urls:selected}]:[];
  })};
}

/** 邀请固定房主 peerId；其他房间成员不能冒充权威节点。 */
export function parseInvite(value:unknown):{channel:string;hostId:string;code:string}|null {
  if(typeof value!=='string'||value.length>2048)return null;
  let code=value.trim();
  if(/^https?:\/\//i.test(code)){
    try{
      const url=new URL(code),hash=url.hash.slice(1);
      code=(hash?hash.includes('=')?new URLSearchParams(hash).get('room'):hash:null)??url.searchParams.get('room')??'';
    }catch{return null;}
  }else{
    if(code.startsWith('#'))code=code.slice(1);
    if(/^room=/i.test(code))code=new URLSearchParams(code).get('room')??'';
  }
  try{code=decodeURIComponent(code).trim();}catch{return null;}
  const match=/^([A-Fa-f0-9]{12}):([A-Za-z0-9_-]{1,128})$/.exec(code);
  return match?{channel:match[1].toUpperCase(),hostId:match[2],code:`${match[1].toUpperCase()}:${match[2]}`}:null;
}
export const displayRoom=(code:string)=>PAGES_BUILD?code.split(':')[0]:code;
export function inviteURL(code:string):string {
  const url=new URL(location.href);url.hash=`room=${encodeURIComponent(code)}`;return url.href;
}
