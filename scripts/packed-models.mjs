import assert from 'node:assert/strict';

/** Remove the selected model while retaining the other compressed mesh blocks verbatim. */
export function removePackedModel(bytes, key) {
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryStart = 20 + jsonLength + 8;
  assert.equal(bytes.readUInt32LE(binaryStart - 4), 0x004e4942);
  const binary = bytes.subarray(binaryStart);
  if (!doc.nodes.some(node => node.extras?.key === key)) return bytes;
  assert.ok(!doc.animations && !doc.skins && !doc.materials && !doc.images);
  assert.ok(doc.nodes.every(node => !node.children), 'Pack must have flat roots');
  assert.equal(doc.buffers.length, 2);
  const nodes = new Map(), meshes = new Map(), accessors = new Map(), views = new Map();
  doc.nodes.forEach((node, i) => {
    if (node.extras?.key !== key) nodes.set(i, nodes.size);
  });
  for (const index of nodes.keys()) meshes.set(doc.nodes[index].mesh, meshes.size);
  for (const index of meshes.keys()) for (const primitive of doc.meshes[index].primitives) {
    assert.ok(!primitive.targets);
    for (const accessor of [...Object.values(primitive.attributes), primitive.indices]) {
      assert.ok(Number.isInteger(accessor));
      if (!accessors.has(accessor)) accessors.set(accessor, accessors.size);
    }
  }
  for (const index of accessors.keys()) {
    const accessor = doc.accessors[index];
    assert.ok(!accessor.sparse && Number.isInteger(accessor.bufferView));
    if (!views.has(accessor.bufferView)) views.set(accessor.bufferView, views.size);
  }
  const chunks = [];
  let byteLength = 0, fallbackLength = 0;
  doc.bufferViews = [...views.keys()].map(index => {
    const view = structuredClone(doc.bufferViews[index]);
    const compressed = view.extensions?.EXT_meshopt_compression;
    assert.ok(compressed && compressed.buffer === 0 && view.buffer === 1);
    const data = binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
    assert.equal(data.length, compressed.byteLength);
    const padding = (4 - data.length % 4) % 4;
    chunks.push(data, Buffer.alloc(padding));
    compressed.byteOffset = byteLength;byteLength += data.length + padding;
    view.byteOffset = fallbackLength;
    fallbackLength += view.byteLength + (4 - view.byteLength % 4) % 4;
    return view;
  });
  doc.nodes = [...nodes.keys()].map(index => ({...doc.nodes[index], mesh: meshes.get(doc.nodes[index].mesh)}));
  for (const scene of doc.scenes) scene.nodes = scene.nodes.filter(index => nodes.has(index)).map(index => nodes.get(index));
  doc.meshes = [...meshes.keys()].map(index => {
    const mesh = structuredClone(doc.meshes[index]);
    for (const primitive of mesh.primitives) {
      primitive.indices = accessors.get(primitive.indices);
      for (const name of Object.keys(primitive.attributes)) primitive.attributes[name] = accessors.get(primitive.attributes[name]);
    }
    return mesh;
  });
  doc.accessors = [...accessors.keys()].map(index => ({
    ...doc.accessors[index], bufferView: views.get(doc.accessors[index].bufferView),
  }));
  doc.buffers[0].byteLength = byteLength;doc.buffers[1].byteLength = fallbackLength;
  const json = Buffer.from(JSON.stringify(doc));
  const jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const content = Buffer.concat(chunks), header = Buffer.alloc(20), binaryHeader = Buffer.alloc(8);
  header.write('glTF');header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + jsonPadding.length + content.length, 8);
  header.writeUInt32LE(json.length + jsonPadding.length, 12);header.writeUInt32LE(0x4e4f534a, 16);
  binaryHeader.writeUInt32LE(content.length);binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, jsonPadding, binaryHeader, content]);
}
