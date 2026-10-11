import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH, ToolError, createRateLimiter, handleMcp, validateAgainst, type JsonSchema, type McpServerDef } from '../site/functions/_lib/mcp.js';

const server: McpServerDef<{ n: number }> = {
  name: 'demo',
  title: 'Demo',
  version: '1.2.3',
  description: 'demo server',
  instructions: 'be nice',
  links: { docs: 'https://example.test/docs/' },
  tools: [
    {
      name: 'add',
      title: 'Add',
      description: 'Adds a and b.',
      inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number', minimum: 0 } }, required: ['a', 'b'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { sum: { type: 'number' } }, required: ['sum'] },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(args, ctx) {
        return { text: `sum ${Number(args.a) + Number(args.b) + ctx.n}`, structured: { sum: Number(args.a) + Number(args.b) + ctx.n } };
      },
    },
    {
      name: 'fail',
      title: 'Fail',
      description: 'Always fails.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run() {
        throw new ToolError('upstream is down');
      },
    },
    {
      name: 'boom',
      title: 'Boom',
      description: 'Throws an unexpected error.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run() {
        throw new TypeError('secret internals');
      },
    },
  ],
};

const call = (body: unknown, init: RequestInit = {}, opts: Partial<Parameters<typeof handleMcp>[1]> = {}) =>
  handleMcp(new Request('https://example.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(init.headers as Record<string, string>) }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init }), { server, ctx: { n: 0 }, ...opts } as never);

describe('mcp protocol', () => {
  it('initializes and echoes a supported protocol version', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-03-26');
    expect(body.result.capabilities.tools).toEqual({ listChanged: false });
    expect(body.result.serverInfo).toMatchObject({ name: 'demo', title: 'Demo', version: '1.2.3' });
    expect(body.result.instructions).toBe('be nice');
  });

  it('falls back to the default protocol for an unknown version', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('answers notifications with 202 and no body', async () => {
    const res = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('answers ping and empty resource and prompt lists', async () => {
    const out = await (await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'resources/list' }, { jsonrpc: '2.0', id: 3, method: 'prompts/list' }])).json();
    expect(out).toHaveLength(3);
    expect(out[0].result).toEqual({});
    expect(out[1].result.resources).toEqual([]);
    expect(out[2].result.prompts).toEqual([]);
  });

  it('lists tools with full metadata', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    const add = body.result.tools.find((t: { name: string }) => t.name === 'add');
    expect(add).toMatchObject({ title: 'Add', annotations: { readOnlyHint: true } });
    expect(add.inputSchema.type).toBe('object');
    expect(add.outputSchema.type).toBe('object');
  });

  it('calls a tool and returns text plus structuredContent', async () => {
    const body = await (await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'add', arguments: { a: 1, b: 2 } } }, {}, { ctx: { n: 10 } })).json();
    expect(body.id).toBe(9);
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0]).toEqual({ type: 'text', text: 'sum 13' });
    expect(body.result.structuredContent).toEqual({ sum: 13 });
  });

  it('reports tool failures with isError and hides unexpected internals', async () => {
    const known = await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fail', arguments: {} } })).json();
    expect(known.result.isError).toBe(true);
    expect(known.result.content[0].text).toContain('upstream is down');
    const unknown = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boom', arguments: {} } })).json();
    expect(unknown.result.isError).toBe(true);
    expect(unknown.result.content[0].text).not.toContain('secret internals');
  });

  it('uses standard JSON-RPC error codes', async () => {
    expect((await (await call('{not json')).json()).error.code).toBe(-32700);
    expect((await (await call([])).json()).error.code).toBe(-32600);
    expect((await (await call({ jsonrpc: '2.0', id: 1, method: 'nope' })).json()).error.code).toBe(-32601);
    expect((await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ghost', arguments: {} } })).json()).error.code).toBe(-32602);
    expect((await (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add', arguments: { a: 'x', b: -1 } } })).json()).error.code).toBe(-32602);
  });

  it('rejects oversized batches and bodies', async () => {
    const batch = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }));
    expect((await (await call(batch)).json()).error.code).toBe(-32600);
    const big = await call('x'.repeat(70 * 1024));
    expect(big.status).toBe(413);
  });

  it('streams a single SSE message when only event-stream is accepted', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { accept: 'text/event-stream' } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toMatch(/^event: message\ndata: /);
    expect(JSON.parse(text.split('data: ')[1]).id).toBe(1);
  });

  it('handles GET, DELETE and preflight per the transport spec', async () => {
    const sse = await handleMcp(new Request('https://example.test/mcp', { headers: { accept: 'text/event-stream' } }), { server, ctx: { n: 0 } });
    expect(sse.status).toBe(405);
    expect(sse.headers.get('allow')).toContain('POST');
    const info = await handleMcp(new Request('https://example.test/mcp'), { server, ctx: { n: 0 } });
    expect(info.status).toBe(200);
    const doc = await info.json();
    expect(doc).toMatchObject({ name: 'demo', transport: 'streamable-http', readOnly: true });
    expect(doc.links.docs).toBe('https://example.test/docs/');
    const del = await handleMcp(new Request('https://example.test/mcp', { method: 'DELETE' }), { server, ctx: { n: 0 } });
    expect(del.status).toBe(405);
    const pre = await handleMcp(new Request('https://example.test/mcp', { method: 'OPTIONS' }), { server, ctx: { n: 0 } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Mcp-Session-Id/i);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('ignores client responses sent to the server', async () => {
    const res = await call({ jsonrpc: '2.0', id: 1, result: {} });
    expect(res.status).toBe(202);
  });

  it('rate limits per client with Retry-After', async () => {
    const limiter = createRateLimiter(2, 60_000);
    const send = () => call({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { limiter, clientKey: 'ip-1' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, {}, { limiter, clientKey: 'ip-2' });
    expect(other.status).toBe(200);
  });
});

describe('validateAgainst', () => {
  const schema: JsonSchema = { type: 'object', properties: { s: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer', minimum: 1, maximum: 5 }, p: { type: 'string', pattern: '^0x[0-9a-f]{2}$' } }, required: ['s'], additionalProperties: false };
  it('accepts valid input', () => expect(validateAgainst(schema, { s: 'a', n: 3, p: '0xab' })).toBeNull());
  it('flags missing, extra, enum, range, type and pattern problems', () => {
    expect(validateAgainst(schema, {})).toMatch(/s/);
    expect(validateAgainst(schema, { s: 'a', z: 1 })).toMatch(/z/);
    expect(validateAgainst(schema, { s: 'c' })).toMatch(/s/);
    expect(validateAgainst(schema, { s: 'a', n: 9 })).toMatch(/n/);
    expect(validateAgainst(schema, { s: 'a', n: 1.5 })).toMatch(/n/);
    expect(validateAgainst(schema, { s: 'a', p: 'nope' })).toMatch(/p/);
  });
});

import { createContext, serverDef, TOOLS, tradeLink } from '../site/functions/_lib/tools.js';

const recorded = readFileSync(new URL('./fixtures/trading-state.json', import.meta.url), 'utf8');
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/state/trading') return new Response(recorded, { headers: { 'content-type': 'application/json' } });
  if (/\/price-history$/.test(url.pathname)) {
    const base = Date.now() - 6000;
    return new Response(JSON.stringify({ baseTimeMs: base, timeOffsetsMs: [0, 1000, 2000], gapIndices: [], columns: { price: [100_000, 100_010, 100_020] } }), { headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ code: 'not_found', message: 'nope' }), { status: 404, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const rpc = async (name: string, args: Record<string, unknown>) => {
  const def = serverDef('https://t.test');
  const res = await handleMcp(new Request('https://t.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }), { server: def, ctx: createContext({ origin: 'https://t.test', baseUrl: 'https://recorded.invalid', fetchImpl: fakeFetch }) });
  return res.json();
};

describe('papertrade tools', () => {
  it('registers 4 to 10 read-only tools with complete metadata', () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(4);
    expect(TOOLS.length).toBeLessThanOrEqual(10);
    for (const t of TOOLS) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
      expect(t.title && t.description && t.outputSchema.type === 'object' && t.inputSchema.type === 'object').toBeTruthy();
      expect(`${t.description}${t.title}`).not.toMatch(/[–—]/);
    }
  });

  it('lists live markets from the recorded trading state', async () => {
    const body = await rpc('list_markets', {});
    expect(body.result.isError).toBeFalsy();
    const btc = body.result.structuredContent.markets.find((m: { symbol: string }) => m.symbol === 'BTC');
    expect(btc.maxLeverage).toBeGreaterThan(1);
    expect(btc.markPrice).toBe(100_020);
  });

  it('quotes an open with bust on the right side and a six-step ladder', async () => {
    const body = await rpc('quote_open_position', { market: 'btc', side: 'long', marginUsd: 100, leverage: 50 });
    const q = body.result.structuredContent;
    expect(q.entryPrice).toBe(100_020);
    expect(q.bustPrice).toBeLessThan(q.entryPrice);
    expect(q.notionalUsd).toBe(5000);
    expect(q.ladder).toHaveLength(6);
  });

  it('rejects unknown markets as a tool error that lists live ones', async () => {
    const body = await rpc('quote_open_position', { market: 'DOGE9', side: 'long', marginUsd: 100, leverage: 5 });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('BTC');
  });

  it('quotes a leverage ladder whose bust distance shrinks as leverage grows', async () => {
    const body = await rpc('quote_leverage_ladder', { market: 'BTC', side: 'long', marginUsd: 100 });
    const steps = body.result.structuredContent.steps as Array<{ leverage: number; bustDistancePct: number }>;
    expect(steps.length).toBeGreaterThan(3);
    for (let i = 1; i < steps.length; i++) expect(steps[i].bustDistancePct).toBeLessThan(steps[i - 1].bustDistancePct);
  });

  it('quotes a close that forfeits the margin past the bust price', async () => {
    const body = await rpc('quote_close_position', { market: 'BTC', side: 'long', entryPrice: 100000, exitPrice: 50000, marginUsd: 100, leverage: 100 });
    expect(body.result.structuredContent.liquidated).toBe(true);
  });

  it('builds an unsigned plan with a prefill deep link and the risk line', async () => {
    const body = await rpc('build_trade_plan', { market: 'BTC', side: 'short', marginUsd: 50, leverage: 10 });
    const p = body.result.structuredContent;
    expect(p.unsigned).toBe(true);
    expect(p.link).toBe('https://t.test/?market=BTC&side=short&margin=50&leverage=10');
    expect(p.warnings.join(' ')).toMatch(/not financial advice/i);
    expect(body.result.content[0].text).toMatch(/nothing was signed/i);
  });

  it('builds deep links the app can parse', () => {
    const u = new URL(tradeLink('https://t.test/', { market: 'eth', side: 'long', marginUsd: 25.5, leverage: 3 }));
    expect(u.searchParams.get('market')).toBe('ETH');
    expect(u.searchParams.get('margin')).toBe('25.5');
  });

  it('rejects malformed wallet addresses at the schema boundary', async () => {
    const def = serverDef('https://t.test');
    const res = await handleMcp(new Request('https://t.test/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_wallet_positions', arguments: { address: 'bob' } } }) }), { server: def, ctx: createContext({ fetchImpl: fakeFetch }) });
    expect((await res.json()).error.code).toBe(-32602);
  });
});
