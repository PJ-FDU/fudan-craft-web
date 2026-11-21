import type { Surface } from './battle-materials.js';

// 污垢、腐蚀、擦伤、撞击；腐蚀为负时使用铜/合金氧化色，非金属不生锈。
export type Weathering = readonly [dirt:number,corrosion:number,abrasion:number,impact:number];
const coating:Weathering=[.68,.72,.85,.7],steel:Weathering=[.7,.95,.7,.55];
const alloy:Weathering=[.48,-.38,.68,.55],ceramic:Weathering=[.55,0,.78,.65];
const fabric:Weathering=[.82,0,.36,0],rubber:Weathering=[.94,0,.48,.1];
const shell:Weathering=[.62,0,.65,.3],glass:Weathering=[.26,0,.22,.08];
const natural:Weathering=[0,0,0,0];
const profiles:Record<Surface,Weathering>={
  armor:coating,wall:[.85,.55,.7,.6],tread:rubber,glass,
  concrete:[.9,0,.65,.65],roof:steel,stone:natural,insignia:coating,
  pine:natural,leaf:natural,bark:natural,ore:natural,
  grass:natural,earth:natural,water:natural,cloth:fabric,
  helmet:coating,chest:coating,guard:coating,undersuit:fabric,
  deck:coating,track:rubber,grille:steel,wing:[.52,.48,.8,.55],
  mechPlate:coating,piston:[.58,.35,.6,.18],medicPanel:ceramic,scoutCloth:fabric,
  optic:glass,weapon:steel,hazard:coating,exhaust:[.98,.95,.6,.22],
  chitin:shell,membrane:[.5,0,.25,.1],nutrient:[.3,0,.18,.06],horn:shell,
  ceramic,stellarConductor:alloy,astralAlloy:alloy,conductor:[.55,-.8,.65,.35],
  expeditionPlate:[.85,.65,.95,.7],expeditionFrame:steel,expeditionCanvas:fabric,fieldRubber:rubber,
  federalPlate:coating,circuitry:alloy,medicalComposite:ceramic,serviceSteel:steel,
  chitinLamella:shell,photonicGlass:glass,expeditionLaminate:[.82,0,.85,.65],armorCeramic:ceramic,
  titanArmor:coating,titanSteel:steel,titanSeal:rubber,titanTrim:[.75,.65,.92,.55],
};
export const surfaceWeathering=(surface:Surface):Weathering=>profiles[surface];

export const weatherVertexDeclarations=/* glsl */`
  attribute vec4 surfaceWeathering;
  attribute vec4 weatherCoord;
  attribute vec2 weatherSpan;
  varying vec4 vSurfaceWeathering;
  varying vec4 vWeatherCoord;
  varying vec2 vWeatherSpan;
`;
export const weatherVertex=/* glsl */`
  vSurfaceWeathering=surfaceWeathering;
  vWeatherCoord=weatherCoord;
  vWeatherSpan=weatherSpan;
`;

export const weatherFragmentDeclarations=/* glsl */`
  varying vec4 vSurfaceWeathering;
  varying vec4 vWeatherCoord;
  varying vec2 vWeatherSpan;
  float weatherHash(vec2 p){
    vec3 h=fract(vec3(p.xyx)*.1031);
    h+=dot(h,h.yzx+33.33);
    return fract((h.x+h.y)*h.z);
  }
  float weatherNoise(vec2 p){
    vec2 cell=floor(p),f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(weatherHash(cell),weatherHash(cell+vec2(1,0)),f.x),
      mix(weatherHash(cell+vec2(0,1)),weatherHash(cell+vec2(1,1)),f.x),f.y);
  }
  // 与 Three.js 的表面梯度算法一致；叠加在原有法线之后，不占用额外贴图。
  vec3 weatherNormal(vec3 position,vec3 normal,float height,float direction){
    vec3 dx=normalize(dFdx(position)),dy=normalize(dFdy(position));
    vec3 r1=cross(dy,normal),r2=cross(normal,dx);
    float det=dot(dx,r1)*direction;
    vec3 gradient=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
    return normalize(abs(det)*normal-gradient);
  }
`;

