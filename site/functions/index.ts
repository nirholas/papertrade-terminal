/**
 * "/" serves the landing page. A link that carries a trade prefill or embed flag
 * (the MCP build_trade_plan deep link, or the Papertrade OS window) goes straight to the terminal.
 */
const APP_KEYS = ['market', 'side', 'margin', 'leverage', 'embed'];

export const onRequestGet: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (APP_KEYS.some((k) => url.searchParams.has(k))) {
    return new Response(null, { status: 302, headers: { location: `/app/${url.search}`, 'cache-control': 'no-store' } });
  }
  return next();
};
