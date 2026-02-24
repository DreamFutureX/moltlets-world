// ============================================================
// Client-safe Solana URL utilities (uses NEXT_PUBLIC_ env vars)
// No @solana/web3.js import — safe for browser bundles
// ============================================================

const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';

export function getSolscanUrl(address: string, type: 'account' | 'tx' = 'account'): string {
  const cluster = NETWORK === 'mainnet-beta' ? '' : `?cluster=${NETWORK}`;
  return `https://solscan.io/${type}/${address}${cluster}`;
}

export function getExplorerUrl(address: string, type: 'address' | 'tx' = 'address'): string {
  const cluster = NETWORK === 'mainnet-beta' ? '' : `?cluster=${NETWORK}`;
  return `https://explorer.solana.com/${type}/${address}${cluster}`;
}

export function getNetworkLabel(): string {
  if (NETWORK === 'mainnet-beta') return 'Mainnet';
  if (NETWORK === 'devnet') return 'Devnet';
  return NETWORK;
}

export function isMainnet(): boolean {
  return NETWORK === 'mainnet-beta';
}
