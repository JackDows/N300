import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cacheRoot = process.argv[2] ?? process.env.DESKHUB_CACHE_ROOT ?? fileURLToPath(new URL('../.local/dependencies/tools/', import.meta.url));
const output = resolve(cacheRoot,'downloads/rustup-init-1.29.1.exe');
const expected = '6f4bef66261261fcb43131be8720bab817d403a09edec7455c371974b90bdb7e';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cached = await readFile(output).catch(() => null);
if (!cached || sha256(cached) !== expected) {
  const response = await fetch('https://static.rust-lang.org/rustup/archive/1.29.1/x86_64-pc-windows-msvc/rustup-init.exe', { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`rustup download: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error('rustup SHA-256 mismatch');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output + '.partial', bytes);
  await rename(output + '.partial', output);
}
console.log(`Verified rustup 1.29.1: ${output}`);
