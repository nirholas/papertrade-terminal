import { restoreSessionKey, type SessionKey } from 'papertrade-sdk';
import type { Hex } from 'viem';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'papertrade-terminal.session.v1:';

/**
 * The browser-held session key for one wallet. It can open, close and cancel
 * trades but can never withdraw. It lives in localStorage so a reload does not
 * force a new wallet signature; the trader can clear it at any time.
 */
export function loadSessionKey(storage: KeyValueStore, address: string): SessionKey | null {
  try {
    const raw = storage.getItem(PREFIX + address.toLowerCase());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { privateKey?: string; expiry?: string };
    if (!parsed.privateKey || !/^0x[0-9a-fA-F]{64}$/.test(parsed.privateKey) || !parsed.expiry || !/^\d+$/.test(parsed.expiry)) return null;
    return restoreSessionKey(parsed.privateKey as Hex, BigInt(parsed.expiry));
  } catch {
    return null;
  }
}

export function saveSessionKey(storage: KeyValueStore, address: string, key: SessionKey): void {
  storage.setItem(PREFIX + address.toLowerCase(), JSON.stringify({ privateKey: key.privateKey, expiry: key.expiry.toString() }));
}

export function clearSessionKey(storage: KeyValueStore, address: string): void {
  storage.removeItem(PREFIX + address.toLowerCase());
}

export type SessionStatus = 'none' | 'pending' | 'active' | 'expired';

/** Combine the locally held key with what the relayer reports as registered. */
export function sessionStatus(key: SessionKey | null, registered: Record<string, bigint> | undefined, nowMs = Date.now(), marginSeconds = 60): SessionStatus {
  if (!key) return 'none';
  const nowSec = BigInt(Math.floor(nowMs / 1000) + marginSeconds);
  if (key.expiry <= nowSec) return 'expired';
  const onChain = registered?.[key.account.address.toLowerCase()];
  if (onChain === undefined) return 'pending';
  return onChain > nowSec ? 'active' : 'expired';
}
