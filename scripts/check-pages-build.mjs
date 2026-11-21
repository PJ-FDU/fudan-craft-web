import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = path.join(root, 'dist-pages');
const server = path.join(root, 'dist');

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

const html = await readFile(path.join(pages, 'index.html'), 'utf8');
// 仓库 Pages 位于子路径；首页链接、脚本、字体及图集都必须保留此路径。
for (const match of html.matchAll(/\b(?:href|src|srcset)\s*=\s*["']([^"']+)["']/g)) {
  assert.ok(!/^\/(?!\/)/.test(match[1]), `Pages 根路径引用：${match[1]}`);
}
for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["'](\.\/[^"']+)["']/g)) {
  const target = await stat(path.join(pages, match[1]));
  assert.ok(target.isFile() || match[1] === './' && target.isDirectory(), `缺少入口资源：${match[1]}`);
}

const built = await files(pages);
const names = built.map(file => path.relative(pages, file).split(path.sep).join('/'));
assert.ok(names.some(name => /^assets\/host-worker-.+\.js$/.test(name)), 'Pages 缺少房主模拟 Worker');
assert.ok(names.some(name => /^assets\/p2p-connection-.+\.js$/.test(name)), 'Pages 缺少 WebRTC 模块');
assert.ok(!(await files(server)).some(file => /(?:host-worker|p2p-connection)-.+\.js$/.test(file)),
  '服务器版意外包含 Pages 专用网络模块');
assert.ok(!names.some(name => /(?:^|\/)(?:\.env[^/]*|node_modules|\.git)(?:\/|$)/.test(name)),
  'Pages 产物包含本地配置或开发文件');

// 公共素材必须原样进入发布产物，防止字体、音频或贴图在本机存在而发布后缺失。
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const publicRoot = path.join(root, 'public');
const publicFiles = (await files(publicRoot)).filter(file => path.basename(file) !== '.DS_Store');
for (const file of publicFiles) {
  const relative = path.relative(publicRoot, file);
  assert.equal(digest(await readFile(path.join(pages, relative))), digest(await readFile(file)),
    `Pages 素材缺失或改变：${relative}`);
}

const totalBytes = (await Promise.all(built.map(file => stat(file)))).reduce((sum, file) => sum + file.size, 0);
assert.ok(totalBytes < 1024 ** 3, 'Pages 产物超过 1 GiB');
console.log(`Pages 发布检查通过：${publicFiles.length} 份公共素材，${(totalBytes / 1024 ** 2).toFixed(1)} MiB；子路径引用与 WebRTC Worker 完整。`);
