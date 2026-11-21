import { factionProfile, factionPalette, factionGlyphs } from './faction-models.js';
import { STATS, type Kind, type LegacyMobileKind, type Race } from './types.js';
import { assetPath } from './assets.js';
import { PORTRAIT_COLUMNS, PORTRAIT_ROWS, portraitAtlas, portraitCell } from './model-portraits.js';
export const ART = {
  units: assetPath('generated/units-v2.png'),
  buildings: assetPath('generated/buildings-v2.png'),
  nature: assetPath('generated/nature-v2.png'),
  terrain: assetPath('generated/terrain-v2.png'),
};
export const DIRECTION_ATLASES = {
  support:assetPath('generated/directions-support-v3.png'),
  vehicles:assetPath('generated/directions-vehicles-v3.png'),
  advanced:assetPath('generated/directions-advanced-v3.png'),
};
export const DIRECTION_ROWS:Record<LegacyMobileKind,{atlas:keyof typeof DIRECTION_ATLASES;row:number}>={
  worker:{atlas:'support',row:0},soldier:{atlas:'support',row:1},medic:{atlas:'support',row:2},
  scout:{atlas:'vehicles',row:0},tank:{atlas:'vehicles',row:1},artillery:{atlas:'vehicles',row:2},
  sniper:{atlas:'advanced',row:0},fighter:{atlas:'advanced',row:1},mech:{atlas:'advanced',row:2},
};
export function spriteMarkup(kind:Kind,race?:Race,packed=false) {
  const portrait=portraitCell(kind,race,packed);
  if(portrait!==undefined){
    const col=portrait%PORTRAIT_COLUMNS,row=Math.floor(portrait/PORTRAIT_COLUMNS);
    return `<span class="atlas-art model-portrait" role="img" aria-label="${STATS[kind].name}" style="background-image:url('${portraitAtlas}');background-size:${PORTRAIT_COLUMNS*100}% ${PORTRAIT_ROWS*100}%;background-position:${col*100/(PORTRAIT_COLUMNS-1)}% ${row*100/(PORTRAIT_ROWS-1)}%"></span>`;
  }
  const profile=factionProfile(kind);
  if(profile)return `<span class="atlas-art faction-icon" role="img" aria-label="${STATS[kind].name}" style="--faction-ink:${factionPalette[profile[0]]}">${factionGlyphs[profile[1]]}</span>`;
  const s=STATS[kind],col=s.cell%3,row=Math.floor(s.cell/3);
  return `<span class="atlas-art ${s.atlas==='buildings'?'art-building':''}" role="img" aria-label="${s.name}" style="background-image:url('${ART[s.atlas]}');background-position:${col*50}% ${row*50}%"></span>`;
}
export function drawCell(c:CanvasRenderingContext2D,img:HTMLImageElement,columns:number,rows:number,cell:number,x:number,y:number,width:number,height=width) {
  const sw=img.naturalWidth/columns,sh=img.naturalHeight/rows;
  // A half-pixel inset prevents neighbouring cells bleeding into scaled sprites.
  c.drawImage(img,(cell%columns)*sw+.5,Math.floor(cell/columns)*sh+.5,sw-1,sh-1,x,y,width,height);
}

export function drawOilWell(c:CanvasRenderingContext2D,x:number,y:number,size:number,angle=0,construction=1){
  c.save();
  c.translate(x,y);
  c.scale(size/88,size/88);
  c.fillStyle='#303b3c';c.fillRect(-32,-13,64,29);
  c.scale(1,Math.max(.12,construction));
  c.fillStyle='#728285';c.fillRect(-6,-38,11,39);
  c.fillStyle='#566263';c.fillRect(13,-14,15,17);
  c.fillStyle='#364649';c.fillRect(-25,-29,4,35);
  c.translate(0,-38);c.rotate(angle);
  c.fillStyle='#a7b3b4';c.fillRect(-28,-3,58,6);
  c.fillStyle='#d4af65';c.fillRect(-32,-2,11,15);
  c.restore();
}
