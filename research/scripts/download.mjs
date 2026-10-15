import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

const [url, destination, expected] = process.argv.slice(2);
if (!url || !destination) throw new Error('Usage: node download.mjs URL OUTPUT [SHA256]');
await mkdir(dirname(destination), { recursive: true });
const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
const bytes = await readFile(destination);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (expected && expected.toLowerCase() !== sha256) throw new Error('SHA256 mismatch: ' + destination);
const resolvedUrl = new URL(response.url);
for (const key of ['sig', 'jwt', 'X-Amz-Signature', 'X-Amz-Security-Token']) {
  if (resolvedUrl.searchParams.has(key)) resolvedUrl.searchParams.set(key, 'REDACTED');
}
const provenance = { source_url: url, resolved_url: resolvedUrl.href, bytes: bytes.length, sha256, fetched_at: new Date().toISOString() };
await writeFile(destination + '.provenance.json', JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance));
