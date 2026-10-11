/**
 * Stateless MCP server core (Streamable HTTP, JSON-RPC 2.0) with no platform dependencies,
 * so the same code runs in a Pages Function and under vitest with real Request/Response objects.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 */

export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const DEFAULT_PROTOCOL = '2025-06-18';
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_BATCH = 20;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchema;
  maxItems?: number;
  default?: Json;
  examples?: Json[];
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolOutput {
  /** Human readable summary shown to the model. */
  text: string;
  structured: { [key: string]: Json };
}

export interface ToolDef<Ctx> {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: 'object' };
  outputSchema: JsonSchema & { type: 'object' };
  annotations: ToolAnnotations;
  run(args: Record<string, unknown>, ctx: Ctx): Promise<ToolOutput>;
}

export interface McpServerDef<Ctx> {
  name: string;
  title: string;
  version: string;
  description: string;
  instructions: string;
  tools: ToolDef<Ctx>[];
  /** Links shown on a plain GET. */
  links: Record<string, string>;
}

/** Thrown by a tool for an expected failure (bad market, upstream down). Becomes `isError: true`. */
export class ToolError extends Error {}

export const RPC = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  rateLimited: -32029,
} as const;

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result: Json } | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: Json } };

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After',
  'access-control-max-age': '86400',
  vary: 'Origin',
};

