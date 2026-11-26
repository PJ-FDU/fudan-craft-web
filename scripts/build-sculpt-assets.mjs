import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const project=resolve(import.meta.dirname,'..'),source=resolve(project,'.cache/sculpt-source');
const args=process.argv.slice(2);
mkdirSync(source,{recursive:true});
function run(command,args){
  const result=spawnSync(command,args,{cwd:project,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run(process.execPath,['--import','tsx','scripts/export-blender-source.ts',source,'--sculpt']);
run(process.env.BLENDER_BIN??'/Applications/Blender.app/Contents/MacOS/Blender',[
  '--background','--factory-startup','--threads','0','--python-exit-code','1',
  '--python','scripts/build-sculpt-assets.py','--','--source',source,'--project',project,
  ...args,
]);
// Existing independent assets are preserved by Blender. These generators also
// bootstrap their models when building a new library without a published manifest.
if(!args.some(arg=>arg==='--only-key'||arg.startsWith('--only-key='))){
  const raceIndex=args.indexOf('--only');
  const race=raceIndex>=0?args[raceIndex+1]:args.find(arg=>arg.startsWith('--only='))?.slice(7);
  if(!race||race==='industrial')run(process.execPath,['--import','tsx','scripts/finish-lumbermill-wood.ts',source]);
  run(process.execPath,['--import','tsx','scripts/bake-sculpt-weathering.ts',project,...(race?[race]:[])]);
  const manifest=JSON.parse(readFileSync(resolve(project,'public/assets/blender-sculpt-v2/manifest.json'),'utf8'));
  const device=process.argv.indexOf('--device');
  const deviceArgs=device<0?[]:['--device',process.argv[device+1]];
  if(!manifest.surfaces.worker)run(process.execPath,['scripts/build-worker-hero.mjs',...deviceArgs]);
  if(!manifest.surfaces.sniper)run(process.execPath,['scripts/build-sniper-hero.mjs',...deviceArgs]);
  if(!manifest.surfaces.rifleman)run(process.execPath,['scripts/publish-rifleman.mjs']);
}
