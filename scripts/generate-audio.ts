/**
 * 原创 PCM 音效与配乐，使用 FFmpeg 编码。
 * 临时 WAV 写入系统临时目录，发布素材写入 public/assets/audio。
 */
import { existsSync,mkdirSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { EFFECTS,LOOPS,BUILDING_LOOPS,VOICES,EN_VOICES } from '../src/game/audio-catalog.js';
import { FACTION_AUDIO_DIR,FACTION_EFFECTS,FACTION_LOOPS } from '../src/game/faction-sounds.js';
import { FACTION_VOICES } from '../src/game/faction-voice.js';
import { renderFactionSounds } from './faction-sound-design.js';
const rate=44100,out=resolve('public/assets/audio'),temp=mkdtempSync(join(tmpdir(),'fudancraft-audio-'));
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
mkdirSync(out,{recursive:true});
const qwenVoices=Object.keys(VOICES);
let seed=73129;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const noise=()=>random()*2-1;
const hz=(note:number)=>440*2**((note-69)/12);
const sine=(phase:number)=>Math.sin(phase*Math.PI*2);
function pcm(name:string,length:number,render:(left:Float32Array,right:Float32Array)=>void,peak=.8,destination=out,bitrate='128k'){
  const count=Math.round(length*rate),left=new Float32Array(count),right=new Float32Array(count);
  render(left,right);
  let maximum=.001;for(let i=0;i<count;i++)maximum=Math.max(maximum,Math.abs(left[i]),Math.abs(right[i]));
  const wav=Buffer.alloc(44+count*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*4,40);
  for(let i=0;i<count;i++){
    const edge=Math.min(1,i/(rate*.006),(count-1-i)/(rate*.018)),gain=peak/maximum*edge*32767;
    wav.writeInt16LE(Math.round(left[i]*gain),44+i*4);wav.writeInt16LE(Math.round(right[i]*gain),46+i*4);
  }
  const source=join(temp,`${name}.wav`);writeFileSync(source,wav);
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',source,'-codec:a','libmp3lame','-b:a',bitrate,join(destination,`${name}.mp3`)]);
  console.log(`Created ${name} (${length.toFixed(2)}s)`);
}
function layer(left:Float32Array,right:Float32Array,at:number,duration:number,fn:(t:number)=>number,gain=1,pan=0){
  const start=Math.round(at*rate),count=Math.round(duration*rate);
  for(let i=0;i<count&&start+i<left.length;i++){
    if(start+i<0)continue;
    const sample=fn(i/rate)*gain;
    left[start+i]+=sample*Math.sqrt((1-pan)/2);right[start+i]+=sample*Math.sqrt((1+pan)/2);
  }
}
function effect(name:string){
  if(name.startsWith('select-')){industrial(name.slice(7),true);return;}
  const length=name==='victory'?3.6:name==='defeat'?3.8:name==='collapse'?2.2:name==='explosion'?1.6:name==='bird'?1.5:name==='alarm'?1.4:name==='heal'||name==='research'?1.1:name.includes('cannon')?1.15:.5;
  pcm(name,length,(left,right)=>{
    let low=0;
    if(['rifle','scout-gun','fighter-gun','tower-gun'].includes(name)){
      const shots=name==='scout-gun'?3:name==='fighter-gun'?4:name==='rifle'?2:1;
      for(let s=0;s<shots;s++)layer(left,right,s*.075,.28,t=>{
        low=low*.74+noise()*.26;
        return (noise()*.35+low*.65+sine(t*(130-80*t))*.26)*Math.exp(-t*27);
      });
    }else if(['sniper','tank-cannon','artillery-cannon','mech-gun','shell-hit','explosion','collapse','bullet-hit'].includes(name)){
      const heavy=name!=='bullet-hit',base=name==='sniper'?140:name==='mech-gun'?90:heavy?55:270,decay=name==='collapse'?2.6:heavy?5:24;
      layer(left,right,0,length,t=>{
        low=low*.93+noise()*.07;
        return (sine(base*t* Math.exp(-t*.6))*.55+low*2.7+noise()*Math.exp(-t*32)*.6)*Math.exp(-t*decay);
      });
      if(name==='collapse')for(let s=0;s<7;s++)layer(left,right,.12+s*.14,.55,t=>noise()*Math.exp(-t*12),.24,random()*.8-.4);
    }else if(name==='bird'){
      for(let s=0;s<3;s++)layer(left,right,.1+s*.35,.24,t=>sine(t*2200+35*sine(t*11))*Math.sin(Math.PI*t/.24)**2,.45);
    }else if(name==='alarm'){
      layer(left,right,0,length,t=>sine(t*(Math.floor(t*4)%2?640:480))*.6*(.6+.4*sine(t*2)));
    }else if(name==='victory'||name==='defeat'){
      const notes=name==='victory'?[50,57,62,65,69,74]:[50,53,56,49];
      notes.forEach((n,i)=>layer(left,right,i*.16,length-i*.16,t=>(sine(t*hz(n))+.24*sine(t*hz(n)*2))*Math.min(1,t*40)*Math.exp(-t*1.3),.4,(i%2?1:-1)*.3));
    }else{
      const tones:Record<string,number[]>={'ui-hover':[720],'ui-click':[480,720],'ui-confirm':[523,784,1046],'ui-error':[220,165],order:[350,510],'build-start':[260,390,520],complete:[392,523,784],research:[440,660,880,1320],heal:[580,730,920]};
      (tones[name]||[640]).forEach((f,i)=>layer(left,right,i*.07,length-i*.07,t=>sine(t*f)*Math.min(1,t*100)*Math.exp(-t*(name==='heal'||name==='research'?5:19)),.6));
    }
  },name==='ui-hover'?.45:.82);
}
function music(name:string){
  const duration=48,beat=.75,chords=[[50,53,57,62],[46,50,53,58],[48,52,55,60],[45,50,53,57]];
  pcm(name,duration,(left,right)=>{
    chords.forEach((notes,c)=>{for(let repeat=0;repeat<4;repeat++){
      const at=(repeat*4+c)*3;
      for(const [j,n] of notes.entries())layer(left,right,at,Math.min(4,duration-at),t=>{
        const f=hz(n),envelope=Math.min(1,t/ .65)*Math.min(1,(4-t)/1.1);
        return (sine(t*f)+.28*sine(t*f*2)+.18*sine(t*f*1.003))*envelope*(.85+.15*sine(t*.3));
      },name==='combat'?.2:.4,(j-1.5)*.35);
      layer(left,right,at,3,t=>sine(t*hz(notes[0]-12))*Math.min(1,t*3)*Math.min(1,(3-t)*2),.38);
    }});
    const melody=[74,0,69,72,0,65,69,0,70,0,65,69,0,62,65,0,72,0,67,70,0,64,67,0,69,0,65,62,0,57,62,0];
    for(let step=0;step<64;step++){
      const at=step*beat,n=melody[step%melody.length];
      if(n&&name!=='combat'){
        const tone=(t:number)=>(sine(t*hz(n))+.2*sine(t*hz(n)*2))*Math.exp(-t*3)*Math.min(1,t*80);
        layer(left,right,at,2,tone,name==='menu'?.28:.17,Math.sin(step)*.45);
        layer(left,right,at+.37,1.8,tone,.065,-Math.sin(step)*.5);
      }
      if(name==='combat'){
        const n=chords[Math.floor(step/4)%4][0]+12;
        layer(left,right,at,.5,t=>(sine(t*hz(n))+.2*sine(t*hz(n)*3))*Math.exp(-t*8),.23,step%2?.3:-.3);
        layer(left,right,at,.38,t=>sine(48*t+5*(1-Math.exp(-t*25)))*Math.exp(-t*11),.8);
        if(step%4===2)layer(left,right,at,.25,t=>(noise()*.65+sine(150*t)*.35)*Math.exp(-t*17),.32);
        layer(left,right,at+.375,.1,t=>noise()*Math.exp(-t*60),.08,.25);
      }else if(step%4===0){
        layer(left,right,at,1.2,t=>sine(42*t)*Math.exp(-t*5),name==='menu'?.28:.13);
      }
    }
  },.65);
}
function ambient(name:string){
  if((BUILDING_LOOPS as readonly string[]).includes(name)){industrial(name);return;}
  pcm(name,12,(left,right)=>{
    let lowL=0,lowR=0;
    for(let i=0;i<left.length;i++){
      const t=i/rate;
      lowL=lowL*.985+noise()*.015;lowR=lowR*.985+noise()*.015;
      const pulse=.65+.2*sine(t/12)+.15*sine(t/6);
      if(name==='wind'){left[i]=lowL*pulse;right[i]=lowR*pulse;}
      if(name==='water'){left[i]=lowL*2*pulse+noise()*.025;right[i]=lowR*2*pulse+noise()*.025;}
      if(name==='machinery'){left[i]=sine(48*t)*.13+sine(96*t)*.04+lowL*.35;right[i]=sine(48*t+.015)*.13+sine(96*t)*.04+lowR*.35;}
    }
  },.38);
}
function industrial(name:string,selection=false){
  const length=selection?.7:8,kind=name.split('-')[0],producing=name.includes('production');
  pcm(selection?`select-${name}`:name,length,(left,right)=>{
    let rumble=0,air=0;
    for(let i=0;i<left.length;i++){
      const t=i/rate,hit=t%(selection?.7:producing?.4:1),noiseValue=noise();
      rumble=rumble*.97+noiseValue*.03;air=air*.55+noiseValue*.45;
      const hum=sine(60*t)*.03+sine(120*t)*.012;
      let sample=hum;
      if(kind==='factory'||kind==='construction'||kind==='gold'){
        // 低频机床 + 多个不谐和金属共振，敲击有短暂尾音。
        sample=rumble*.2+(sine(377*t)+sine(619*t)*.5+sine(1037*t)*.25)*Math.exp(-hit*28)*.17+air*Math.exp(-hit*70)*.4;
      }else if(kind==='lumbermill'||kind==='wood'){
        sample=air*(.08+.08*Math.sin(t*Math.PI*2)**2)+sine(180*t+3*sine(30*t))*.035;
        if(selection)sample+=noiseValue*Math.exp(-t*35)*.28;
      }else if(kind==='airfield'){
        sample=rumble*.6+air*.11+sine(240*t+14*sine(t/8))*.02;
        sample*=producing?.65+.35*Math.sin(t*Math.PI/4)**2:1;
      }else if(kind==='refinery'||kind==='oil'){
        sample=rumble*.6+air*.04+sine(90*t)*.06+(noiseValue+sine(340*t))*.045*Math.exp(-hit*18);
      }else if(kind==='barracks'){
        sample=rumble*.15+noiseValue*Math.exp(-hit*40)*.14+sine(72*t)*Math.exp(-hit*24)*.12;
      }else if(kind==='powerplant'){
        sample=sine(60*t)*.12+sine(120*t)*.04+sine(180*t)*.02+rumble*.2;
      }else if(kind==='tower'){
        sample=air*.06*Math.sin(t*Math.PI/2)**8+sine(180*t)*.05*Math.exp(-hit*18);
      }else{
        // 指挥终端与研究仪器的稀疏双音提示。
        sample=hum+rumble*.1+sine((kind==='research'?880:660)*t)*.08*Math.exp(-hit*15)
          +sine((kind==='research'?1320:990)*t)*.045*Math.exp(-((t+.15)%1)*18);
      }
      left[i]=sample;right[i]=sample*.96;
    }
  },selection?.65:.3);
}
try{
  if(process.argv.includes('--factions')){
    const destination=join(out,FACTION_AUDIO_DIR);
    mkdirSync(destination,{recursive:true});
    renderFactionSounds((name,length,render,peak)=>pcm(name,length,render,peak,destination,'96k'));
    writeFileSync(join(destination,'manifest.json'),JSON.stringify({sampleRate:rate,effects:FACTION_EFFECTS,loops:FACTION_LOOPS,voices:Object.fromEntries(FACTION_VOICES)},null,2)+'\n');
  }else{
    for(const id of qwenVoices)for(const prefix of ['','en-']){
      const filename=`${prefix}${id}.mp3`;
      if(!existsSync(join(out,filename)))throw Error(`Missing Qwen voice ${filename}. Run scripts/generate-qwen-voices.py first.`);
    }
    EFFECTS.forEach(effect);
    for(const name of LOOPS){if(['menu','exploration','combat'].includes(name))music(name);else ambient(name);}
    writeFileSync(join(out,'manifest.json'),JSON.stringify({sampleRate:rate,effects:EFFECTS,loops:LOOPS,voices:VOICES,englishVoices:EN_VOICES,qwenChineseVoices:qwenVoices,qwenEnglishVoices:qwenVoices},null,2)+'\n');
  }
}finally{rmSync(temp,{recursive:true,force:true});}