export const weatherColor=/* glsl */`
  // 原始部件 UV、静止高度与固定种子随蒙皮插值；移动/旋转时污渍不会游走。
  vec2 weatherUv=vWeatherCoord.xy;
  vec2 weatherPoint=weatherUv*vWeatherSpan/10.0+vWeatherCoord.w*vec2(17.13,9.71);
  float weatherGrain=weatherNoise(weatherPoint*11.0);
  float weatherPatch=weatherNoise(weatherPoint*.8)*.55+
    weatherNoise(weatherPoint*2.3)*.3+weatherNoise(weatherPoint*6.1)*.15;
  float lowDirt=1.0-smoothstep(2.0,25.0,vWeatherCoord.z);
  float streak=smoothstep(.61,.82,weatherNoise(weatherPoint*vec2(2.7,.24)));
  float dirt=clamp((smoothstep(.42,.67,weatherPatch)*.68+streak*.2+
    lowDirt*(.1+.24*weatherPatch))*vSurfaceWeathering.x,0.0,.78);
  float corrosion=smoothstep(.57,.7,weatherNoise(weatherPoint*1.7)*.6+
    weatherNoise(weatherPoint*4.9)*.27+weatherGrain*.13)*abs(vSurfaceWeathering.y)*
    (.6+.4*smoothstep(.25,.7,weatherGrain));
  float edgeDistance=min(min(weatherUv.x,1.0-weatherUv.x),min(weatherUv.y,1.0-weatherUv.y));
  float edgeWear=(1.0-smoothstep(.006,.065,edgeDistance))*
    smoothstep(.38,.72,weatherNoise(weatherPoint*4.0));
  float scratchDistance=abs(fract(weatherPoint.x*.71+weatherPoint.y*1.63)-.5);
  float scratch=(1.0-smoothstep(.012,.038+fwidth(scratchDistance),scratchDistance))*
    smoothstep(.65,.8,weatherNoise(weatherPoint*2.8+vec2(2.4,7.1)));
  float flake=smoothstep(.64,.8,weatherNoise(weatherPoint*5.3))*
    smoothstep(.42,.7,weatherNoise(weatherPoint*1.8+vec2(6.2,2.1)));
  float abrasion=clamp((edgeWear*.82+scratch*.52+flake*.62)*vSurfaceWeathering.z,0.0,1.0);
  vec2 impactPoint=weatherPoint*.67,impactCell=floor(impactPoint);
  vec2 impactCenter=vec2(weatherHash(impactCell+vec2(5.2,1.7)),weatherHash(impactCell+vec2(8.3,6.4)))*.56+.22;
  float impactDistance=length(fract(impactPoint)-impactCenter);
  float impactRadius=.055+.045*weatherHash(impactCell+vec2(9.1,3.4));
  float impactAA=max(.008,fwidth(impactDistance));
  float impactGate=step(.76,weatherHash(impactCell+vec2(4.1,2.9)))*vSurfaceWeathering.w;
  float impact=(1.0-smoothstep(impactRadius-impactAA,impactRadius+impactAA,impactDistance))*impactGate;
  float impactRim=(1.0-smoothstep(impactRadius+.028,impactRadius+.075+impactAA,impactDistance))*
    smoothstep(impactRadius-impactAA,impactRadius+impactAA,impactDistance)*impactGate;
  // 大面板另有稀疏固定落点，避免胸甲/侧裙恰好落在噪声格子的空白区域。
  vec2 panelCenter=vec2(weatherHash(vec2(vWeatherCoord.w*71.3,2.7)),
    weatherHash(vec2(vWeatherCoord.w*39.1,8.2)))*.5+.25;
  float panelDistance=length((weatherUv-panelCenter)*vWeatherSpan);
  float panelRadius=.65+.4*weatherHash(vec2(vWeatherCoord.w*17.9,4.3));
  float panelAA=max(.06,fwidth(panelDistance));
  float panelGate=step(.68,weatherHash(vec2(vWeatherCoord.w*51.7,1.9)))*
    smoothstep(100.0,260.0,vWeatherSpan.x*vWeatherSpan.y)*vSurfaceWeathering.w;
  impact=max(impact,(1.0-smoothstep(panelRadius-panelAA,panelRadius+panelAA,panelDistance))*panelGate);
  impactRim=max(impactRim,(1.0-smoothstep(panelRadius+.3,panelRadius+.8+panelAA,panelDistance))*
    smoothstep(panelRadius-panelAA,panelRadius+panelAA,panelDistance)*panelGate);
  vec3 baseWeatherColor=diffuseColor.rgb;
  vec3 dirtColor=mix(vec3(.052,.043,.029),vec3(.19,.145,.084),weatherGrain);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.48+dirtColor*.5,dirt);
  vec3 corrosionColor=vSurfaceWeathering.y<0.0?
    mix(vec3(.025,.09,.078),vec3(.09,.19,.15),weatherGrain):
    mix(vec3(.075,.021,.009),vec3(.25,.072,.019),weatherGrain);
  diffuseColor.rgb=mix(diffuseColor.rgb,corrosionColor,corrosion*.8);
  float compositeWear=step(.5,vSurfaceWeathering.w)*(1.0-step(.01,abs(vSurfaceWeathering.y)));
  vec3 exposedColor=mix(baseWeatherColor*1.3+vec3(.035),vec3(.2,.23,.25),
    smoothstep(.18,.55,vSurfaceFinish.y));
  exposedColor=mix(exposedColor,baseWeatherColor*.28+vec3(.025,.03,.032),compositeWear);
  diffuseColor.rgb=mix(diffuseColor.rgb,exposedColor,abrasion*.7+impactRim*.24);
  diffuseColor.rgb*=1.0-scratch*compositeWear*.32;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.016,.014),impact*.85);
  float weatherHeight=-impact*.19+impactRim*.035-abrasion*.025+corrosion*(weatherGrain-.5)*.055;
`;

export const weatherRoughness=/* glsl */`
  roughnessFactor=clamp(mix(roughnessFactor,.92,clamp(dirt*.65+corrosion*.75+impact*.6,0.0,1.0))-
    abrasion*.07,.12,1.0);
`;
export const weatherMetalness=/* glsl */`
  metalnessFactor*=1.0-clamp(dirt*.68+corrosion*.88+impact*.5,0.0,.95);
`;
export const weatherRelief=/* glsl */`
  normal=weatherNormal(-vViewPosition,normal,weatherHeight,faceDirection);
`;
