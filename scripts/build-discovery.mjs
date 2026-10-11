/**
 * Generates the agent discovery files from the live MCP tool registry so they can never drift from /mcp:
 * server card (SEP-1649), mcp.json alias, A2A agent card (+ legacy agent.json), RFC 9727 api-catalog, OpenAPI 3.1.
 * Files land in site/public (committed, and rebuilt by `npm run build:site`).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const ORIGIN = 'https://papertrade-terminal.pages.dev';
const REPO = 'https://github.com/nirholas/papertrade-terminal';
const outDir = new URL('../site/public/', import.meta.url).pathname;

async function loadRegistry() {
  const dir = await mkdtemp(join(tmpdir(), 'pt-discovery-'));
  const file = join(dir, 'tools.mjs');
  try {
    await build({ entryPoints: ['site/functions/_lib/tools.ts'], outfile: file, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent', banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const listing = (t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations });

export function buildServerCard(def) {
  return {
    serverInfo: { name: def.name, title: def.title, version: def.version },
    description: def.description,
    documentationUrl: `${ORIGIN}/docs/`,
    repository: { url: REPO, source: 'github' },
    license: 'Apache-2.0',
    transport: { type: 'streamable-http', endpoint: `${ORIGIN}/mcp` },
    protocolVersions: ['2025-06-18', '2025-03-26', '2024-11-05'],
    capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
    authentication: { required: false },
    readOnly: true,
    instructions: def.instructions,
    tools: def.tools.map(listing),
  };
}

export function buildAgentCard(def) {
  return {
    protocolVersion: '0.3.0',
    name: def.title,
    description: def.description,
    url: `${ORIGIN}/mcp`,
    preferredTransport: 'JSONRPC',
    version: def.version,
    iconUrl: `${ORIGIN}/favicon.svg`,
    documentationUrl: `${ORIGIN}/docs/`,
    provider: { organization: 'nirholas (unofficial community project, not affiliated with Papertrade)', url: REPO },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    securitySchemes: {},
    security: [],
    skills: def.tools.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ['papertrade', 'hyperliquid', 'hyperevm', 'perps', t.annotations.readOnlyHint ? 'read-only' : 'write'],
      inputModes: ['application/json'],
      outputModes: ['application/json', 'text/plain'],
    })),
    additionalInterfaces: [{ url: `${ORIGIN}/mcp`, transport: 'MCP-streamable-http' }],
  };
}

export function buildApiCatalog() {
  return {
    linkset: [
      {
        anchor: `${ORIGIN}/mcp`,
        'service-desc': [{ href: `${ORIGIN}/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1' }],
        'service-doc': [{ href: `${ORIGIN}/docs/`, type: 'text/html' }],
        describedby: [{ href: `${ORIGIN}/.well-known/mcp/server-card.json`, type: 'application/json' }],
      },
      {
        anchor: `${ORIGIN}/api/papertrade`,
        'service-desc': [{ href: `${ORIGIN}/openapi.json`, type: 'application/vnd.oai.openapi+json;version=3.1' }],
        'service-doc': [{ href: `${ORIGIN}/docs/reference/`, type: 'text/html' }],
      },
      {
        anchor: `${ORIGIN}/`,
        'service-doc': [{ href: `${ORIGIN}/llms.txt`, type: 'text/plain' }, { href: `${ORIGIN}/llms-full.txt`, type: 'text/plain' }],
        describedby: [{ href: `${ORIGIN}/.well-known/agent-card.json`, type: 'application/json' }],
      },
    ],
  };
}

const rpcEnvelope = (method, params) => ({ type: 'object', properties: { jsonrpc: { const: '2.0' }, id: { oneOf: [{ type: 'string' }, { type: 'integer' }] }, method: { const: method }, params }, required: ['jsonrpc', 'method'] });

export function buildOpenApi(def) {
  const jsonRes = (description) => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
  const toolNames = def.tools.map((t) => t.name);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Papertrade Terminal API',
      version: def.version,
      summary: 'Read-only MCP endpoint and the public Papertrade read proxy.',
      description: `${def.description} Unofficial, not affiliated with Papertrade. High leverage can lose the whole margin. Nothing here signs, sends funds or places orders.`,
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
      contact: { name: 'nirholas', url: REPO },
    },
    servers: [{ url: ORIGIN }],
    externalDocs: { description: 'Documentation', url: `${ORIGIN}/docs/` },
    tags: [{ name: 'MCP', description: 'Model Context Protocol, Streamable HTTP, stateless.' }, { name: 'Papertrade', description: 'Same-origin proxy of the public Papertrade API (GET reads only are documented here).' }],
    paths: {
      '/mcp': {
        post: {
          tags: ['MCP'],
          operationId: 'mcpRpc',
          summary: 'JSON-RPC 2.0 over Streamable HTTP',
          description: `Methods: initialize, ping, tools/list, tools/call, resources/list, prompts/list. A JSON array is processed as a batch (max 20). Send Accept: text/event-stream only to receive a single SSE message. Tools: ${toolNames.join(', ')}. Rate limit 60 requests per minute per IP, body limit 64 KB.`,
          requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [rpcEnvelope('tools/call', { type: 'object', properties: { name: { enum: toolNames }, arguments: { type: 'object' } }, required: ['name'] }), { type: 'array', items: { type: 'object' } }] }, examples: { toolsList: { summary: 'List tools', value: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }, quote: { summary: 'Quote a position', value: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'quote_open_position', arguments: { market: 'BTC', side: 'long', marginUsd: 50, leverage: 10 } } } } } } } },
          responses: { 200: jsonRes('JSON-RPC response (or SSE message when only text/event-stream is accepted).'), 202: { description: 'Notification or client response accepted, no body.' }, 400: jsonRes('Parse error or invalid request.'), 413: jsonRes('Body too large.'), 429: jsonRes('Rate limited. Retry-After says when.') },
        },
        get: { tags: ['MCP'], operationId: 'mcpInfo', summary: 'Describe the server', description: 'Plain GET returns server info and links. GET with Accept: text/event-stream returns 405 because there is no standalone stream.', responses: { 200: jsonRes('Server description.'), 405: { description: 'SSE stream not offered. Allow: POST.' } } },
        delete: { tags: ['MCP'], operationId: 'mcpDelete', summary: 'Not supported (stateless)', responses: { 405: { description: 'No sessions to terminate.' } } },
      },
      '/api/papertrade/state/trading': { get: { tags: ['Papertrade'], operationId: 'tradingState', summary: 'Instruments, open interest, caps and accepted intent actions', responses: { 200: jsonRes('Compact trading state (arrays, decode with papertrade-sdk).') } } },
      '/api/papertrade/query/protocol/trades/recent': { get: { tags: ['Papertrade'], operationId: 'recentTrades', summary: 'Recent opens, closes and liquidations', responses: { 200: jsonRes('Recent events.') } } },
      '/api/papertrade/query/notices': { get: { tags: ['Papertrade'], operationId: 'notices', summary: 'Operator notices (untrusted text)', responses: { 200: jsonRes('Notices.') } } },
      '/api/papertrade/relayer/health': { get: { tags: ['Papertrade'], operationId: 'relayerHealth', summary: 'Relayer health', responses: { 200: jsonRes('Health.') } } },
      '/api/papertrade/query/markets/{id}/price-history': {
        get: { tags: ['Papertrade'], operationId: 'priceHistory', summary: 'One price-history tile (use papertrade-sdk to plan tiles)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, { name: 'fromMs', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'toMs', in: 'query', required: true, schema: { type: 'integer' } }, { name: 'intervalMs', in: 'query', required: true, schema: { type: 'integer', enum: [125, 1000, 60000] } }], responses: { 200: jsonRes('Columnar tile.') } },
      },
    },
    components: { schemas: Object.fromEntries(def.tools.map((t) => [`${t.name}_input`, t.inputSchema])) },
  };
}

async function writeJson(path, value) {
  const full = join(outDir, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main() {
  const { serverDef } = await loadRegistry();
  const def = serverDef(ORIGIN);
  const card = buildServerCard(def);
  const agent = buildAgentCard(def);
  await writeJson('.well-known/mcp/server-card.json', card);
  await writeJson('.well-known/mcp.json', card);
  await writeJson('.well-known/agent-card.json', agent);
  await writeJson('.well-known/agent.json', agent);
  await writeJson('.well-known/api-catalog', buildApiCatalog());
  await writeJson('openapi.json', buildOpenApi(def));
  console.log(`discovery: wrote ${def.tools.length}-tool server card, agent card, api-catalog and openapi.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
