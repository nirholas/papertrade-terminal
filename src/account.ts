import { createSessionKey, isSessionKeyActive, PapertradeTrader, streamWallet, type SessionKey, type WalletState, wadToNumber } from 'papertrade-sdk';
import { getAddress, isAddress, type Address, type EIP1193Provider, type Hex } from 'viem';
import { publicClient, usdcBalance } from 'papertrade-sdk';
import { confirmDialog, kv } from './dialogs.js';
import { S, emit, instrumentById, type Account, type IntentStatus } from './state.js';
import { clearSessionKey, loadSessionKey, saveSessionKey, sessionStatus, type SessionStatus } from './session-store.js';
import { addLegacyProvider, ensureHyperEvm, existingAccounts, listWallets, onWalletsChanged, readChainId, requestAccounts, startDiscovery, typedDataSigner, walletClientFor, type DiscoveredWallet } from './wallet.js';
import { $, apiErrorMessage, errMessage, esc, fmtSigned, shortAddr, store, toast } from './util.js';

const LAST_WALLET_KEY = 'papertrade-terminal.wallet.v1';
const sessionStore = { getItem: (k: string) => store.get(k), setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => store.remove(k) };

let stopStream: (() => void) | null = null;
let detach: (() => void) | null = null;
const rpc = publicClient();

export function restartStream(): void {
  if (S.account) startStream(S.account.address);
}

export function chainOk(): boolean {
  return S.chainId === 999;
}

export function isWatchOnly(): boolean {
  return S.account !== null && S.account.provider === null;
}

export function currentSessionStatus(): SessionStatus {
  return sessionStatus(S.session, S.wallet?.sessionKeys);
}

/** Rebuild the SDK trader for the current account, wallet signer and session key. */
export function rebuildTrader(): void {
  const acct = S.account;
  if (!acct) {
    S.trader = null;
    return;
  }
  S.trader = new PapertradeTrader({
    user: acct.address,
    wallet: acct.walletClient ? typedDataSigner(acct.walletClient, acct.address) : undefined,
    session: S.session ?? undefined,
    client: S.client,
    nonceStorage: { getItem: (k) => store.get(k), setItem: (k, v) => void store.set(k, v) },
  });
}

export async function ensureChain(): Promise<void> {
  const provider = S.account?.provider;
  if (!provider) throw new Error('Connect a wallet first.');
  await ensureHyperEvm(provider);
  S.chainId = await readChainId(provider);
  emit('chain');
}

export async function refreshBalances(): Promise<void> {
  const addr = S.account?.address;
  if (!addr) return;
  try {
    const [usdc, hype] = await Promise.all([usdcBalance(addr, rpc), rpc.getBalance({ address: addr })]);
    if (S.account?.address !== addr) return;
    S.balances = { usdc, hype };
  } catch {
    if (S.account?.address === addr) S.balances = { usdc: null, hype: null };
  }
  emit('balances');
}

export async function loadTrades(more = false): Promise<void> {
  const addr = S.account?.address;
  if (!addr) return;
  try {
    const page = await S.client.accountTrades(addr, more && S.tradesCursor ? { cursor: S.tradesCursor } : {});
    if (S.account?.address !== addr) return;
    S.trades = more && S.trades ? [...S.trades, ...page.items] : page.items;
    S.tradesCursor = page.nextCursor;
    S.tradesError = null;
  } catch (err) {
    S.tradesError = apiErrorMessage(err);
    if (!more) S.trades = S.trades ?? [];
  }
  emit('trades');
}

export function trackIntent(id: Hex, label: string): void {
  S.intents.set(id, { id, label, status: 'submitted', at: Date.now() });
  emit('intents');
}

function updateIntents(state: WalletState): void {
  const queued = new Set(state.operations.map((o) => o.intentId.toLowerCase()));
  const openedBy = new Set(state.positions.map((p) => p.intentId?.toLowerCase()).filter(Boolean));
  let changed = false;
  for (const t of S.intents.values()) {
    if (t.status === 'confirmed' || t.status === 'failed') continue;
    const id = t.id.toLowerCase();
    const outcome = state.intentOutcomes.find((o) => o.intentId.toLowerCase() === id)?.outcome;
    let next: IntentStatus = t.status;
    if (outcome) next = outcome === 'succeeded' ? 'confirmed' : 'failed';
    else if (queued.has(id)) next = 'queued';
    else if (openedBy.has(id) || t.status === 'queued') next = 'confirmed';
    if (next !== t.status) {
      t.status = next;
      changed = true;
      if (next === 'confirmed') toast(`Confirmed: ${t.label}`, 'ok');
      if (next === 'failed') toast(`Failed (${outcome ?? 'rejected'}): ${t.label}`, 'err');
    }
  }
  if (changed) emit('intents');
}

