import { ERC20_ABI, formatUnits, hyperEvm, parseUnits, publicClient } from 'papertrade-sdk';
import { encodeFunctionData, type Address } from 'viem';
import { ensureChain, isWatchOnly, openWalletDialog, refreshBalances } from './account.js';
import { confirmDialog, kv } from './dialogs.js';
import { GAS_RESERVE_WEI, HYPE_TOKEN, USDC_TOKEN, buildSwap, fetchQuote, minReceived, priceImpact, shortVenue, type SwapQuote, type SwapToken } from './swap.js';
import { S, on } from './state.js';
import { $, apiErrorMessage, debounce, errMessage, esc, explorerTx, fmtNum, fmtUsd, toast } from './util.js';

const rpc = publicClient();
const SLIPPAGE_KEY = 'pt.slippageBps';
const SLIPPAGES = [10, 50, 100];

let from: SwapToken = HYPE_TOKEN;
let to: SwapToken = USDC_TOKEN;
let slippageBps = 50;
let quote: SwapQuote | null = null;
let quoteState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let quoteError = '';
let controller: AbortController | null = null;
let allowance: bigint | null = null;
let mounted = false;

const fmtToken = (raw: bigint, t: SwapToken, digits = 6) => fmtNum(Number(formatUnits(raw, t.decimals)), digits);

function balanceOf(t: SwapToken): bigint | null {
  return t.native ? S.balances.hype : S.balances.usdc;
}

