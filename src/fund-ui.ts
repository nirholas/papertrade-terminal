import { buildHyperEvmDeposit, formatCoreUsdc, formatUnits, hyperEvm, HYPEREVM_GAS_ALLOWANCE_USDC, MIN_DEPOSIT_USDC, MIN_WITHDRAWAL_USDC, ACTIVATION_FEE_USDC, parseUnits, publicClient, wadToNumber, wadToUsdc, withdrawalActivationFee, type EvmCall } from 'papertrade-sdk';
import { ensureChain, isWatchOnly, openWalletDialog, refreshBalances, trackIntent } from './account.js';
import { confirmDialog, kv } from './dialogs.js';
import { S, on } from './state.js';
import { $, apiErrorMessage, esc, explorerTx, fmtUsd, shortAddr, toast } from './util.js';

const rpc = publicClient();
let coreAccount: boolean | null = null;
let coreFor = '';
let route: 'hypercore' | 'hyperevm' = 'hyperevm';

const usdc = (raw: bigint) => formatUnits(raw, 6);

function layout(): void {
  $('fund-root').innerHTML = `
    <div id="fund-gate"></div>
    <div id="fund-forms" hidden>
      <section class="sub" aria-labelledby="dep-h">
        <h3 id="dep-h">Deposit USDC</h3>
        <p class="muted small">Bridge USDC from your HyperEVM wallet into your Papertrade balance. You sign each step in your wallet.</p>
        <dl class="kv"><dt>Wallet USDC (HyperEVM)</dt><dd id="f-usdc">-</dd><dt>Papertrade balance</dt><dd id="f-pt">-</dd></dl>
        <div class="field"><label for="f-dep-amt">Amount (USDC)</label><div class="input-row"><input id="f-dep-amt" inputmode="decimal" placeholder="10 minimum" spellcheck="false" autocomplete="off"><span class="suffix">USDC</span></div>
          <div class="quick"><button type="button" id="f-dep-max">Max</button></div></div>
        <p id="f-dep-info" class="muted small" aria-live="polite"></p>
        <button id="f-dep-btn" class="btn btn-primary btn-block" type="button">Review deposit</button>
      </section>
      <section class="sub" aria-labelledby="wd-h">
        <h3 id="wd-h">Withdraw USDC</h3>
        <p class="muted small">Withdrawals are signed by your wallet. The session key can never withdraw.</p>
        <dl class="kv"><dt>Available</dt><dd id="f-avail">-</dd></dl>
        <div class="field"><label for="f-wd-amt">Amount (USDC)</label><div class="input-row"><input id="f-wd-amt" inputmode="decimal" placeholder="10 minimum" spellcheck="false" autocomplete="off"><span class="suffix">USDC</span></div>
          <div class="quick"><button type="button" id="f-wd-max">Max</button></div></div>
        <fieldset class="radio-row"><legend class="visually-hidden">Withdrawal route</legend>
          <label><input type="radio" name="wd-route" value="hyperevm" checked><span><b>To my HyperEVM wallet</b><br><span class="muted small">Two wallet signatures. 0.1 USDC gas allowance.</span></span></label>
          <label><input type="radio" name="wd-route" value="hypercore"><span><b>To HyperCore spot</b><br><span class="muted small">One wallet signature. Lands in your Hyperliquid spot balance.</span></span></label>
        </fieldset>
        <dl class="kv" id="f-wd-info"></dl>
        <p id="f-wd-msg" class="validation" role="alert" hidden></p>
        <button id="f-wd-btn" class="btn btn-primary btn-block" type="button">Review withdrawal</button>
      </section>
    </div>`;
}

function parseUsdc(text: string): bigint | null {
  const t = text.trim().replace(/,/g, '');
  if (!t || !/^\d*\.?\d+$|^\d+\.?$/.test(t)) return null;
  try {
    return parseUnits(t, 6);
  } catch {
    return null;
  }
}

function isFirstDeposit(): boolean {
  return !S.wallet || S.wallet.lifetime.depositedRaw === 0n;
}

function depositMinimum(): bigint {
  return MIN_DEPOSIT_USDC + (isFirstDeposit() ? ACTIVATION_FEE_USDC : 0n);
}

async function loadCoreAccount(): Promise<void> {
  const addr = S.account?.address;
  if (!addr || coreFor === addr) return;
  coreFor = addr;
  coreAccount = null;
  try {
    coreAccount = (await S.client.accountFunding(addr)).coreAccount;
  } catch {
    coreFor = '';
  }
  renderWithdraw();
}

function withdrawQuote() {
  const amount = parseUsdc(($('f-wd-amt') as HTMLInputElement).value);
  const fee = withdrawalActivationFee(S.wallet?.lifetime.withdrawnRaw ?? 0n, coreAccount ?? false);
  const gas = route === 'hyperevm' ? HYPEREVM_GAS_ALLOWANCE_USDC : 0n;
  const available = S.wallet ? wadToUsdc(S.wallet.funds.availableBalance) : null;
  let problem: string | null = null;
  if (amount !== null) {
    if (available !== null && amount > available) problem = `Only ${usdc(available)} USDC is available to withdraw.`;
    else if (amount - fee < MIN_WITHDRAWAL_USDC) problem = `Withdraw at least ${formatCoreUsdc(MIN_WITHDRAWAL_USDC + fee)} USDC${fee > 0n ? ' (includes the 1 USDC activation fee)' : ''}.`;
  }
  return { amount, fee, gas, available, receive: amount === null ? null : amount - fee - gas, problem };
}

