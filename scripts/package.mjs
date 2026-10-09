import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== metadata.version) throw Error('Package and manifest versions differ.');
if (manifest.host_permissions?.length)
  throw Error('Release must not contain required host grants.');
const files = [
  'manifest.json',
  'content.js',
  'background.js',
  'popup.js',
  'popup.html',
  'popup.css',
  'theme.css',
  ...new Set([
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.web_accessible_resources.flatMap((resource) => resource.resources),
  ]),
];
const entries = await Promise.all(
  files.sort().map(async (name) => ({ name, data: await readFile(path.join(root, 'dist', name)) }))
);
entries.push({ name: 'LICENSE', data: await readFile(path.join(root, 'LICENSE')) });
entries.push({
  name: 'README.txt',
  data: Buffer.from(
    `Openwide ${manifest.version}\n\nExtract this archive into a permanent folder.\nOpen chrome://extensions or edge://extensions and enable Developer mode.\nChoose Load unpacked and select the folder containing manifest.json.\nOpen a video page and choose Enable on this site in the Openwide popup.\n\nFor updates, replace files in the same folder and reload the existing extension.\n\nSource and documentation: https://github.com/sudoaanish/Openwide\nLicense: MIT (see LICENSE)\n`
  ),
});

// Fixed ZIP timestamps and sorted entries keep archives reproducible.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [],
  central = [];
let offset = 0;
for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
  const name = Buffer.from(entry.name, 'utf8'),
    compressed = deflateRawSync(entry.data),
    crc = crc32(entry.data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, compressed);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(0x800, 8);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt16LE(33, 14);
  directory.writeUInt32LE(crc, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(entry.data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, name);
  offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]),
  filename = `openwide-${manifest.version}.zip`;
const folder = path.join(root, 'release');
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, filename), archive);
await writeFile(
  path.join(folder, 'SHA256SUMS.txt'),
  `${createHash('sha256').update(archive).digest('hex')}  ${filename}\n`
);
console.log(`Packaged ${entries.length} files: release/${filename}`);
