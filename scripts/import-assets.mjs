// Reproduce the Lost Temple map data from the pinned upstream revision.
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
async function fetch(url) { const {stdout} = await run('curl', ['-fsSL', '--retry', '2', '--max-time', '60', url], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }); return {ok:true, arrayBuffer:async()=>stdout, text:async()=>stdout.toString('utf8')}; }
const commit = 'd277e41c731202996598c1e475dbf63ac4a54671';
const root = `https://raw.githubusercontent.com/PJ-FDU/fudancraft/${commit}/`;
const r = await fetch(root+'Resources/Map/LostTemple.tmx');
if (!r.ok) throw Error('Map download failed');
const xml = await r.text();
const layers = [...xml.matchAll(/<layer\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/layer>/g)].map(m=>({name:m[1],data:m[2].match(/<data[^>]*>([\s\S]*?)<\/data>/)[1].trim().split(/\s*,\s*/).map(Number)}));
const group = xml.match(/<objectgroup[^>]*name="InitialUnits"[^>]*>([\s\S]*?)<\/objectgroup>/)[1];
const initial = [...group.matchAll(/<object\b([^>]+)>([\s\S]*?)<\/object>/g)].map(m=>{const attr=Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(x=>[x[1],x[2]]));const prop=Object.fromEntries([...m[2].matchAll(/<property[^>]*name="([^"]+)"[^>]*value="([^"]+)"/g)].map(x=>[x[1],Number(x[2])]));return{x:Number(attr.x)/32,y:Number(attr.y)/32,camp:prop.camp,type:Number(attr.type)||prop.type};});
await mkdir('src/game',{recursive:true});
await writeFile('src/game/map.ts', '// Generated from the original LostTemple.tmx. See THIRD_PARTY_NOTICES.md.\nexport const MAP = '+JSON.stringify({width:128,height:128,tile:32,layers,initial})+' as const;\n');
await writeFile('docs/ORIGINAL_LICENSE',await (await fetch(root+'LICENSE')).text());
console.log(`Imported Lost Temple; layers: ${layers.map(l=>l.name)}; initial units: ${initial.length}`);
console.log(initial);
