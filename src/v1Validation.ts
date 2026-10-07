import { keccak256, toUtf8Bytes } from 'ethers';
import { ensure, uint, whole } from './validation.js';
import type { V1ChainId, V1PrincipalLock, V1TokenSnapshot } from './v1Types.js';

export const V1_MAX_QUOTE_AGE_SECONDS = 120;
export const V1_MAX_DEADLINE_SECONDS = 900;
export const V1_MAX_POOL_AMOUNT = (1n << 112n) - 1n;
export const V1_PHASE_NAMES = ['unlisted', 'active', 'migrating', 'graduated', 'graduation-failed', 'refund-only', 'refunded'] as const;
export function v1ChainId(value: number): V1ChainId {
  ensure(value === 1 || value === 56, 'WRONG_CHAIN', 'Choose Ethereum mainnet (1) or BSC mainnet (56) explicitly.');
  return value;
}
export function v1CodeHash(value: string): string {
  ensure(typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value), 'INVALID_DEPLOYMENT', 'An exact runtime bytecode hash is required.');
  return value.toLowerCase();
}
export function v1CloneCode(implementation: string): string {
  return `0x363d3d373d3d3d363d73${implementation.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
}
export function v1PoolIdentity(s: V1TokenSnapshot): string {
  // Mutable quantities (sold/reserve) are intentionally excluded. A refund or recovery
  // changes phase/asset/pair and therefore invalidates an earlier quote capability.
  return keccak256(toUtf8Bytes([s.chainId, s.portal.toLowerCase(), s.token.toLowerCase(), s.factory.toLowerCase(),
    s.creator.toLowerCase(), s.pair.toLowerCase(), s.quoteAsset.toLowerCase(), s.quoteDecimals,
    s.initialInventory, s.saleAllocation, s.liquidityAllocation, s.targetNative, s.quoteTarget,
    s.customTarget, s.lifecycleHooks, s.phaseNumber].join('|')));
}
export function v1Deadline(value: bigint, timestamp: number): bigint {
  uint(value, true);
  ensure(value > BigInt(timestamp) && value <= BigInt(timestamp + V1_MAX_DEADLINE_SECONDS),
    'INVALID_DEADLINE', 'Deadline must be after the current block and within 15 minutes.');
  return value;
}
export function v1MinimumReceived(value: bigint | undefined, amount: bigint): bigint {
  // Actual receipts, including receiver-side transfer fees, remain authoritative.
  // A caller can voluntarily require a minimum, but cannot claim an output > input.
  const minimum = uint(value ?? 0n);
  ensure(minimum <= amount, 'INVALID_AMOUNT', 'Minimum receipt cannot exceed the requested input.');
  return minimum;
}
export function v1PrincipalLock(p: V1PrincipalLock): V1PrincipalLock {
  whole(p.mode, 0, 2); whole(p.initialDays, 0, 3650); whole(p.intervalDays, 0, 3650); whole(p.batches, 0, 365);
  if (p.mode === 0) ensure(p.initialDays === 0 && p.intervalDays === 0 && p.batches === 0, 'INVALID_LOCK', 'Flexible principal uses zero lock fields.');
  else if (p.mode === 1) ensure(p.initialDays >= 1 && p.intervalDays === 0 && p.batches === 1, 'INVALID_LOCK', 'Cliff principal requires 1–3650 days and one batch.');
  else ensure(p.intervalDays >= 1 && p.batches >= 2 && p.initialDays + p.intervalDays * (p.batches - 1) <= 3650,
    'INVALID_LOCK', 'Batch principal requires at least two batches and a total horizon no longer than 3650 days.');
  return Object.freeze({...p});
}
