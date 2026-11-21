import {
  BoxGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,SphereGeometry,SRGBColorSpace,
  Texture,TorusGeometry,type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { oilPipeLayout,OIL_PIPE_HEIGHT,OIL_PIPE_RADIUS } from './oil.js';
import type { Point } from './types.js';

type PipeSurface='paint'|'steel'|'seal'|'saddle'|'footing'|'valve';
const height=OIL_PIPE_HEIGHT;

export interface OilPipeTextures {paint:HTMLImageElement;normal:HTMLImageElement;roughness:HTMLImageElement}

export function oilPipeMaterials(images:OilPipeTextures,anisotropy:number):Record<PipeSurface,MeshStandardMaterial>{
  const texture=(image:HTMLImageElement)=>{
    const result=new Texture(image);result.needsUpdate=true;result.anisotropy=Math.min(anisotropy,8);return result;
  };
  const map=texture(images.paint);map.colorSpace=SRGBColorSpace;
  return {
    paint:new MeshStandardMaterial({map,normalMap:texture(images.normal),roughnessMap:texture(images.roughness),metalness:.43,roughness:.87}),
    steel:new MeshStandardMaterial({color:0xaca07c,metalness:.57,roughness:.48}),
    seal:new MeshStandardMaterial({color:0x262d2a,metalness:.1,roughness:.9}),
    saddle:new MeshStandardMaterial({color:0x4d5a50,metalness:.56,roughness:.65}),
    footing:new MeshStandardMaterial({color:0x737266,roughness:.94}),
    valve:new MeshStandardMaterial({color:0xac5c38,metalness:.45,roughness:.53}),
  };
}

export function oilPipeModel(well:Point,refinery:Point,materials:Record<PipeSurface,MeshStandardMaterial>,land?:Uint8Array){
  const {points,sections}=oilPipeLayout(well,refinery,land);
  const root=new Group();root.name='oil-pipeline';root.position.set(well.x,0,well.y);
  if(!sections.length)return root;

  const parts=new Map<PipeSurface,BufferGeometry[]>();
  const add=(surface:PipeSurface,shape:BufferGeometry,x:number,y:number,z=0)=>{
    const group=parts.get(surface)??[];
    group.push(shape.translate(x,y,z));parts.set(surface,group);
  };
  const barrel=(r:number,length:number,sides=18)=>new CylinderGeometry(r,r,length,sides).rotateZ(Math.PI/2);

  for(const {a,b,length,angle} of sections){
    const x=(a.x+b.x)/2-well.x,z=(a.y+b.y)/2-well.y;
    const along=(shape:BufferGeometry)=>shape.rotateY(-angle);
    add('paint',along(barrel(OIL_PIPE_RADIUS,length)),x,height,z);
    if(length>24){
      add('footing',along(new BoxGeometry(11,1.2,10)),x,-.45,z);
      add('saddle',along(barrel(3.1,3.8)),x,height,z);
    }
    add('seal',along(barrel(3.2,3)),a.x-well.x,height,a.y-well.y);
    for(const offset of [-1.8,1.8]){
      add('steel',along(barrel(3.5,1.1)),a.x-well.x+Math.cos(angle)*offset,height,a.y-well.y+Math.sin(angle)*offset);
    }
  }
  // 球形短接构成圆润弯头；主管最高约 2，远低于旧高架管的 17。
  for(const point of points){
    add('paint',new SphereGeometry(2.9,12,8),point.x-well.x,height,point.y-well.y);
  }
  const end=points.at(-1)!;
  if(distanceSquared(well,refinery)>32**2){
    const x=end.x-well.x,z=end.y-well.y;
    add('steel',new CylinderGeometry(.9,.9,3,8),x,2,z);
    add('valve',new TorusGeometry(3,.65,6,12).rotateX(Math.PI/2),x,3.5,z);
    add('valve',new BoxGeometry(5.5,.8,.8),x,3.5,z);
  }

  for(const [surface,geometries] of parts){
    const shape=mergeGeometries(geometries)!;
    const part=new Mesh(shape,materials[surface]);part.receiveShadow=true;root.add(part);
    for(const geometry of geometries)geometry.dispose();
  }
  return root;
}

const distanceSquared=(a:Point,b:Point)=>(a.x-b.x)**2+(a.y-b.y)**2;
