import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(process.argv[2] ?? fileURLToPath(new URL('../public/assets/generated/micro/', import.meta.url)));
const size = 512;
const materials = ['micro-painted-armor.png', 'micro-brushed-metal.png', 'micro-matte-rough.png', 'micro-organic-chitin.png'];
const weather = ['weather-grime-rust.png', 'weather-cracks-chips.png'];
const fabric = 'micro-woven-cloth.png';
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

function ffmpeg(args, input) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    input, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr.toString().trim());
  return result.stdout;
}

function sourcePixels(filename) {
  const pixels = ffmpeg(['-i', join(directory, filename), '-frames:v', '1', '-filter_threads', '1',
    '-vf', `scale=${size}:${size}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  if (pixels.length !== size * size * 4) throw Error(`无法读取贴图 ${filename}`);
  return pixels;
}

function tileEdges(channel) {
  // Crossfade a narrow strip of opposite borders. The rest of the source stays intact.
  const border = Math.round(size * .035);
  function blendEdges(first, last, weight) {
    const change = (channel[last] - channel[first]) * weight;
    channel[first] += change;
    channel[last] -= change;
  }
  for (let offset = 0; offset < border; offset++) {
    const weight = .25 * (1 + Math.cos(Math.PI * offset / border));
    // Complete each axis before blending the other so the four corner pixels agree.
    for (let y = 0; y < size; y++) blendEdges(y * size + offset, y * size + size - 1 - offset, weight);
    for (let x = 0; x < size; x++) blendEdges(offset * size + x, (size - 1 - offset) * size + x, weight);
  }
  return channel;
}

function channels(filename, base, extractors) {
  const pixels = sourcePixels(filename);
  return extractors.map(extract => tileEdges(Float32Array.from({ length: size * size }, (_, index) => {
    const offset = index * 4;
    const alpha = pixels[offset + 3] / 255;
    const r = base + alpha * (pixels[offset] / 255 - base);
    const g = base + alpha * (pixels[offset + 1] / 255 - base);
    const b = base + alpha * (pixels[offset + 2] / 255 - base);
    return extract(r, g, b);
  })));
}

function pack(channels) {
  const pixels = Buffer.alloc(size * size * channels.length);
  for (const [index, channel] of channels.entries()) {
    for (let i = 0; i < channel.length; i++) pixels[i * channels.length + index] = Math.round(channel[i] * 255);
  }
  return ffmpeg(['-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${size}x${size}`, '-i', 'pipe:0', '-frames:v', '1', '-threads', '1',
    '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], pixels);
}

const luminance = (r, g, b) => r * .2126 + g * .7152 + b * .0722;

async function hasSource(file) {
  try { await access(join(directory, file)); return true; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

function neutralHeight(file) {
  const [height] = channels(file, .5, [luminance]);
  const mean = height.reduce((sum, value) => sum + value, 0) / height.length;
  const peak = height.reduce((max, value) => Math.max(max, Math.abs(value - mean)), .4);
  return height.map(value => .5 + (value - mean) * .4 / peak);
}

try {
  const missing = (await Promise.all([...materials, ...weather].map(async file => await hasSource(file) ? undefined : file))).filter(Boolean);
  if (missing.length) throw Error(`缺少源图 ${missing.join('、')}\n${directory}`);

  const detail = materials.map(neutralHeight);
  const cloth = await hasSource(fabric) ? neutralHeight(fabric) : new Float32Array(size * size).fill(.5);
  const [grime, rust] = channels(weather[0], 1, [
    (r, g, b) => clamp((.96 - luminance(r, g, b)) / .70),
    (r, g, b) => clamp((r - Math.max(g, b) - .025) * 5) * clamp((.97 - luminance(r, g, b)) * 3),
  ]);
  const [chips] = channels(weather[1], 1, [(r, g, b) => clamp((.96 - luminance(r, g, b)) / .73)]);

  const temp = await mkdtemp(join(directory, '.micro-'));
  try {
    const outputs = [['material-detail.png', detail], ['weather-detail.png', [grime, rust, chips, cloth]]];
    for (const [name, maps] of outputs) await writeFile(join(temp, name), pack(maps));
    for (const [name] of outputs) await rename(join(temp, name), join(directory, name));
    console.log(`已生成 ${outputs.map(([name]) => name).join('、')}（${size}×${size}）`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