function onWalletState(state: WalletState, kind: 'snapshot' | 'update'): void {
  S.wallet = state;
  updateIntents(state);
  if (kind === 'update' && state.closedPositions.length) {
    for (const c of state.closedPositions) {
      const symbol = instrumentById(c.instrumentId)?.symbol ?? `#${c.instrumentId}`;
      const pnl = wadToNumber(c.netPnlRaw);
      toast(`${c.liquidated ? 'Liquidated' : 'Closed'} ${c.isLong ? 'long' : 'short'} ${symbol}: ${fmtSigned(pnl)}`, c.liquidated || pnl < 0 ? 'err' : 'ok');
    }
    void loadTrades();
    void refreshBalances();
  }
  emit('wallet');
  emit('session');
}

function startStream(address: Address): void {
  stopStream?.();
  S.streamStatus = 'connecting';
  S.wallet = null;
  emit('wallet');
  stopStream = streamWallet({
    wallet: address,
    baseUrl: '/api/papertrade',
    onState: onWalletState,
    onStatus: (status) => {
      S.streamStatus = status;
      emit('wallet');
    },
  });
}

function setAccount(acct: Account): void {
  detach?.();
  detach = null;
  S.account = acct;
  S.session = loadSessionKey(sessionStore, acct.address);
  S.trades = null;
  S.tradesCursor = null;
  S.balances = { usdc: null, hype: null };
  S.intents.clear();
  rebuildTrader();
  startStream(acct.address);
  emit('account');
  emit('session');
  emit('intents');
  void refreshBalances();
  void loadTrades();
}

function listen(provider: EIP1193Provider): void {
  const onAccounts = (accounts: unknown) => {
    const first = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
    if (!first || !isAddress(first)) return disconnect();
    if (S.account && first.toLowerCase() !== S.account.address.toLowerCase()) {
      const name = S.account.name;
      setAccount({ address: getAddress(first), name, provider, walletClient: walletClientFor(provider, getAddress(first)) });
    }
  };
  const onChain = (chainId: unknown) => {
    S.chainId = Number(chainId);
    emit('chain');
    void refreshBalances();
  };
  provider.on?.('accountsChanged', onAccounts as never);
  provider.on?.('chainChanged', onChain as never);
  detach = () => {
    provider.removeListener?.('accountsChanged', onAccounts as never);
    provider.removeListener?.('chainChanged', onChain as never);
  };
}

export async function connect(wallet: DiscoveredWallet, opts: { silent?: boolean } = {}): Promise<boolean> {
  const accounts = opts.silent ? await existingAccounts(wallet.provider) : await requestAccounts(wallet.provider);
  const first = accounts[0];
  if (!first || !isAddress(first)) return false;
  const address = getAddress(first);
  S.chainId = await readChainId(wallet.provider);
  setAccount({ address, name: wallet.name, provider: wallet.provider, walletClient: walletClientFor(wallet.provider, address) });
  listen(wallet.provider);
  store.set(LAST_WALLET_KEY, wallet.id);
  emit('chain');
  if (!opts.silent && !chainOk()) {
    try {
      await ensureChain();
    } catch {
      /* the wrong-network banner stays up and offers the switch again */
    }
  }
  return true;
}

export function watchAddress(input: string): boolean {
  const value = input.trim();
  if (!isAddress(value)) return false;
  detach?.();
  detach = null;
  S.chainId = null;
  store.remove(LAST_WALLET_KEY);
  setAccount({ address: getAddress(value), name: 'Watching', provider: null, walletClient: null });
  emit('chain');
  return true;
}

export function disconnect(): void {
  stopStream?.();
  stopStream = null;
  detach?.();
  detach = null;
  store.remove(LAST_WALLET_KEY);
  S.account = null;
  S.wallet = null;
  S.session = null;
  S.trader = null;
  S.chainId = null;
  S.streamStatus = 'idle';
  S.trades = null;
  S.balances = { usdc: null, hype: null };
  S.intents.clear();
  emit('account');
  emit('wallet');
  emit('session');
  emit('balances');
  emit('trades');
  emit('chain');
  emit('intents');
}

