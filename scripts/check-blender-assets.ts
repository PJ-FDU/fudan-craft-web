import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, Mesh, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BlenderAssets, restoreBlenderGeometry, type BlenderManifest } from '../src/game/blender-assets.js';
import { BattleModels } from '../src/game/models-3d.js';
import { poseRig, RigDefinition } from '../src/game/unit-rig.js';
import type { UnitAnimation } from '../src/game/animation.js';
import type { Kind, MobileKind, Race } from '../src/game/types.js';
import { MAPS } from '../src/game/maps.js';
import { getWorld } from '../src/game/world.js';
import { terrainGeometry, waterGeometry } from '../src/game/battle-terrain.js';
import { waterContour } from '../src/game/terrain-shapes.js';

const project=resolve(process.argv[3]??'.');
const directory=resolve(project,'public/assets/blender-sculpt-v2');
const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8')) as BlenderManifest;
const scriptHash=createHash('sha256').update(readFileSync(resolve('scripts/build-sculpt-assets.py'))).digest('hex');
assert.equal(manifest.scriptHash,scriptHash,'资产生成脚本已变化，请重新烘焙');
const sharedAtlases=Object.entries(manifest.generators??{}).filter(([,generator])=>
  generator.script==='scripts/build-sculpt-assets.py').map(([name])=>name).sort();
assert.deepEqual([...(manifest.bakedWeather??[])].sort(),sharedAtlases,'共享图集尚未完成固定旧化烘焙');
const textureChecks=manifest.textures.map(file=>{
  const path=resolve(directory,file),header=Buffer.alloc(24);
  const fd=openSync(path,'r');
  try{
    assert.equal(readSync(fd,header,0,header.length,0),header.length,file);
    assert.equal(header.subarray(0,8).toString('hex'),'89504e470d0a1a0a',file);
    assert.equal(header.toString('ascii',12,16),'IHDR',file);
  }finally{closeSync(fd);}
  const width=header.readUInt32BE(16),height=header.readUInt32BE(20);
  assert.ok(width>0&&height>0&&width<=4096&&height<=4096,file);
  return {file,width,height,bytes:statSync(path).size,rgbaMipBytes:Math.ceil(width*height*4*4/3)};
});
const texturesByFile=new Map(textureChecks.map(texture=>[texture.file,texture]));
assert.equal(texturesByFile.size,textureChecks.length,'贴图文件重复登记');

function matchingTextureSizes(channels:NonNullable<BlenderManifest['legacyTextures']>):[number,number]{
  const albedo=texturesByFile.get(channels.albedo);
  assert.ok(albedo,`清单缺少反照率贴图：${channels.albedo}`);
  for(const file of [channels.normal,channels.orm]){
    const texture=texturesByFile.get(file);
    assert.ok(texture,`清单缺少 PBR 通道：${file}`);
    assert.deepEqual([texture.width,texture.height],[albedo.width,albedo.height],`PBR 通道尺寸不一致：${file}`);
  }
  return [albedo.width,albedo.height];
}

