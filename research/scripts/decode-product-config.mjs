import { readFile, writeFile } from 'node:fs/promises';
import { createDecipheriv, createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('evidence/jadx-source/com.edifier.edifierconnect.util.CryptUtil.java', root), 'utf8');
const key = /aesKey\s*=\s*"([^"]+)"/.exec(source)?.[1];
const iv = /aesVector\s*=\s*"([^"]+)"/.exec(source)?.[1];
if (!key || !iv) throw new Error('App configuration constants not found');
const encrypted = await readFile(new URL('inputs/products_release.json', root), 'utf8');
const cipher = createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(iv));
const plain = Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64')), cipher.final()]);
const value = JSON.parse(plain.toString('utf8'));
await writeFile(new URL('evidence/products-decoded.json', root), JSON.stringify(value, null, 2));
const matches = [];
function walk(item, path) {
  if (!item || typeof item !== 'object') return;
  if (!Array.isArray(item) && Object.values(item).some(v => typeof v === 'string' && /\bN300\b/i.test(v))) matches.push({ path, item });
  for (const [key, child] of Object.entries(item)) walk(child, path + '/' + key);
}
walk(value, '');
await writeFile(new URL('evidence/n300-product-config.json', root), JSON.stringify(matches, null, 2));
console.log(JSON.stringify({ plaintext_bytes: plain.length, plaintext_sha256: createHash('sha256').update(plain).digest('hex'), matches }, null, 2));
