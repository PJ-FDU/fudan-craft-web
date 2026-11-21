import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry,
  LatheGeometry, Matrix4, Quaternion, Euler, SphereGeometry, TorusGeometry, Vector2, Vector3, Uint16BufferAttribute,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { atlasUV, type Surface } from './battle-materials.js';
import { surfaceFinish } from './model-surface.js';
import { surfaceWeathering, type Weathering } from './model-weathering.js';

const box = new BoxGeometry();
const drum = new CylinderGeometry(.5, .5, 1, 20);
const pin = new CylinderGeometry(.5, .5, 1, 8);
const cone = new CylinderGeometry(.1, .5, 1, 7);
const nose = new CylinderGeometry(0,.5,1,20);
const facet = new IcosahedronGeometry(.5, 0);
const crown = new IcosahedronGeometry(.5, 1);
const dome = new SphereGeometry(.5,20,12);

function facetedGeometry(positions:number[],uvs:number[]){
  const result=new BufferGeometry();
  result.setAttribute('position',new Float32BufferAttribute(positions,3));
  result.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  result.computeVertexNormals();
  return result;
}

type Contour=readonly (readonly [x:number,z:number])[];
type Section=readonly [y:number,width:number,depth:number,offset:number];

// The shoulder, waist and edge bevel are modeled as separate cross-sections.
// Contours wind from front to right. The top and bottom keep planar UVs.
function armoredVolume(outline:Contour,sections:readonly Section[]){
  const positions:number[]=[],uvs:number[]=[];
  const sides=outline.length;
  const rim=sections.map(([y,w,d,offset])=>outline.map(([x,z])=>[x*w,y,z*d+offset] as const));
  const vertex=(level:number,side:number,cap=false)=>{
    const point=rim[level][side%sides];
    positions.push(...point);
    uvs.push(cap?.5+point[0]:side/sides,cap?.5+point[2]:point[1]+.5);
  };
  const top=sections.length-1;
  for(let side=0;side<sides;side++){
    for(let level=0;level<top;level++){
      vertex(level,side);vertex(level,side+1);vertex(level+1,side+1);
      vertex(level,side);vertex(level+1,side+1);vertex(level+1,side);
    }
    positions.push(0,sections[top][0],sections[top][3]);uvs.push(.5,.5+sections[top][3]);
    vertex(top,side,true);vertex(top,side+1,true);
    positions.push(0,sections[0][0],sections[0][3]);uvs.push(.5,.5+sections[0][3]);
    vertex(0,side+1,true);vertex(0,side,true);
  }
  return facetedGeometry(positions,uvs);
}