function amountIn(): bigint | null {
  const text = ($('s-amt') as HTMLInputElement).value.trim().replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  try {
    const v = parseUnits(text, from.decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

function layout(): void {
  $('swap-root').innerHTML = `
    <section class="sub" aria-labelledby="swap-h">
      <h3 id="swap-h">Swap on HyperEVM</h3>
      <p class="muted small">Get HYPE for gas or USDC to deposit. Routed across HyperEVM DEXs by KyberSwap. Your wallet signs the swap.</p>
      <div class="field"><label for="s-amt">You pay</label>
        <div class="input-row"><input id="s-amt" inputmode="decimal" placeholder="0.0" autocomplete="off" spellcheck="false"><span class="suffix" id="s-from">HYPE</span></div>
        <div class="quick"><span class="muted small" id="s-bal">Balance: -</span><button type="button" id="s-max">Max</button></div></div>
      <div class="swap-flip"><button type="button" class="btn btn-sm" id="s-flip" aria-label="Swap direction">Flip direction</button></div>
      <div class="field"><span class="label">You receive (estimate)</span><div class="readout" id="s-out" aria-live="polite">-</div></div>
      <div class="field"><span class="label" id="s-slip-l">Slippage tolerance</span>
        <div class="seg" role="group" aria-labelledby="s-slip-l" id="s-slip"></div></div>
      <div id="s-quote" aria-live="polite"></div>
      <button id="s-go" class="btn btn-primary btn-block" type="button">Enter an amount</button>
    </section>`;
  $('s-slip').innerHTML = SLIPPAGES.map((b) => `<button type="button" class="seg-btn" data-slip="${b}" aria-pressed="${b === slippageBps}">${b / 100}%</button>`).join('');
}

function renderHead(): void {
  $('s-from').textContent = from.symbol;
  const bal = balanceOf(from);
  $('s-bal').textContent = S.account ? `Balance: ${bal === null ? '-' : `${fmtToken(bal, from)} ${from.symbol}`}` : 'Connect a wallet to see your balance';
  $('s-out').textContent = quote ? `${fmtToken(quote.amountOut, to)} ${to.symbol}` : '-';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-slip]')) b.setAttribute('aria-pressed', String(Number(b.dataset.slip) === slippageBps));
}

function renderQuote(): void {
  const box = $('s-quote');
  const go = $<HTMLButtonElement>('s-go');
  const amt = amountIn();
  const bal = balanceOf(from);
  go.classList.remove('busy');
  if (!S.account) {
    box.innerHTML = '';
    go.textContent = 'Connect wallet';
    go.disabled = false;
    return;
  }
  if (isWatchOnly()) {
    box.innerHTML = '<p class="callout warn">Read-only: connect a wallet to swap.</p>';
    go.textContent = 'Read-only';
    go.disabled = true;
    return;
  }
  if (amt === null) {
    box.innerHTML = '';
    go.textContent = 'Enter an amount';
    go.disabled = true;
    return;
  }
  if (bal !== null && amt > bal) {
    box.innerHTML = `<p class="validation" role="alert">Amount exceeds your ${from.symbol} balance.</p>`;
    go.textContent = 'Insufficient balance';
    go.disabled = true;
    return;
  }
  if (quoteState === 'loading') {
    box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    go.textContent = 'Finding best route...';
    go.disabled = true;
    return;
  }
  if (quoteState === 'error') {
    box.innerHTML = `<p class="validation" role="alert">${esc(quoteError)}</p><button class="btn btn-sm" type="button" data-act="requote">Retry quote</button>`;
    go.textContent = 'No quote';
    go.disabled = true;
    return;
  }
  if (!quote) {
    go.disabled = true;
    return;
  }
  const impact = priceImpact(quote);
  const min = minReceived(quote.amountOut, slippageBps);
  const rate = Number(formatUnits(quote.amountOut, to.decimals)) / Number(formatUnits(quote.amountIn, from.decimals));
  const needsApprove = !from.native && allowance !== null && allowance < quote.amountIn;
  box.innerHTML = `<dl class="kv">
      <dt>Rate</dt><dd>1 ${from.symbol} = ${fmtNum(rate, 6)} ${to.symbol}</dd>
      <dt>Minimum received</dt><dd>${fmtToken(min, to)} ${to.symbol}</dd>
      <dt>Price impact</dt><dd class="${impact > 0.02 ? 'neg' : ''}">${(impact * 100).toFixed(2)}%</dd>
      <dt>Network fee (est.)</dt><dd>${fmtUsd(quote.gasUsd)}</dd>
      <dt>Route</dt><dd>${esc(quote.venues.map(shortVenue).join(' > ') || 'Direct')}${quote.splits > 1 ? ` (${quote.splits} splits)` : ''}</dd>
    </dl>${impact > 0.05 ? '<p class="validation" role="alert">High price impact. You may lose a large part of this swap to slippage.</p>' : ''}`;
  go.textContent = needsApprove ? `Approve and swap ${from.symbol}` : `Swap ${from.symbol} for ${to.symbol}`;
  go.disabled = false;
}

function render(): void {
  if (!mounted) return;
  renderHead();
  renderQuote();
}

async function requote(): Promise<void> {
  controller?.abort();
  quote = null;
  const amt = amountIn();
  if (amt === null) {
    quoteState = 'idle';
    render();
    return;
  }
  const bal = balanceOf(from);
  if (bal !== null && amt > bal) {
    quoteState = 'idle';
    render();
    return;
  }
  const ctl = new AbortController();
  controller = ctl;
  quoteState = 'loading';
  render();
  try {
    const q = await fetchQuote({ tokenIn: from, tokenOut: to, amountIn: amt, signal: ctl.signal });
    if (ctl.signal.aborted) return;
    quote = q;
    quoteState = 'ready';
    if (!from.native && S.account) {
      allowance = (await rpc.readContract({ address: from.address, abi: ERC20_ABI, functionName: 'allowance', args: [S.account.address, q.routerAddress] })) as bigint;
    }
  } catch (err) {
    if (ctl.signal.aborted) return;
    quoteState = 'error';
    quoteError = errMessage(err);
  }
  if (!ctl.signal.aborted) render();
}

const requoteSoon = debounce(() => void requote(), 450);

async function execute(): Promise<void> {
  const acct = S.account;
  const wc = acct?.walletClient;
  const q = quote;
  if (!acct || !wc || !q) return;
  const amt = q.amountIn;
  const go = $<HTMLButtonElement>('s-go');
  go.classList.add('busy');
  go.disabled = true;
  let built: Awaited<ReturnType<typeof buildSwap>>;
  try {
    built = await buildSwap({ quote: q, sender: acct.address, slippageBps });
  } catch (err) {
    toast(errMessage(err), 'err');
    render();
    return;
  }
  const needsApprove = !from.native && allowance !== null && allowance < amt;
  const impact = priceImpact(q);
  const body =
    kv([
      ['You pay', `${fmtToken(amt, from)} ${from.symbol}`],
      ['You receive (est.)', `${fmtToken(built.amountOut, to)} ${to.symbol}`],
      ['Minimum received', `<b>${fmtToken(built.minReceived, to)} ${to.symbol}</b>`],
      ['Slippage', `${slippageBps / 100}%`],
      ['Price impact', `${(impact * 100).toFixed(2)}%`],
      ['Network fee (est.)', fmtUsd(built.gasUsd)],
      ['Router', esc(`${built.to.slice(0, 6)}...${built.to.slice(-4)}`)],
    ]) +
    `<p class="callout">${needsApprove ? `Step 1: approve exactly ${fmtToken(amt, from)} ${from.symbol} for the router. Step 2: sign the swap. ` : 'Your wallet will ask you to sign the swap transaction. '}Nothing is sent until you sign.</p>`;
  const ok = await confirmDialog({
    title: 'Confirm swap',
    body,
    confirmText: needsApprove ? 'Approve, then swap' : 'Sign swap',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      await ensureChain();
      if (needsApprove) {
        ctl.setBusy('Approve the token in your wallet...');
        const approveHash = await wc.sendTransaction({
          account: acct.address,
          chain: hyperEvm,
          to: from.address,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [built.to as Address, amt] }),
          value: 0n,
        });
        ctl.setBusy('Waiting for the approval to confirm...');
        const r = await rpc.waitForTransactionReceipt({ hash: approveHash });
        if (r.status !== 'success') throw new Error('The approval reverted on chain. Nothing was swapped.');
        allowance = amt;
      }
      ctl.setBusy('Sign the swap in your wallet...');
      const hash = await wc.sendTransaction({ account: acct.address, chain: hyperEvm, to: built.to, data: built.data, value: built.value });
      ctl.setBusy('Waiting for confirmation...');
      const receipt = await rpc.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('The swap reverted on chain. Your tokens were not exchanged. Try a higher slippage or a smaller amount.');
      toast(`Swapped ${from.symbol} for ${to.symbol}`, 'ok', { href: explorerTx(hash), linkText: 'Transaction' });
    },
  });
  if (ok) {
    ($('s-amt') as HTMLInputElement).value = '';
    quote = null;
    quoteState = 'idle';
    void refreshBalances();
  }
  render();
}

