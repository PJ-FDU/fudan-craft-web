import { oilPipeLayout } from './oil.js';
import type { Point } from './types.js';

export const OIL_PIPE_PAINT='generated/oil-pipe-paint-v1.webp';
export const OIL_PIPE_NORMAL='generated/oil-pipe-normal-v1.webp';
export const OIL_PIPE_ROUGHNESS='generated/oil-pipe-roughness-v1.webp';

export function drawOilPipe(c:CanvasRenderingContext2D,paint:CanvasImageSource,well:Point,refinery:Point,land?:Uint8Array){
  const {points,sections}=oilPipeLayout(well,refinery,land);
  if(!sections.length)return;
  c.save();c.strokeStyle='#14211b9c';c.lineWidth=9;c.lineJoin='round';c.lineCap='round';
  c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();
  for(const {a,b,length,angle} of sections){
    c.save();c.translate(a.x,a.y);c.rotate(angle);
    c.fillStyle='#4c5047';c.fillRect(length/2-4,-4.5,8,9);
    c.fillStyle='#273b37';c.fillRect(0,-3,length,6);
    c.drawImage(paint,0,-2.8,length,5.6);
    const sheen=c.createLinearGradient(0,-3,0,3);
    sheen.addColorStop(0,'#e7e8c750');sheen.addColorStop(1,'#091919a0');
    c.fillStyle=sheen;c.fillRect(0,-2.8,length,5.6);
    c.fillStyle='#a69973';c.fillRect(-1.8,-3.5,1,7);c.fillRect(1,-3.5,1,7);
    c.restore();
  }
  const end=points.at(-1)!;
  c.strokeStyle='#b16c46';c.lineWidth=1.2;c.beginPath();c.arc(end.x,end.y,3,0,Math.PI*2);c.stroke();
  c.restore();
}
