import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkinnedMesh, Texture, Vector3 } from 'three';
import { BattleModels } from '../src/game/models-3d.js';
import { legLengths, poseRig, rigStride, type RigPose } from '../src/game/unit-rig.js';
import { MOBILE_KINDS } from '../src/game/types.js';

const basePose:RigPose={state:'idle',weight:0,travel:0,time:2,id:1,aim:0,recoil:0,turn:0,animate:true};

test('every mobile archetype uses shared geometry but owns an independent skinned rig',()=>{
  const models=new BattleModels(new Texture());
  for(const kind of MOBILE_KINDS){
    const a=models.unit(kind,1),b=models.unit(kind,2);
    assert.ok(a.rig&&b.rig);
    assert.notEqual(a.rig.skeleton,b.rig.skeleton);
    const meshes:SkinnedMesh[]=[];
    a.root.traverse(mesh=>{if(mesh instanceof SkinnedMesh)meshes.push(mesh);});
    assert.ok(meshes.length>=2&&meshes.length<=3,kind);
    for(const mesh of meshes){
      assert.equal(mesh.skeleton,a.rig.skeleton);
      const {skinIndex,skinWeight,position}=mesh.geometry.attributes;
      assert.equal(skinIndex.count,position.count);
      for(let i=0;i<skinWeight.count;i++){
        assert.ok(skinIndex.getX(i)<a.rig.skeleton.bones.length);
        assert.ok(skinIndex.getY(i)<a.rig.skeleton.bones.length);
        assert.ok(Math.abs(skinWeight.getX(i)+skinWeight.getY(i)-1)<.0001);
      }
    }
    poseRig(a.rig,kind,{...basePose,weight:1,travel:22,aim:.4,recoil:.2,state:'move'});
    a.root.updateMatrixWorld(true);
    const mesh=meshes[0],rest=new Vector3(),posed=new Vector3();
    assert.ok(Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>i).some(i=>{
      rest.fromBufferAttribute(mesh.geometry.attributes.position,i);
      return mesh.getVertexPosition(i,posed).distanceTo(rest)>.5;
    }),kind);
  }
});

test('the infantry stance keeps a planted ankle low while its other foot lifts',()=>{
  const model=new BattleModels(new Texture()).unit('soldier',1),rig=model.rig!;
  poseRig(rig,'soldier',{...basePose,state:'move',weight:1,travel:rigStride('soldier')*.27});
  model.root.updateMatrixWorld(true);
  const planted=rig.joint('LFoot').getWorldPosition(new Vector3());
  const swing=rig.joint('RFoot').getWorldPosition(new Vector3());
  const scale=model.root.children[0].scale.y;
  assert.ok(Math.abs(planted.y-legLengths(false)[2]*scale)<.45);
  assert.ok(swing.y>planted.y+1.7);
  assert.notEqual(rig.joint('LKnee').rotation.x,rig.joint('RKnee').rotation.x);
});

test('mechanical poses keep the firing slide, wheels and loader claw on separate joints',()=>{
  const models=new BattleModels(new Texture()),tank=models.unit('tank',1).rig!,worker=models.unit('worker',1).rig!;
  poseRig(tank,'tank',{...basePose,state:'attack',aim:1,recoil:0});
  assert.equal(tank.joint('barrel').position.z,3);
  poseRig(tank,'tank',{...basePose,state:'attack',aim:1,recoil:1});
  assert.ok(tank.joint('barrel').position.z<1);
  poseRig(worker,'worker',{...basePose,state:'move',travel:47,weight:1});
  assert.ok(Math.abs(worker.joint('LWheel0').rotation.x)>2);
  poseRig(worker,'worker',{...basePose,state:'gather'});
  assert.ok(worker.joint('boom').rotation.x>0);
  assert.ok(worker.joint('tool').rotation.x<0);
});