export function initSwap(): void {
  if (mounted) return;
  layout();
  mounted = true;
  const stored = Number(localStorage.getItem(SLIPPAGE_KEY));
  if (SLIPPAGES.includes(stored)) slippageBps = stored;
  $('s-amt').addEventListener('input', () => {
    quote = null;
    quoteState = amountIn() === null ? 'idle' : 'loading';
    render();
    requoteSoon();
  });
  $('swap-root').addEventListener('click', (event) => {
    const t = event.target as HTMLElement;
    if (t.closest('#s-flip')) {
      [from, to] = [to, from];
      ($('s-amt') as HTMLInputElement).value = '';
      quote = null;
      quoteState = 'idle';
      render();
    }
    if (t.closest('#s-max')) {
      const bal = balanceOf(from);
      if (bal === null) return;
      const max = from.native ? (bal > GAS_RESERVE_WEI ? bal - GAS_RESERVE_WEI : 0n) : bal;
      ($('s-amt') as HTMLInputElement).value = formatUnits(max, from.decimals);
      void requote();
    }
    const slip = t.closest<HTMLButtonElement>('[data-slip]');
    if (slip?.dataset.slip) {
      slippageBps = Number(slip.dataset.slip);
      try {
        localStorage.setItem(SLIPPAGE_KEY, String(slippageBps));
      } catch {
        /* slippage simply is not remembered */
      }
      render();
    }
    if (t.closest('[data-act="requote"]')) void requote();
    if (t.closest('#s-go')) {
      if (!S.account) openWalletDialog();
      else void execute();
    }
  });
  on('account', () => {
    allowance = null;
    render();
  });
  on('balances', render);
  render();
}