const armorHull=armoredVolume(
  [[-.32,.5],[.32,.5],[.49,.27],[.5,-.32],[.28,-.5],[-.28,-.5],[-.5,-.32],[-.49,.27]],
  [[-.5,.80,.82,0],[-.31,1,1,0],[.14,1,.95,-.015],[.5,.67,.79,-.08]],
);
const armorPlate=armoredVolume(
  [[-.31,.5],[.31,.5],[.49,.19],[.44,-.35],[.21,-.5],[-.21,-.5],[-.44,-.35],[-.49,.19]],
  [[-.5,.91,.92,0],[-.32,1,1,0],[.18,.98,.98,0],[.5,.78,.79,-.025]],
);
const canopy=armoredVolume(
  [[-.35,.5],[.35,.5],[.5,.26],[.42,-.35],[.25,-.5],[-.25,-.5],[-.42,-.35],[-.5,.26]],
  [[-.5,1,1,0],[-.18,.98,.94,-.025],[.35,.69,.65,-.16],[.5,.55,.53,-.19]],
);
// The belt and offset tip give crystal weapons and spires long, readable facets.
function crystalShard(){
  const positions:number[]=[],uvs:number[]=[];
  const sides=6;
  const rings=[[-.46,.24],[-.22,.48],[.25,.36]];
  const vertex=(ring:number,side:number)=>{
    const angle=side*2*Math.PI/sides;
    const [y,radius]=rings[ring];
    const offset=ring===2?.07*Math.cos(angle*2):0;
    positions.push(Math.sin(angle)*radius,y+offset,Math.cos(angle)*radius);
    uvs.push(side/sides,y+.46);
  };
  for(let i=0;i<sides;i++){
    const next=i+1;
    positions.push(0,-.5,0);uvs.push((i+.5)/sides,0);
    vertex(0,next);vertex(0,i);
    for(let ring=0;ring<rings.length-1;ring++){
      vertex(ring,i);vertex(ring,next);vertex(ring+1,next);
      vertex(ring,i);vertex(ring+1,next);vertex(ring+1,i);
    }
    vertex(2,i);vertex(2,next);
    positions.push(.09,.5,-.085);uvs.push((i+.5)/sides,1);
  }
  return facetedGeometry(positions,uvs);
}
const shard=crystalShard();
// 连续曲面替代生物的多面球；腹面收平、尾端收窄，保留甲壳的承重方向。
const carapace=new SphereGeometry(.5,16,10);
const scalePlate=new SphereGeometry(.5,10,6);
for(const shape of [carapace,scalePlate]){
  const vertices=shape.attributes.position;
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
    vertices.setXYZ(i,x*(.86+.24*(z+.5)),y<0?y*.48:y,z);
  }
  shape.computeVertexNormals();
}
const jointBall=new SphereGeometry(.5,10,6);
// The ridged scute has a raised dorsal keel and a swept, tucked underside.
const scute=new SphereGeometry(.5,20,12);
const scuteVertices=scute.attributes.position;
for(let i=0;i<scuteVertices.count;i++){
  const x=scuteVertices.getX(i),y=scuteVertices.getY(i),z=scuteVertices.getZ(i);
  const taper=.85+.28*(z+.5);
  const keel=Math.exp(-x*x*58)*Math.sqrt(Math.max(0,1-4*z*z));
  scuteVertices.setXYZ(i,x*taper,y>=0?y*.86+keel*y*.22:y*.30,z+.07*y);
}
scute.computeVertexNormals();
const horn=new CylinderGeometry(.012,.22,1,12,6);
const hornVertices=horn.attributes.position;
for(let i=0;i<hornVertices.count;i++){
  const t=hornVertices.getY(i)+.5;
  hornVertices.setZ(i,hornVertices.getZ(i)+t*t*.42);
}
horn.computeVertexNormals();
const limb=new CylinderGeometry(.23,.45,1,10,1);
const membrane=new BoxGeometry(1,1,1,12,1,6);
const membraneVertices=membrane.attributes.position;
for(let i=0;i<membraneVertices.count;i++){
  const x=membraneVertices.getX(i),z=membraneVertices.getZ(i),t=x+.5;
  const chord=1-t*.74;
  membraneVertices.setXYZ(i,x,membraneVertices.getY(i)*(.65-.4*t)+Math.sin(t*Math.PI)*.05,
    z*chord-t*.35+(z<0?Math.abs(Math.sin(t*Math.PI*3))*.16:0));
}
membrane.computeVertexNormals();
const sleeve = new CylinderGeometry(.5,.5,1,12,2);
const spruce = new CylinderGeometry(.045,.5,1,9);
const gable = new CylinderGeometry(Math.sqrt(1/3),Math.sqrt(1/3),1,3)
  .rotateX(-Math.PI/2).translate(0,-Math.sqrt(1/48),0).scale(1,2/Math.sqrt(3),1);