function renderWithdraw(): void {
  if (!document.getElementById('f-wd-info')) return;
  const q = withdrawQuote();
  $('f-avail').textContent = q.available === null ? '-' : `${usdc(q.available)} USDC`;
  const fee = coreAccount === null && S.account ? 'checking...' : `${formatCoreUsdc(q.fee)} USDC`;
  $('f-wd-info').innerHTML = [
    ['Minimum', `${formatCoreUsdc(MIN_WITHDRAWAL_USDC)} USDC after fees`],
    ['Activation fee', esc(fee)],
    ['Gas allowance', `${formatCoreUsdc(q.gas)} USDC`],
    ['You receive', q.receive !== null && q.receive > 0n ? `${formatCoreUsdc(q.receive)} USDC` : '-'],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  const msg = $('f-wd-msg');
  msg.hidden = !q.problem;
  msg.textContent = q.problem ?? '';
  const btn = $<HTMLButtonElement>('f-wd-btn');
  btn.disabled = isWatchOnly() || q.amount === null || q.problem !== null;
}

function renderDeposit(): void {
  if (!document.getElementById('f-dep-info')) return;
  $('f-usdc').textContent = S.balances.usdc === null ? '-' : `${usdc(S.balances.usdc)} USDC`;
  $('f-pt').textContent = S.wallet ? fmtUsd(wadToNumber(S.wallet.balance)) : '-';
  const amount = parseUsdc(($('f-dep-amt') as HTMLInputElement).value);
  const min = depositMinimum();
  const info = $('f-dep-info');
  let problem: string | null = null;
  if (amount !== null && amount < min) problem = `Deposit at least ${usdc(min)} USDC${isFirstDeposit() ? ' (10 USDC plus the one-time 1 USDC activation fee)' : ''}.`;
  else if (amount !== null && S.balances.usdc !== null && amount > S.balances.usdc) problem = 'That is more USDC than your wallet holds on HyperEVM. Swap to USDC from the Swap tab.';
  info.className = problem ? 'validation' : 'muted small';
  info.textContent = problem ?? `Minimum ${usdc(min)} USDC${isFirstDeposit() ? ', including a one-time 1 USDC activation fee' : ''}. You need a little HYPE for gas.`;
  $<HTMLButtonElement>('f-dep-btn').disabled = isWatchOnly() || amount === null || problem !== null;
}

function renderGate(): void {
  const gate = $('fund-gate');
  const forms = $('fund-forms');
  if (!S.account) {
    gate.innerHTML = '<div class="empty"><strong>Connect a wallet to fund your account</strong><p>Deposit USDC from HyperEVM, withdraw back to your wallet, or swap for gas.</p><button class="btn btn-primary btn-sm" type="button" data-act="connect">Connect wallet</button></div>';
    forms.hidden = true;
    return;
  }
  gate.innerHTML = isWatchOnly() ? '<p class="callout warn">Read-only: connect a wallet to deposit or withdraw.</p>' : '';
  forms.hidden = false;
  renderDeposit();
  renderWithdraw();
  void loadCoreAccount();
}

async function reviewDeposit(): Promise<void> {
  const acct = S.account;
  const wc = acct?.walletClient;
  const amount = parseUsdc(($('f-dep-amt') as HTMLInputElement).value);
  if (!acct || !wc || amount === null) return;
  const btn = $<HTMLButtonElement>('f-dep-btn');
  btn.disabled = true;
  btn.classList.add('busy');
  let built: Awaited<ReturnType<typeof buildHyperEvmDeposit>>;
  try {
    built = await buildHyperEvmDeposit({ user: acct.address, amount, client: rpc, firstDeposit: isFirstDeposit() });
  } catch (err) {
    toast(apiErrorMessage(err), 'err');
    return;
  } finally {
    btn.classList.remove('busy');
    renderDeposit();
  }
  const done = new Set<number>();
  const steps = (active: number, failed = false) =>
    `<ol class="steps">${built.calls
      .map((c, i) => `<li data-s="${done.has(i) ? 'done' : i === active ? (failed ? 'err' : 'active') : 'todo'}"><span class="n">${i + 1}</span><span>${esc(c.description)}${done.has(i) ? ' (done)' : ''}</span></li>`)
      .join('')}</ol>`;
  const body =
    kv([
      ['Amount', `${usdc(amount)} USDC`],
      ['From', esc(shortAddr(acct.address))],
      ['Deposit address', esc(shortAddr(built.proxy))],
      ['Transactions', String(built.calls.length)],
    ]) +
    steps(-1) +
    `<p class="callout">${built.calls.length > 1 ? 'Your wallet will ask you to sign each transaction in order. ' : ''}Funds move to your personal Papertrade deposit address, and the relayer sweeps them into your balance${isFirstDeposit() ? ' (1 USDC one-time activation fee)' : ''}. This usually takes under a minute.</p>`;
  await confirmDialog({
    title: 'Confirm deposit',
    body,
    confirmText: built.calls.length > 1 ? `Sign ${built.calls.length} transactions` : 'Sign transaction',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      await ensureChain();
      for (let i = 0; i < built.calls.length; i++) {
        if (done.has(i)) continue;
        const call: EvmCall = built.calls[i];
        ctl.setBody(body.replace(/<ol class="steps">[\s\S]*<\/ol>/, steps(i)));
        ctl.setBusy(`Sign step ${i + 1} of ${built.calls.length} in your wallet...`);
        const hash = await wc.sendTransaction({ account: acct.address, chain: hyperEvm, to: call.to, data: call.data, value: call.value });
        ctl.setBusy('Waiting for confirmation...');
        const receipt = await rpc.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') throw new Error(`Step ${i + 1} reverted on chain. Nothing was bridged by that step.`);
        done.add(i);
        toast(`Step ${i + 1} confirmed`, 'ok', { href: explorerTx(hash), linkText: 'Transaction' });
      }
      ctl.setBusy('Asking the relayer to sweep...');
      try {
        await S.client.checkDepositAddress(acct.address);
      } catch {
        /* the relayer also sweeps on its own schedule; the deposit is already on chain */
      }
      toast('Deposit sent. It lands in your balance within a minute.', 'ok');
      ($('f-dep-amt') as HTMLInputElement).value = '';
      void refreshBalances();
    },
  });
  renderDeposit();
}

