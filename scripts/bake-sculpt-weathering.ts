import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { BlenderManifest } from '../src/game/blender-assets.js';

interface BakeMetadata {
  fixedWeather?: string;
  textureSources?: Record<string, { file: string; sha256: string }>;
}

const project = resolve(process.argv[2] ?? '.');
const names = process.argv.slice(3);
const directory = resolve(project, 'public/assets/blender-sculpt-v2');
const manifestPath = join(directory, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BlenderManifest;
const { generators, surfaces } = manifest;
assert.ok(generators && surfaces, 'Missing sculpt model atlas manifest');
const weatherFile = 'public/assets/generated/micro/weather-detail.png';
const weatherHash = createHash('sha256').update(readFileSync(weatherFile)).digest('hex');
const weatherBytes = readFileSync(weatherFile);
const weatherWidth = weatherBytes.readUInt32BE(16);
const weatherHeight = weatherBytes.readUInt32BE(20);
const weather = decode(weatherFile, 'rgba');
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const shared = ['industrial', 'brood', 'stellar', 'relay'];
const strength: Record<string, number> = { industrial: 1, brood: .82, stellar: .53, relay: .78 };
const linear = Array.from({ length: 256 }, (_, value) => {
  const encoded = value / 255;
  return encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4;
});
const byte = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
const encode = (value: number) => byte(value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055);
const interpolate = (a: number, b: number, t: number) => a + (b - a) * t;
function smooth(low: number, high: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}
function decode(path: string, format: 'rgb24' | 'rgba') {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-filter_threads', '1',
    '-f', 'rawvideo', '-pix_fmt', format, 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
}
function sample(u: number, v: number, channel: number) {
  const sx = (u - Math.floor(u)) * weatherWidth - .5;
  const sy = (Math.ceil(v) - v) * weatherHeight - .5;
  const x = Math.floor(sx), y = Math.floor(sy);
  const ax = (x + weatherWidth) % weatherWidth, ay = (y + weatherHeight) % weatherHeight;
  const bx = (ax + 1) % weatherWidth, by = (ay + 1) % weatherHeight;
  const a = interpolate(weather[(ay * weatherWidth + ax) * 4 + channel], weather[(ay * weatherWidth + bx) * 4 + channel], sx - x);
  const b = interpolate(weather[(by * weatherWidth + ax) * 4 + channel], weather[(by * weatherWidth + bx) * 4 + channel], sx - x);
  return interpolate(a, b, sy - y) / 255;
}
function triplanar(x: number, y: number, z: number, a: number, b: number, c: number, channel: number) {
  return sample(z, y, channel) * a + sample(x, z, channel) * b + sample(x, y, channel) * c;
}
function savePng(destination: string, rgb: Buffer, width: number, height: number) {
  const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
    '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', '-threads', '1',
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { input: rgb, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(destination, png);
}

for (const name of names.length ? names : shared) {
  assert.ok(shared.includes(name), `Unknown shared model atlas: ${name}`);
  const surface: NonNullable<BlenderManifest['surfaces']>[string] | undefined = surfaces[name];
  const generator = generators[name];
  assert.ok(surface && generator, `Missing model atlas: ${name}`);
  const recordPath = resolve(project, generator.bake);
  const records = JSON.parse(readFileSync(recordPath, 'utf8')) as BakeMetadata[];
  assert.ok(records.length, `Missing model bake records: ${name}`);
  if (records.every(record => record.fixedWeather === weatherHash)) continue;
  assert.ok(records.every(record => !record.fixedWeather), `Rebuild the shared atlas before applying changed weather: ${name}`);
  const sourceFiles: string[] = [surface.albedo, surface.normal, surface.orm].map(file => join(directory, file));
  const png = readFileSync(sourceFiles[0]);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const [albedo, normal, orm] = sourceFiles.map(file => decode(file, 'rgb24'));
  for (const data of [albedo, normal, orm]) assert.equal(data.length, width * height * 3);
  const covered = new Uint32Array(width * height);
  const relief = new Float32Array(covered.length);
  let modified = 0, meshId = 0;
  const glb = Uint8Array.from(readFileSync(join(directory, `${name}.glb`))).buffer;
  const models = await loader.parseAsync(glb, '');

  models.scene.traverse(mesh => {
    if (!(mesh instanceof Mesh)) return;
    const { key, part, slot } = mesh.userData;
    const { position, uv, normal: surfaceNormal } = mesh.geometry.attributes;
    const index = mesh.geometry.index;
    const jointHeight = part < 0 ? 0 : manifest.templates[key].moving[part][1];
    const intensity = strength[name] * (slot === 1 ? .65 : 1);
    const organic = name === 'brood';
    assert.ok(index && position && uv && surfaceNormal, key);
    const owner = ++meshId;
    for (let face = 0; face < index.count; face += 3) {
      const a = index.getX(face), b = index.getX(face + 1), c = index.getX(face + 2);
      const ax = uv.getX(a) * width, ay = uv.getY(a) * height;
      const bx = uv.getX(b) * width - ax, by = uv.getY(b) * height - ay;
      const cx = uv.getX(c) * width - ax, cy = uv.getY(c) * height - ay;
      const det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-8) continue;
      const minX = Math.max(0, Math.floor(ax + Math.min(0, bx, cx)));
      const maxX = Math.min(width - 1, Math.floor(ax + Math.max(0, bx, cx)));
      const minY = Math.max(0, Math.floor(ay + Math.min(0, by, cy)));
      const maxY = Math.min(height - 1, Math.floor(ay + Math.max(0, by, cy)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + .5 - ax, py = y + .5 - ay;
        const u = (px * cy - py * cx) / det, v = (bx * py - by * px) / det, w = 1 - u - v;
        const pixel = y * width + x;
        if (u < 0 || v < 0 || w < 0 || covered[pixel]) continue;
        covered[pixel] = owner;
        if (slot === 2) continue;
        const at = pixel * 3, roughness = orm[at + 1] / 255, metalness = orm[at + 2] / 255;
        const mask = smooth(.28, .40, roughness) * intensity;
        if (mask === 0) continue;
        const sx = position.getX(a) * w + position.getX(b) * u + position.getX(c) * v;
        const sy = position.getY(a) * w + position.getY(b) * u + position.getY(c) * v;
        const sz = position.getZ(a) * w + position.getZ(b) * u + position.getZ(c) * v;
        const nx = Math.abs(surfaceNormal.getX(a) * w + surfaceNormal.getX(b) * u + surfaceNormal.getX(c) * v) ** 5;
        const ny = Math.abs(surfaceNormal.getY(a) * w + surfaceNormal.getY(b) * u + surfaceNormal.getY(c) * v) ** 5;
        const nz = Math.abs(surfaceNormal.getZ(a) * w + surfaceNormal.getZ(b) * u + surfaceNormal.getZ(c) * v) ** 5;
        const total = nx + ny + nz || 1;
        const wx = nx / total, wy = ny / total, wz = nz / total;
        const cavity = 1 - orm[at] / 255, base = 1 - smooth(4, 28, sy + jointHeight);
        const wearEdge = smooth(.10, .36, Math.hypot(normal[at] / 127.5 - 1, normal[at + 1] / 127.5 - 1));
        const stain = triplanar(sx * .031, sy * .031, sz * .031, wx, wy, wz, 0);
        const oxide = triplanar(sx * .031, sy * .031, sz * .031, wx, wy, wz, 1);
        const scratch = triplanar(sx * .075 + .17, sy * .075 + .39, sz * .075 + .61, wx, wy, wz, 2);
        const matte = smooth(.65, .88, roughness) * (1 - smooth(.45, .75, metalness));
        const steel = organic ? 0 : smooth(.04, .22, metalness) * (1 - smooth(.64, .83, roughness));
        const rustable = organic ? 0 : smooth(.05, .23, metalness) * (1 - .8 * matte);
        const rust = smooth(.04, .72, oxide) * (.28 + .43 * cavity + .20 * base + .11 * wearEdge) * rustable * mask;
        const dirt = stain * (.09 + .4 * cavity + .19 * base) * mask;
        const chips = scratch * (.08 + .31 * wearEdge + .10 * cavity) * (1 - .75 * matte) * mask;
        const ink = smooth(.08, .26, scratch) * (1 - smooth(.27, .63, scratch)) * (.22 + .31 * wearEdge + .11 * cavity) * mask;
        const oxideColor = smooth(.22, .92, oxide);
        const shade = 1 - dirt * .72 - ink * .76;
        const r = interpolate(linear[albedo[at]] * shade, interpolate(.12, .39, oxideColor), rust);
        const g = interpolate(linear[albedo[at + 1]] * shade, interpolate(.030, .123, oxideColor), rust);
        const bColor = interpolate(linear[albedo[at + 2]] * shade, interpolate(.012, .034, oxideColor), rust);
        albedo[at] = encode(interpolate(r, interpolate(r * .52, .31, steel), chips));
        albedo[at + 1] = encode(interpolate(g, interpolate(g * .52, .34, steel), chips));
        albedo[at + 2] = encode(interpolate(bColor, interpolate(bColor * .52, .38, steel), chips));
        orm[at + 1] = byte(roughness + dirt * .23 + rust * .43 + chips * (.14 - .23 * steel));
        orm[at + 2] = byte(interpolate(metalness, .96, chips * steel * .78) * (1 - rust * .88 - dirt * .25));
        relief[pixel] = -.14 * scratch * mask + rust * .15;
        modified++;
      }
    }
  });

  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const pixel = y * width + x, owner = covered[pixel], at = pixel * 3;
    if (!owner || relief[pixel] === 0) continue;
    const dx = covered[pixel + 1] === owner && covered[pixel - 1] === owner ? relief[pixel + 1] - relief[pixel - 1] : 0;
    const dy = covered[pixel + width] === owner && covered[pixel - width] === owner ? relief[pixel + width] - relief[pixel - width] : 0;
    const nx = normal[at] / 127.5 - 1 - dx * .8;
    const ny = normal[at + 1] / 127.5 - 1 + dy * .8;
    const nz = normal[at + 2] / 127.5 - 1;
    const length = Math.hypot(nx, ny, nz) || 1;
    normal[at] = byte(nx / length * .5 + .5);
    normal[at + 1] = byte(ny / length * .5 + .5);
    normal[at + 2] = byte(nz / length * .5 + .5);
  }

  assert.ok(modified > 0, `No eligible surfaces: ${name}`);
  const temp = mkdtempSync(join(directory, '.fixed-weather-'));
  try {
    [albedo, normal, orm].forEach((rgb, channel) => savePng(join(temp, String(channel)), rgb, width, height));
    for (const record of records) {
      record.fixedWeather = weatherHash;
      record.textureSources ??= {};
      record.textureSources[weatherFile] = { file: weatherFile, sha256: weatherHash };
    }
    writeFileSync(join(temp, 'report'), JSON.stringify(records, null, 2) + '\n');
    for (const [channel, file] of sourceFiles.entries()) renameSync(join(temp, String(channel)), file);
    renameSync(join(temp, 'report'), recordPath);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`${name}: baked fixed wear into ${modified} atlas texels`);
}

manifest.bakedWeather = shared.filter(name => {
  const bake = generators[name]?.bake;
  if (!bake) return false;
  const records = JSON.parse(readFileSync(resolve(project, bake), 'utf8')) as BakeMetadata[];
  const applied = records[0]?.fixedWeather;
  return Boolean(applied && records.every(record => record.fixedWeather === applied));
});
const pending = manifestPath + '.fixed-weather';
writeFileSync(pending, JSON.stringify(manifest, null, 2) + '\n');
renameSync(pending, manifestPath);
