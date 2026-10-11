import { createSessionKey } from 'papertrade-sdk';
import { describe, expect, it } from 'vitest';
import { clearSessionKey, loadSessionKey, saveSessionKey, sessionStatus, type KeyValueStore } from '../src/session-store.js';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const wallet = '0x00000000000000000000000000000000000000Aa';

describe('session key storage', () => {
  it('round-trips a generated throwaway key per wallet, case-insensitively', () => {
    const store = memory();
    const key = createSessionKey(3600);
    saveSessionKey(store, wallet, key);
    const back = loadSessionKey(store, wallet.toLowerCase());
    expect(back?.privateKey).toBe(key.privateKey);
    expect(back?.account.address).toBe(key.account.address);
    expect(back?.expiry).toBe(key.expiry);
  });

  it('clears the key and ignores corrupt entries', () => {
    const store = memory();
    saveSessionKey(store, wallet, createSessionKey(3600));
    clearSessionKey(store, wallet);
    expect(loadSessionKey(store, wallet)).toBeNull();
    store.setItem(`papertrade-terminal.session.v1:${wallet.toLowerCase()}`, '{"privateKey":"nope","expiry":"1"}');
    expect(loadSessionKey(store, wallet)).toBeNull();
    store.setItem(`papertrade-terminal.session.v1:${wallet.toLowerCase()}`, 'not json');
    expect(loadSessionKey(store, wallet)).toBeNull();
  });
});

describe('sessionStatus', () => {
  const now = 1_800_000_000_000;
  it('walks none, pending, active and expired', () => {
    expect(sessionStatus(null, {}, now)).toBe('none');
    const key = createSessionKey(3600, now);
    expect(sessionStatus(key, {}, now)).toBe('pending');
    const addr = key.account.address.toLowerCase();
    expect(sessionStatus(key, { [addr]: key.expiry }, now)).toBe('active');
    expect(sessionStatus(key, { [addr]: BigInt(now / 1000) }, now)).toBe('expired');
    expect(sessionStatus(key, { [addr]: key.expiry }, now + 3_700_000)).toBe('expired');
  });
});
