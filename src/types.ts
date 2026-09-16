import type { TransactionRequest } from 'ethers';

/** Monetary values are raw on-chain integers. BNB uses 18 decimals. */
export interface TrustedPortal {
  readonly address: string;
  readonly codeHash: string;
  readonly startBlock: number;
  readonly deploymentVersion: number;
}
export type ReadBlock = number | 'latest' | 'finalized';
export interface BlockReference { readonly blockNumber: number; readonly blockHash: string; readonly timestamp: number }
export interface TokenSnapshot extends BlockReference {
  readonly token: string; readonly portal: string; readonly name: string; readonly symbol: string;
  readonly decimals: number; readonly phase: 'launch' | 'migrating' | 'graduated';
  readonly quoteAsset: string; readonly quoteDecimals: number; readonly router: string; readonly pair: string;
  readonly target: bigint; readonly reserve: bigint; readonly saleAmount: bigint; readonly totalSold: bigint;
  readonly remaining: bigint; readonly progressBps: bigint | null; readonly feeRecipient: string;
  readonly recoveryDestination: string; readonly deploymentVersion: number;
}
export interface TradeQuote extends BlockReference {
  readonly kind: 'buy' | 'sell' | 'remaining'; readonly token: string; readonly portal: string;
  readonly inputAmount: bigint; readonly outputAmount: bigint; readonly feeBNB: bigint;
  readonly principalBNB: bigint; readonly refundBNB: bigint;
  /** For a remaining-supply buy: exact quoted spend before the optional <=3% budget buffer. */
  readonly quotedPaymentBNB: bigint;
}
export interface UnsignedTransaction extends TransactionRequest {
  chainId: 56; from: string; to: string; data: string; value: bigint;
}
export interface SwapOptions {
  /** Default 50 (0.5%); range 0..1000. Remaining-supply buys always require the full original output. */
  slippageBps?: number;
  /** Explicit absolute Unix time; must be after the current block and within 15 minutes. */
  deadline: bigint;
}
export interface PortalEvent {
  readonly name: string; readonly portal: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly blockNumber: number; readonly blockHash: string; readonly transactionHash: string;
  readonly logIndex: number; readonly removed: boolean;
}
