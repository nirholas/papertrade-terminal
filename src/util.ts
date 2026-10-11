/** Small DOM, formatting and storage helpers shared by every module. */
import { ADMISSION_REASONS, PapertradeApiError } from 'papertrade-sdk';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape untrusted text (API strings, wallet names, token metadata) before it goes into HTML. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export function qsa<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

export function fmtUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value < 0 ? '-' : value > 0 ? '+' : ''}$${abs}`;
}

export function fmtNum(value: number, maxDigits = 4): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', { maximumFractionDigits: maxDigits });
}

export function fmtPct(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return '-';
  const text = (fraction * 100).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${/^-0(\.0+)?$/.test(text) ? text.slice(1) : text}%`;
}

/** Price with a tick-aware number of decimals (BTC scale 10 gives 1, ETH scale 100 gives 2). */
export function fmtPrice(price: number, priceScale: number): string {
  const digits = Math.max(0, Math.round(Math.log10(priceScale)));
  return price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function timeUntil(unixSeconds: number, now = Date.now()): string {
  const s = Math.round(unixSeconds - now / 1000);
  if (s <= 0) return 'expired';
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable: nothing to remove */
    }
  },
};

export type ToastKind = 'ok' | 'err' | 'info';

export function toast(message: string, kind: ToastKind = 'info', opts: { href?: string; linkText?: string; ms?: number } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (opts.href) {
    const a = document.createElement('a');
    a.href = opts.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = opts.linkText ?? 'View';
    el.append(a);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-x';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = 'x';
  close.addEventListener('click', () => el.remove());
  el.append(close);
  host.append(el);
  while (host.children.length > 5) host.firstElementChild?.remove();
  window.setTimeout(() => el.remove(), opts.ms ?? (kind === 'err' ? 9000 : 5000));
}

/** Turn any thrown value into a message a trader can act on. */
export function errMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: number | string; shortMessage?: string; message?: string; details?: string; name?: string };
    if (e.code === 4001 || e.code === 'ACTION_REJECTED' || e.name === 'UserRejectedRequestError') return 'You rejected the request in your wallet.';
    if (e.code === -32002) return 'Your wallet already has a pending request. Open it and approve or reject it.';
    const msg = e.shortMessage ?? e.message ?? e.details;
    if (msg) return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
  }
  return String(err);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: number | undefined;
  return (...args: A) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

export function explorerTx(hash: string): string {
  return `https://hyperevmscan.io/tx/${hash}`;
}

/** Explain a relayer or network failure in terms the trader can act on. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof PapertradeApiError) {
    if (err.code === 'unauthorized_intent') return 'The relayer does not recognise this session key. Re-register it from the session control, then retry.';
    if (err.reason && ADMISSION_REASONS[err.reason]) return ADMISSION_REASONS[err.reason];
    if (err.code === 'rate_limited') return 'The relayer is rate limiting requests. Wait a few seconds and retry.';
    return err.message || `The relayer rejected the request (${err.code}).`;
  }
  return errMessage(err);
}