assert.ok(manifest.legacyTextures,'清单缺少环境 PBR 通道');
matchingTextureSizes(manifest.legacyTextures);
interface BakeRecord {
  key:string;tile:[number,number];tileSize:number;lowFaces:number;highFaces:number;scriptHash:string;
  textureSources?:Record<string,{file:string;sha256:string}>;
  fixedWeather?:string;
  projection:{
    cageExtrusion:number;maxRayDistance:number;uvPixels:number;missedNormalPixels:number;
    backfacingNormalPixels:number;missedMaterialPixels:number;missedProjectionPixels:number;
    lowSurfaceFallbackPixels:number;neutralNormalPixels:number;
  };
}
const bakeRecords=new Map<string,BakeRecord>();
const textureSizes=new Map<string,[number,number]>();
const generatorHashes:Record<string,string>={};
for(const [race,surface] of Object.entries(manifest.surfaces??{})){
  const generator=manifest.generators?.[race];
  const expectedHash=generator?createHash('sha256').update(readFileSync(resolve(generator.script))).digest('hex'):scriptHash;
  if(generator)assert.equal(generator.scriptHash,expectedHash,`资产生成脚本已变化：${race}`);
  generatorHashes[race]=expectedHash;
  const bakePath=generator?.bake??`artifacts/blender-sculpt/${race}-bake.json`;
  const records=JSON.parse(readFileSync(resolve(project,bakePath),'utf8')) as BakeRecord[];
  const [width,height]=matchingTextureSizes(surface);
  textureSizes.set(race,[width,height]);
  const used=new Set<string>();
  for(const record of records){
    assert.equal(record.scriptHash,expectedHash,`模型烘焙版本过期：${record.key}`);
    assert.equal(Boolean(record.fixedWeather),Boolean(manifest.bakedWeather?.includes(race)),`做旧烘焙标记不一致：${record.key}`);
    if(record.fixedWeather)assert.ok(Object.values(record.textureSources??{}).some(source=>source.sha256===record.fixedWeather),record.key);
    for(const source of Object.values(record.textureSources??{})){
      const actualHash=createHash('sha256').update(readFileSync(resolve(source.file))).digest('hex');
      assert.equal(source.sha256,actualHash,`纹理源图已变化，请重新烘焙：${source.file}`);
    }
    assert.ok(!bakeRecords.has(record.key),`重复烘焙模型：${record.key}`);
    assert.equal(manifest.templates[record.key]?.surface,race,record.key);
    assert.ok(record.lowFaces>0&&record.highFaces>record.lowFaces,`高低模面数错误：${record.key}`);
    assert.ok(Number.isInteger(record.tileSize)&&record.tileSize>0&&
      width%record.tileSize===0&&height%record.tileSize===0,`纹理分辨率错误：${record.key}`);
    assert.ok(record.tile.every(Number.isInteger)&&record.tile[0]>=0&&record.tile[1]>=0&&
      (record.tile[0]+1)*record.tileSize<=width&&(record.tile[1]+1)*record.tileSize<=height,record.key);
    assert.ok(!used.has(record.tile.join(':')),`模型共用 UV 图块：${record.key}`);
    const projection=record.projection;
    assert.ok(projection&&Number.isFinite(projection.cageExtrusion)&&projection.cageExtrusion>0&&
      Number.isFinite(projection.maxRayDistance)&&projection.maxRayDistance>projection.cageExtrusion,record.key);
    for(const field of ['uvPixels','missedNormalPixels','backfacingNormalPixels','missedMaterialPixels',
      'missedProjectionPixels','lowSurfaceFallbackPixels','neutralNormalPixels'] as const){
      assert.ok(Number.isInteger(projection[field])&&projection[field]>=0&&
        projection[field]<=record.tileSize**2,`${record.key}: ${field}`);
    }
    assert.ok(projection.uvPixels>0&&projection.missedProjectionPixels/projection.uvPixels<=.05,
      `高模投射覆盖不足 95%：${record.key}`);
    assert.ok(projection.backfacingNormalPixels<=projection.missedNormalPixels&&
      projection.missedNormalPixels<=projection.missedProjectionPixels&&
      projection.missedMaterialPixels<=projection.missedProjectionPixels&&
      projection.neutralNormalPixels<=projection.lowSurfaceFallbackPixels,record.key);
    assert.equal(projection.lowSurfaceFallbackPixels,projection.missedProjectionPixels,record.key);
    used.add(record.tile.join(':'));bakeRecords.set(record.key,record);
  }
}
assert.equal(bakeRecords.size,Object.keys(manifest.templates).length,'模型烘焙记录不完整');
const dummySurface=()=>({albedo:new Texture(),normal:new Texture(),orm:new Texture()});
const assets=new BlenderAssets(manifest,dummySurface(),
  new Map(Object.keys(manifest.surfaces??{}).map(name=>[name,dummySurface()])));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let meshes=0,vertices=0,triangles=0,rigPosesChecked=0,rigContractsChecked=0,uvVerticesChecked=0;
