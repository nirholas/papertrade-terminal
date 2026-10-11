/** Landing page behavior. Live data comes from this site's own read-only MCP endpoint (dogfooding /mcp). */
const $ = (id) => document.getElementById(id);
let rpcId = 0;

async function tool(name, args = {}) {
  const res = await fetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (res.status === 429) throw new Error('Rate limited. Retrying shortly.');
  if (!res.ok) throw new Error(`The API answered ${res.status}.`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  if (body.result.isError) throw new Error(body.result.content?.[0]?.text ?? 'The tool failed.');
  return body.result.structuredContent;
}

const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compact = (n) => `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
const price = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : n < 100 ? 4 : 2 });

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(kind, text) {
  $('status-dot').dataset.kind = kind;
  $('status-text').textContent = text;
}

function renderMarkets(data) {
  const grid = $('markets');
  const state = $('markets-state');
  grid.replaceChildren();
  state.hidden = true;
  if (!data.markets.length) {
    grid.hidden = true;
    state.hidden = false;
    state.replaceChildren(el('p', null, 'Papertrade has no live markets right now.'), el('p', 'muted small', 'Trading may be paused. The terminal will show markets as soon as they return.'));
    return;
  }
  grid.hidden = false;
  for (const m of data.markets) {
    const a = el('a', 'market');
    a.href = `/app/?market=${encodeURIComponent(m.symbol)}`;
    a.setAttribute('aria-label', `Open ${m.symbol} in the terminal`);
    const head = el('div', 'market-head');
    head.append(el('b', null, `${m.symbol}-PERP`), el('span', m.openable ? 'tag' : 'tag tag-off', m.openable ? `up to ${m.maxLeverage}x` : m.closeOnly ? 'close only' : 'paused'));
    a.append(head, el('div', 'market-price', m.markPrice === null ? 'No mark' : price(m.markPrice)));
    const oi = (m.longOpenInterestUsd ?? 0) + (m.shortOpenInterestUsd ?? 0);
    a.append(el('div', 'muted small', m.longOpenInterestUsd === null ? 'Open interest unavailable' : `Open interest ${compact(oi)}`));
    grid.append(a);
  }
  $('markets-meta').textContent = `${data.markets.length} markets, marks refresh every 30s`;
}

function renderError(target, message, retry) {
  const state = $('markets-state');
  $('markets').hidden = true;
  state.hidden = false;
  const btn = el('button', 'btn btn-sm', 'Retry');
  btn.type = 'button';
  btn.addEventListener('click', retry);
  state.replaceChildren(el('p', null, `Could not load live markets. ${message}`), btn);
}

function renderTicket(plan) {
  const q = plan.quote;
  const body = $('ticket-body');
  const rows = [
    ['Order', `${q.side.toUpperCase()} ${q.market} ${q.leverage}x`],
    ['Margin', usd(q.marginUsd)],
    ['Notional', usd(q.notionalUsd)],
    ['Entry (mark)', price(q.entryPrice)],
    ['Bust price', price(q.bustPrice)],
    ['Room to liquidation', `${q.bustDistancePct}%`],
  ];
  const dl = el('dl');
  for (const [k, v] of rows) dl.append(el('dt', null, k), el('dd', k === 'Bust price' ? 'neg' : null, v));
  const worst = q.ladder[0];
  const best = q.ladder[q.ladder.length - 1];
  body.replaceChildren(dl, el('p', 'muted small', `Close outcomes across the ladder: ${usd(worst.netPnlUsd)} to ${usd(best.netPnlUsd)} after fees. Unsigned: nothing is placed until you sign in your wallet.`));
  const link = $('ticket-link');
  link.href = `/app/${new URL(plan.link).search}`;
  link.hidden = false;
}

async function load() {
  try {
    const [markets, status] = await Promise.all([tool('list_markets'), tool('get_protocol_status')]);
    renderMarkets(markets);
    setStatus(status.relayerOk && !status.tradingPaused ? 'ok' : 'warn', status.tradingPaused ? 'Trading paused on Papertrade' : status.relayerOk ? 'Papertrade live' : 'Relayer not ready');
  } catch (err) {
    renderError('markets', err.message, load);
    setStatus('err', 'Papertrade unreachable');
  }
}

async function loadTicket() {
  try {
    renderTicket(await tool('build_trade_plan', { market: 'BTC', side: 'long', marginUsd: 1000, leverage: 10 }));
  } catch (err) {
    $('ticket-body').replaceChildren(el('p', 'muted', `Live quote unavailable. ${err.message}`));
  }
}

function initTabs() {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.querySelector(`[data-pane="${t.dataset.tab}"]`).hidden = !on;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  }
}

function initCopy() {
  for (const btn of document.querySelectorAll('.copy')) {
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(btn.parentElement.querySelector('code'));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        btn.textContent = 'Press Ctrl+C';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1800);
    });
  }
}

function initTheme() {
  $('theme-btn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = (root.dataset.theme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('papertrade-terminal.theme', root.dataset.theme);
    } catch {
      /* storage blocked: the choice lasts for this page view */
    }
  });
}

initTabs();
initCopy();
initTheme();
void load();
void loadTicket();
setInterval(() => {
  if (!document.hidden) void load();
}, 30_000);
