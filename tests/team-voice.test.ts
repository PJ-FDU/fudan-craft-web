import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeamVoice } from '../src/game/team-voice.js';

test('push-to-talk gates tracks during permission resolution, mute overrides holding, and cancelled acquisition stops media',async()=>{
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const secureDescriptor=Object.getOwnPropertyDescriptor(globalThis,'isSecureContext');
  let resolve!:(stream:MediaStream)=>void;
  const track={enabled:true,readyState:'live',onended:null,stop(){this.readyState='ended';}};
  const stream={getAudioTracks:()=>[track],getTracks:()=>[track]} as unknown as MediaStream;
  const outgoing:Record<string,unknown>[]=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise<MediaStream>(r=>{resolve=r;})}}});
  Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:true});
  const voice=new TeamVoice(m=>outgoing.push(m),()=>[],()=>{});
  try{
    voice.setPushToTalk(true);const start=voice.start(1);voice.talk(true);voice.talk(false);resolve(stream);await start;
    assert.equal(track.enabled,false,'release during permission prompt cannot leave mic enabled');
    voice.talk(true);assert.equal(track.enabled,true);
    voice.mute();assert.equal(track.enabled,false);
    voice.talk(false);voice.talk(true);assert.equal(track.enabled,false,'manual mute wins over PTT');
    voice.mute();assert.equal(track.enabled,true);
    voice.talk(false);assert.equal(track.enabled,false);
    voice.setPushToTalk(false);assert.equal(track.enabled,true);
    voice.stop();assert.equal(track.readyState,'ended');assert.equal(outgoing.at(-1)?.session,null);
    track.readyState='live';const pending=voice.start(1);voice.stop();resolve(stream);await pending;
    assert.equal(track.readyState,'ended','late permission result is immediately stopped');
    assert.equal(voice.active,false);
  }finally{
    voice.stop(false);
    if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else Reflect.deleteProperty(globalThis,'navigator');
    if(secureDescriptor)Object.defineProperty(globalThis,'isSecureContext',secureDescriptor);else Reflect.deleteProperty(globalThis,'isSecureContext');
  }
});
