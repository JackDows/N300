import { writeFileSync } from 'node:fs';
import { Cdp } from './cdp.mjs';
const client = await Cdp.connect(process.argv[2] ?? 'http://127.0.0.1:19381');
try {
  const snapshot = await client.evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button,[role=button],a,[title]')].map(e=>({tag:e.tagName,text:e.textContent?.trim().slice(0,70),title:e.getAttribute('title')}))})`);
  writeFileSync(new URL('../artifacts/analysis/official-page.json', import.meta.url), JSON.stringify(snapshot, null, 2));
  const png = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(new URL('../artifacts/analysis/official-page.png', import.meta.url), Buffer.from(png.data, 'base64'));
  console.log(JSON.stringify(snapshot));
} finally { client.close(); }
