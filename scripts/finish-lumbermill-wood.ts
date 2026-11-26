import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Euler, Mesh, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

type Triple = [number, number, number];
interface Primitive {
  shape: string;
  finish?: { surface?: string };
  position: Triple;
  rotation: Triple;
  size: Triple;
}

const key = 'industrial:lumbermill';
const project = resolve(process.argv[3] ?? '.');
const directory = resolve(project, 'public/assets/blender-sculpt-v2');
const sourcePath = resolve(process.argv[2] ?? '.cache/sculpt-source', 'source.json');
const grainSource = 'public/assets/generated/micro/mill-wood-grain.png';
const grainPath = resolve(grainSource);
const filenames = ['industrial-albedo.png', 'industrial-normal.png', 'industrial-orm.png'];

function decode(path: string, grain = false) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-filter_threads', '1',
    ...(grain ? ['-vf', 'scale=512:512:flags=area'] : []),
    '-f', 'rawvideo', '-pix_fmt', grain ? 'gray' : 'rgb24', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
}

const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as {
  meshes: { key: string; slot: number; part: number; primitives: Primitive[] }[];
};
const wood = source.meshes.find(mesh => mesh.key === key && mesh.slot === 0 && mesh.part === -1)?.primitives
  .filter(part => part.finish?.surface === 'bark' && (part.shape === 'gable' || part.shape === 'drum'));
assert.ok(wood && wood.some(part => part.shape === 'gable') && wood.some(part => part.shape === 'drum'), 'Missing lumbermill wood parts');
const pieces = wood.map(part => ({
  roof: part.shape === 'gable', center: new Vector3(...part.position), half: new Vector3(...part.size).multiplyScalar(.5),
  inverse: new Quaternion().setFromEuler(new Euler(...part.rotation)).invert(),
}));

const recordsPath = resolve(project, 'artifacts/blender-sculpt/industrial-bake.json');
const records = JSON.parse(readFileSync(recordsPath, 'utf8')) as {
  key: string; tile: [number, number]; tileSize: number;
  textureSources?: Record<string, {file:string; sha256:string}>;
}[];
const record = records.find(item => item.key === key);
assert.ok(record, 'Missing industrial lumbermill bake record');
const bytes = readFileSync(resolve(directory, filenames[0]));
const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
const { tile, tileSize } = record;
const tileX = tile[0] * tileSize, tileY = height - (tile[1] + 1) * tileSize;
const [albedo, normal, orm] = filenames.map(name => decode(resolve(directory, name)));
for (const channel of [albedo, normal, orm]) assert.equal(channel.length, width * height * 3);

const glb = Uint8Array.from(readFileSync(resolve(directory, 'industrial.glb'))).buffer;
const model = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb, '');
let solid: Mesh | undefined;
model.scene.traverse(object => {
  if (object instanceof Mesh && object.userData.key === key && object.userData.slot === 0) solid = object;
});
assert.ok(solid, 'Missing lumbermill solid mesh');
const { geometry } = solid;
const { position, uv } = geometry.attributes;
const index = geometry.index;
assert.ok(position && uv && index, 'Missing lumbermill positions, UVs or indices');

const grain = decode(grainPath, true);
const fract = (v: number) => v - Math.floor(v);
const clamp = (v: number, low = 0, high = 1) => Math.min(high, Math.max(low, v));
const mirror = (v: number) => 1 - Math.abs(fract(v * .5) * 2 - 1);
function fiber(u: number, v: number) {
  const x = Math.round(mirror(u) * 511), y = Math.round(mirror(v) * 511);
  return grain[y * 512 + x] / 255;
}
type Surface = 'boards' | 'gable' | 'bark' | 'end';
const colors: Record<Surface, Triple> = {
  boards: [141, 97, 66], gable: [125, 83, 54], bark: [103, 63, 38], end: [194, 136, 80],
};
const counts: Record<Surface, number> = { boards: 0, gable: 0, bark: 0, end: 0 };

function woodHeight(surface: Surface, p: Vector3, seed: number, radius: number) {
  if (surface === 'end') {
    const x = p.x / radius, z = p.z / radius;
    const r = Math.hypot(x + .08, z - .11), angle = Math.atan2(z, x);
    const rings = .5 + .5 * Math.cos((r + .021 * Math.sin(4 * angle + r * 9 + seed)) * 35 + 1.7 * Math.sin(6 * r + seed));
    return .56 + .19 * (rings - .5) + .17 * (fiber(x * .8, z * .9) - .5) - .31 * clamp((Math.hypot(x, z) - .82) * 7);
  }
  if (surface === 'bark') {
    const angle = Math.atan2(p.z, p.x) / (Math.PI * 2);
    return .41 + 1.12 * (fiber(angle * 4 + seed * .37, p.y / 28 + seed * .3) - .5);
  }
  const across = surface === 'gable' ? p.y : p.z;
  const board = across / (surface === 'gable' ? 4.5 : 6.2);
  const joint = clamp((.12 - Math.min(fract(board), 1 - fract(board))) * 7);
  const variation = Math.sin(Math.floor(board) * 13.16) * .065;
  return .47 + .96 * (fiber(across / 39 + .21, p.x / 67 + .29) - .5) - .25 * joint + variation;
}

