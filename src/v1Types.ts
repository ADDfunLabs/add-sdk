import type { TransactionRequest } from 'ethers';
import type { BlockReference, ReadBlock } from './types.js';

/** V1 deployments are independent of the historical v12/v13 Portal ABI. */
export type V1ChainId = 1 | 56;
export interface V1ContractPin { readonly address: string; readonly codeHash: string; readonly role?: string }
export interface V1Mechanism {
  readonly id: string; readonly kind: 'standard' | 'tax' | 'staking-tax';
  readonly factory: string; readonly factoryHash: string;
  readonly implementation: string; readonly templateHash: string;
  readonly dividendImplementation?: string; readonly dividendHash?: string;
}
export interface V1StakingDeployment {
  readonly version: 2; readonly kind: 'standalone' | 'tax';
  readonly factory: string; readonly factoryHash: string;
  readonly poolImplementation: string; readonly poolHash: string;
  readonly wrappedNative: string; readonly startBlock?: number;
}
export interface V1Deployment {
  readonly chainId: V1ChainId; readonly portal: string; readonly portalHash: string;
  readonly startBlock: number; readonly router: string; readonly dexFactory: string;
  readonly wrappedNative: string;
  /** Initial public reference only: Portal ownership can legitimately change this recipient. */
  readonly feeRecipient: string;
  readonly mechanisms: readonly V1Mechanism[]; readonly staking: readonly V1StakingDeployment[];
  readonly roles?: readonly V1ContractPin[];
}
export interface V1ReadOptions { readonly blockTag?: ReadBlock }
export type V1Phase = 'unlisted' | 'active' | 'migrating' | 'graduated' | 'graduation-failed' | 'refund-only' | 'refunded';
export interface V1TokenSnapshot extends BlockReference {
  readonly chainId: V1ChainId; readonly token: string; readonly portal: string;
  readonly factory: string; readonly creator: string; readonly pair: string;
  readonly name: string; readonly symbol: string; readonly decimals: number;
  readonly phase: V1Phase; readonly phaseNumber: number;
  readonly initialInventory: bigint; readonly saleAllocation: bigint; readonly liquidityAllocation: bigint;
  readonly sold: bigint; readonly remaining: bigint; readonly reserve: bigint;
  readonly quoteAsset: string; readonly quoteDecimals: number;
  readonly targetNative: bigint; readonly quoteTarget: bigint;
  readonly customTarget: boolean; readonly lifecycleHooks: boolean;
  readonly progressBps: bigint;
  readonly feeRecipient: string;
  /** Unregistered external code may be inspected, but never receives SDK money builders. */
  readonly reviewed: boolean; readonly mechanismId: string | null;
  /** Actual asset used for V2 graduation, including recovery conversions; null before graduation. */
  readonly settlementQuoteAsset: string | null; readonly settlementQuoteAmount: bigint | null;
}
export interface V1LaunchTarget extends BlockReference {
  readonly chainId: V1ChainId; readonly portal: string; readonly quoteAsset: string;
  readonly targetNative: bigint; readonly quoteTarget: bigint; readonly quoteDecimals: number;
  readonly defaultTargetNative: bigint; readonly customTargetsEnabled: boolean;
}
export interface V1TradeQuote extends BlockReference {
  readonly chainId: V1ChainId; readonly kind: 'buy' | 'remaining' | 'sell' | 'refund';
  readonly token: string; readonly portal: string; readonly quoteAsset: string;
  readonly quoteDecimals: number; readonly poolIdentity: string;
  /** Native wei for buy/remaining; launch-token base units for sell/refund. */
  readonly inputAmount: bigint;
  /** Launch-token units for buy; native wei for sell; original quote-asset units for refund. */
  readonly outputAmount: bigint;
  readonly quotePrincipal: bigint; readonly nativePrincipal: bigint;
  readonly nativeFee: bigint; readonly nativeRefund: bigint;
  readonly quotedNativePayment: bigint;
}
export interface V1UnsignedTransaction extends TransactionRequest {
  readonly chainId: V1ChainId; readonly from: string; readonly to: string;
  readonly data: string; readonly value: bigint;
  /** Optional execution ceiling, not a prediction of gas actually consumed. */
  readonly gasLimit?: bigint;
}
export interface V1SwapOptions {
  readonly slippageBps?: number;
  /** Absolute Unix seconds, after the current block and no more than 15 minutes ahead. */
  readonly deadline: bigint;
}
export interface V1Allowance extends BlockReference {
  readonly chainId: V1ChainId; readonly token: string; readonly account: string;
  readonly spender: string; readonly allowance: bigint; readonly balance: bigint;
}
export interface V1Event {
  readonly chainId: V1ChainId; readonly contract: string; readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly blockNumber: number; readonly blockHash: string; readonly transactionHash: string;
  readonly logIndex: number; readonly removed: boolean;
}
export interface V1TaxConfig {
  readonly buyTaxBps: number; readonly sellTaxBps: number;
  readonly marketingBps: number; readonly burnBps: number; readonly dividendBps: number; readonly liquidityBps: number;
  readonly marketingWallet: string; readonly rewardMode: 0 | 1 | 2;
  readonly rewardToken: string; readonly minimumHolding: bigint;
}
export interface V1TaxSnapshot extends BlockReference {
  readonly chainId: V1ChainId; readonly token: string; readonly portal: string;
  readonly config: V1TaxConfig; readonly dividend: string; readonly stakingPool: string | null;
  readonly rewardAsset: string; readonly quoteToken: string;
  readonly processingThreshold: bigint; readonly unprocessedTokens: bigint;
  readonly pendingMarketing: bigint; readonly pendingDividendQuote: bigint; readonly pendingSelfReward: bigint;
  readonly pendingLPToken: bigint; readonly pendingLPQuote: bigint;
  readonly totalBurned: bigint; readonly totalLiquidity: bigint; readonly graduatedAt: bigint;
  readonly automaticProcessing: boolean;
}
export interface V1DividendSnapshot extends BlockReference {
  readonly chainId: V1ChainId; readonly token: string; readonly dividend: string;
  readonly rewardToken: string; readonly nativeReward: boolean; readonly minimumHolding: bigint;
  readonly totalShares: bigint; readonly totalFunded: bigint; readonly totalClaimed: bigint;
  readonly account: string | null; readonly claimable: bigint | null;
}
export interface V1PrincipalLock {
  readonly mode: 0 | 1 | 2; readonly initialDays: number; readonly intervalDays: number; readonly batches: number;
}
export interface V1StakingSchedule {
  readonly remainingRewards: bigint; readonly emittedRewards: bigint;
  readonly grossClaimed: bigint; readonly fundedRewards: bigint; readonly stakedSupply: bigint;
  readonly activeElapsedSeconds: bigint; readonly remainingActiveSeconds: bigint; readonly estimatedEndTime: bigint;
  readonly currentRateNumerator: bigint; readonly currentRateDenominator: bigint;
  readonly currentRewardsPerMinute: bigint; readonly nextHalvingInActiveSeconds: bigint; readonly halvingsApplied: bigint;
  readonly pausedForNoStakers: boolean; readonly finished: boolean;
}
export interface V1StakingAccount {
  readonly staked: bigint; readonly totalStake: bigint; readonly shareBps: bigint;
  readonly earnedGross: bigint; readonly claimFee: bigint; readonly claimNet: bigint;
  readonly claimedGross: bigint; readonly paidFees: bigint;
}
export interface V1UnlockInfo {
  readonly withdrawable: bigint; readonly locked: bigint; readonly nextUnlockAt: bigint; readonly livePositions: bigint;
}
export interface V1StakingPosition {
  readonly deposited: bigint; readonly withdrawn: bigint; readonly startedAt: bigint;
}
export interface V1CycleInfo {
  readonly number: bigint; readonly duration: bigint; readonly budget: bigint;
  readonly emittedThisCycle: bigint; readonly elapsedThisCycle: bigint;
  readonly pendingUnrecognized: bigint; readonly awaitingGraduation: boolean;
}
export interface V1StakingSnapshot extends BlockReference {
  readonly chainId: V1ChainId; readonly pool: string; readonly factory: string; readonly creator: string;
  readonly rewardToken: string; readonly stakingAsset: string; readonly stakingToken: string;
  readonly nativeReward: boolean; readonly cycling: boolean;
  readonly linkedToken: string; readonly linkedActivated: boolean; readonly linkedStakeMode: number;
  readonly principalLock: V1PrincipalLock;
  /** Linked pools awaiting graduation do not yet have a ready schedule/account ledger. */
  readonly schedule: V1StakingSchedule | null; readonly cycle: V1CycleInfo;
  readonly account: string | null; readonly accountInfo: V1StakingAccount | null; readonly unlock: V1UnlockInfo | null;
}
export interface V1FundingPreview extends BlockReference {
  readonly chainId: V1ChainId; readonly pool: string; readonly mode: 'extend' | 'recalculate';
  readonly assumedReceived: bigint; readonly remainingRewardsAfter: bigint;
  readonly remainingActiveSeconds: bigint; readonly estimatedEndTime: bigint; readonly currentRewardsPerMinute: bigint;
}
export interface V1CreationDomain extends BlockReference {
  readonly chainId: V1ChainId; readonly mechanismId: string; readonly factory: string;
  readonly implementation: string; readonly portal: string;
  readonly creationCodeHash: string; readonly tokenAddressSuffix: string;
}
export interface V1TokenLaunch {
  readonly name: string; readonly symbol: string; readonly supply: bigint;
  /** bytes32, first 20 bytes equal the transaction creator; caller supplies the vanity nonce. */
  readonly salt: string; readonly expectedAddress: string; readonly quoteAsset: string;
  readonly targetNative: bigint; readonly quoteTarget: bigint; readonly deadline: bigint;
  readonly customTarget: boolean; readonly metadataURI?: string;
}
export interface V1LinkedStakingConfig {
  readonly principalLock: V1PrincipalLock; readonly cycleDays: number;
  readonly stakeMode: 0 | 1 | 2; readonly customStake: string;
}
export interface V1PrepaidPoolCreation {
  readonly principalLock: V1PrincipalLock;
  readonly rewardToken: string; readonly stakingAsset: string;
  readonly rewardAmount: bigint; readonly minimumReceived?: bigint;
  readonly durationSeconds: number; readonly halvingIntervalSeconds?: number; readonly halvingCount?: number;
}
export interface V1CyclePoolCreation {
  readonly principalLock: V1PrincipalLock; readonly rewardAsset: string; readonly stakingAsset: string;
  readonly cycleDays: number; readonly initialRewardAmount: bigint; readonly minimumReceived?: bigint;
}
