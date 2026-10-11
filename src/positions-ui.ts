import { MAX_CLOSE_BATCH, wadToNumber, type OpenPosition, type PendingOperation } from 'papertrade-sdk';
import type { Hex } from 'viem';
import { loadTrades, openWalletDialog, restartStream, sessionActive, isWatchOnly, trackIntent, enableTrading } from './account.js';
import { confirmDialog } from './dialogs.js';
import { S, instrumentById, on } from './state.js';
import { positionView, tradeNetPnlUsd } from './trade-math.js';
import { $, apiErrorMessage, esc, explorerTx, fmtPct, fmtPrice, fmtSigned, fmtUsd, shortAddr, timeAgo, timeUntil, toast } from './util.js';

const selected = new Set<string>();
let openSignature = '';
let tab: 'open' | 'pending' | 'history' = 'open';

function emptyState(title: string, text: string, action?: { label: string; id: string }): string {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(text)}</p>${action ? `<button class="btn btn-sm" type="button" data-act="${esc(action.id)}">${esc(action.label)}</button>` : ''}</div>`;
}

function skeletonRows(): string {
  return '<div class="pad"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
}

/** Placeholder state shared by every tab when there is no wallet data to show. Returns null when data is available. */
function gate(): string | null {
  if (!S.account) return emptyState('Connect a wallet', 'Your open positions, pending orders and trade history appear here, live.', { label: 'Connect wallet', id: 'connect' });
  if (!S.wallet) {
    if (S.streamStatus === 'reconnecting') return emptyState('Reconnecting to your live account stream', 'The connection dropped. It retries automatically, or retry now.', { label: 'Retry now', id: 'retry' });
    return skeletonRows();
  }
  return null;
}

function pendingCloseIds(): Set<string> {
  const ids = new Set<string>();
  for (const op of S.wallet?.operations ?? []) if (op.action === 'closePositions') op.positionIds.forEach((id) => ids.add(id));
  return ids;
}

function openSig(positions: OpenPosition[]): string {
  return positions.map((p) => p.positionId).join(',') + '|' + [...pendingCloseIds()].join(',') + '|' + (sessionActive() ? 1 : 0) + (isWatchOnly() ? 1 : 0);
}

function renderOpen(): void {
  const host = $('ppane-open');
  const blocked = gate();
  if (blocked) {
    host.innerHTML = blocked;
    openSignature = '';
    updateSelectedButton();
    return;
  }
  const positions = S.wallet?.positions ?? [];
  if (!positions.length) {
    host.innerHTML = emptyState('No open positions', isWatchOnly() ? 'This address has nothing open right now.' : 'Open a long or short from the Trade panel. It shows up here the moment the relayer confirms it.');
    openSignature = '';
    updateSelectedButton();
    return;
  }
  const sig = openSig(positions);
  if (sig !== openSignature) {
    openSignature = sig;
    const closing = pendingCloseIds();
    const live = new Set(positions.map((p) => String(p.positionId)));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);
    const canAct = !isWatchOnly();
    host.innerHTML = `<table class="grid"><thead><tr><th scope="col"><span class="visually-hidden">Select</span></th><th scope="col">Market</th><th scope="col">Size</th><th scope="col">Lev</th><th scope="col">Entry</th><th scope="col">Mark</th><th scope="col">PnL</th><th scope="col">To bust</th><th scope="col">Bust</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${positions
      .map((p) => {
        const inst = instrumentById(p.instrumentId);
        const id = String(p.positionId);
        const isClosing = closing.has(id);
        return `<tr data-id="${esc(id)}"><td class="sel">${canAct ? `<input type="checkbox" data-sel="${esc(id)}" aria-label="Select position ${esc(id)}" ${selected.has(id) ? 'checked' : ''} ${isClosing ? 'disabled' : ''}>` : ''}</td>
          <td class="sym">${esc(inst?.symbol ?? `#${p.instrumentId}`)}<span class="tag ${p.isLong ? 'long' : 'short'}">${p.isLong ? 'LONG' : 'SHORT'}</span></td>
          <td data-label="Size" data-f="size"></td><td data-label="Lev">${p.leverage}x</td><td data-label="Entry" data-f="entry"></td><td data-label="Mark" data-f="mark"></td>
          <td data-label="PnL" data-f="pnl"></td><td data-label="To bust" data-f="dist"></td><td data-label="Bust" data-f="bust"></td>
          <td class="act">${canAct ? (isClosing ? '<span class="status queued">closing</span>' : `<button class="btn btn-sm btn-danger" type="button" data-close="${esc(id)}">Close</button>`) : ''}</td></tr>`;
      })
      .join('')}</tbody></table>`;
  }
  updateOpenCells();
  updateSelectedButton();
}

function updateOpenCells(): void {
  const positions = S.wallet?.positions ?? [];
  for (const p of positions) {
    const row = $('ppane-open').querySelector<HTMLElement>(`tr[data-id="${String(p.positionId)}"]`);
    const inst = instrumentById(p.instrumentId);
    const mark = S.marks[p.instrumentId];
    if (!row || !inst) continue;
    const scale = Number(inst.priceScale);
    const set = (f: string, text: string, cls?: string) => {
      const cell = row.querySelector<HTMLElement>(`[data-f="${f}"]`);
      if (!cell) return;
      if (cell.textContent !== text) cell.textContent = text;
      if (cls !== undefined) cell.className = cls;
    };
    const margin = wadToNumber(p.marginRaw);
    set('size', fmtUsd(margin * p.leverage, 0));
    set('entry', fmtPrice(Number(p.entryPriceRaw) / scale, scale));
    set('bust', fmtPrice(Number(p.bustPriceRaw) / scale, scale));
    if (mark === undefined) {
      set('mark', '...');
      set('pnl', '...');
      set('dist', '...');
      continue;
    }
    const v = positionView(p, inst, mark);
    set('mark', fmtPrice(mark, scale));
    set('pnl', `${fmtSigned(v.unrealizedUsd)} (${fmtPct(v.roe, 1)})`, v.unrealizedUsd >= 0 ? 'pos' : 'neg');
    const initial = Math.abs(Number(p.entryPriceRaw - p.bustPriceRaw)) / Number(p.entryPriceRaw);
    const frac = initial > 0 ? Math.min(1, Math.max(0, v.distance / initial)) : 0;
    const cell = row.querySelector<HTMLElement>('[data-f="dist"]');
    if (cell) {
      cell.replaceChildren(document.createTextNode(fmtPct(Math.max(0, v.distance), 2)));
      const bar = document.createElement('span');
      bar.className = `bar${frac < 0.25 ? ' danger' : frac < 0.5 ? ' warn' : ''}`;
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(frac * 100)}%`;
      bar.append(fill);
      cell.append(bar);
    }
  }
}

function updateSelectedButton(): void {
  const btn = $<HTMLButtonElement>('close-selected');
  btn.hidden = tab !== 'open' || selected.size === 0;
  btn.textContent = `Close selected (${selected.size})`;
}

function describeOp(op: PendingOperation): string {
  switch (op.action) {
    case 'openPosition': {
      const inst = instrumentById(op.instrumentId);
      return `Open ${op.isLong ? 'LONG' : 'SHORT'} ${inst?.symbol ?? `#${op.instrumentId}`} ${op.leverage}x, ${fmtUsd(wadToNumber(op.marginRaw))} margin`;
    }
    case 'closePositions':
      return `Close ${op.positionIds.length} position${op.positionIds.length === 1 ? '' : 's'}`;
    case 'withdrawToCore':
      return `Withdraw ${fmtUsd(wadToNumber(op.marginRaw))}`;
    case 'registerSessionKey':
      return 'Register session key';
    default:
      return op.action;
  }
}

function statusFor(id: Hex): string {
  const t = S.intents.get(id);
  return t ? t.status : 'queued';
}

function renderPending(): void {
  const host = $('ppane-pending');
  const blocked = gate();
  $('count-pending').textContent = String(S.wallet?.operations.length ?? 0);
  if (blocked) {
    host.innerHTML = blocked;
    return;
  }
  const ops = S.wallet?.operations ?? [];
  const recent = [...S.intents.values()].filter((t) => !ops.some((o) => o.intentId.toLowerCase() === t.id.toLowerCase())).sort((a, b) => b.at - a.at).slice(0, 6);
  const rows = ops
    .map((op) => {
      const cancellable = sessionActive() && (op.action === 'openPosition' || op.action === 'closePositions');
      const status = statusFor(op.intentId);
      return `<tr><td class="sym">${esc(describeOp(op))}</td><td data-label="Status"><span class="status ${esc(status)}">${esc(status)}</span></td><td data-label="Accepted">${esc(timeAgo(op.acceptedAtMs))}</td><td data-label="Expires">${esc(timeUntil(Number(op.deadline)))}</td><td class="act">${cancellable ? `<button class="btn btn-sm" type="button" data-cancel="${esc(op.intentId)}">Cancel</button>` : ''}</td></tr>`;
    })
    .join('');
  const recentRows = recent
    .map((t) => `<tr><td class="sym">${esc(t.label)}</td><td data-label="Status"><span class="status ${esc(t.status)}">${esc(t.status)}</span></td><td data-label="Sent">${esc(timeAgo(t.at))}</td><td data-label="Id">${esc(shortAddr(t.id))}</td><td class="act"></td></tr>`)
    .join('');
  if (!ops.length && !recent.length) {
    host.innerHTML = emptyState('Nothing pending', 'Orders you submit wait here until the relayer settles them. You can cancel a queued order while it is still waiting.');
    return;
  }
  host.innerHTML = `<table class="grid"><thead><tr><th scope="col">Intent</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col">Expires</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${rows}${recentRows}</tbody></table>`;
}

function renderHistory(): void {
  const host = $('ppane-history');
  if (!S.account) {
    host.innerHTML = gate() ?? '';
    return;
  }
  if (S.trades === null) {
    host.innerHTML = skeletonRows();
    return;
  }
  if (!S.trades.length) {
    host.innerHTML = S.tradesError
      ? emptyState('Could not load history', S.tradesError, { label: 'Retry', id: 'retry-trades' })
      : emptyState('No closed trades yet', 'Closed and liquidated positions appear here with net PnL and the PAPER you minted on losses.');
    return;
  }
  const rows = S.trades
    .map((t) => {
      const net = tradeNetPnlUsd(t);
      const scale = Number(t.priceScaleRaw);
      const paper = wadToNumber(t.paperMintedRaw);
      return `<tr><td class="sym">${esc(t.symbol)}<span class="tag ${t.isLong ? 'long' : 'short'}">${t.isLong ? 'LONG' : 'SHORT'}</span></td><td data-label="Result">${t.kind === 'Liquidated' ? '<span class="neg">liquidated</span>' : 'closed'}</td><td data-label="Lev">${t.leverage}x</td><td data-label="Margin">${esc(fmtUsd(wadToNumber(t.marginRaw)))}</td><td data-label="Entry">${esc(fmtPrice(Number(t.entryPriceRaw) / scale, scale))}</td><td data-label="Exit">${esc(fmtPrice(Number(t.exitPriceRaw) / scale, scale))}</td><td data-label="Net PnL" class="${net >= 0 ? 'pos' : 'neg'}">${esc(fmtSigned(net))}</td><td data-label="PAPER">${paper > 0 ? esc(paper.toLocaleString('en-US', { maximumFractionDigits: 2 })) : '-'}</td><td data-label="Closed"><a href="${esc(explorerTx(t.txHash))}" target="_blank" rel="noopener noreferrer">${esc(timeAgo(t.timestampMs))}</a></td></tr>`;
    })
    .join('');
  host.innerHTML = `<table class="grid"><thead><tr><th scope="col">Market</th><th scope="col">Result</th><th scope="col">Lev</th><th scope="col">Margin</th><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">Net PnL</th><th scope="col">PAPER minted</th><th scope="col">Closed</th></tr></thead><tbody>${rows}</tbody></table>${
    S.tradesError ? `<p class="validation pad">${esc(S.tradesError)}</p>` : ''
  }${S.tradesCursor ? '<button class="btn btn-sm load-more" type="button" data-act="more-trades">Load more</button>' : ''}`;
}

export function setPositionsTab(next: 'open' | 'pending' | 'history'): void {
  tab = next;
  for (const t of ['open', 'pending', 'history'] as const) {
    const btn = $(`ptab-${t}`);
    btn.setAttribute('aria-selected', String(t === next));
    btn.tabIndex = t === next ? 0 : -1;
    $(`ppane-${t}`).hidden = t !== next;
  }
  updateSelectedButton();
}

async function ensureTradingReady(): Promise<boolean> {
  if (!S.account) {
    openWalletDialog();
    return false;
  }
  if (!sessionActive()) {
    toast('Enable trading first: the session key signs closes.', 'info');
    await enableTrading();
    return false;
  }
  return true;
}

async function closePositions(ids: string[]): Promise<void> {
  if (!(await ensureTradingReady())) return;
  const wanted = (S.wallet?.positions ?? []).filter((p) => ids.includes(String(p.positionId)));
  if (!wanted.length) return;
  let est = 0;
  let allEstimated = true;
  const lines = wanted.map((p) => {
    const inst = instrumentById(p.instrumentId);
    const mark = S.marks[p.instrumentId];
    if (!inst || mark === undefined) {
      allEstimated = false;
      return `<dt>${esc(inst?.symbol ?? '?')} ${p.isLong ? 'long' : 'short'} ${p.leverage}x</dt><dd>no live mark</dd>`;
    }
    const v = positionView(p, inst, mark);
    est += v.closeEstimate.netPnlUsd;
    return `<dt>${esc(inst.symbol)} ${p.isLong ? 'long' : 'short'} ${p.leverage}x, ${esc(fmtUsd(v.marginUsd))}</dt><dd class="${v.closeEstimate.netPnlUsd >= 0 ? 'pos' : 'neg'}">${esc(fmtSigned(v.closeEstimate.netPnlUsd))}</dd>`;
  });
  const batches = Math.ceil(wanted.length / MAX_CLOSE_BATCH);
  const body =
    `<dl class="kv">${lines.join('')}</dl>` +
    (wanted.length > 1 && allEstimated ? `<p class="callout">Estimated total at the current mark: <b>${esc(fmtSigned(est))}</b></p>` : '') +
    `<p class="callout">Closes at the mark when the relayer processes it, so the final fill can differ. Estimates include the deadband, impact haircut and 2% win fee.${batches > 1 ? ` This is sent as ${batches} close intents (at most ${MAX_CLOSE_BATCH} positions each).` : ''}</p>`;
  await confirmDialog({
    title: wanted.length === 1 ? 'Close position' : `Close ${wanted.length} positions`,
    body,
    confirmText: wanted.length === 1 ? 'Close position' : `Close ${wanted.length}`,
    tone: 'danger',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      const trader = S.trader;
      if (!trader) throw new Error('Not ready to trade yet.');
      ctl.setBusy('Signing...');
      const prepared = await trader.prepareClose(wanted.map((p) => p.positionId));
      ctl.setBusy('Submitting...');
      for (const intent of prepared) {
        const submitted = await trader.submit(intent);
        trackIntent(submitted.intentId, intent.summary);
      }
      for (const p of wanted) selected.delete(String(p.positionId));
      toast(`Close ${wanted.length === 1 ? 'order' : 'orders'} queued.`, 'ok');
    },
  });
}

async function cancelIntent(id: Hex): Promise<void> {
  const trader = S.trader;
  if (!trader) return;
  try {
    await trader.cancel(id);
    toast('Cancel request sent.', 'ok');
  } catch (err) {
    toast(apiErrorMessage(err), 'err');
  }
}

function renderAll(): void {
  $('count-open').textContent = String(S.wallet?.positions.length ?? 0);
  renderOpen();
  renderPending();
  renderHistory();
}

export function initPositions(): void {
  const panel = $('sec-positions');
  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const closeId = target.closest<HTMLElement>('[data-close]')?.dataset.close;
    if (closeId) return void closePositions([closeId]);
    const cancelId = target.closest<HTMLElement>('[data-cancel]')?.dataset.cancel;
    if (cancelId) return void cancelIntent(cancelId as Hex);
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') openWalletDialog();
    if (act === 'retry') restartStream();
    if (act === 'retry-trades' || act === 'more-trades') void loadTrades(act === 'more-trades');
  });
  panel.addEventListener('change', (event) => {
    const box = (event.target as HTMLElement).closest<HTMLInputElement>('[data-sel]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.sel ?? '');
    else selected.delete(box.dataset.sel ?? '');
    updateSelectedButton();
  });
  $('close-selected').addEventListener('click', () => void closePositions([...selected]));
  for (const t of ['open', 'pending', 'history'] as const) {
    $(`ptab-${t}`).addEventListener('click', () => setPositionsTab(t));
  }
  $('ptab-open').parentElement?.addEventListener('keydown', (event) => {
    const keys = ['open', 'pending', 'history'] as const;
    const i = keys.indexOf(tab);
    if ((event as KeyboardEvent).key === 'ArrowRight') setPositionsTab(keys[(i + 1) % 3]);
    else if ((event as KeyboardEvent).key === 'ArrowLeft') setPositionsTab(keys[(i + 2) % 3]);
    else return;
    $(`ptab-${tab}`).focus();
  });
  on('wallet', renderAll);
  on('account', renderAll);
  on('session', () => {
    openSignature = '';
    renderOpen();
    renderPending();
  });
  on('intents', renderPending);
  on('trades', renderHistory);
  on('marks', updateOpenCells);
  on('markets', updateOpenCells);
  window.setInterval(renderPending, 15_000);
  renderAll();
}