const covered = new Uint8Array(tileSize * tileSize);
const painted = new Uint8Array(covered.length);
function atlasOffset(x: number, y: number) { return ((tileY + y) * width + tileX + x) * 3; }

for (let i = 0; i < index.count; i += 3) {
  const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
  const vertices = indices.map(id => new Vector3().fromBufferAttribute(position, id));
  const piece = pieces.find(part => vertices.every(vertex => {
    const p = vertex.clone().sub(part.center).applyQuaternion(part.inverse);
    if (part.roof) return Math.abs(p.x) <= part.half.x + .1 && Math.abs(p.y) <= part.half.y + .1 && Math.abs(p.z) <= part.half.z + .1;
    return Math.hypot(p.x, p.z) <= part.half.x + .1 && Math.abs(p.y) <= part.half.y + .1;
  }));
  const [[ax, ay], [bx, by], [cx, cy]] = indices.map(id => [uv.getX(id) * width - tileX, uv.getY(id) * height - tileY]);
  const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) < 1e-8) continue;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(tileSize - 1, Math.floor(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(tileSize - 1, Math.floor(Math.max(ay, by, cy)));
  const local = piece && vertices.map(vertex => vertex.clone().sub(piece.center).applyQuaternion(piece.inverse));
  const edgeU = local && local[1].clone().sub(local[0]), edgeV = local && local[2].clone().sub(local[0]);
  const face = edgeU && edgeV && edgeU.clone().cross(edgeV).normalize();
  const surface: Surface | undefined = piece && face && (piece.roof ? (Math.abs(face.z) > .7 ? 'gable' : 'boards')
    : (Math.abs(face.y) > .7 ? 'end' : 'bark'));
  const seed = piece ? pieces.indexOf(piece) : 0;

  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + .5 - ax, py = y + .5 - ay;
    const u = (px * vy - py * vx) / det, v = (ux * py - uy * px) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    const pixel = y * tileSize + x, at = atlasOffset(x, y);
    covered[pixel] = 1;
    if (!piece || !local || !surface || !edgeU || !edgeV || orm[at + 2] > 3 || orm[at + 1] < 196) continue;

    const relief = (a: number, b: number) => woodHeight(surface, local[0].clone().addScaledVector(edgeU, a).addScaledVector(edgeV, b), seed, piece.half.x);
    const h = relief(u, v);
    const dx = relief(u + vy / det, v - uy / det) - h;
    const dy = relief(u - vx / det, v + ux / det) - h;
    const n = new Vector3(clamp(-dx * 1.1, -.29, .29), clamp(dy * 1.1, -.29, .29), 1).normalize();
    const shade = clamp(.51 + h * .96, .35, 1.30);
    const color = colors[surface];
    for (let c = 0; c < 3; c++) {
      albedo[at + c] = Math.round(color[c] * shade);
      normal[at + c] = Math.round((n.getComponent(c) * .5 + .5) * 255);
    }
    orm[at + 1] = Math.round(clamp(.93 - .13 * h - (surface === 'end' ? .045 : 0), .775, .95) * 255);
    painted[pixel] = 1;
    counts[surface]++;
  }
}

for (const count of Object.values(counts)) assert.ok(count > 50, 'Unexpected lumbermill wood coverage');
// Extend the new colors into the existing bake margin, without crossing other UV islands.
for (let y = 1; y + 1 < tileSize; y++) for (let x = 1; x + 1 < tileSize; x++) {
  if (covered[y * tileSize + x]) continue;
  const at = atlasOffset(x, y);
  if (orm[at + 2] > 3 || orm[at + 1] < 196) continue;
  const neighbor = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => painted[(y + dy) * tileSize + x + dx]);
  if (!neighbor) continue;
  const from = atlasOffset(x + neighbor[0], y + neighbor[1]);
  albedo.copy(albedo, at, from, from + 3);
  normal.copy(normal, at, from, from + 3);
  orm[at + 1] = orm[from + 1];
}

const temp = mkdtempSync(join(directory, '.mill-wood-'));
try {
  for (const [channel, data] of [albedo, normal, orm].entries()) {
    const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
      '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', '-threads', '1',
      '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: data, maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(temp, filenames[channel]), png);
  }
  for (const name of filenames) renameSync(join(temp, name), join(directory, name));
  record.textureSources ??= {};
  record.textureSources[grainSource] = {
    file:grainSource,sha256:createHash('sha256').update(readFileSync(grainPath)).digest('hex'),
  };
  const bakeRecord = join(temp, 'industrial-bake.json');
  writeFileSync(bakeRecord,JSON.stringify(records,null,2)+'\n');
  renameSync(bakeRecord,recordsPath);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(`Lumbermill wood pixels ${JSON.stringify(counts)}`);
