import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const project=resolve(import.meta.dirname,'..');
const source=mkdtempSync(resolve(tmpdir(),'fudancraft-blender-'));
function run(command,args){
  const result=spawnSync(command,args,{cwd:project,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
run(process.execPath,['--import','tsx','scripts/export-blender-source.ts',source]);
run(process.env.BLENDER_BIN??'/Applications/Blender.app/Contents/MacOS/Blender',[
  '--background','--factory-startup','--threads','4','--python-exit-code','1','--python','scripts/build-blender-assets.py','--',
  '--source',source,'--output',resolve(project,'public/assets/blender-v1'),'--project',project,
  ...process.argv.slice(2),
]);
