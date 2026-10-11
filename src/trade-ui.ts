import { PapertradeTrader, priceToRaw, wadToNumber } from 'papertrade-sdk';
import { zeroAddress } from 'viem';
import { clearSession, currentSessionStatus, enableTrading, ensureChain, openWalletDialog, sessionExpiryText, sessionActive, isWatchOnly, chainOk, trackIntent } from './account.js';
import { confirmDialog, kv } from './dialogs.js';
import { S, currentInstrument, currentMark, emit, instruments, on } from './state.js';
import { previewOpen, type Side } from './trade-math.js';
import { $, apiErrorMessage, esc, fmtPct, fmtPrice, fmtSigned, fmtUsd, shortAddr, store, timeUntil, toast } from './util.js';

const PREFS_KEY = 'papertrade-terminal.prefs.v1';
const validator = new PapertradeTrader({ user: zeroAddress });
const MARGIN_QUICK = [10, 50, 100, 500, 1000];
const LEVERAGE_QUICK = [1, 5, 10, 25, 100, 250, 500, 1000];

interface Prefs {
  market?: number;
  side?: Side;
  leverage?: number;
  margin?: string;
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(store.get(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

function savePrefs(): void {
  store.set(PREFS_KEY, JSON.stringify({ market: S.marketId, side: S.side, leverage: leverage(), margin: $<HTMLInputElement>('margin').value } satisfies Prefs));
}

const marginEl = () => $<HTMLInputElement>('margin');
const levNum = () => $<HTMLInputElement>('lev-num');
const levRange = () => $<HTMLInputElement>('lev-range');

function leverage(): number {
  return Number(levNum().value);
}

function marginValue(): number | null {
  const text = marginEl().value.trim().replace(/,/g, '');
  if (!text || !/^\d*\.?\d*$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function availableUsd(): number | null {
  return S.wallet ? wadToNumber(S.wallet.funds.availableBalance) : null;
}

export function selectMarket(id: number): void {
  if (S.marketId === id) return;
  S.marketId = id;
  syncLeverageBounds();
  emit('market-select');
  render();
  savePrefs();
}

export function nextMarket(): void {
  const list = instruments();
  if (list.length < 2) return;
  const i = list.findIndex((m) => m.id === S.marketId);
  selectMarket(list[(i + 1) % list.length].id);
}

export function setSide(side: Side): void {
  S.side = side;
  $('side-long').setAttribute('aria-pressed', String(side === 'long'));
  $('side-short').setAttribute('aria-pressed', String(side === 'short'));
  emit('side');
  render();
  savePrefs();
}

export function focusMargin(): void {
  const el = marginEl();
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus();
  el.select();
}

export function nudgeLeverage(delta: number): void {
  setLeverage(leverage() + delta);
}

function setLeverage(value: number): void {
  const max = currentInstrument()?.maxLeverage ?? 1000;
  const v = Math.min(max, Math.max(1, Math.round(value)));
  levNum().value = String(v);
  levRange().value = String(v);
  render();
  savePrefs();
}

function syncLeverageBounds(): void {
  const max = currentInstrument()?.maxLeverage ?? 1000;
  levRange().max = String(max);
  if (leverage() > max) setLeverage(max);
  const quick = $('lev-quick');
  quick.replaceChildren(
    ...LEVERAGE_QUICK.filter((l) => l <= max).map((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${l}x`;
      b.addEventListener('click', () => setLeverage(l));
      return b;
    }),
  );
}

function renderMarketButtons(): void {
  const seg = $('market-seg');
  seg.replaceChildren(
    ...instruments().map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.textContent = `${i.symbol}-PERP`;
      b.setAttribute('aria-pressed', String(i.id === S.marketId));
      b.addEventListener('click', () => selectMarket(i.id));
      return b;
    }),
  );
}

export function renderTickers(): void {
  const host = $('tickers');
  const list = instruments();
  host.replaceChildren(
    ...list.map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ticker';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(i.id === S.marketId));
      const mark = S.marks[i.id];
      const chg = S.dayChange[i.symbol];
      b.innerHTML = `<b>${esc(i.symbol)}</b><span class="num">${mark === undefined ? '...' : esc(fmtPrice(mark, Number(i.priceScale)))}</span>${
        chg === undefined ? '' : `<span class="chg num ${chg >= 0 ? 'pos' : 'neg'}">${esc(fmtPct(chg, 2))}</span>`
      }`;
      b.addEventListener('click', () => selectMarket(i.id));
      return b;
    }),
  );
}

function renderQuickMargin(): void {
  const avail = availableUsd();
  const quick = $('margin-quick');
  const buttons = MARGIN_QUICK.map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `$${v}`;
    b.addEventListener('click', () => {
      marginEl().value = String(v);
      render();
      savePrefs();
    });
    return b;
  });
  if (avail !== null && avail >= 10) {
    const max = document.createElement('button');
    max.type = 'button';
    max.textContent = 'Max';
    max.addEventListener('click', () => {
      marginEl().value = (Math.floor(avail * 100) / 100).toFixed(2);
      render();
      savePrefs();
    });
    buttons.push(max);
  }
  quick.replaceChildren(...buttons);
}

function renderSessionCard(): void {
  const card = $('session-card');
  const acct = S.account;
  if (!acct) {
    card.innerHTML = '<h3>Non-custodial trading</h3><p class="muted">Connect a wallet to trade. Your keys stay in your wallet. A limited session key signs orders, and it can never withdraw.</p><div class="row-actions"><button class="btn btn-primary btn-sm" type="button" data-act="connect">Connect wallet</button></div>';
  } else if (isWatchOnly()) {
    card.innerHTML = `<h3>Watching ${esc(shortAddr(acct.address))}</h3><p class="muted">Read-only view. Connect a wallet to place orders.</p><div class="row-actions"><button class="btn btn-sm" type="button" data-act="connect">Connect wallet</button></div>`;
  } else {
    const status = currentSessionStatus();
    const key = S.session;
    const clear = '<button class="btn btn-sm btn-danger" type="button" data-act="clear" title="Remove the session key from this browser. It can no longer trade, and it can never withdraw.">Clear key</button>';
    if (status === 'active' && key) {
      card.innerHTML = `<h3>Session key active</h3><p class="muted small">Key ${esc(shortAddr(key.account.address))} expires in ${esc(timeUntil(Number(key.expiry)))} (${esc(sessionExpiryText(key))}). It can trade but <b>cannot withdraw</b>.</p><div class="row-actions">${clear}</div>`;
    } else if (status === 'pending' && key) {
      card.innerHTML = `<h3>Waiting for the relayer</h3><p class="muted small">Key ${esc(shortAddr(key.account.address))} was submitted. Trading unlocks when the relayer lists it.</p><div class="row-actions"><button class="btn btn-sm" type="button" data-act="enable">Register again</button>${clear}</div>`;
    } else if (status === 'expired') {
      card.innerHTML = `<h3>Session key expired</h3><p class="muted small">Sign one message in your wallet to register a fresh key. No gas needed.</p><div class="row-actions"><button class="btn btn-primary btn-sm" type="button" data-act="enable">Re-register key</button>${clear}</div>`;
    } else {
      card.innerHTML = '<h3>Enable trading</h3><p class="muted small">Sign one message in your wallet (no gas) to authorise a browser session key for 30 days. It can trade but <b>cannot withdraw</b>.</p><div class="row-actions"><button class="btn btn-primary btn-sm" type="button" data-act="enable">Enable trading</button></div>';
    }
  }
  const chip = $<HTMLButtonElement>('session-chip');
  if (!acct || isWatchOnly()) {
    chip.hidden = true;
  } else {
    const status = currentSessionStatus();
    chip.hidden = false;
    chip.dataset.state = status;
    chip.innerHTML = `<i></i>${status === 'active' && S.session ? `Session ${esc(timeUntil(Number(S.session.expiry)))}` : status === 'pending' ? 'Session pending' : status === 'expired' ? 'Session expired' : 'No session'}`;
    chip.title = 'Session key status';
  }
}

interface Check {
  ok: boolean;
  message: string | null;
}

function validate(): Check {
  const inst = currentInstrument();
  const trading = S.trading;
  if (!inst || !trading) return { ok: false, message: S.tradingError ?? 'Loading markets...' };
  const margin = marginValue();
  if (margin === null) return { ok: false, message: null };
  const lev = leverage();
  const mark = currentMark();
  try {
    validator.validateOpen({ market: inst.id, side: S.side, marginUsd: margin, leverage: lev, markPriceRaw: mark === null ? undefined : priceToRaw(mark, inst.priceScale) }, trading);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  const avail = availableUsd();
  if (avail !== null && margin > avail) return { ok: false, message: `Margin is above your available Papertrade balance (${fmtUsd(avail)}). Deposit from the Fund tab.` };
  return { ok: true, message: null };
}

function renderPretrade(): void {
  const host = $('pretrade');
  const inst = currentInstrument();
  const mark = currentMark();
  const margin = marginValue();
  const lev = leverage();
  if (!inst || mark === null) {
    host.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    return;
  }
  if (margin === null || !Number.isFinite(lev) || lev < 1) {
    host.innerHTML = '<p class="muted small">Enter a margin to see notional, bust price and what a close pays at different prices.</p>';
    return;
  }
  const p = previewOpen({ instrument: inst, side: S.side, marginUsd: margin, leverage: lev, markPrice: mark });
  const scale = Number(inst.priceScale);
  const minMargin = S.trading ? wadToNumber(S.trading.minimumOpenNotionalRaw) / lev : 10;
  const hint = p.notionalUsd < (S.trading ? wadToNumber(S.trading.minimumOpenNotionalRaw) : 10000) ? `<p class="muted small">At ${lev}x the minimum margin is ${esc(fmtUsd(Math.max(minMargin, 10)))}.</p>` : '';
  const rows = p.scenarios
    .map((s) => {
      const label = s.estimate.liquidated ? 'Liquidated' : fmtSigned(s.estimate.netPnlUsd);
      const cls = s.estimate.liquidated || s.estimate.netPnlUsd < 0 ? 'neg' : s.estimate.netPnlUsd > 0 ? 'pos' : '';
      return `<tr><td>${esc(fmtPct(s.move, 3))}</td><td>${esc(fmtPrice(s.exitPrice, scale))}</td><td class="${cls}">${esc(label)}</td></tr>`;
    })
    .join('');
  host.innerHTML = `<dl>
      <dt>Notional</dt><dd>${esc(fmtUsd(p.notionalUsd))}</dd>
      <dt>Entry (mark)</dt><dd>${esc(fmtPrice(p.entryPrice, scale))}</dd>
      <dt>Bust price</dt><dd class="neg">${esc(fmtPrice(p.bustPrice, scale))} (${esc(fmtPct(p.bustDistance, 3))})</dd>
    </dl>${hint}
    <table class="scen"><caption>If you close at a ${S.side === 'long' ? 'higher or lower' : 'lower or higher'} price</caption><thead class="visually-hidden"><tr><th>Price change</th><th>Exit price</th><th>Net result</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Wins pay after the deadband, impact haircut and 2% fee. Losses are 1:1. Crossing the bust price loses the margin.</p>`;
}

function renderReview(check: Check): void {
  const btn = $<HTMLButtonElement>('review-btn');
  const inst = currentInstrument();
  btn.classList.remove('btn-long', 'btn-short', 'btn-primary');
  btn.classList.add(S.side === 'long' ? 'btn-long' : 'btn-short');
  btn.dataset.mode = 'review';
  if (!S.account) {
    btn.disabled = false;
    btn.textContent = 'Connect a wallet to trade';
    btn.dataset.mode = 'connect';
    btn.classList.remove('btn-long', 'btn-short');
    btn.classList.add('btn-primary');
  } else if (isWatchOnly()) {
    btn.disabled = true;
    btn.textContent = 'Read-only: connect a wallet';
  } else if (!chainOk()) {
    btn.disabled = false;
    btn.textContent = 'Switch to HyperEVM';
    btn.dataset.mode = 'chain';
    btn.classList.remove('btn-long', 'btn-short');
    btn.classList.add('btn-primary');
  } else if (!sessionActive()) {
    btn.disabled = currentSessionStatus() === 'pending';
    btn.textContent = currentSessionStatus() === 'pending' ? 'Waiting for session key...' : currentSessionStatus() === 'expired' ? 'Re-register session key' : 'Enable trading';
    btn.dataset.mode = 'enable';
    btn.classList.remove('btn-long', 'btn-short');
    btn.classList.add('btn-primary');
  } else {
    btn.disabled = !check.ok;
    btn.textContent = `Review ${S.side} ${inst?.symbol ?? ''}`.trim();
  }
  const msg = $('validation');
  msg.hidden = !check.message;
  msg.textContent = check.message ?? '';
}

export function render(): void {
  const inst = currentInstrument();
  const mark = currentMark();
  $('mid').textContent = inst && mark !== undefined && mark !== null ? fmtPrice(mark, Number(inst.priceScale)) : '-';
  const avail = availableUsd();
  $('avail').textContent = avail === null ? '-' : fmtUsd(avail);
  const margin = marginEl().closest('.input-row');
  const check = validate();
  margin?.classList.toggle('err', Boolean(check.message) && marginValue() !== null);
  renderPretrade();
  renderReview(check);
}

async function review(): Promise<void> {
  const inst = currentInstrument();
  const mark = currentMark();
  const margin = marginValue();
  if (!inst || mark === null || margin === null) return;
  const lev = leverage();
  const side = S.side;
  const p = previewOpen({ instrument: inst, side, marginUsd: margin, leverage: lev, markPrice: mark });
  const scale = Number(inst.priceScale);
  const body =
    kv([
      ['Market', `${esc(inst.symbol)}-PERP`],
      ['Side', `<b class="${side === 'long' ? 'pos' : 'neg'}">${side.toUpperCase()}</b>`],
      ['Margin', esc(fmtUsd(margin))],
      ['Leverage', `${lev}x`],
      ['Notional', esc(fmtUsd(p.notionalUsd))],
      ['Entry (mark now)', esc(fmtPrice(p.entryPrice, scale))],
      ['Bust price', `<span class="neg">${esc(fmtPrice(p.bustPrice, scale))}</span>`],
    ]) +
    `<p class="callout danger">At ${lev}x a ${esc(fmtPct(p.bustDistance, 3))} move against you liquidates the position and you lose the full ${esc(fmtUsd(margin))} margin.</p>` +
    '<p class="callout">Signed locally by your session key and sent through the relayer. The fill happens at the mark when the relayer processes it.</p>';
  await confirmDialog({
    title: `Confirm ${side} ${inst.symbol}`,
    body,
    confirmText: `${side === 'long' ? 'Long' : 'Short'} ${inst.symbol} ${lev}x`,
    tone: side === 'long' ? 'long' : 'short',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      const trader = S.trader;
      if (!trader || !S.trading) throw new Error('Not ready to trade yet.');
      ctl.setBusy('Signing...');
      const prepared = await trader.prepareOpen({ market: inst.id, side, marginUsd: margin, leverage: lev, markPriceRaw: priceToRaw(mark, inst.priceScale) }, S.trading);
      ctl.setBusy('Submitting...');
      const submitted = await trader.submit(prepared);
      trackIntent(submitted.intentId, prepared.summary);
      toast(`Order queued: ${prepared.summary}`, 'ok');
    },
  });
}

export function initTrade(): void {
  const prefs = loadPrefs();
  if (typeof prefs.market === 'number') S.marketId = prefs.market;
  if (prefs.side === 'short') S.side = 'short';
  if (prefs.margin) marginEl().value = prefs.margin;
  const lev = prefs.leverage && prefs.leverage > 0 ? prefs.leverage : 100;
  levNum().value = String(lev);
  levRange().value = String(lev);
  $('side-long').setAttribute('aria-pressed', String(S.side === 'long'));
  $('side-short').setAttribute('aria-pressed', String(S.side === 'short'));

  $('side-long').addEventListener('click', () => setSide('long'));
  $('side-short').addEventListener('click', () => setSide('short'));
  marginEl().addEventListener('input', () => {
    render();
    savePrefs();
  });
  levRange().addEventListener('input', () => setLeverage(Number(levRange().value)));
  levNum().addEventListener('input', () => {
    const v = Number(levNum().value);
    if (Number.isFinite(v) && v >= 1) {
      levRange().value = String(Math.min(v, Number(levRange().max)));
      render();
      savePrefs();
    }
  });
  levNum().addEventListener('change', () => setLeverage(leverage() || 1));

  $('session-card').addEventListener('click', (event) => {
    const act = (event.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') openWalletDialog();
    if (act === 'enable') void enableTrading();
    if (act === 'clear') clearSession();
  });
  $('session-chip').addEventListener('click', () => {
    document.body.dataset.view = 'side';
    $('session-card').scrollIntoView({ block: 'center' });
  });

  $('order-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = $('review-btn').dataset.mode;
    if (mode === 'connect') return openWalletDialog();
    if (mode === 'enable') return void enableTrading();
    if (mode === 'chain') {
      try {
        await ensureChain();
      } catch (err) {
        toast(apiErrorMessage(err), 'err');
      }
      return;
    }
    if (validate().ok) await review();
  });

  on('markets', () => {
    syncLeverageBounds();
    renderMarketButtons();
    renderTickers();
    render();
  });
  on('marks', () => {
    renderTickers();
    render();
  });
  on('market-select', () => {
    renderMarketButtons();
    renderTickers();
  });
  on('wallet', () => {
    renderQuickMargin();
    renderSessionCard();
    render();
  });
  on('account', () => {
    renderSessionCard();
    renderQuickMargin();
    render();
  });
  on('session', () => {
    renderSessionCard();
    render();
  });
  on('chain', render);
  syncLeverageBounds();
  renderMarketButtons();
  renderQuickMargin();
  renderSessionCard();
  renderTickers();
  render();
}
