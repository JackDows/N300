import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'));
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
await mkdir(resolve(root, 'inputs'), { recursive: true });
for (const source of manifest.files) {
  const destination = resolve(root, source.path);
  if (!destination.startsWith(resolve(root, 'inputs') + sep)) throw new Error('Input path leaves research/inputs');
  const existing = await digest(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing === source.sha256) { console.log('Verified ' + source.path); continue; }
  if (existing) throw new Error('Existing input differs from recorded SHA-256: ' + source.path);
  const temporary = destination + '.part';
  try {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + source.url);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (await digest(temporary) !== source.sha256) throw new Error('SHA-256 mismatch: ' + source.path);
    await rename(temporary, destination);
    await writeFile(destination + '.provenance.json', JSON.stringify({ source_url: source.url, sha256: source.sha256, fetched_at: new Date().toISOString() }, null, 2));
    console.log('Downloaded and verified ' + source.path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
