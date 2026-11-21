import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Texture } from 'three';
import { BattleModels } from '../src/game/models-3d.js';
import { ROSTERS } from '../src/game/races.js';
import { RACES, STATS } from '../src/game/types.js';
import { poseRig } from '../src/game/unit-rig.js';

const models=new BattleModels(new Texture());
after(()=>models.dispose());

test('all faction models carry finite wear coordinates on solid and team meshes without splitting the batches',()=>{
  for(const race of RACES){
    const roster=ROSTERS[race];
    for(const kind of new Set(['base',...roster.units,...roster.buildings] as const)){
      for(const packed of kind==='assembly'?[false,true]:[false]){
        const model=models.unit(kind,1,false,race,packed),label=`${race}:${kind}:${packed}`;
        let meshes=0;
        model.root.traverse(object=>{
          if(!(object instanceof Mesh))return;
          meshes++;
          if(object.material!==models.solid&&object.material!==models.teams[0])return;
          const {position,color,surfaceFinish,surfaceTexture,surfaceWeathering,weatherCoord,weatherSpan}=object.geometry.attributes;
          for(const attribute of [color,surfaceFinish,surfaceTexture,surfaceWeathering,weatherCoord,weatherSpan]){
            assert.equal(attribute?.count,position.count,label);
            assert.ok(attribute.array.every(Number.isFinite),label);
          }
          for(let i=0;i<position.count;i++){
            // 有机组织、织物与橡胶的磨损不能变成金属锈斑。
            if(surfaceFinish.getY(i)<.05)assert.equal(surfaceWeathering.getY(i),0,label);
            assert.ok(weatherSpan.getX(i)>=1&&weatherSpan.getY(i)>=1,label);
          }
        });
        if(STATS[kind].speed>0)assert.ok(meshes<=3,label);
        model.rig?.skeleton.dispose();
      }
    }
  }
});

test('wear stays in the rest pose through animation and elevated pump equipment avoids ground dirt',()=>{
  const tank=models.unit('tank',1),attributes:Float32Array[]=[];
  tank.root.traverse(object=>{
    if(object instanceof Mesh&&object.geometry.hasAttribute('weatherCoord')){
      attributes.push(object.geometry.getAttribute('weatherCoord').array as Float32Array);
    }
  });
  const before=attributes.map(array=>array.slice());
  poseRig(tank.rig!,'tank',{state:'move',weight:1,travel:47,time:3,id:1,aim:.8,recoil:.7,turn:.2,animate:true});
  tank.root.position.set(120,0,90);tank.root.rotation.y=.8;tank.root.updateMatrixWorld(true);
  attributes.forEach((array,i)=>assert.deepEqual(array,before[i]));
  const pump=models.unit('oilwell',1);
  assert.ok(pump.moving.length);
  pump.moving[0].traverse(object=>{
    if(!(object instanceof Mesh)||!object.geometry.hasAttribute('weatherCoord'))return;
    const coordinate=object.geometry.getAttribute('weatherCoord');
    for(let i=0;i<coordinate.count;i++)assert.ok(coordinate.getZ(i)>25);
  });
  const tree=models.resource('wood',false,{kind:'oak',size:100});
  tree.root.traverse(object=>{if(object instanceof Mesh)assert.equal(object.material,models.forest);});
  assert.notEqual(models.forest.customProgramCacheKey(),models.solid.customProgramCacheKey());
  tank.rig?.skeleton.dispose();
});