let environmentMeshes=0;
for(const file of manifest.packs){
  const bytes=readFileSync(resolve(directory,file));
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  gltf.scene.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const {key,part,slot}=object.userData;
    const geometry=restoreBlenderGeometry(object.geometry,key,manifest.templates[key]?.rig.length??0);
    const record=bakeRecords.get(key);
    if(record){
      const [width,height]=textureSizes.get(manifest.templates[key].surface!)!;
      const columns=width/record.tileSize,rows=height/record.tileSize;
      const uv=geometry.getAttribute('uv'),[x,y]=record.tile;
      // 从导出的 GLB 验证实际 UV，不能只相信烘焙脚本声明了独立图块。
      for(let i=0;i<uv.count;i++){
        assert.ok(uv.getX(i)>=x/columns-.0001&&uv.getX(i)<=(x+1)/columns+.0001&&
          uv.getY(i)>=y/rows-.0001&&uv.getY(i)<=(y+1)/rows+.0001,`UV 超出专属图块：${key}/${i}`);
        uvVerticesChecked++;
      }
    }else if(key.startsWith('nature:')||key.startsWith('resource:')){
      const uv=geometry.getAttribute('uv');
      for(let i=0;i<uv.count;i++)assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1,key);
      environmentMeshes++;
    }
    assets.add(key,part,slot,geometry);
    meshes++;vertices+=geometry.getAttribute('position').count;
    triangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;
  });
}
assets.validate();
assert.equal(environmentMeshes,17,'环境与资源网格覆盖不足');
const models=new BattleModels(new Texture(),undefined,assets);
for(const [key,template] of Object.entries(manifest.templates)){
  const [race,kind,mode]=key.split(':') as [Race,Kind,string|undefined];
  const visual=models.unit(kind,2,false,race,mode==='packed');
  assert.equal(visual.rig?.skeleton.bones.length??0,template.rig.length,key);
  for(const state of ['idle','move','attack','gather','build','death'] as UnitAnimation[])for(const time of [0,.25,.8]){
    if(visual.rig){
      poseRig(visual.rig,kind as MobileKind,{state,time,id:1,weight:state==='move'?1:0,travel:time*30,
        aim:state==='attack'?.85:0,recoil:state==='attack'?.4:0,cast:state==='build'?.7:0,
        fall:state==='death'?time:0,active:true,turn:.3,animate:true});
      rigPosesChecked++;
    }
    visual.root.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(visual.root);
    assert.ok([...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite),key);
    assert.ok(bounds.max.y>bounds.min.y,key);
  }
  if(template.rig.length){
    const invalidRig=new RigDefinition();
    invalidRig.joints.push(...template.rig.map((joint,i)=>({...joint,name:i===0?'invalid-joint':joint.name})));
    assert.throws(()=>assets.model(key,invalidRig),/骨骼不匹配/,key);
    rigContractsChecked++;
  }
  visual.rig?.skeleton.dispose();
}
for(const kind of ['wood','gold','oil'] as const)for(const empty of [false,true]){
  const visual=models.resource(kind,empty);
  assert.ok(visual.height>0,`${kind}:${empty}`);
}
models.dispose();
const terrainChecks=[];
for(const map of MAPS){
  const world=getWorld(map.id),ground=terrainGeometry(world,320),position=ground.getAttribute('position');
  let minHeight=Infinity,maxHeight=-Infinity,waterTriangles=0;
  for(let i=0;i<position.count;i++){
    assert.ok([position.getX(i),position.getY(i),position.getZ(i)].every(Number.isFinite),map.id);
    minHeight=Math.min(minHeight,position.getY(i));maxHeight=Math.max(maxHeight,position.getY(i));
  }
  for(const feature of world.features.filter(f=>f.kind==='water')){
    const contour=waterContour(feature),water=waterGeometry(feature),vertices=water.getAttribute('position');
    let expected=0,actual=0;
    for(let i=0;i<contour.length;i++){
      const a=contour[i],b=contour[(i+1)%contour.length];expected+=a.x*b.y-b.x*a.y;
    }
    for(let i=0;i<vertices.count;i+=3){
      const ax=vertices.getX(i),az=vertices.getZ(i),bx=vertices.getX(i+1),bz=vertices.getZ(i+1);
      const cx=vertices.getX(i+2),cz=vertices.getZ(i+2);
      const area=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
      assert.ok(area<=.01,`${map.id}: water triangle faces downward`);
      actual+=Math.abs(area)/2;
      for(let j=i;j<i+3;j++){
        assert.equal(vertices.getY(j),Math.fround(1.35));
        assert.ok(Number.isFinite(water.getAttribute('waterDepth').getX(j)));
      }
    }
    assert.ok(Math.abs(actual-Math.abs(expected)/2)/Math.abs(expected)<.00001,`${map.id}: shoreline area mismatch`);
    waterTriangles+=vertices.count/3;water.dispose();
  }
  terrainChecks.push({map:map.id,revision:world.revision,vertices:position.count,minHeight,maxHeight,waterTriangles});
  ground.dispose();
}
const report={
  generator:manifest.generator,scriptHash,generatorHashes,templates:Object.keys(manifest.templates).length,meshes,vertices,triangles,
  files:Object.fromEntries([...manifest.packs,...manifest.textures].map(file=>[file,statSync(resolve(directory,file)).size])),
  rigPosesChecked,rigContractsChecked,uvVerticesChecked,environmentMeshes,uniqueModelTiles:bakeRecords.size,terrainChecks,
  sculptFaces:{
    low:[...bakeRecords.values()].reduce((sum,r)=>sum+r.lowFaces,0),
    high:[...bakeRecords.values()].reduce((sum,r)=>sum+r.highFaces,0),
  },
  projectionPixels:{
    covered:[...bakeRecords.values()].reduce((sum,r)=>sum+r.projection.uvPixels,0),
    lowSurfaceFallback:[...bakeRecords.values()].reduce((sum,r)=>sum+r.projection.lowSurfaceFallbackPixels,0),
    neutralNormals:[...bakeRecords.values()].reduce((sum,r)=>sum+r.projection.neutralNormalPixels,0),
    worstModel:[...bakeRecords.values()].map(r=>({
      key:r.key,fallbackFraction:r.projection.lowSurfaceFallbackPixels/r.projection.uvPixels,
    })).sort((a,b)=>b.fallbackFraction-a.fallbackFraction)[0],
  },
  textureChecks,
};
if(process.argv[2])writeFileSync(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