const needles=spruce.attributes.position;
for(let i=0;i<needles.count;i++){
  const x=needles.getX(i),z=needles.getZ(i),angle=Math.atan2(z,x);
  const rim=1+.17*Math.cos(angle*4);
  needles.setXYZ(i,x*rim,needles.getY(i)+Math.hypot(x,z)*.16*Math.sin(angle*3),z*rim);
}
spruce.computeVertexNormals();
// 真实圆角保留连续法线；收窄上沿时同步变换法线，避免装甲高光断裂。
const panel = new RoundedBoxGeometry(1,1,1,1,.07);
const bevel = new RoundedBoxGeometry(1,1,1,1,.10);
const positions=bevel.attributes.position,normals=bevel.attributes.normal;
const normal=new Vector3();
for(let i=0;i<positions.count;i++){
  const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),taper=1-.2*(y+.5);
  normal.set(normals.getX(i)/taper,normals.getY(i)+.2*(x*normals.getX(i)+z*normals.getZ(i))/taper,normals.getZ(i)/taper).normalize();
  positions.setXYZ(i,x*taper,y,z*taper);
  normals.setXYZ(i,normal.x,normal.y,normal.z);
}
const ring = new TorusGeometry(.43,.07,6,24);
const arch = new TorusGeometry(.43,.07,8,32,Math.PI*.83).rotateZ(Math.PI*.585);
const archConduit = new TorusGeometry(.43,.021,6,32,Math.PI*.83).rotateZ(Math.PI*.585);
const tire=new LatheGeometry([
  [.27,-.46],[.37,-.49],[.45,-.40],[.49,-.23],[.50,0],
  [.49,.23],[.45,.40],[.37,.49],[.27,.46],[.27,-.46],
].map(([radius,y])=>new Vector2(radius,y)),20);
const elbow = new TorusGeometry(.38,.12,8,16,Math.PI/2);
const duct = new CylinderGeometry(.5,.5,1,24,1,true);
// Closed loft with a rounded leading edge, tapered tip and a sharp trailing edge.
function sweptWing(){
  const positions:number[]=[],uvs:number[]=[];
  const sections=[[-.5,-.48,.50,.82],[-.23,-.5,.48,1],[.07,-.49,.34,.76],[.35,-.54,.055,.39],[.5,-.49,-.22,.11]];
  const chordProfile=[[1,0],[.84,-.35],[.46,-.5],[.07,-.2],[0,0],[.10,.14],[.48,.49],[.82,.36]];
  const sides=chordProfile.length;
  const vertex=(station:number,side:number,cap=false)=>{
    const [x,back,front,thickness]=sections[station];
    const [chord,y]=chordProfile[side%sides];
    positions.push(x,y*thickness,back+(front-back)*chord);
    uvs.push(cap?chord:x+.5,cap?y+.5:chord);
  };
  for(let side=0;side<sides;side++){
    for(let station=0;station<sections.length-1;station++){
      vertex(station,side);vertex(station+1,side+1);vertex(station+1,side);
      vertex(station,side);vertex(station,side+1);vertex(station+1,side+1);
    }
    const last=sections.length-1;
    positions.push(-.5,0,0);uvs.push(.5,.5);vertex(0,side+1,true);vertex(0,side,true);
    positions.push(.5,0,-.35);uvs.push(.5,.5);vertex(last,side,true);vertex(last,side+1,true);
  }
  return facetedGeometry(positions,uvs);
}
const airfoil=sweptWing();
const octagon = new CylinderGeometry(.47,.5,1,8).rotateY(Math.PI/8);
const geometry = { box, panel, drum, pin, ring, arch, archConduit, tire, elbow, duct, airfoil, cone, nose, facet, shard, bevel, armorHull, armorPlate, canopy, crown, spruce, gable, octagon, dome, sleeve, carapace, scute, scalePlate, jointBall, horn, limb, membrane };
export type Shape = keyof typeof geometry;
export type Size = readonly [number, number, number];
interface Paint {surface:Surface;tint:number;gain:number;finish?:readonly [number,number,number];texture:number;weathering?:Weathering}
export type Finish = number | Paint | 'team' | 'lamp';
export const paint=(surface:Surface,tint=0xffffff,gain=1,finish?:Paint['finish'],texture=1,weathering?:Weathering):Paint=>({surface,tint,gain,finish,texture,weathering});
export const armor=paint('armor',0xf7efe1,1.22), lightArmor=paint('insignia',0xfff8e7,1.4);
export const dark=paint('wall',0x9ca9a1), steel=paint('roof',0xc4d9cf,1.15);
export const glass=paint('glass',0xcbe9e6,1.24), orange=paint('insignia',0xffa855,1.2);
export const baseSlab=paint('concrete',0xaeb7a9), tread=paint('tread'), mineral=paint('ore',0xffe296,1.62);
export const stone=paint('stone',0xd8dfd2), bark=paint('bark',0xc8b89b);

