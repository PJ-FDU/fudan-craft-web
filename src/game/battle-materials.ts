import { CanvasTexture, SRGBColorSpace, Texture } from 'three';

// Cells follow the artist's grid in image order, from top left to bottom right.
export const SURFACE = {
  armor:0, wall:1, tread:2, glass:3,
  concrete:4, roof:5, stone:6, insignia:7,
  pine:8, leaf:9, bark:10, ore:11,
  grass:12, earth:13, water:14, cloth:15,
  helmet:16, chest:17, guard:18, undersuit:19,
  deck:20, track:21, grille:22, wing:23,
  mechPlate:24, piston:25, medicPanel:26, scoutCloth:27,
  optic:28, weapon:29, hazard:30, exhaust:31,
  chitin:32, membrane:33, nutrient:34, horn:35,
  ceramic:36, stellarConductor:37, astralAlloy:38, conductor:39,
  expeditionPlate:40, expeditionFrame:41, expeditionCanvas:42, fieldRubber:43,
  federalPlate:44, circuitry:45, medicalComposite:46, serviceSteel:47,
  chitinLamella:48, photonicGlass:49, expeditionLaminate:50, armorCeramic:51,
  titanArmor:52, titanSteel:53, titanSeal:54, titanTrim:55,
} as const;
export type Surface = keyof typeof SURFACE;
export const FACTION_ATLAS_FILE='generated/faction-materials-v4.webp';
export const FACTION_DETAIL_FILE='generated/faction-detail-v4.webp';
// Two 4-column legacy sheets and one 6-column faction sheet share the atlas.
const factionColumns=6,legacyColumns=8;
export const ATLAS_COLUMNS=legacyColumns+factionColumns,ATLAS_ROWS=4;
const inset=.012;
export function atlasCell(surface:Surface) {
  const index=SURFACE[surface];
  if(index>=SURFACE.chitinLamella){
    const accent=index-SURFACE.chitinLamella;
    return {x:legacyColumns+4+Math.floor(accent/ATLAS_ROWS),y:ATLAS_ROWS-1-accent%ATLAS_ROWS};
  }
  return {x:index%4+Math.floor(index/16)*4,y:3-Math.floor(index%16/4)};
}
export function atlasUV(surface:Surface,u:number,v:number){
  const cell=atlasCell(surface),span=1-inset*2;
  // 球面/多面体接缝会生成略超出 0–1 的 UV，必须限制在本材质格内。
  const boundedU=Math.max(0,Math.min(1,u)),boundedV=Math.max(0,Math.min(1,v));
  return [(cell.x+inset+boundedU*span)/ATLAS_COLUMNS,(cell.y+inset+boundedV*span)/ATLAS_ROWS] as const;
}
export function atlasCellGLSL(surface:Surface){
  const {x,y}=atlasCell(surface);
  return `vec2(${x}.0,${y}.0)`;
}

export function battleAtlas(terrain:HTMLImageElement,units:HTMLImageElement,factions:HTMLImageElement,anisotropy:number){
  const canvas=document.createElement('canvas');
  canvas.width=ATLAS_COLUMNS*256;canvas.height=ATLAS_ROWS*256;
  const ctx=canvas.getContext('2d')!;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(terrain,0,0,1024,1024);
  ctx.drawImage(units,1024,0,1024,1024);
  ctx.drawImage(factions,legacyColumns*256,0,factionColumns*256,1024);
  const atlas=new CanvasTexture(canvas);
  atlas.colorSpace=SRGBColorSpace;
  atlas.anisotropy=Math.min(8,anisotropy);
  atlas.needsUpdate=true;
  return atlas;
}

export function factionDetailTexture(image:HTMLImageElement,anisotropy:number){
  const texture=new Texture(image);
  texture.anisotropy=Math.min(8,anisotropy);
  texture.needsUpdate=true;
  return texture;
}

export const atlasSamplingGLSL=`
  uniform sampler2D paintedAtlas;
  vec3 paintedCell(vec2 cell,vec2 uv){
    return texture2D(paintedAtlas,(cell+${inset.toFixed(3)}+uv*${(1-inset*2).toFixed(3)})/vec2(${ATLAS_COLUMNS}.0,${ATLAS_ROWS}.0)).rgb;
  }
  vec2 mirrorPaint(vec2 uv){ return 1.0-abs(fract(uv*.5)*2.0-1.0); }
  vec3 paintGround(vec2 cell,vec2 uv){
    vec3 first=paintedCell(cell,mirrorPaint(uv));
    vec2 brush=vec2(uv.x*.61+uv.y*.48,-uv.x*.48+uv.y*.61)+vec2(.43,.71);
    return mix(first,paintedCell(cell,mirrorPaint(brush)),.36);
  }
`;
