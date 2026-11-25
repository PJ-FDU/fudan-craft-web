import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, RGBAFormat, Vector3 } from 'three';

/** CPU 生成线性 HDR 天空；WebGL 和 WebGPU 共用同一光源，不跨后端复用 PMREM。 */
export function cinematicEnvironment(){
  const width=512,height=256,data=new Float32Array(width*height*4);
  const key=new Vector3(-.62,.76,.22).normalize(),rim=new Vector3(.65,.48,-.58).normalize();
  const direction=new Vector3();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const latitude=((y+.5)/height-.5)*Math.PI,longitude=((x+.5)/width-.5)*Math.PI*2;
    direction.set(Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude));
    const sky=Math.pow(Math.max(direction.y,0),.6),above=Math.min(1,Math.max(0,(direction.y+.16)/.24));
    const warm=Math.pow(Math.max(0,direction.dot(key)),180)*18;
    const cold=Math.pow(Math.max(0,direction.dot(rim)),90)*9;
    const index=(y*width+x)*4;
    data[index]=(.09*(1-above)+(.48-.32*sky)*above)+warm+cold*.38;
    data[index+1]=(.10*(1-above)+(.58-.31*sky)*above)+warm*.74+cold*.67;
    data[index+2]=(.08*(1-above)+(.72-.29*sky)*above)+warm*.48+cold;
    data[index+3]=1;
  }
  const texture=new DataTexture(data,width,height,RGBAFormat,FloatType);
  texture.mapping=EquirectangularReflectionMapping;
  texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true;
  return texture;
}
