import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const project=resolve(import.meta.dirname,'..'),source=resolve(project,'.cache/sculpt-source');
mkdirSync(source,{recursive:true});
function run(command,args){
  const result=spawnSync(command,args,{cwd:project,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run(process.execPath,['--import','tsx','scripts/export-blender-source.ts',source]);
run(process.env.BLENDER_BIN??'/Applications/Blender.app/Contents/MacOS/Blender',[
  '--background','--factory-startup','--threads','0','--python-exit-code','1',
  '--python','scripts/build-sculpt-assets.py','--','--source',source,'--project',project,
  ...process.argv.slice(2),
]);
// 通用模型构建完成后恢复单独维护的单位资产。
if(!process.argv.includes('--only-key')){
  const device=process.argv.indexOf('--device');
  run(process.execPath,['scripts/build-worker-hero.mjs',...(device<0?[]:['--device',process.argv[device+1]])]);
  run(process.execPath,['scripts/build-sniper-hero.mjs',...(device<0?[]:['--device',process.argv[device+1]])]);
  run(process.execPath,['scripts/publish-rifleman.mjs']);
}
