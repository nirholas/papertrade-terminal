import { wadToNumber } from 'papertrade-sdk';
import { chainOk, disconnect, ensureChain, initAccount, isWatchOnly, openWalletDialog, watchAddress } from './account.js';
import { initCharts } from './charts-ui.js';
import { confirmDialog, kv } from './dialogs.js';
import { initFund } from './fund-ui.js';
import { loadTrading, startMarkets } from './markets.js';
import { initPositions } from './positions-ui.js';
import { S, on } from './state.js';
import { focusMargin, initTrade, nextMarket, nudgeLeverage, setSide } from './trade-ui.js';
import { $, apiErrorMessage, esc, fmtUsd, qsa, shortAddr, toast } from './util.js';
import { formatUnits } from 'viem';
import { parseLink } from './deeplink.js';

type SideTab = 'trade' | 'fund' | 'swap';
type View = 'chart' | 'side' | 'positions';

let swapReady = false;

function setSideTab(next: SideTab): void {
  document.body.dataset.side = next;
  for (const btn of qsa<HTMLButtonElement>('[data-stab]')) {
    const active = btn.dataset.stab === next;
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    $(`spane-${btn.dataset.stab}`).hidden = !active;
  }
  if (next === 'swap' && !swapReady) {
    swapReady = true;
    void import('./swap-ui.js').then((m) => m.initSwap());
  }
}

function setView(view: View): void {
  document.body.dataset.view = view;
  for (const btn of qsa<HTMLButtonElement>('[data-nav]')) {
    const nav = btn.dataset.nav;
    const active = nav === view || (view === 'side' && nav === document.body.dataset.side);
    btn.setAttribute('aria-current', String(active));
  }
}

function navigate(target: string): void {
  if (target === 'chart') return setView('chart');
  if (target === 'positions') return setView('positions');
  setSideTab(target as SideTab);
  setView('side');
}

function renderStream(): void {
  const dot = $('stream-status');
  const kind = S.account ? (isWatchOnly() && S.streamStatus === 'idle' ? 'idle' : S.streamStatus) : 'idle';
  dot.dataset.kind = kind;
  const text = ({ idle: 'Account stream idle', connecting: 'Connecting to the account stream', live: 'Account stream live', reconnecting: 'Account stream reconnecting', stopped: 'Account stream stopped' } as Record<string, string>)[kind];
  dot.title = text;
  dot.querySelector('.visually-hidden')!.textContent = text;
}

function renderHeader(): void {
  renderStream();
  const btn = $<HTMLButtonElement>('wallet-btn');
  const bal = $('pt-balance');
  if (!S.account) {
    btn.textContent = 'Connect wallet';
    btn.classList.add('btn-primary');
    bal.hidden = true;
  } else {
    btn.textContent = isWatchOnly() ? `Watching ${shortAddr(S.account.address)}` : shortAddr(S.account.address);
    btn.classList.remove('btn-primary');
    bal.hidden = false;
    $('pt-available').textContent = S.wallet ? fmtUsd(wadToNumber(S.wallet.funds.availableBalance)) : '-';
  }
}

function renderBanner(): void {
  const el = $('banner');
  el.replaceChildren();
  const add = (kind: string, text: string, action?: { label: string; run: () => void }) => {
    el.hidden = false;
    el.dataset.kind = kind;
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = action.label;
      b.addEventListener('click', action.run);
      el.append(b);
    }
  };
  el.hidden = true;
  if (S.tradingError && !S.trading) {
    add('err', `Could not load Papertrade markets: ${S.tradingError}`, { label: 'Retry', run: () => void loadTrading() });
  } else if (S.account && !isWatchOnly() && !chainOk()) {
    add('warn', `Your wallet is on chain ${S.chainId ?? 'unknown'}. Papertrade runs on HyperEVM (chain 999).`, {
      label: 'Switch to HyperEVM',
      run: () => void ensureChain().catch((err) => toast(apiErrorMessage(err), 'err')),
    });
  }
}