interface Part {
  shape: Shape;
  finish: Finish;
  position: Size;
  size: Size;
  rotation: Size;
  skin?:{joint:number;parent?:number};
}
export class Parts {
  private values: Part[] = [];
  add(shape: Shape, finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number, rx=0, ry=0, rz=0) {
    this.values.push({shape,finish,position:[x,y,z],size:[w,h,d],rotation:[rx,ry,rz]});
  }
  box(finish: Finish, x: number, y: number, z: number, w: number, h: number, d: number) {
    this.add('box',finish,x,y,z,w,h,d);
  }
  bind(other:Parts,origin:Size,joint:number,parent?:number){
    for(const part of other.values){
      const [x,y,z]=part.position;
      this.values.push({...part,position:[x+origin[0],y+origin[1],z+origin[2]],skin:{joint,parent}});
    }
  }
  geometry(finish: 'solid' | 'team' | 'lamp',groundOffset=0) {
    const use = this.values.filter(p => finish==='solid' ? typeof p.finish!=='string' : p.finish===finish);
    if (!use.length) return;
    const transform=new Matrix4(),quaternion=new Quaternion(),position=new Vector3(),scale=new Vector3(),color=new Color();
    const pieces=use.map((p,index)=>{
      quaternion.setFromEuler(new Euler(...p.rotation));
      transform.compose(position.set(...p.position),quaternion,scale.set(...p.size));
      const source=geometry[p.shape];
      const piece=source.index?source.toNonIndexed():source.clone();
      if(p.finish!=='lamp'){
        const surface=p.finish==='team'?'insignia':typeof p.finish==='number'?'insignia':p.finish.surface;
        const uv=piece.attributes.uv;
        const vertices=piece.attributes.position,normals=piece.attributes.normal;
        const coords=new Float32Array(vertices.count*4),spans=new Float32Array(vertices.count*2);
        const weather=new Float32Array(vertices.count*4),profile=typeof p.finish==='object'?
          p.finish.weathering??surfaceWeathering(surface):surfaceWeathering(surface);
        const seed=(index+1)*.61803398875%1,transformValues=transform.elements;
        for(let i=0;i<uv.count;i++){
          coords.set([Math.max(0,Math.min(1,uv.getX(i))),Math.max(0,Math.min(1,uv.getY(i))),
            transformValues[1]*vertices.getX(i)+transformValues[5]*vertices.getY(i)+
              transformValues[9]*vertices.getZ(i)+transformValues[13]+groundOffset,seed],i*4);
          const top=Math.abs(normals.getY(i))>.7,side=Math.abs(normals.getX(i))>Math.abs(normals.getZ(i));
          spans.set([Math.max(1,top?p.size[0]:side?p.size[2]:p.size[0]),Math.max(1,top?p.size[2]:p.size[1])],i*2);
          weather.set(profile,i*4);
          const [u,v]=atlasUV(surface,uv.getX(i),uv.getY(i));
          uv.setXY(i,u,v);
        }
        // 同时保留阵营色板的磨损；静止 UV 与高度独立于当前骨骼/世界位置。
        piece.setAttribute('surfaceWeathering',new Float32BufferAttribute(weather,4));
        piece.setAttribute('weatherCoord',new Float32BufferAttribute(coords,4));
        piece.setAttribute('weatherSpan',new Float32BufferAttribute(spans,2));
      }
      if(p.finish!=='lamp'){
        if(p.finish==='team')color.setHex(0xffffff);
        else if(typeof p.finish==='number')color.setHex(p.finish);
        else color.setHex(p.finish.tint).multiplyScalar(p.finish.gain);
        const colors=new Float32Array(piece.attributes.position.count*3);
        const finish=p.finish==='team'||typeof p.finish==='number'?surfaceFinish('insignia'):p.finish.finish??surfaceFinish(p.finish.surface);
        const surfaces=new Float32Array(piece.attributes.position.count*3);
        const pos=piece.attributes.position;
        for(let i=0;i<pos.count;i++){
          // Broad shading on each component retains form under the baked surface detail.
          const shade=.84+Math.max(0,Math.min(1,pos.getY(i)+.5))*.16;
          colors[i*3]=color.r*shade;
          colors[i*3+1]=color.g*shade;
          colors[i*3+2]=color.b*shade;
          surfaces.set(finish,i*3);
        }
        piece.setAttribute('color',new Float32BufferAttribute(colors,3));
        // 材质参数随顶点合批：不同表面无需拆成更多 Mesh / draw call。
        piece.setAttribute('surfaceFinish',new Float32BufferAttribute(surfaces,3));
        piece.setAttribute('surfaceTexture',new Float32BufferAttribute(
          new Float32Array(pos.count).fill(p.finish==='team'||typeof p.finish==='number'?1:p.finish.texture),1));
      }
      if(p.skin){
        const {joint,parent}=p.skin,vertices=piece.attributes.position;
        const ids=new Uint16Array(vertices.count*4),weights=new Float32Array(vertices.count*4);
        for(let i=0;i<vertices.count;i++){
          const offset=i*4;
          const blend=parent===undefined?0:Math.max(0,Math.min(1,.5+vertices.getY(i)*.94));
          ids[offset]=joint;ids[offset+1]=parent??joint;
          weights[offset]=1-blend;weights[offset+1]=blend;
        }
        piece.setAttribute('skinIndex',new Uint16BufferAttribute(ids,4));
        piece.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
      }
      return piece.applyMatrix4(transform);
    });
    const result=mergeGeometries(pieces)!;
    for(const piece of pieces)piece.dispose();
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }
}