// Wallet dialog

function walletMessage(text: string | null): void {
  const el = $('wallet-msg');
  el.hidden = !text;
  el.textContent = text ?? '';
}

function renderWalletList(): void {
  const host = $('wallet-list');
  host.replaceChildren();
  const wallets = listWallets();
  if (!wallets.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>No browser wallet detected</strong><p>Install a HyperEVM-compatible wallet such as MetaMask, Rabby or Phantom, then reload. You can still watch any address read-only below.</p>';
    host.append(empty);
    return;
  }
  for (const w of wallets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wallet-opt';
    if (w.icon.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.src = w.icon;
      img.alt = '';
      img.width = 28;
      img.height = 28;
      btn.append(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'ph';
      ph.textContent = w.name.slice(0, 1).toUpperCase();
      btn.append(ph);
    }
    const label = document.createElement('span');
    label.textContent = w.name;
    btn.append(label);
    btn.addEventListener('click', async () => {
      walletMessage(null);
      btn.disabled = true;
      try {
        if (await connect(w)) $<HTMLDialogElement>('dlg-wallet').close();
        else walletMessage('The wallet returned no account. Unlock it and try again.');
      } catch (err) {
        walletMessage(errMessage(err));
      } finally {
        btn.disabled = false;
      }
    });
    host.append(btn);
  }
}

export function openWalletDialog(): void {
  walletMessage(null);
  renderWalletList();
  $<HTMLDialogElement>('dlg-wallet').showModal();
}

// Session key

export function sessionExpiryText(key: SessionKey): string {
  return new Date(Number(key.expiry) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export async function enableTrading(): Promise<void> {
  const acct = S.account;
  if (!acct?.walletClient) {
    toast('Connect a wallet to enable trading.', 'info');
    return;
  }
  const key = createSessionKey();
  const body =
    kv([
      ['Trading account', esc(shortAddr(acct.address))],
      ['New session key', esc(shortAddr(key.account.address))],
      ['Valid until', esc(sessionExpiryText(key))],
    ]) +
    '<p class="callout">Your wallet signs one RegisterSessionKey message (no transaction, no gas). After that this browser signs trades itself, with no wallet popup for each order.</p>' +
    '<p class="callout warn">The session key can open and close positions but <b>cannot withdraw</b>. It is stored only in this browser and you can clear it at any time.</p>';
  await confirmDialog({
    title: 'Enable trading',
    body,
    confirmText: 'Sign in wallet',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      const trader = S.trader;
      if (!trader) throw new Error('Connect a wallet first.');
      await ensureChain();
      ctl.setBusy('Waiting for your wallet...');
      const { prepared } = await trader.prepareRegisterSession(key);
      ctl.setBusy('Registering...');
      const submitted = await trader.submit(prepared);
      saveSessionKey(sessionStore, acct.address, key);
      S.session = key;
      trader.useSession(key);
      trackIntent(submitted.intentId, 'Session key registration');
      emit('session');
      toast('Session key submitted. Trading unlocks as soon as the relayer confirms it.', 'ok');
    },
  });
}

export function clearSession(): void {
  const acct = S.account;
  if (!acct) return;
  clearSessionKey(sessionStore, acct.address);
  S.session = null;
  rebuildTrader();
  emit('session');
  toast('Session key removed from this browser.', 'info');
}

export function sessionActive(): boolean {
  return Boolean(S.session && S.wallet && isSessionKeyActive(S.wallet.sessionKeys, S.session.account.address));
}

// Boot

export function initAccount(): void {
  startDiscovery();
  window.setTimeout(addLegacyProvider, 500);
  onWalletsChanged(() => {
    if ($<HTMLDialogElement>('dlg-wallet').open) renderWalletList();
  });
  window.setInterval(() => {
    emit('session');
    void refreshBalances();
  }, 30_000);

  const watch = new URLSearchParams(location.search).get('watch');
  if (watch && watchAddress(watch)) return;

  const last = store.get(LAST_WALLET_KEY);
  if (!last) return;
  const tryRestore = async () => {
    const w = listWallets().find((x) => x.id === last);
    if (!w || S.account) return;
    try {
      await connect(w, { silent: true });
    } catch {
      /* the wallet is locked or unavailable: the user can reconnect manually */
    }
  };
  onWalletsChanged(() => void tryRestore());
  window.setTimeout(() => void tryRestore(), 600);
}