function openAccountMenu(): void {
  const a = S.account;
  if (!a) return openWalletDialog();
  const body = kv([
    ['Address', esc(a.address)],
    ['Wallet', esc(a.name)],
    ['USDC (HyperEVM)', S.balances.usdc === null ? '-' : esc(formatUnits(S.balances.usdc, 6))],
    ['HYPE (HyperEVM)', S.balances.hype === null ? '-' : esc(Number(formatUnits(S.balances.hype, 18)).toFixed(4))],
    ['Papertrade balance', S.wallet ? fmtUsd(wadToNumber(S.wallet.balance)) : '-'],
    ['Available', S.wallet ? fmtUsd(wadToNumber(S.wallet.funds.availableBalance)) : '-'],
  ]);
  void confirmDialog({
    title: isWatchOnly() ? 'Watching address' : 'Wallet',
    body,
    confirmText: 'Disconnect',
    tone: 'danger',
    describeError: apiErrorMessage,
    run: async () => {
      disconnect();
    },
  });
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function onKey(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (typing(event.target)) {
    if (event.key === 'Escape') (event.target as HTMLElement).blur();
    return;
  }
  const key = event.key;
  if (key === 'b' || key === 'B') setSide('long');
  else if (key === 's' || key === 'S') setSide('short');
  else if (key === '/') {
    event.preventDefault();
    navigate('trade');
    focusMargin();
  } else if (key === 'm' || key === 'M') nextMarket();
  else if (key === '[') nudgeLeverage(event.shiftKey ? -10 : -1);
  else if (key === ']') nudgeLeverage(event.shiftKey ? 10 : 1);
  else if (key === '1') navigate('trade');
  else if (key === '2') navigate('positions');
  else if (key === '3') navigate('fund');
  else if (key === '4') navigate('swap');
  else if (key === 'c' || key === 'C') navigate('chart');
  else if (key === '?') $<HTMLDialogElement>('dlg-help').showModal();
  else return;
  if (key !== '/') event.preventDefault();
}

function initTabs(): void {
  const tabs = qsa<HTMLButtonElement>('[data-stab]');
  for (const btn of tabs) {
    btn.addEventListener('click', () => setSideTab(btn.dataset.stab as SideTab));
    btn.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(tabs.indexOf(btn) + step + tabs.length) % tabs.length];
      next.focus();
      setSideTab(next.dataset.stab as SideTab);
    });
  }
  for (const btn of qsa<HTMLButtonElement>('[data-nav]')) btn.addEventListener('click', () => navigate(btn.dataset.nav as string));
  setSideTab('trade');
  setView('chart');
}

function boot(): void {
  if (parseLink(location.search).embed) document.body.dataset.embed = '1';
  initAccount();
  initTrade();
  initPositions();
  initFund();
  initCharts();
  initTabs();
  startMarkets();

  $('wallet-btn').addEventListener('click', openAccountMenu);
  $('help-btn').addEventListener('click', () => $<HTMLDialogElement>('dlg-help').showModal());
  $('watch-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $<HTMLInputElement>('watch-addr');
    const msg = $('wallet-msg');
    if (watchAddress(input.value.trim())) {
      msg.hidden = true;
      $<HTMLDialogElement>('dlg-wallet').close();
      input.value = '';
    } else {
      msg.hidden = false;
      msg.textContent = 'That is not a valid 0x address.';
    }
  });
  for (const dlg of qsa<HTMLDialogElement>('dialog')) {
    dlg.addEventListener('click', (event) => {
      if (event.target === dlg && dlg.id !== 'dlg-confirm') dlg.close();
    });
  }
  document.addEventListener('keydown', onKey);

  for (const topic of ['account', 'wallet', 'balances', 'chain', 'markets'] as const) {
    on(topic, () => {
      renderHeader();
      renderBanner();
    });
  }
  renderHeader();
  renderBanner();
}

boot();
