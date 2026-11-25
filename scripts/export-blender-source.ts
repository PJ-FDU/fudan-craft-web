import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BufferGeometry, Texture } from 'three';
import { BattleModels, natureGeometry } from '../src/game/models-3d.js';
import { ROSTERS } from '../src/game/races.js';
import { RACES, LEGACY_BUILDING_KINDS, LEGACY_MOBILE_KINDS } from '../src/game/types.js';
import { SURFACE, atlasCell, ATLAS_COLUMNS, ATLAS_ROWS } from '../src/game/battle-materials.js';
import { surfaceFinish } from '../src/game/model-surface.js';
import { surfaceWeathering } from '../src/game/model-weathering.js';
import { MODEL_PORTRAITS } from '../src/game/model-portraits.js';

const output=resolve(process.argv[2]??'.cache/blender-source');
mkdirSync(output,{recursive:true});
const models=new BattleModels(new Texture());
const chunks:Buffer[]=[];
let offset=0;
const meshes:Record<string,unknown>[]=[];
function mesh(geometry:BufferGeometry|undefined,pack:string,key:string,part:number,slot:number){
  if(!geometry)return;
  const attributes:Record<string,{offset:number;count:number;size:number}>={};
  for(const [name,attribute] of Object.entries(geometry.attributes)){
    const values=new Float32Array(attribute.count*attribute.itemSize);
    for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)
      values[i*attribute.itemSize+c]=attribute.getComponent(i,c);
    const data=Buffer.from(values.buffer);
    attributes[name]={offset,count:attribute.count,size:attribute.itemSize};
    chunks.push(data);offset+=data.byteLength;
  }
  meshes.push({pack,key,part,slot,attributes,primitives:geometry.userData.primitives??[]});
}
const templates:Record<string,unknown>={};
for(const race of RACES){
  const roster=ROSTERS[race];
  const kinds=[...new Set(['base',...roster.units,...roster.buildings,...(race==='industrial'?[...LEGACY_MOBILE_KINDS,...LEGACY_BUILDING_KINDS]:[])])] as const;
  for(const kind of kinds)for(const packed of kind==='assembly'?[false,true]:[false]){
    const key=`${race}:${kind}${packed?':packed':''}`;
    const source=models.source(kind as Parameters<BattleModels['source']>[0],race,packed);
    templates[key]={bounds:[source.bounds.min.toArray(),source.bounds.max.toArray()],
      rig:source.rig?.joints??[],moving:source.moving.map(m=>m.at)};
    source.body.forEach((g,slot)=>mesh(g,race,key,-1,slot));
    source.moving.forEach((m,part)=>m.parts.forEach((g,slot)=>mesh(g,race,key,part,slot)));
    for(const g of [...source.body,...source.moving.flatMap(m=>m.parts)])g?.dispose();
  }
}
for(const kind of ['pine','oak','birch','bush','stump','rock','rockLarge','ruin','grass','flower','fern']){
  const geometry=natureGeometry([{kind,x:0,y:0,size:100}]);
  mesh(geometry,'nature',`nature:${kind}`,-1,0);geometry?.dispose();
}
// 资源也走相同库，保留采空后的矿床、树桩和油井底座。
for(const kind of ['wood','gold','oil'] as const)for(const empty of [false,true]){
  const visual=models.resource(kind,empty);
  visual.root.traverse(object=>{
    if('geometry' in object)mesh(object.geometry as BufferGeometry,'nature',`resource:${kind}${empty?':empty':''}`,-1,0);
  });
}
const surfaces=Object.keys(SURFACE).map(name=>{
  const surface=name as keyof typeof SURFACE;
  return {name,cell:atlasCell(surface),finish:surfaceFinish(surface),weather:surfaceWeathering(surface)};
});
writeFileSync(resolve(output,'geometry.bin'),Buffer.concat(chunks));
const portraits=MODEL_PORTRAITS.map(({race,kind,packed})=>`${race}:${kind}${packed?':packed':''}`);
writeFileSync(resolve(output,'source.json'),JSON.stringify({version:1,columns:ATLAS_COLUMNS,rows:ATLAS_ROWS,templates,meshes,surfaces,portraits}));
models.dispose();
console.log(JSON.stringify({output,templates:Object.keys(templates).length,meshes:meshes.length,bytes:offset}));
