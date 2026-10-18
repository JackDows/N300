import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(root, '..');
const repository = process.env.REA_ROOT ?? resolve(project, '../../tools/rea');
const require = createRequire(resolve(repository, 'package.json'));
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { parse } = require('smol-toml');
const configPath = process.argv[2] ?? resolve(process.env.CODEX_HOME ?? resolve(homedir(), '.codex'), 'config.toml');
const entry = parse(await readFile(configPath, 'utf8')).mcp_servers.rea;
const temporary = resolve(project, '.local/tmp');
await mkdir(temporary, { recursive: true });
await mkdir(resolve(root, 'evidence'), { recursive: true });
const transport = new StdioClientTransport({
  command: entry.command, args: entry.args, cwd: repository,
  env: { ...process.env, ...entry.env, TEMP: temporary, TMP: temporary, REA_JADX_HEAP_MIB: '4096' },
  stderr: 'pipe',
});
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'n300-protocol-investigation', version: '1.0.0' });
const input = createInterface({ input: process.stdin, terminal: false });
try {
  await client.connect(transport, { timeout: 30000 });
  const catalog = await client.listTools();
  await writeFile(resolve(root, 'evidence/rea-tool-catalog.json'), JSON.stringify(catalog));
  console.log(JSON.stringify({ ready: true, server: client.getServerVersion(), tools: catalog.tools.length }));
  for await (const line of input) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.exit) break;
    try {
      const result = await client.callTool({ name: request.tool, arguments: request.args }, { timeout: 180000, toolDefinition: catalog.tools.find(t => t.name === request.tool) });
      const data = result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
      if (!/^[a-zA-Z0-9_-]+$/.test(request.save)) throw new Error('Invalid evidence filename');
      await writeFile(resolve(root, 'evidence', request.save + '.json'), JSON.stringify(data, null, 2));
      const normalized = data.normalized_result ?? data;
      const text = JSON.stringify(normalized);
      console.log(JSON.stringify({ tool: request.tool, saved: request.save, isError: result.isError, evidence_id: data.evidence_id, result: text.length < 18000 ? normalized : { keys: Object.keys(normalized), result_bytes: text.length, preview: text.slice(0,12000) } }));
    } catch (error) { console.log(JSON.stringify({ error: error.message })); }
  }
} finally {
  await client.close();
  input.close();
}
