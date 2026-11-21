import { drawOilWell } from './art.js';
import { drawAtlasSprite } from './atlas-sprite.js';
import { animationColumn,stride } from './animation.js';
import { weapon } from './weapons.js';
import { drawTree } from './tree-renderer.js';
import { MOBILE_KINDS,BUILDING_KINDS,STATS,type MobileKind,type BuildingKind } from './types.js';
import { t } from './locale.js';
import { dropdownMarkup,type GameSelect } from './dropdown.js';

/** A visible field guide lets players inspect every animation without unlocking a whole tech tree. */
export function animationGallery(root:HTMLElement,images:Map<string,HTMLImageElement>){
  root.innerHTML=`<p class="dialog-description">查看八个朝向的动作、建筑各阶段与林间风动。暂停后可逐帧查看。</p><div class="settings-row"><div class="field">图鉴分类${dropdownMarkup('gallery-category','图鉴分类',[['units','部队动作'],['buildings','基地建筑'],['trees','林间风动'],['ground','地表细节']])}</div><div class="field" id="gallery-kind-label">对象${dropdownMarkup('gallery-kind','对象')}</div></div><div class="animation-stage"><canvas id="animation-preview" aria-label="序列帧动画预览"></canvas></div><p class="room-note" id="gallery-caption"></p><div class="dialog-actions"><button class="secondary-button" id="gallery-play">暂停动画</button><button class="secondary-button" id="gallery-step">下一帧</button></div>`;
  const category=root.querySelector<GameSelect>('#gallery-category')!,kind=root.querySelector<GameSelect>('#gallery-kind')!,canvas=root.querySelector<HTMLCanvasElement>('#animation-preview')!,caption=root.querySelector<HTMLElement>('#gallery-caption')!;
  const play=root.querySelector<HTMLButtonElement>('#gallery-play')!,step=root.querySelector<HTMLButtonElement>('#gallery-step')!;
  const c=canvas.getContext('2d')!;canvas.width=1280;canvas.height=840;
  let frame=0,playing=true,request=0,last=0,elapsed=0,previewTime=0;
  function options(){const keys=category.value==='units'?MOBILE_KINDS:BUILDING_KINDS;kind.setOptions(keys.map(k=>[k,STATS[k].name]));root.querySelector<HTMLElement>('#gallery-kind-label')!.hidden=!['units','buildings'].includes(category.value);frame=0;previewTime=0;elapsed=0;draw();}
  function text(s:string,x:number,y:number,size=18){c.font=`${size}px sans-serif`;c.fillStyle='#d8e5c9';c.textAlign='left';c.fillText(t(s),x,y);}
  function draw(){
    const ground=images.get('ground-grass')!;c.fillStyle='#1b3426';c.fillRect(0,0,1280,840);c.globalAlpha=.5;c.drawImage(ground,0,0,1280,840);c.globalAlpha=1;
    c.fillStyle='#08160ec0';c.fillRect(0,0,1280,840);
    if(category.value==='units'){
      const k=kind.value as MobileKind;
      const states=[{name:'待机',rows:[0,1]},{name:'移动',rows:[2,3,4,5]},{name:k==='worker'?'采集 / 施工':k==='medic'?'治疗':'攻击',rows:[6,7]},{name:'阵亡',rows:[8,9,9,9]}];
      ['东','东南','南','西南','西','西北','北','东北'].forEach((d,i)=>text(d,130+i*143,35));
      const spec=weapon(k),cycle=previewTime%STATS[k].cooldown;
      const rows=[Math.floor(previewTime*1.6)%2,2+Math.floor(previewTime*STATS[k].speed/stride(k)*4)%4,k==='worker'?6+Math.floor(previewTime*2.6)%2:cycle<spec.windup?6:cycle<spec.windup+spec.recovery?7:0,previewTime%3.2<.28?8:9];
      states.forEach((s,r)=>{const row=rows[r];text(s.name,12,125+r*198,17);for(let d=0;d<8;d++){drawAtlasSprite(c,images,`animation-${k}`,row*8+animationColumn(k,d),165+d*143,195+r*198,140);}});
      caption.textContent=`${STATS[k].name} · 8 个朝向 · 每朝向 2 帧待机 / 4 帧移动 / 2 帧${k==='worker'?'作业':k==='medic'?'治疗':'攻击'} / 2 帧阵亡`;
    }else if(category.value==='buildings'){
      const k=kind.value as BuildingKind,row=BUILDING_KINDS.findIndex(k=>k===k),names=['施工进度','损毁程度','生产循环'];
      if(k==='oilwell'){
        for(let stage=1;stage<=4;stage++){
          text(`施工 ${stage*25}%`,stage*245-100,130);
          drawOilWell(c,stage*245-95,400,175,stage===4?Math.sin(previewTime*2.4)*.18:0,stage/4);
        }
        caption.textContent='油井 · 施工与抽油动画';
        return;
      }
      ['building-construction','building-damage','building-production'].forEach((name,r)=>{text(names[r],16,50+r*270);for(let col=0;col<4;col++){drawAtlasSprite(c,images,name,row*4+col,282+col*265,255+r*270,235);if(r===2&&col===frame%4){c.strokeStyle='#a4e5c0';c.lineWidth=3;c.strokeRect(165+col*265,20+r*270,235,235);}}});
      caption.textContent=`${STATS[k].name} · 4 个建造阶段 / 4 级建筑损毁 / 4 帧生产动画`;
    }else if(category.value==='trees'){
      ['松树','橡树','白桦','灌木'].forEach((s,r)=>{text(s,12,100+r*200);for(let col=0;col<6;col++){drawTree(c,images,r,205+col*190,200+r*200,190,previewTime);}});
      caption.textContent='同一树形连续轻摆 · 12 秒微风周期 · 树根与下部树干固定';
    }else{
      for(const [i,name] of ['grass','earth'].entries()){const img=images.get(`ground-${name}`)!;c.drawImage(img,0,0,Math.min(img.width,960),Math.min(img.height,1260),i*640,0,640,840);c.fillStyle='#06180fc9';c.fillRect(i*640,0,640,55);text(`${i?'泥土':'草地'} · ${img.width} × ${img.height}`,i*640+22,36,22);}
      caption.textContent='高分辨率微观纹理 · 战场按缩放级别分块绘制，最高 4 像素 / 世界像素';
    }
    canvas.dataset.frame=String(frame);
    canvas.dataset.time=String(previewTime);
  }
  category.onchange=options;kind.onchange=()=>{frame=0;previewTime=0;draw();};play.onclick=()=>{playing=!playing;play.textContent=playing?'暂停动画':'播放动画';};step.onclick=()=>{playing=false;play.textContent='播放动画';frame++;previewTime+=.16;draw();};
  function tick(now:number){if(last&&playing){const dt=Math.min(100,now-last);elapsed+=dt;previewTime+=dt/1000;}last=now;if(elapsed>=160){elapsed%=160;frame++;}if(playing)draw();request=requestAnimationFrame(tick);}
  options();request=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(request);
}
