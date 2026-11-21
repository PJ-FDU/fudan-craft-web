import {
  ACESFilmicToneMapping, BackSide, Mesh, PMREMGenerator, Scene, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, type WebGLRenderer,
} from 'three';

/** 一次烘焙天空反射，所有粗糙度共用 PMREM，不逐帧渲染反射探针。 */
export function battleLighting(renderer:WebGLRenderer,scene:Scene){
  renderer.outputColorSpace=SRGBColorSpace;
  renderer.toneMapping=ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  const sky=new Scene();
  const geometry=new SphereGeometry(100,32,16);
  const material=new ShaderMaterial({
    side:BackSide,
    vertexShader:`varying vec3 skyDirection;
      void main(){skyDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`varying vec3 skyDirection;
      void main(){
        vec3 direction=normalize(skyDirection);
        vec3 horizon=vec3(.7,.78,.86),zenith=vec3(.22,.38,.62),earth=vec3(.16,.18,.13);
        vec3 sky=mix(horizon,zenith,pow(max(direction.y,0.0),.55));
        sky=mix(earth,sky,smoothstep(-.22,.08,direction.y));
        float sun=max(0.0,dot(direction,normalize(vec3(-598.0,1150.0,-462.0))));
        sky+=vec3(1.0,.83,.6)*(pow(sun,48.0)*.5+pow(sun,700.0)*9.0);
        gl_FragColor=vec4(sky,1.0);
      }`,
  });
  sky.add(new Mesh(geometry,material));
  const generator=new PMREMGenerator(renderer);
  const environment=generator.fromScene(sky,.04,1,300);
  scene.environment=environment.texture;
  scene.environmentIntensity=.65;
  geometry.dispose();material.dispose();generator.dispose();
  return environment;
}
