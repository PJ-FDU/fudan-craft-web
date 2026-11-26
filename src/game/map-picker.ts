import { MAPS,mapInfo,isMapId,type MapId } from './maps.js';
import { getWorld,initialNodes } from './world.js';
import { COLORS } from './types.js';
import { traceWater } from './terrain-shapes.js';
import { gridSize,TILE } from './pathfinding.js';
import { heightAt } from './terrain-height.js';

export function mapPickerMarkup(selected:MapId|string,locked=false,playerCount=2){
  return `<fieldset class="map-picker"><legend>选择战场 <span>${MAPS.length} 张地图 · ${locked?'由房主选择':'含 4 张魔兽经典布局'}</span></legend>
    <div class="map-grid">${MAPS.map((map,i)=>`<label class="map-option">
      <input type="radio" name="battle-map" value="${map.id}" ${map.id===selected?'checked':''} ${locked||map.maxPlayers<playerCount?'disabled':''}/>
      <canvas width="256" height="256" data-map-preview="${map.id}" aria-hidden="true"></canvas>
      <span class="map-number">0${i+1}</span><span class="map-capacity">${map.maxPlayers===2?'2 人':'2–4 人'}</span><strong>${map.name}</strong><small>${map.tag}</small>
    </label>`).join('')}</div>
    <p class="map-brief" aria-live="polite">${isMapId(selected)?mapInfo(selected).description:'已选择自定义战场；选择上方内置地图可更换战场。'}</p></fieldset>`;
}

/** 大地图与房间缩略图共用权威地形、资源点与出生位，不维护另一套预览数据。 */
export function drawMapPreview(canvas:HTMLCanvasElement,mapId:MapId|string){
    const world=getWorld(mapId),c=canvas.getContext('2d')!,size=gridSize(world.land),scale=canvas.width/(size*TILE);
    const raster=document.createElement('canvas');raster.width=raster.height=size;
    const paint=raster.getContext('2d')!,pixels=paint.createImageData(size,size);
    const obstacle=world.id==='shattered-highlands'?[119,125,104]:[22,44,37];
    for(let i=0;i<world.land.length;i++){
      const road=world.roads[i]/255,at=i*4,blocked=world.land[i];
      const h=world.heights?Math.max(0,heightAt(world,(i%size+.5)*TILE,(Math.floor(i/size)+.5)*TILE)):0;
      const lift=Math.round(Math.min(34,h*.65));
      pixels.data[at]=Math.min(255,(blocked?obstacle[0]:64+Math.round(77*road))+lift);
      pixels.data[at+1]=Math.min(255,(blocked?obstacle[1]:88+Math.round(45*road))+lift);
      pixels.data[at+2]=Math.min(255,(blocked?obstacle[2]:62+Math.round(34*road))+Math.round(lift*.75));
      pixels.data[at+3]=255;
    }
    paint.putImageData(pixels,0,0);
    c.drawImage(raster,0,0,canvas.width,canvas.height);
    c.save();c.scale(scale,scale);
    if(world.waterMask){
      c.fillStyle='#6196a5';
      for(let i=0;i<world.waterMask.length;i++)if(world.waterMask[i])c.fillRect(i%size*TILE,Math.floor(i/size)*TILE,TILE,TILE);
    }
    for(const f of world.features)if(f.kind==='water'){
      c.fillStyle='#6196a5';traceWater(c,f);c.fill();
    }
    for(const n of world.deposits??initialNodes(world)){
      if(n.tree!==undefined)continue;
      c.fillStyle=n.kind==='gold'?'#e8cd87':n.kind==='oil'?'#a4c6d1':'#b3cb8a';c.beginPath();c.arc(n.x,n.y,Math.max(23,1.5/scale),0,Math.PI*2);c.fill();
    }
    const marker=Math.max(64,2/scale);
    for(const b of world.bases){
      c.fillStyle=COLORS[b.side];c.strokeStyle='#0d201a';c.lineWidth=Math.max(18,.6/scale);
      c.fillRect(b.x-marker,b.y-marker,marker*2,marker*2);c.strokeRect(b.x-marker,b.y-marker,marker*2,marker*2);
    }
    c.restore();
}

export function bindMapPicker(parent:HTMLElement,onChange:(id:MapId)=>void){
  for(const canvas of parent.querySelectorAll<HTMLCanvasElement>('[data-map-preview]')){
    drawMapPreview(canvas,canvas.dataset.mapPreview as MapId);
  }
  parent.querySelectorAll<HTMLInputElement>('input[name="battle-map"]').forEach(input=>{
    input.onchange=()=>{
      const id=input.value as MapId;
      parent.querySelector('.map-brief')!.textContent=mapInfo(id).description;onChange(id);
    };
  });
}
