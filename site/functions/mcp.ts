/** MCP endpoint: Streamable HTTP, stateless, read-only. Plumbing lives in _lib/mcp.ts, tools in _lib/tools.ts. */
import { createRateLimiter, handleMcp } from './_lib/mcp';
import { createContext, serverDef } from './_lib/tools';

interface Env {
  PAPERTRADE_API_URL?: string;
}

const limiter = createRateLimiter(60, 60_000);

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  return handleMcp(request, {
    server: serverDef(origin),
    ctx: createContext({ baseUrl: env.PAPERTRADE_API_URL, origin }),
    limiter,
    clientKey: request.headers.get('cf-connecting-ip') ?? 'anonymous',
  });
};