async function reviewWithdraw(): Promise<void> {
  const acct = S.account;
  const q = withdrawQuote();
  const trader = S.trader;
  if (!acct?.walletClient || !trader || q.amount === null || q.problem || q.receive === null) return;
  const amount = q.amount;
  const fee = q.fee;
  const chosen = route;
  const sigs = chosen === 'hyperevm' ? 2 : 1;
  const body =
    kv([
      ['Withdraw', `${usdc(amount)} USDC`],
      ['Route', chosen === 'hyperevm' ? 'HyperEVM wallet' : 'HyperCore spot'],
      ['To', esc(shortAddr(acct.address))],
      ['Activation fee', `${formatCoreUsdc(fee)} USDC`],
      ['Gas allowance', `${formatCoreUsdc(q.gas)} USDC`],
      ['You receive', `<b>${formatCoreUsdc(q.receive)} USDC</b>`],
      ['Minimum', `${formatCoreUsdc(MIN_WITHDRAWAL_USDC)} USDC after fees`],
    ]) + `<p class="callout">Your wallet will ask for ${sigs} signature${sigs > 1 ? 's' : ''} (typed data, no gas). ${chosen === 'hyperevm' ? 'The relayer then forwards the funds on to your HyperEVM address.' : 'Funds land in your HyperCore spot balance.'}</p>`;
  await confirmDialog({
    title: 'Confirm withdrawal',
    body,
    confirmText: 'Sign withdrawal',
    describeError: apiErrorMessage,
    run: async (ctl) => {
      await ensureChain();
      ctl.setBusy('Waiting for your wallet...');
      const prepared = await trader.prepareWithdraw({ amountUsdc: usdc(amount), route: chosen, activationFee: fee });
      ctl.setBusy('Submitting...');
      const submitted = await trader.submit(prepared);
      trackIntent(submitted.intentId, prepared.summary);
      toast('Withdrawal submitted.', 'ok');
      ($('f-wd-amt') as HTMLInputElement).value = '';
    },
  });
  renderWithdraw();
}

export function initFund(): void {
  layout();
  $('fund-root').addEventListener('click', (event) => {
    const t = event.target as HTMLElement;
    if (t.closest('[data-act="connect"]')) openWalletDialog();
    if (t.closest('#f-dep-btn')) void reviewDeposit();
    if (t.closest('#f-wd-btn')) void reviewWithdraw();
    if (t.closest('#f-dep-max') && S.balances.usdc !== null) {
      ($('f-dep-amt') as HTMLInputElement).value = usdc(S.balances.usdc);
      renderDeposit();
    }
    if (t.closest('#f-wd-max') && S.wallet) {
      ($('f-wd-amt') as HTMLInputElement).value = usdc(wadToUsdc(S.wallet.funds.availableBalance));
      renderWithdraw();
    }
  });
  $('f-dep-amt').addEventListener('input', renderDeposit);
  $('f-wd-amt').addEventListener('input', renderWithdraw);
  $('fund-root').addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'wd-route') {
      route = input.value === 'hypercore' ? 'hypercore' : 'hyperevm';
      renderWithdraw();
    }
  });
  on('account', () => {
    coreFor = '';
    coreAccount = null;
    renderGate();
  });
  on('wallet', () => {
    renderDeposit();
    renderWithdraw();
  });
  on('balances', renderDeposit);
  renderGate();
}
