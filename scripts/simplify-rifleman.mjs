import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

const [directory, triangles] = process.argv.slice(2);
const readArray = (name, Type) => {
  const bytes = readFileSync(join(directory, name));
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
};
const positions = readArray('positions.bin', Float32Array);
const normals = readArray('normals.bin', Float32Array);
const source = readArray('triangles.bin', Uint32Array);
await MeshoptSimplifier.ready;
const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
  source, positions, 3, normals, 3, [.13, .13, .13], null, Number(triangles) * 3, 1,
  ['RegularizeLight', 'Prune', 'Permissive'],
);
writeFileSync(join(directory, 'low.bin'), Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength));
console.log(JSON.stringify({ triangles: indices.length / 3, error }));
