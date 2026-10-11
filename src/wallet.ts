import { createWalletClient, custom, type Address, type EIP1193Provider, type WalletClient } from 'viem';
import { hyperEvm, MAINNET, type TypedDataSigner } from 'papertrade-sdk';

/** A wallet announced through EIP-6963, or the legacy window.ethereum. */
export interface DiscoveredWallet {
  id: string;
  name: string;
  /** Data URI supplied by the wallet. Untrusted: only ever used as an <img src>. */
  icon: string;
  provider: EIP1193Provider;
}

interface Announcement {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
}

const wallets = new Map<string, DiscoveredWallet>();
const listeners = new Set<() => void>();
let started = false;

export function onWalletsChanged(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function listWallets(): DiscoveredWallet[] {
  return [...wallets.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Start EIP-6963 discovery. Safe to call more than once. */
export function startDiscovery() {
  if (started) return;
  started = true;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const { info, provider } = (event as CustomEvent<Announcement>).detail ?? {};
    if (!info?.rdns || !provider || typeof provider.request !== 'function') return;
    wallets.set(info.rdns, { id: info.rdns, name: String(info.name).slice(0, 40), icon: String(info.icon ?? ''), provider });
    listeners.forEach((fn) => fn());
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** After discovery settles, add window.ethereum if no announced wallet already wraps it. */
export function addLegacyProvider() {
  const legacy = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!legacy || typeof legacy.request !== 'function') return;
  if ([...wallets.values()].some((w) => w.provider === legacy)) return;
  wallets.set('window.ethereum', { id: 'window.ethereum', name: 'Browser wallet', icon: '', provider: legacy });
  listeners.forEach((fn) => fn());
}

export const HYPEREVM_CHAIN_HEX = `0x${MAINNET.chainId.toString(16)}`;

export async function readChainId(provider: EIP1193Provider): Promise<number> {
  return Number(await provider.request({ method: 'eth_chainId' }));
}

export async function requestAccounts(provider: EIP1193Provider): Promise<Address[]> {
  return (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
}

/** Accounts the site is already allowed to see. Never opens a wallet prompt. */
export async function existingAccounts(provider: EIP1193Provider): Promise<Address[]> {
  return (await provider.request({ method: 'eth_accounts' })) as Address[];
}

/** Switch the wallet to HyperEVM, adding the network first when the wallet does not know it. */
export async function ensureHyperEvm(provider: EIP1193Provider): Promise<void> {
  if ((await readChainId(provider)) === MAINNET.chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HYPEREVM_CHAIN_HEX }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 4902 && code !== -32603) throw err;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: HYPEREVM_CHAIN_HEX,
          chainName: MAINNET.network.chainName,
          nativeCurrency: hyperEvm.nativeCurrency,
          rpcUrls: [MAINNET.network.rpcUrl],
          blockExplorerUrls: [MAINNET.network.explorerUrl],
        },
      ],
    });
  }
  if ((await readChainId(provider)) !== MAINNET.chainId) throw new Error('Your wallet did not switch to HyperEVM (chain 999).');
}

export function walletClientFor(provider: EIP1193Provider, account: Address): WalletClient {
  return createWalletClient({ account, chain: hyperEvm, transport: custom(provider) });
}

/** Adapt a viem WalletClient to the SDK's signer shape. The wallet shows the EIP-712 prompt. */
export function typedDataSigner(client: WalletClient, address: Address): TypedDataSigner {
  return {
    address,
    signTypedData: (args) =>
      client.signTypedData({ account: address, domain: args.domain, types: args.types, primaryType: args.primaryType, message: args.message } as Parameters<WalletClient['signTypedData']>[0]),
  };
}