function rpcError(id: string | number | null, code: number, message: string, data?: Json): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** Minimal JSON Schema check: enough for the tool input schemas we publish. Returns a message or null. */
export function validateAgainst(schema: JsonSchema, value: unknown, path = 'arguments'): string | null {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object`;
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (obj[key] === undefined) return `${path}.${key} is required`;
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const child = props[key];
      if (!child) {
        if (schema.additionalProperties === false) return `${path}.${key} is not a known parameter`;
        continue;
      }
      const err = validateAgainst(child, v, `${path}.${key}`);
      if (err) return err;
    }
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path} must be a string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is too long`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} has the wrong format`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`;
    return null;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number`;
    if (schema.type === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `${path} must be greater than ${schema.exclusiveMinimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
    return null;
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? null : `${path} must be a boolean`;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has too many items`;
    for (const [i, item] of value.entries()) {
      const err = schema.items ? validateAgainst(schema.items, item, `${path}[${i}]`) : null;
      if (err) return err;
    }
  }
  return null;
}

export function toolListing<Ctx>(tool: ToolDef<Ctx>) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  };
}

function ok(id: string | number | null, result: Json): RpcResponse {
  return { jsonrpc: '2.0', id, result };
}

async function dispatch<Ctx>(server: McpServerDef<Ctx>, ctx: Ctx, req: RpcRequest): Promise<RpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  const params = (typeof req.params === 'object' && req.params !== null ? req.params : {}) as Record<string, unknown>;

  switch (req.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(asked) ? asked : DEFAULT_PROTOCOL;
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, title: server.title, version: server.version },
        instructions: server.instructions,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: server.tools.map(toolListing) as unknown as Json });
    case 'resources/list':
      return ok(id, { resources: [] });
    case 'resources/templates/list':
      return ok(id, { resourceTemplates: [] });
    case 'prompts/list':
      return ok(id, { prompts: [] });
    case 'tools/call': {
      const name = params.name;
      if (typeof name !== 'string') return rpcError(id, RPC.invalidParams, 'tools/call needs a string "name"');
      const tool = server.tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, RPC.invalidParams, `Unknown tool: ${name}`);
      const args = params.arguments === undefined ? {} : params.arguments;
      const problem = validateAgainst(tool.inputSchema, args);
      if (problem) return rpcError(id, RPC.invalidParams, problem);
      try {
        const out = await tool.run(args as Record<string, unknown>, ctx);
        return ok(id, { content: [{ type: 'text', text: out.text }], structuredContent: out.structured });
      } catch (err) {
        if (err instanceof ToolError) return ok(id, { isError: true, content: [{ type: 'text', text: err.message }] });
        return ok(id, { isError: true, content: [{ type: 'text', text: 'The tool failed unexpectedly. Try again shortly.' }] });
      }
    }
    default:
      if (isNotification || req.method.startsWith('notifications/')) return null;
      return rpcError(id, RPC.methodNotFound, `Method not found: ${req.method}`);
  }
}

function isRequestObject(value: unknown): value is RpcRequest {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as RpcRequest).jsonrpc === '2.0' && typeof (value as RpcRequest).method === 'string';
}

function isClientResponse(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === '2.0' && v.method === undefined && ('result' in v || 'error' in v);
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS, ...extra } });
}

function wantsSseOnly(accept: string): boolean {
  const a = accept.toLowerCase();
  return a.includes('text/event-stream') && !a.includes('application/json') && !a.includes('*/*');
}

export interface RateLimiter {
  /** Returns the number of seconds to wait, or 0 when the call is allowed. */
  check(key: string, now?: number): number;
}

/** Sliding window limiter held in isolate memory. Best effort per isolate, which is the right weight for a read-only API. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return 0;
    },
  };
}

export interface HandleOptions<Ctx> {
  server: McpServerDef<Ctx>;
  ctx: Ctx;
  limiter?: RateLimiter;
  /** Stable key for rate limiting, usually the caller IP. */
  clientKey?: string;
}

export async function handleMcp<Ctx>(request: Request, opts: HandleOptions<Ctx>): Promise<Response> {
  const { server, ctx } = opts;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  if (method === 'GET') {
    if ((request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream')) {
      return new Response('This server does not offer a standalone SSE stream. POST JSON-RPC to this URL.', { status: 405, headers: { allow: 'POST, OPTIONS', 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS } });
    }
    return json(200, {
      name: server.name,
      title: server.title,
      version: server.version,
      description: server.description,
      transport: 'streamable-http',
      protocolVersions: SUPPORTED_PROTOCOLS,
      method: 'POST',
      authentication: 'none',
      readOnly: true,
      tools: server.tools.map((t) => ({ name: t.name, title: t.title, description: t.description })),
      links: server.links,
    });
  }

  if (method !== 'POST') {
    return new Response('Method not allowed. POST JSON-RPC 2.0 to this URL.', { status: 405, headers: { allow: 'POST, GET, OPTIONS', 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS } });
  }

  if (opts.limiter && opts.clientKey) {
    const wait = opts.limiter.check(opts.clientKey);
    if (wait > 0) return json(429, rpcError(null, RPC.rateLimited, `Rate limit reached. Retry in ${wait}s.`), { 'retry-after': String(wait) });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, rpcError(null, RPC.invalidRequest, 'Request body is too large.'));
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return json(413, rpcError(null, RPC.invalidRequest, 'Request body is too large.'));

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, RPC.parse, 'Parse error: the body is not valid JSON.'));
  }

  const batch = Array.isArray(body);
  const items = batch ? (body as unknown[]) : [body];
  if (batch && items.length === 0) return json(400, rpcError(null, RPC.invalidRequest, 'Invalid Request: empty batch.'));
  if (items.length > MAX_BATCH) return json(400, rpcError(null, RPC.invalidRequest, `Invalid Request: batches are limited to ${MAX_BATCH} calls.`));

  const responses: RpcResponse[] = [];
  for (const item of items) {
    if (isClientResponse(item)) continue;
    if (!isRequestObject(item)) {
      responses.push(rpcError(null, RPC.invalidRequest, 'Invalid Request: expected a JSON-RPC 2.0 request object.'));
      continue;
    }
    try {
      const res = await dispatch(server, ctx, item);
      if (res && item.id !== undefined) responses.push(res);
    } catch (err) {
      if (item.id !== undefined) responses.push(rpcError(item.id, RPC.internal, `Internal error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`));
    }
  }

  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });

  const payload = batch ? responses : responses[0];
  const accept = request.headers.get('accept') ?? '';
  if (wantsSseOnly(accept)) {
    const events = (batch ? responses : [responses[0]]).map((r) => `event: message\ndata: ${JSON.stringify(r)}\n\n`).join('');
    return new Response(events, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...CORS_HEADERS } });
  }
  return json(200, payload);
}
