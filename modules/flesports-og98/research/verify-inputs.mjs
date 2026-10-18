import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync(new URL('./official-manifest.json', import.meta.url), 'utf8'));
for (const entry of manifest) {
  const bytes = readFileSync(new URL('./inputs/official/' + entry.path, import.meta.url));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error('Artifact version mismatch: ' + entry.path);
  }
}
mkdirSync(new URL('../artifacts/analysis/', import.meta.url), { recursive: true });
console.log('Verified ' + manifest.length + ' official artifact hashes');
