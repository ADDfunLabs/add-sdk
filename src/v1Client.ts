import { Contract, Interface, ZeroAddress, keccak256, getCreate2Address, toUtf8Bytes, type Provider, type Log } from 'ethers';
import {
  V1_DEPLOYMENTS, V1_PORTAL_ABIS, V1_TOKEN_ABI, V1_TAX_TOKEN_ABI,
  V1_DIVIDEND_ABI, V1_STAKING_POOL_ABI, V1_STAKING_FACTORY_ABI, V1_STAKING_TAX_FACTORY_ABI,
  V1_FACTORY_ABIS, V1_TAX_FACTORY_ABIS, V1_STAKING_FACTORY_ABIS, V1_STAKING_TAX_FACTORY_ABIS,
} from './v1Generated.js';
import { address, ensure, same, uint, whole, minimumOutput, remainingBuyBudget } from './validation.js';
import { V1_MAX_QUOTE_AGE_SECONDS, V1_MAX_POOL_AMOUNT, V1_PHASE_NAMES, v1ChainId, v1CodeHash,
  v1CloneCode, v1PoolIdentity, v1Deadline, v1MinimumReceived, v1PrincipalLock } from './v1Validation.js';
import type { BlockReference, ReadBlock } from './types.js';
import type {
  V1ChainId, V1Deployment, V1Mechanism, V1StakingDeployment, V1ReadOptions, V1TokenSnapshot,
  V1LaunchTarget, V1TradeQuote, V1UnsignedTransaction, V1SwapOptions, V1Allowance, V1Event,
  V1TaxSnapshot, V1TaxConfig, V1DividendSnapshot, V1StakingSnapshot, V1StakingSchedule,
  V1StakingAccount, V1UnlockInfo, V1CycleInfo, V1StakingPosition, V1FundingPreview,
  V1CreationDomain, V1TokenLaunch, V1LinkedStakingConfig, V1PrepaidPoolCreation, V1CyclePoolCreation,
} from './v1Types.js';

const factoryReads = [
  'function portal() view returns(address)', 'function portalFactoryVersion() view returns(uint256)',
  'function isCreatedToken(address) view returns(bool)', 'function creatorOf(address) view returns(address)',
  'function implementation() view returns(address)', 'function dividendImplementation() view returns(address)',
  'function dividendOf(address) view returns(address)', 'function stakingOf(address) view returns(address)',
];
const routerReads = ['function getAmountsIn(uint256,address[]) view returns(uint256[])'];
const tokenInterface = new Interface(V1_TOKEN_ABI), taxInterface = new Interface(V1_TAX_TOKEN_ABI);
const dividendInterface = new Interface(V1_DIVIDEND_ABI), stakingInterface = new Interface(V1_STAKING_POOL_ABI);
const numeric = (value: unknown): bigint => uint(value as bigint);
const phaseForToken = [0, 1, 2, 3, 1, 4, 5] as const;

/** Explicit-chain, immutable-deployment V1 client. Uses only provider reads and unsigned calldata.
 * The historical AddClient remains a separate v12/v13 implementation; no ABI fallback is attempted.
 * Trust overrides authorize reviewed code, not arbitrary addresses claiming a version getter.
 */
export class AddV1Client {
  readonly provider: Provider;
  readonly chainId: V1ChainId;
  readonly deployment: V1Deployment;
  private readonly portalInterface: Interface;
  private readonly issuedQuotes = new WeakSet<object>();
  private readonly issuedTransactions = new WeakSet<object>();

  constructor(provider: Provider, options: {chainId: V1ChainId; deployment?: V1Deployment}) {
    this.provider = provider; this.chainId = v1ChainId(options.chainId);
    const supplied = options.deployment ?? V1_DEPLOYMENTS.find(d => d.chainId === this.chainId);
    ensure(supplied && supplied.chainId === this.chainId, 'INVALID_DEPLOYMENT', 'No matching explicit-chain V1 deployment is pinned.');
    const mechanisms = supplied.mechanisms.map(m => {
      ensure(['standard', 'tax', 'staking-tax'].includes(m.kind) && typeof m.id === 'string' && m.id.length > 0,
        'INVALID_DEPLOYMENT', 'A reviewed factory mechanism is required.');
      ensure(Boolean(m.dividendImplementation) === Boolean(m.dividendHash), 'INVALID_DEPLOYMENT', 'Dividend trust pins must be complete.');
      return Object.freeze({...m, factory: address(m.factory), factoryHash: v1CodeHash(m.factoryHash),
        implementation: address(m.implementation), templateHash: v1CodeHash(m.templateHash),
        ...(m.dividendImplementation ? {dividendImplementation: address(m.dividendImplementation), dividendHash: v1CodeHash(m.dividendHash!)} : {})});
    });
    const staking = supplied.staking.map(d => {
      ensure(d.version === 2 && ['standalone', 'tax'].includes(d.kind), 'INVALID_DEPLOYMENT', 'Only reviewed staking V2 deployments are supported.');
      if (d.startBlock !== undefined) whole(d.startBlock, 0, Number.MAX_SAFE_INTEGER);
      return Object.freeze({...d, factory: address(d.factory), factoryHash: v1CodeHash(d.factoryHash),
        poolImplementation: address(d.poolImplementation), poolHash: v1CodeHash(d.poolHash), wrappedNative: address(d.wrappedNative)});
    });
    ensure(new Set(mechanisms.map(m => m.factory.toLowerCase())).size === mechanisms.length,
      'INVALID_DEPLOYMENT', 'Duplicate mechanism factories.');
    ensure(new Set(mechanisms.map(m => m.id)).size === mechanisms.length,
      'INVALID_DEPLOYMENT', 'Duplicate mechanism identifiers.');
    ensure(new Set(staking.map(d => d.factory.toLowerCase())).size === staking.length,
      'INVALID_DEPLOYMENT', 'Duplicate staking factories.');
    ensure(staking.filter(d => d.kind === 'standalone').length <= 1,
      'INVALID_DEPLOYMENT', 'Choose one reviewed standalone staking factory per deployment.');
    const roles = supplied.roles?.map(r => Object.freeze({...r, address: address(r.address), codeHash: v1CodeHash(r.codeHash)}));
    this.deployment = Object.freeze({...supplied, portal: address(supplied.portal), portalHash: v1CodeHash(supplied.portalHash),
      startBlock: whole(supplied.startBlock, 0, Number.MAX_SAFE_INTEGER), router: address(supplied.router),
      dexFactory: address(supplied.dexFactory), wrappedNative: address(supplied.wrappedNative), feeRecipient: address(supplied.feeRecipient),
      mechanisms: Object.freeze(mechanisms), staking: Object.freeze(staking), ...(roles ? {roles: Object.freeze(roles)} : {})});
    this.portalInterface = new Interface(V1_PORTAL_ABIS[this.chainId]);
  }

  private async block(tag: ReadBlock = 'latest'): Promise<BlockReference> {
    ensure((await this.provider.getNetwork()).chainId === BigInt(this.chainId), 'WRONG_CHAIN', 'Provider chain does not match the explicitly selected SDK deployment.');
    if (typeof tag === 'number') whole(tag, 0, Number.MAX_SAFE_INTEGER);
    else ensure(tag === 'latest' || tag === 'finalized', 'INVALID_BLOCK', 'Use a block number, latest or finalized.');
    const b = await this.provider.getBlock(tag);
    ensure(b?.hash && /^0x[0-9a-fA-F]{64}$/.test(b.hash), 'BLOCK_UNAVAILABLE', 'A canonical block hash is required.');
    return Object.freeze({blockNumber: whole(b.number, 0, Number.MAX_SAFE_INTEGER), blockHash: b.hash,
      timestamp: whole(b.timestamp, 0, Number.MAX_SAFE_INTEGER)});
  }
  private async stable(b: BlockReference): Promise<void> {
    const [network, current] = await Promise.all([this.provider.getNetwork(), this.provider.getBlock(b.blockNumber)]);
    ensure(network.chainId === BigInt(this.chainId), 'WRONG_CHAIN', 'Provider switched chains during the operation.');
    ensure(current?.hash === b.blockHash, 'BLOCK_CHANGED', 'Block changed during the read; discard the result and retry.');
  }
  private async pin(target: string, expected: string, b: BlockReference): Promise<string> {
    const code = await this.provider.getCode(target, b.blockNumber);
    ensure(code !== '0x' && keccak256(code).toLowerCase() === expected.toLowerCase(), 'CODE_MISMATCH', 'Runtime code does not match the reviewed deployment.');
    return code;
  }
  private async portalAt(b: BlockReference): Promise<Contract> {
    const d = this.deployment, at = {blockTag: b.blockNumber};
    ensure(b.blockNumber >= d.startBlock, 'BEFORE_DEPLOYMENT', 'Portal was not deployed at this block.');
    await Promise.all([this.pin(d.portal, d.portalHash, b), ...(d.roles ?? []).map(r => this.pin(r.address, r.codeHash, b))]);
    const p = new Contract(d.portal, V1_PORTAL_ABIS[this.chainId], this.provider);
    const [version, router, factory, wrapped] = await Promise.all([
      p.getFunction('DEPLOYMENT_VERSION')(at), p.getFunction('router')(at), p.getFunction('dexFactory')(at), p.getFunction('wrappedNative')(at),
    ]);
    ensure(version === 1n && same(router, d.router) && same(factory, d.dexFactory) && same(wrapped, d.wrappedNative),
      'BINDING_MISMATCH', 'Portal version or immutable DEX bindings do not match the selected deployment.');
    return p;
  }
  private mechanism(factory: string): V1Mechanism | undefined {
    return this.deployment.mechanisms.find(m => same(m.factory, factory));
  }
  private async reviewedToken(token: string, factory: string, creator: string, b: BlockReference): Promise<V1Mechanism | undefined> {
    const m = this.mechanism(factory); if (!m) return undefined;
    await Promise.all([this.pin(m.factory, m.factoryHash, b), this.pin(m.implementation, m.templateHash, b)]);
    const code = await this.provider.getCode(token, b.blockNumber);
    ensure(code.toLowerCase() === v1CloneCode(m.implementation), 'CODE_MISMATCH', 'Token is not the exact reviewed implementation clone.');
    const f = new Contract(m.factory, factoryReads, this.provider), t = new Contract(token, V1_TOKEN_ABI, this.provider), at = {blockTag: b.blockNumber};
    const [bound, version, created, recordedCreator, implementation, authority, tokenPortal, tokenVersion] = await Promise.all([
      f.getFunction('portal')(at), f.getFunction('portalFactoryVersion')(at), f.getFunction('isCreatedToken')(token, at),
      f.getFunction('creatorOf')(token, at), f.getFunction('implementation')(at), t.getFunction('initializationFactory')(at),
      t.getFunction('portal')(at), t.getFunction('portalTokenVersion')(at),
    ]);
    // Current factory admission is deliberately not required: removal revokes NEW
    // launches, while the Portal preserves previously admitted holders' exits.
    ensure(created === true && version === 1n && tokenVersion === 1n && same(bound, this.deployment.portal)
      && same(recordedCreator, creator) && same(implementation, m.implementation) && same(authority, m.factory)
      && same(tokenPortal, this.deployment.portal), 'BINDING_MISMATCH', 'Token/factory creation and initialization bindings do not match.');
    return m;
  }
  private async tokenAt(input: string, b: BlockReference): Promise<V1TokenSnapshot> {
    const token = address(input), p = await this.portalAt(b), at = {blockTag: b.blockNumber};
    const row = await p.getFunction('getPool')(token, at), phase = whole(Number(row[14]), 0, 6);
    ensure(phase !== 0, 'UNREGISTERED_TOKEN', 'Token has no registered V1 pool in this Portal.');
    const factory = address(row[0], true), creator = address(row[1]), asset = address(row[2], true), pair = address(row[3]);
    const inventory = uint(row[4], true), allocation = uint(row[5], true), liquidity = uint(row[6], true), sold = uint(row[7]), reserve = uint(row[8]);
    ensure(allocation === inventory / 2n && liquidity === allocation && allocation <= V1_MAX_POOL_AMOUNT && sold <= allocation,
      'INVALID_STATE', 'Invalid V1 inventory accounting.');
    const quoteTarget = uint(row[10], true), targetNative = uint(row[9], true), quoteDecimals = whole(Number(row[11]), 0, 36);
    ensure(quoteTarget <= V1_MAX_POOL_AMOUNT && (asset !== ZeroAddress || quoteDecimals === 18), 'INVALID_STATE', 'Invalid quote denomination.');
    const m = await this.reviewedToken(token, factory, creator, b), t = new Contract(token, V1_TOKEN_ABI, this.provider);
    const [name, symbol, decimals, feeRecipient] = await Promise.all([
      t.getFunction('name')(at), t.getFunction('symbol')(at), t.getFunction('decimals')(at), p.getFunction('feeRecipient')(at),
    ]);
    if (m) {
      const [tokenPhase, tokenPair] = await Promise.all([t.getFunction('phase')(at), t.getFunction('pair')(at)]);
      ensure(Number(tokenPhase) === phaseForToken[phase] && same(tokenPair, pair) && row[13] === true,
        'INVALID_STATE', 'Reviewed token lifecycle differs from Portal ledger.');
    }
    const settlement = phase === 3 ? await p.getFunction('graduationSettlement')(token, at) : null;
    // Graduation may replace the settlement asset without rewriting the original
    // target ledger. Read the final pair/asset separately rather than assuming it
    // always represents the original fundraising denomination.
    return Object.freeze({...b, chainId: this.chainId, token, portal: this.deployment.portal, factory, creator, pair,
      name: String(name), symbol: String(symbol), decimals: whole(Number(decimals), 0, 36),
      phase: V1_PHASE_NAMES[phase]!, phaseNumber: phase, initialInventory: inventory, saleAllocation: allocation,
      liquidityAllocation: liquidity, sold, remaining: allocation - sold, reserve, quoteAsset: asset, quoteDecimals,
      targetNative, quoteTarget, customTarget: Boolean(row[12]), lifecycleHooks: Boolean(row[13]),
      progressBps: sold * 10000n / allocation, feeRecipient: address(feeRecipient), reviewed: Boolean(m), mechanismId: m?.id ?? null,
      settlementQuoteAsset: settlement ? address(settlement[0], true) : null, settlementQuoteAmount: settlement ? numeric(settlement[1]) : null});
  }
  private reviewed(s: V1TokenSnapshot): void {
    ensure(s.reviewed, 'UNREVIEWED_TOKEN', 'Money builders accept only the exact pinned ADD token implementations.');
  }
  private active(s: V1TokenSnapshot): void {
    this.reviewed(s); ensure(s.phase === 'active', 'POOL_NOT_ACTIVE', 'Only active inner-market pools can be traded.');
  }
  async readToken(token: string, options: V1ReadOptions = {}): Promise<V1TokenSnapshot> {
    const b = await this.block(options.blockTag), result = await this.tokenAt(token, b); await this.stable(b); return result;
  }
  async getLaunchTarget(quoteAsset = ZeroAddress, options: V1ReadOptions & {targetNative?: bigint} = {}): Promise<V1LaunchTarget> {
    const asset = address(quoteAsset, true), b = await this.block(options.blockTag), p = await this.portalAt(b), at = {blockTag: b.blockNumber};
    const [defaultTarget, custom] = await Promise.all([
      p.getFunction(this.chainId === 1 ? 'DEFAULT_TARGET_ETH' : 'DEFAULT_TARGET_BNB')(at), p.getFunction('customTargetsEnabled')(at),
    ]);
    const target = uint(options.targetNative ?? defaultTarget, true);
    const [quoteTarget, decimals] = await p.getFunction('quoteGraduationTarget')(asset, target, at);
    await this.stable(b);
    return Object.freeze({...b, chainId: this.chainId, portal: this.deployment.portal, quoteAsset: asset,
      targetNative: target, quoteTarget: uint(quoteTarget, true), quoteDecimals: whole(Number(decimals), 0, 36),
      defaultTargetNative: uint(defaultTarget, true), customTargetsEnabled: Boolean(custom)});
  }
  private issued(q: V1TradeQuote): V1TradeQuote { Object.freeze(q); this.issuedQuotes.add(q); return q; }
  private async buyAt(s: V1TokenSnapshot, payment: bigint, kind: 'buy' | 'remaining', quotedPayment?: bigint): Promise<V1TradeQuote> {
    this.active(s); uint(payment, true);
    const p = new Contract(s.portal, V1_PORTAL_ABIS[this.chainId], this.provider), at = {blockTag: s.blockNumber};
    await p.getFunction('assertPoolBacking')(s.token, at);
    const q = await p.getFunction('quoteBuy')(s.token, payment, at);
    const output = uint(q[0], true), principal = uint(q[1], true), nativeUsed = uint(q[2], true), fee = uint(q[3]), refund = uint(q[4]);
    const budget = payment - payment / 100n;
    ensure(output <= s.remaining && principal === (output * s.quoteTarget + s.saleAllocation - 1n) / s.saleAllocation
      && nativeUsed <= budget && fee === (nativeUsed === budget ? payment / 100n : nativeUsed / 99n)
      && nativeUsed + fee + refund === payment && (s.quoteAsset !== ZeroAddress || principal === nativeUsed),
      'INVALID_QUOTE', 'V1 buy quote has inconsistent output, denomination or payment accounting.');
    return this.issued({blockNumber: s.blockNumber, blockHash: s.blockHash, timestamp: s.timestamp, chainId: s.chainId,
      token: s.token, portal: s.portal, kind, quoteAsset: s.quoteAsset, quoteDecimals: s.quoteDecimals, poolIdentity: v1PoolIdentity(s),
      inputAmount: payment, outputAmount: output, quotePrincipal: principal, nativePrincipal: nativeUsed,
      nativeFee: fee, nativeRefund: refund, quotedNativePayment: quotedPayment ?? payment - refund});
  }
  async quoteBuy(token: string, paymentNative: bigint, options: V1ReadOptions = {}): Promise<V1TradeQuote> {
    uint(paymentNative, true); const b = await this.block(options.blockTag), s = await this.tokenAt(token, b), result = await this.buyAt(s, paymentNative, 'buy');
    await this.stable(b); return result;
  }
  async quoteSell(token: string, amount: bigint, options: V1ReadOptions = {}): Promise<V1TradeQuote> {
    uint(amount, true); const b = await this.block(options.blockTag), s = await this.tokenAt(token, b); this.active(s);
    ensure(amount <= s.sold, 'INVALID_AMOUNT', 'Sell exceeds the outstanding inner-market supply.');
    const p = new Contract(s.portal, V1_PORTAL_ABIS[this.chainId], this.provider), at = {blockTag: b.blockNumber};
    await p.getFunction('assertPoolBacking')(s.token, at);
    const q = await p.getFunction('quoteSell')(s.token, amount, at), principal = uint(q[0], true), gross = uint(q[1], true), fee = uint(q[2]), net = uint(q[3], true);
    ensure(principal === amount * s.quoteTarget / s.saleAllocation && gross === fee + net && fee === gross / 100n
      && principal <= s.reserve && (s.quoteAsset !== ZeroAddress || principal === gross), 'INVALID_QUOTE', 'Inconsistent sell pricing, fee, backing or denomination.');
    await this.stable(b);
    return this.issued({...b, chainId: this.chainId, kind: 'sell', token: s.token, portal: s.portal, quoteAsset: s.quoteAsset,
      quoteDecimals: s.quoteDecimals, poolIdentity: v1PoolIdentity(s), inputAmount: amount, outputAmount: net,
      quotePrincipal: principal, nativePrincipal: gross, nativeFee: fee, nativeRefund: 0n, quotedNativePayment: 0n});
  }
  async quoteRemainingBuy(token: string, options: V1ReadOptions & {bufferBps?: number} = {}): Promise<V1TradeQuote> {
    const buffer = whole(options.bufferBps ?? 300, 0, 300), b = await this.block(options.blockTag), s = await this.tokenAt(token, b); this.active(s); uint(s.remaining, true);
    const principal = (s.remaining * s.quoteTarget + s.saleAllocation - 1n) / s.saleAllocation;
    let nativeUsed = principal;
    if (s.quoteAsset !== ZeroAddress) {
      const r = new Contract(this.deployment.router, routerReads, this.provider);
      const amounts = await r.getFunction('getAmountsIn')(principal, [this.deployment.wrappedNative, s.quoteAsset], {blockTag: b.blockNumber});
      ensure(amounts.length === 2 && amounts[1] === principal, 'INVALID_QUOTE', 'Invalid native-to-quote conversion.'); nativeUsed = uint(amounts[0], true);
    }
    const quoted = uint(nativeUsed + nativeUsed / 99n, true), payment = remainingBuyBudget(quoted, buffer), q = await this.buyAt(s, payment, 'remaining', quoted);
    ensure(q.outputAmount === s.remaining && q.nativePrincipal === nativeUsed, 'QUOTE_CHANGED', 'Full remaining-supply payment does not match the authoritative quote.');
    await this.stable(b); return q;
  }
  async quoteRefund(token: string, amount: bigint, options: V1ReadOptions = {}): Promise<V1TradeQuote> {
    uint(amount, true); const b = await this.block(options.blockTag), s = await this.tokenAt(token, b); this.reviewed(s);
    ensure(s.phase === 'refund-only', 'REFUNDS_NOT_ENABLED', 'Refunds require the Portal refund-only phase.');
    ensure(amount <= s.sold, 'INVALID_AMOUNT', 'Refund exceeds outstanding redeemable tokens.');
    const p = new Contract(s.portal, V1_PORTAL_ABIS[this.chainId], this.provider), at = {blockTag: b.blockNumber};
    await p.getFunction('assertPoolBacking')(s.token, at);
    const output = uint(await p.getFunction('quoteRefund')(s.token, amount, at), true);
    ensure(output === (amount === s.sold ? s.reserve : s.reserve * amount / s.sold), 'INVALID_QUOTE', 'Refund is inconsistent with the original asset reserve.');
    await this.stable(b);
    return this.issued({...b, chainId: this.chainId, kind: 'refund', token: s.token, portal: s.portal, quoteAsset: s.quoteAsset,
      quoteDecimals: s.quoteDecimals, poolIdentity: v1PoolIdentity(s), inputAmount: amount, outputAmount: output,
      quotePrincipal: output, nativePrincipal: 0n, nativeFee: 0n, nativeRefund: 0n, quotedNativePayment: 0n});
  }
  private transaction(from: string, to: string, data: string, value = 0n, gasLimit?: bigint): V1UnsignedTransaction {
    const tx = Object.freeze({chainId: this.chainId, from: address(from), to: address(to), data, value: uint(value),
      ...(gasLimit === undefined ? {} : {gasLimit: uint(gasLimit, true)})});
    this.issuedTransactions.add(tx); return tx;
  }
  private async quoteCurrent(q: V1TradeQuote, options: V1SwapOptions): Promise<{snapshot: V1TokenSnapshot; minimum: bigint; block: BlockReference}> {
    ensure(this.issuedQuotes.has(q) && q.chainId === this.chainId && same(q.portal, this.deployment.portal), 'INVALID_QUOTE', 'Use an unchanged quote from this exact client instance.');
    const b = await this.block();
    ensure(b.timestamp >= q.timestamp && b.timestamp - q.timestamp <= V1_MAX_QUOTE_AGE_SECONDS,
      'STALE_QUOTE', 'Quote is older than 120 seconds or from a future block.');
    v1Deadline(options.deadline, b.timestamp); await this.stable(q);
    const s = await this.tokenAt(q.token, b); this.reviewed(s);
    ensure(v1PoolIdentity(s) === q.poolIdentity, 'QUOTE_CHANGED', 'Pool phase, asset, pair or fixed pricing identity changed.');
    if (q.kind === 'refund') ensure(s.phase === 'refund-only', 'REFUNDS_NOT_ENABLED', 'Refunds are no longer enabled.');
    else this.active(s);
    if (q.kind === 'remaining') ensure(s.remaining === q.outputAmount, 'QUOTE_CHANGED', 'Remaining inventory changed; request a new quote.');
    const minimum = q.kind === 'remaining' ? q.outputAmount : minimumOutput(q.outputAmount, whole(options.slippageBps ?? 50, 0, 1000));
    return {snapshot: s, minimum, block: b};
  }
  /** Builds native-payable buy, native-output sell, or original-asset refund. Does not approve or send anything. */
  async buildTrade(q: V1TradeQuote, account: string, options: V1SwapOptions): Promise<V1UnsignedTransaction> {
    const from = address(account), {snapshot: s, minimum, block: b} = await this.quoteCurrent(q, options), at = {blockTag: b.blockNumber};
    const p = new Contract(s.portal, V1_PORTAL_ABIS[this.chainId], this.provider);
    await p.getFunction('assertPoolBacking')(s.token, at);
    let method: string, args: unknown[], value = 0n;
    if (q.kind === 'buy' || q.kind === 'remaining') {
      ensure(await this.provider.getBalance(from, b.blockNumber) >= q.inputAmount, 'INSUFFICIENT_BALANCE', 'Native balance is below the payment, before reserving transaction gas.');
      const fresh = await p.getFunction('quoteBuy')(s.token, q.inputAmount, at);
      ensure(numeric(fresh[0]) >= minimum, 'QUOTE_CHANGED', 'Current buy output is below the chosen minimum.');
      method = 'buy'; args = [s.token, minimum, options.deadline]; value = q.inputAmount;
    } else {
      const allowed = await this.allowanceAt(s.token, from, s.portal, b);
      ensure(allowed.balance >= q.inputAmount, 'INSUFFICIENT_BALANCE', 'Token balance is below the input amount.');
      ensure(allowed.allowance >= q.inputAmount, 'INSUFFICIENT_ALLOWANCE', 'Confirm the exact Portal approval before building this exit.');
      ensure(q.inputAmount <= s.sold, 'QUOTE_CHANGED', 'Outstanding supply is below the quoted input amount.');
      const fresh = q.kind === 'refund' ? await p.getFunction('quoteRefund')(s.token, q.inputAmount, at)
        : (await p.getFunction('quoteSell')(s.token, q.inputAmount, at))[3];
      ensure(numeric(fresh) >= minimum, 'QUOTE_CHANGED', 'Current exit output is below the chosen minimum.');
      method = q.kind === 'refund' ? 'refund' : 'sell'; args = [s.token, q.inputAmount, minimum, options.deadline];
    }
    // A buy may cross the graduation threshold when mined. Estimating the earlier
    // inner-market-only state can under-budget the bounded V2 graduation attempt.
    // Match the platform ceiling so that estimator behavior cannot cause that failure.
    const gasLimit = q.kind === 'buy' || q.kind === 'remaining' ? 6_000_000n : undefined;
    await this.stable(b); return this.transaction(from, s.portal, this.portalInterface.encodeFunctionData(method, args), value, gasLimit);
  }
  async buildSwap(q: V1TradeQuote, account: string, options: V1SwapOptions): Promise<V1UnsignedTransaction> {
    ensure(q.kind !== 'refund', 'INVALID_QUOTE', 'Use buildRefund or buildTrade for original-asset refunds.'); return this.buildTrade(q, account, options);
  }
  async buildRefund(q: V1TradeQuote, account: string, options: V1SwapOptions): Promise<V1UnsignedTransaction> {
    ensure(q.kind === 'refund', 'INVALID_QUOTE', 'Use a refund quote.'); return this.buildTrade(q, account, options);
  }
  async buildApproval(token: string, account: string, amount: bigint): Promise<V1UnsignedTransaction> {
    uint(amount); const b = await this.block(), s = await this.tokenAt(token, b); this.reviewed(s);
    ensure(amount === 0n || s.phase === 'active' || s.phase === 'refund-only', 'POOL_NOT_ACTIVE', 'Only sell/refund exits need a positive Portal approval.');
    const from = address(account), balance = await new Contract(s.token, V1_TOKEN_ABI, this.provider).getFunction('balanceOf')(from, {blockTag: b.blockNumber});
    ensure(amount <= numeric(balance) && amount <= s.sold, 'INVALID_AMOUNT', 'Approval exceeds this wallet balance or redeemable supply.');
    await this.stable(b); return this.transaction(from, s.token, tokenInterface.encodeFunctionData('approve', [s.portal, amount]));
  }
  private async allowanceAt(token: string, account: string, spender: string, b: BlockReference): Promise<V1Allowance> {
    const asset = address(token), owner = address(account), target = address(spender), c = new Contract(asset, V1_TOKEN_ABI, this.provider), at = {blockTag: b.blockNumber};
    const [allowance, balance] = await Promise.all([c.getFunction('allowance')(owner, target, at), c.getFunction('balanceOf')(owner, at)]);
    return Object.freeze({...b, chainId: this.chainId, token: asset, account: owner, spender: target, allowance: numeric(allowance), balance: numeric(balance)});
  }
  async readAllowance(token: string, account: string, options: V1ReadOptions = {}): Promise<V1Allowance> {
    const b = await this.block(options.blockTag), s = await this.tokenAt(token, b); this.reviewed(s);
    const result = await this.allowanceAt(s.token, account, s.portal, b); await this.stable(b); return result;
  }
  /** eth_call only; after an approval transaction confirms, simulate the exit again. */
  async simulate(tx: V1UnsignedTransaction): Promise<string> {
    ensure(this.issuedTransactions.has(tx) && tx.chainId === this.chainId, 'INVALID_TRANSACTION', 'Simulate only an unchanged transaction built by this client.');
    const b = await this.block(), result = await this.provider.call({...tx, blockTag: b.blockNumber}); await this.stable(b); return result;
  }
  private decoded(log: Pick<Log, 'address' | 'data' | 'topics' | 'blockNumber' | 'blockHash' | 'transactionHash' | 'index' | 'removed'>, abi: Interface): V1Event | null {
    let parsed; try { parsed = abi.parseLog(log); } catch { return null; } if (!parsed) return null;
    const args: Record<string, unknown> = {}; parsed.fragment.inputs.forEach((input, i) => {args[input.name || String(i)] = parsed.args[i];});
    return Object.freeze({chainId: this.chainId, contract: address(log.address), name: parsed.name, args: Object.freeze(args),
      blockNumber: log.blockNumber, blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: log.index, removed: log.removed});
  }
  decodePortalLog(log: Pick<Log, 'address' | 'data' | 'topics' | 'blockNumber' | 'blockHash' | 'transactionHash' | 'index' | 'removed'>): V1Event | null {
    if (!same(log.address, this.deployment.portal)) return null; return this.decoded(log, this.portalInterface);
  }
  async getPortalEvents(fromBlock: number, toBlock: number): Promise<readonly V1Event[]> {
    whole(fromBlock, this.deployment.startBlock, Number.MAX_SAFE_INTEGER); whole(toBlock, fromBlock, Number.MAX_SAFE_INTEGER);
    ensure(toBlock - fromBlock < 2000, 'RANGE_TOO_LARGE', 'Request at most 2000 blocks; providers may require a smaller range.');
    const b = await this.block(toBlock); await this.portalAt(b);
    const logs = await this.provider.getLogs({address: this.deployment.portal, fromBlock, toBlock});
    const events = logs.map(log => this.decodePortalLog(log)).filter((event): event is V1Event => event !== null);
    const blocks = new Map<number, string>();
    for (const event of events) {
      whole(event.blockNumber, fromBlock, toBlock); whole(event.logIndex, 0, Number.MAX_SAFE_INTEGER);
      ensure(event.removed === false && /^0x[0-9a-fA-F]{64}$/.test(event.blockHash)
        && /^0x[0-9a-fA-F]{64}$/.test(event.transactionHash), 'INVALID_EVENT', 'Only mined canonical event identifiers are accepted.');
      const previous = blocks.get(event.blockNumber);
      ensure(previous === undefined || previous === event.blockHash, 'BLOCK_CHANGED', 'Events disagree about their block hash.');
      blocks.set(event.blockNumber, event.blockHash);
    }
    await Promise.all([...blocks].map(async ([number, hash]) => {
      ensure((await this.provider.getBlock(number))?.hash === hash, 'BLOCK_CHANGED', 'An event is no longer in its canonical block.');
    }));
    ensure(new Set(events.map(e => `${e.transactionHash}:${e.logIndex}`)).size === events.length,
      'INVALID_EVENT', 'Duplicate Portal event identifiers.');
    await this.stable(b); return Object.freeze(events);
  }

  private async taxAt(token: string, b: BlockReference): Promise<{snapshot: V1TaxSnapshot; mechanism: V1Mechanism; tokenSnapshot: V1TokenSnapshot}> {
    const s = await this.tokenAt(token, b); this.reviewed(s); const m = this.mechanism(s.factory)!;
    ensure(m.kind !== 'standard', 'NOT_TAX_TOKEN', 'Token does not use a pinned tax implementation.');
    const t = new Contract(s.token, V1_TAX_TOKEN_ABI, this.provider), f = new Contract(m.factory, factoryReads, this.provider), at = {blockTag: b.blockNumber};
    const names = ['config', 'dividend', 'rewardAsset', 'quoteToken', 'processingThreshold', 'unprocessedTokens',
      'pendingMarketing', 'pendingDividendQuote', 'pendingSelfReward', 'pendingLPToken', 'pendingLPQuote', 'totalBurned', 'totalLiquidity', 'graduatedAt', 'automaticProcessing'];
    const v = await Promise.all(names.map(name => t.getFunction(name)(at))), c = v[0];
    const config: V1TaxConfig = Object.freeze({buyTaxBps: whole(Number(c[0]), 0, 1000), sellTaxBps: whole(Number(c[1]), 0, 1000),
      marketingBps: whole(Number(c[2]), 0, 10000), burnBps: whole(Number(c[3]), 0, 10000), dividendBps: whole(Number(c[4]), 0, 10000),
      liquidityBps: whole(Number(c[5]), 0, 10000), marketingWallet: address(c[6], true), rewardMode: whole(Number(c[7]), 0, 2) as 0 | 1 | 2,
      rewardToken: address(c[8], true), minimumHolding: numeric(c[9])});
    ensure(config.marketingBps + config.burnBps + config.dividendBps + config.liquidityBps === 10000,
      'INVALID_STATE', 'Tax allocation must total 10000 basis points.');
    const dividend = address(v[1], true), registeredDividend = address(await f.getFunction('dividendOf')(s.token, at), true);
    ensure(same(dividend, registeredDividend) && (config.dividendBps > 0) === (dividend !== ZeroAddress), 'BINDING_MISMATCH', 'Dividend registration differs from token configuration.');
    const mining = m.kind === 'staking-tax' ? address(await f.getFunction('stakingOf')(s.token, at), true) : ZeroAddress;
    if (mining !== ZeroAddress) ensure(same(config.marketingWallet, mining), 'BINDING_MISMATCH', 'Tax marketing income is not bound to the registered mining pool.');
    const result: V1TaxSnapshot = Object.freeze({...b, chainId: this.chainId, token: s.token, portal: s.portal, config, dividend,
      stakingPool: mining === ZeroAddress ? null : mining, rewardAsset: address(v[2], true), quoteToken: address(v[3], true),
      processingThreshold: uint(v[4], true), unprocessedTokens: numeric(v[5]), pendingMarketing: numeric(v[6]),
      pendingDividendQuote: numeric(v[7]), pendingSelfReward: numeric(v[8]), pendingLPToken: numeric(v[9]), pendingLPQuote: numeric(v[10]),
      totalBurned: numeric(v[11]), totalLiquidity: numeric(v[12]), graduatedAt: numeric(v[13]), automaticProcessing: Boolean(v[14])});
    return {snapshot: result, mechanism: m, tokenSnapshot: s};
  }
  async readTax(token: string, options: V1ReadOptions = {}): Promise<V1TaxSnapshot> {
    const b = await this.block(options.blockTag), result = (await this.taxAt(token, b)).snapshot; await this.stable(b); return result;
  }
  private async dividendAt(token: string, holder: string | undefined, b: BlockReference): Promise<V1DividendSnapshot> {
    const {snapshot: tax, mechanism: m} = await this.taxAt(token, b);
    ensure(tax.dividend !== ZeroAddress && m.dividendImplementation && m.dividendHash, 'NO_DIVIDEND', 'Token has no reviewed dividend ledger.');
    await this.pin(m.dividendImplementation, m.dividendHash, b);
    ensure((await this.provider.getCode(tax.dividend, b.blockNumber)).toLowerCase() === v1CloneCode(m.dividendImplementation), 'CODE_MISMATCH', 'Dividend is not an exact reviewed clone.');
    const c = new Contract(tax.dividend, V1_DIVIDEND_ABI, this.provider), f = new Contract(m.factory, factoryReads, this.provider), at = {blockTag: b.blockNumber};
    const [bound, authority, implementation, wrapped, reward, native, minimum, shares, funded, claimed] = await Promise.all([
      c.getFunction('token')(at), c.getFunction('initializationFactory')(at), f.getFunction('dividendImplementation')(at),
      c.getFunction('wrappedNative')(at), c.getFunction('rewardToken')(at), c.getFunction('nativeReward')(at),
      c.getFunction('minimumHolding')(at), c.getFunction('totalShares')(at), c.getFunction('totalFunded')(at), c.getFunction('totalClaimed')(at),
    ]);
    const expectedReward = tax.config.rewardMode === 0 ? this.deployment.wrappedNative : tax.config.rewardMode === 2 ? tax.token : tax.config.rewardToken;
    ensure(same(bound, tax.token) && same(authority, m.factory) && same(implementation, m.dividendImplementation)
      && same(wrapped, this.deployment.wrappedNative) && same(reward, expectedReward)
      && Boolean(native) === (tax.config.rewardMode === 0) && minimum === tax.config.minimumHolding,
      'BINDING_MISMATCH', 'Dividend token, reward and initialization bindings do not match.');
    const account = holder === undefined ? null : address(holder);
    const claimable = account ? numeric(await c.getFunction('claimable')(account, at)) : null;
    return Object.freeze({...b, chainId: this.chainId, token: tax.token, dividend: tax.dividend, rewardToken: address(reward),
      nativeReward: Boolean(native), minimumHolding: numeric(minimum), totalShares: numeric(shares), totalFunded: numeric(funded),
      totalClaimed: numeric(claimed), account, claimable});
  }
  async readDividend(token: string, options: V1ReadOptions & {account?: string} = {}): Promise<V1DividendSnapshot> {
    const b = await this.block(options.blockTag), result = await this.dividendAt(token, options.account, b); await this.stable(b); return result;
  }
  /** claimFor always pays the named holder in ERC20/wrapped units; the gas payer cannot redirect it. */
  async buildDividendClaim(token: string, account: string, options: {unwrapNative?: boolean; holder?: string} = {}): Promise<V1UnsignedTransaction> {
    const from = address(account), holder = options.holder ? address(options.holder) : from, b = await this.block(), d = await this.dividendAt(token, holder, b);
    ensure(!options.unwrapNative || d.nativeReward, 'INVALID_REWARD', 'Only native dividends may be unwrapped.');
    ensure(!options.holder || !options.unwrapNative, 'INVALID_PARAMETER', 'A claimFor gas payer cannot unwrap or redirect the holder reward.');
    const tax = new Contract(d.token, V1_TAX_TOKEN_ABI, this.provider);
    ensure(!await tax.getFunction('automaticProcessing')({blockTag: b.blockNumber}), 'TAX_PROCESSING', 'Dividend claiming is unavailable during tax processing.');
    await this.stable(b);
    return this.transaction(from, d.dividend, dividendInterface.encodeFunctionData(options.holder ? 'claimFor' : 'claim', options.holder ? [holder] : [options.unwrapNative ?? false]));
  }
  async buildProcessTaxes(token: string, account: string): Promise<V1UnsignedTransaction> {
    const b = await this.block(), tax = await this.taxAt(token, b);
    ensure(tax.tokenSnapshot.phase === 'graduated' && !tax.snapshot.automaticProcessing, 'NOT_GRADUATED', 'Tax processing requires a graduated token outside an existing processing call.');
    // The bounded pipeline requires at least 3.1M gas at function entry even when
    // no swap is ready. Include headroom for intrinsic gas and the clone delegatecall.
    await this.stable(b); return this.transaction(account, tax.snapshot.token, taxInterface.encodeFunctionData('processTaxes'), 0n, 3_500_000n);
  }

  private async stakingAt(input: string, holder: string | undefined, b: BlockReference): Promise<V1StakingSnapshot> {
    const pool = address(input), c = new Contract(pool, V1_STAKING_POOL_ABI, this.provider), at = {blockTag: b.blockNumber};
    const authority = address(await c.getFunction('initializationFactory')(at));
    const d = this.deployment.staking.find(item => same(item.factory, authority));
    ensure(d, 'UNTRUSTED_POOL', 'Pool initialization factory is not a pinned staking V2 deployment.');
    if (d.startBlock !== undefined) ensure(b.blockNumber >= d.startBlock, 'BEFORE_DEPLOYMENT', 'Staking factory was not deployed at this block.');
    await Promise.all([this.pin(d.factory, d.factoryHash, b), this.pin(d.poolImplementation, d.poolHash, b)]);
    ensure((await this.provider.getCode(pool, b.blockNumber)).toLowerCase() === v1CloneCode(d.poolImplementation), 'CODE_MISMATCH', 'Staking pool is not the exact reviewed V2 clone.');
    const f = new Contract(d.factory, d.kind === 'tax' ? V1_STAKING_TAX_FACTORY_ABI : V1_STAKING_FACTORY_ABI, this.provider);
    const [registered, implementation, version, initialized, wrapper, fee, recipient] = await Promise.all([
      f.getFunction(d.kind === 'tax' ? 'isStakingPool' : 'isPool')(pool, at), f.getFunction(d.kind === 'tax' ? 'stakingImplementation' : 'implementation')(at),
      c.getFunction('VERSION')(at), c.getFunction('initialized')(at), c.getFunction('wrappedNative')(at), c.getFunction('FEE_BPS')(at), c.getFunction('FEE_RECIPIENT')(at),
    ]);
    ensure(registered === true && version === 2n && initialized === true && same(implementation, d.poolImplementation)
      && same(wrapper, d.wrappedNative) && same(wrapper, this.deployment.wrappedNative) && fee === 100n
      && same(recipient, '0xCb1D21591759E67E93D5054CaEbb5e972229DADd'), 'BINDING_MISMATCH', 'Staking factory, wrapper, version or fixed maintenance fee binding differs.');
    const names = ['creator', 'rewardToken', 'stakingAsset', 'stakingToken', 'nativeReward', 'cycling', 'linkedToken', 'linkedActivated', 'linkedStakeMode', 'principalLock', 'getCycleInfo'];
    const values = await Promise.all(names.map(name => c.getFunction(name)(at)));
    const linked = address(values[6], true), activated = Boolean(values[7]), creator = address(values[0]);
    if (d.kind === 'tax') {
      ensure(linked !== ZeroAddress, 'BINDING_MISMATCH', 'Tax-linked pool has no bound launch token.');
      const token = await this.tokenAt(linked, b); this.reviewed(token);
      const mining = await f.getFunction('stakingOf')(linked, at);
      ensure(same(token.factory, d.factory) && same(token.creator, creator) && same(mining, pool), 'BINDING_MISMATCH', 'Linked pool differs from launch factory registration.');
    } else ensure(linked === ZeroAddress, 'BINDING_MISMATCH', 'Standalone pool unexpectedly contains a linked token.');
    const lock = values[9], principalLock = v1PrincipalLock({mode: whole(Number(lock[0]), 0, 2) as 0 | 1 | 2,
      initialDays: Number(lock[1]), intervalDays: Number(lock[2]), batches: Number(lock[3])});
    const cycle = values[10], cycleInfo: V1CycleInfo = Object.freeze({number: numeric(cycle[0]), duration: numeric(cycle[1]), budget: numeric(cycle[2]),
      emittedThisCycle: numeric(cycle[3]), elapsedThisCycle: numeric(cycle[4]), pendingUnrecognized: numeric(cycle[5]), awaitingGraduation: Boolean(cycle[6])});
    const account = holder === undefined ? null : address(holder), ready = address(values[1], true) !== ZeroAddress;
    const schedule = ready ? await c.getFunction('getSchedule')(at) : null;
    const accountInfo = ready && account ? await c.getFunction('getAccount')(account, at) : null;
    const unlock = account ? await c.getFunction('getUnlockInfo')(account, at) : null;
    return Object.freeze({...b, chainId: this.chainId, pool, factory: d.factory, creator,
      rewardToken: address(values[1], true), stakingAsset: address(values[2], true), stakingToken: address(values[3], true),
      nativeReward: Boolean(values[4]), cycling: Boolean(values[5]), linkedToken: linked, linkedActivated: activated,
      linkedStakeMode: whole(Number(values[8]), 0, 2), principalLock,
      schedule: schedule ? this.schedule(schedule) : null, cycle: cycleInfo, account,
      accountInfo: accountInfo ? this.stakingAccount(accountInfo) : null,
      unlock: unlock ? Object.freeze({withdrawable: numeric(unlock[0]), locked: numeric(unlock[1]), nextUnlockAt: numeric(unlock[2]), livePositions: numeric(unlock[3])}) : null});
  }
  private schedule(v: readonly unknown[]): V1StakingSchedule {
    return Object.freeze({remainingRewards: numeric(v[0]), emittedRewards: numeric(v[1]), grossClaimed: numeric(v[2]), fundedRewards: numeric(v[3]),
      stakedSupply: numeric(v[4]), activeElapsedSeconds: numeric(v[5]), remainingActiveSeconds: numeric(v[6]), estimatedEndTime: numeric(v[7]),
      currentRateNumerator: numeric(v[8]), currentRateDenominator: numeric(v[9]), currentRewardsPerMinute: numeric(v[10]),
      nextHalvingInActiveSeconds: numeric(v[11]), halvingsApplied: numeric(v[12]), pausedForNoStakers: Boolean(v[13]), finished: Boolean(v[14])});
  }
  private stakingAccount(v: readonly unknown[]): V1StakingAccount {
    const result = Object.freeze({staked: numeric(v[0]), totalStake: numeric(v[1]), shareBps: numeric(v[2]), earnedGross: numeric(v[3]),
      claimFee: numeric(v[4]), claimNet: numeric(v[5]), claimedGross: numeric(v[6]), paidFees: numeric(v[7])});
    ensure(result.earnedGross === result.claimFee + result.claimNet, 'INVALID_STATE', 'Staking claim fee accounting is inconsistent.'); return result;
  }
  private async readyStaking(s: V1StakingSnapshot, b: BlockReference): Promise<void> {
    if (s.linkedToken !== ZeroAddress && !s.linkedActivated) {
      const linked = await this.tokenAt(s.linkedToken, b);
      ensure(linked.phase === 'graduated', 'AWAITING_GRADUATION', 'Tax-linked staking starts only after graduation.');
      // The contract activates final reward/LP bindings during a user action. Ask the
      // caller to checkpoint first, then re-read the actual bindings for stake funding.
      ensure(false, 'ACTIVATION_REQUIRED', 'Build a checkpoint and re-read the activated pool before depositing or claiming.');
    }
    ensure(s.schedule !== null, 'UNINITIALIZED_POOL', 'Staking pool does not yet have bound reward assets.');
  }
  async readStakingPool(pool: string, options: V1ReadOptions & {account?: string} = {}): Promise<V1StakingSnapshot> {
    const b = await this.block(options.blockTag), result = await this.stakingAt(pool, options.account, b); await this.stable(b); return result;
  }
  async readStakingPositions(pool: string, account: string, options: V1ReadOptions & {offset?: number; limit?: number} = {}): Promise<readonly V1StakingPosition[]> {
    const offset = whole(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER), limit = whole(options.limit ?? 64, 1, 64), b = await this.block(options.blockTag);
    const s = await this.stakingAt(pool, account, b), c = new Contract(s.pool, V1_STAKING_POOL_ABI, this.provider);
    const list = await c.getFunction('getPositions')(address(account), offset, limit, {blockTag: b.blockNumber}); await this.stable(b);
    return Object.freeze(list.map((v: readonly unknown[]) => Object.freeze({deposited: numeric(v[0]), withdrawn: numeric(v[1]), startedAt: numeric(v[2])})));
  }
  async readStakingAllowance(pool: string, account: string, options: V1ReadOptions & {purpose?: 'stake' | 'fund'} = {}): Promise<V1Allowance> {
    ensure(options.purpose === undefined || options.purpose === 'stake' || options.purpose === 'fund', 'INVALID_PARAMETER', 'Choose staking principal or reward funding explicitly.');
    const b = await this.block(options.blockTag), s = await this.stakingAt(pool, account, b); await this.readyStaking(s, b);
    const asset = options.purpose === 'fund' ? s.rewardToken : s.stakingToken;
    ensure(options.purpose === 'fund' ? !s.nativeReward : s.stakingAsset !== ZeroAddress, 'NATIVE_ASSET', 'Native stake/reward funding does not require an ERC20 approval.');
    const result = await this.allowanceAt(asset, account, s.pool, b); await this.stable(b); return result;
  }
  async buildStakingApproval(pool: string, account: string, amount: bigint, options: {purpose?: 'stake' | 'fund'} = {}): Promise<V1UnsignedTransaction> {
    uint(amount); ensure(amount <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Staking amounts cannot exceed uint112.');
    const allowance = await this.readStakingAllowance(pool, account, options);
    ensure(amount <= allowance.balance, 'INSUFFICIENT_BALANCE', 'ERC20 balance is below the exact approval amount.');
    return this.transaction(account, allowance.token, tokenInterface.encodeFunctionData('approve', [allowance.spender, amount]));
  }
  async buildStake(pool: string, account: string, amount: bigint, options: {minimumReceived?: bigint} = {}): Promise<V1UnsignedTransaction> {
    uint(amount, true); const minimum = v1MinimumReceived(options.minimumReceived, amount), b = await this.block(), s = await this.stakingAt(pool, account, b); await this.readyStaking(s, b);
    ensure(amount <= V1_MAX_POOL_AMOUNT && (s.schedule!.stakedSupply + amount <= V1_MAX_POOL_AMOUNT), 'INVALID_AMOUNT', 'Requested stake exceeds pool capacity.');
    const allowed = s.stakingAsset === ZeroAddress ? null : await this.allowanceAt(s.stakingToken, account, s.pool, b);
    const balance = allowed ? allowed.balance : await this.provider.getBalance(address(account), b.blockNumber);
    ensure(numeric(balance) >= amount, 'INSUFFICIENT_BALANCE', 'Stake input exceeds wallet balance before transaction gas.');
    ensure(allowed === null || allowed.allowance >= amount, 'INSUFFICIENT_ALLOWANCE', 'Confirm the exact pool approval before building this stake.');
    await this.stable(b); return this.transaction(account, s.pool, stakingInterface.encodeFunctionData('stake', [amount, minimum]), s.stakingAsset === ZeroAddress ? amount : 0n);
  }
  async buildWithdraw(pool: string, account: string, amount: bigint, options: {receiver?: string; unwrapNative?: boolean} = {}): Promise<V1UnsignedTransaction> {
    uint(amount, true); const b = await this.block(), s = await this.stakingAt(pool, account, b);
    ensure(s.unlock && amount <= s.unlock.withdrawable, 'PRINCIPAL_LOCKED', 'Amount exceeds currently unlocked principal.');
    const unwrap = options.unwrapNative ?? false;
    ensure(!unwrap || s.stakingAsset === ZeroAddress, 'INVALID_ASSET', 'Only native principal may be unwrapped.');
    await this.stable(b); return this.transaction(account, s.pool, stakingInterface.encodeFunctionData('withdraw', [amount, this.receiver(s.pool, options.receiver ?? account), unwrap]));
  }
  private receiver(pool: string, input: string): string {
    const result = address(input); ensure(!same(pool, result), 'INVALID_RECIPIENT', 'The pool cannot receive its own withdrawal/claim.'); return result;
  }
  async buildStakingClaim(pool: string, account: string, options: {receiver?: string; wrappedReward?: boolean} = {}): Promise<V1UnsignedTransaction> {
    const b = await this.block(), s = await this.stakingAt(pool, account, b); await this.readyStaking(s, b); await this.stable(b);
    return this.transaction(account, s.pool, stakingInterface.encodeFunctionData(options.wrappedReward ? 'claimWrapped' : 'claim', [this.receiver(s.pool, options.receiver ?? account)]));
  }
  async buildCheckpoint(pool: string, account: string): Promise<V1UnsignedTransaction> {
    const b = await this.block(), s = await this.stakingAt(pool, undefined, b);
    if (s.linkedToken !== ZeroAddress && !s.linkedActivated) ensure((await this.tokenAt(s.linkedToken, b)).phase === 'graduated', 'AWAITING_GRADUATION', 'Linked mining cannot activate before graduation.');
    await this.stable(b); return this.transaction(account, s.pool, stakingInterface.encodeFunctionData('checkpoint'));
  }
  async previewAddRewards(pool: string, assumedReceived: bigint, mode: 'extend' | 'recalculate', options: V1ReadOptions = {}): Promise<V1FundingPreview> {
    uint(assumedReceived, true); ensure(mode === 'extend' || mode === 'recalculate', 'INVALID_PARAMETER', 'Choose extend or recalculate explicitly.');
    const b = await this.block(options.blockTag), s = await this.stakingAt(pool, undefined, b); await this.readyStaking(s, b);
    ensure(!s.cycling, 'CYCLIC_POOL', 'Use cycle information for recurrent pools.');
    const v = await new Contract(s.pool, V1_STAKING_POOL_ABI, this.provider).getFunction('previewAddRewards')(assumedReceived, mode === 'extend' ? 0 : 1, {blockTag: b.blockNumber});
    await this.stable(b); return Object.freeze({...b, chainId: this.chainId, pool: s.pool, mode,
      assumedReceived: numeric(v[0]), remainingRewardsAfter: numeric(v[1]), remainingActiveSeconds: numeric(v[2]), estimatedEndTime: numeric(v[3]), currentRewardsPerMinute: numeric(v[4])});
  }
  async buildAddRewards(pool: string, account: string, amount: bigint, options: {mode?: 'extend' | 'recalculate'; minimumReceived?: bigint} = {}): Promise<V1UnsignedTransaction> {
    uint(amount, true); const minimum = v1MinimumReceived(options.minimumReceived, amount), b = await this.block(), s = await this.stakingAt(pool, account, b); await this.readyStaking(s, b);
    ensure(amount <= V1_MAX_POOL_AMOUNT && s.schedule!.fundedRewards + amount <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Funding exceeds the protocol cap.');
    const mode = options.mode ?? 'extend'; ensure(mode === 'extend' || mode === 'recalculate', 'INVALID_PARAMETER', 'Choose extend or recalculate.');
    ensure(s.cycling ? options.mode === undefined : (mode !== 'recalculate' || s.schedule!.remainingActiveSeconds > 0n),
      'INVALID_PARAMETER', 'Cyclic funding has no mode; exhausted prepaid pools cannot recalculate an old end time.');
    const native = s.cycling && s.nativeReward;
    const allowed = native ? null : await this.allowanceAt(s.rewardToken, account, s.pool, b);
    const balance = allowed ? allowed.balance : await this.provider.getBalance(address(account), b.blockNumber);
    ensure(numeric(balance) >= amount, 'INSUFFICIENT_BALANCE', 'Reward funding exceeds wallet balance before gas.');
    ensure(allowed === null || allowed.allowance >= amount, 'INSUFFICIENT_ALLOWANCE', 'Confirm the exact pool reward approval before building this deposit.');
    await this.stable(b); return this.transaction(account, s.pool, stakingInterface.encodeFunctionData(s.cycling ? 'fundCycle' : 'addRewards',
      s.cycling ? [amount, minimum] : [amount, minimum, mode === 'extend' ? 0 : 1]), native ? amount : 0n);
  }

  private async creationAt(mechanismId: string, b: BlockReference): Promise<{domain: V1CreationDomain; mechanism: V1Mechanism; factory: Contract}> {
    const m = this.deployment.mechanisms.find(item => item.id === mechanismId);
    ensure(m, 'UNTRUSTED_FACTORY', 'Choose a reviewed creation mechanism from this chain catalog.');
    const p = await this.portalAt(b), at = {blockTag: b.blockNumber};
    await Promise.all([this.pin(m.factory, m.factoryHash, b), this.pin(m.implementation, m.templateHash, b)]);
    const abi = m.kind === 'standard' ? V1_FACTORY_ABIS[this.chainId] : m.kind === 'tax' ? V1_TAX_FACTORY_ABIS[this.chainId] : V1_STAKING_TAX_FACTORY_ABIS[this.chainId];
    const f = new Contract(m.factory, abi, this.provider);
    const [supported, admittedHash, portal, version, implementation, domain, code, authority] = await Promise.all([
      p.getFunction('isFactorySupported')(m.factory, at), p.getFunction('factoryCodeHash')(m.factory, at),
      f.getFunction('portal')(at), f.getFunction('portalFactoryVersion')(at), f.getFunction('implementation')(at),
      f.getFunction('getDeploymentInfo')(at), f.getFunction('creationCode')(at),
      new Contract(m.implementation, V1_TOKEN_ABI, this.provider).getFunction('initializationFactory')(at),
    ]);
    const expectedCode = `0x3d602d80600a3d3981f3${v1CloneCode(m.implementation).slice(2)}${this.deployment.portal.slice(2).toLowerCase()}`;
    ensure(supported === true && admittedHash.toLowerCase() === m.factoryHash && version === 1n && same(portal, this.deployment.portal)
      && same(implementation, m.implementation) && same(authority, m.factory) && same(domain[0], m.factory)
      && String(code).toLowerCase() === expectedCode && domain[1].toLowerCase() === keccak256(expectedCode)
      && domain[2].toLowerCase() === '0x1111', 'BINDING_MISMATCH', 'Creation factory admission, clone domain or initialization binding differs.');
    if (m.kind !== 'standard') ensure(same(await f.getFunction('router')(at), this.deployment.router), 'BINDING_MISMATCH', 'Tax factory uses a different router.');
    return {domain: Object.freeze({...b, chainId: this.chainId, mechanismId: m.id, factory: m.factory, implementation: m.implementation,
      portal: this.deployment.portal, creationCodeHash: domain[1].toLowerCase(), tokenAddressSuffix: '0x1111'}), mechanism: m, factory: f};
  }
  async readCreationDomain(mechanismId: string, options: V1ReadOptions = {}): Promise<V1CreationDomain> {
    const b = await this.block(options.blockTag), result = (await this.creationAt(mechanismId, b)).domain; await this.stable(b); return result;
  }
  async predictToken(mechanismId: string, salt: string, options: V1ReadOptions = {}): Promise<string> {
    ensure(/^0x[0-9a-fA-F]{64}$/.test(salt), 'INVALID_SALT', 'Provide a bytes32 creator-bound salt.');
    const b = await this.block(options.blockTag), {domain, factory} = await this.creationAt(mechanismId, b);
    const predicted = address(getCreate2Address(domain.factory, salt, domain.creationCodeHash));
    ensure(same(await factory.getFunction('predictToken')(salt, {blockTag: b.blockNumber}), predicted), 'BINDING_MISMATCH', 'Factory address prediction differs from the reviewed CREATE2 domain.');
    await this.stable(b); return predicted;
  }
  private async assetCode(asset: string, b: BlockReference, native = false): Promise<void> {
    if (native && asset === ZeroAddress) return;
    ensure(asset !== ZeroAddress && await this.provider.getCode(asset, b.blockNumber) !== '0x', 'INVALID_ASSET', 'An asset must be a deployed ERC20, or explicit zero address for native input.');
  }
  private async taxConfigAt(c: V1TaxConfig, launch: V1TokenLaunch, m: V1Mechanism, b: BlockReference, linked: boolean): Promise<readonly unknown[]> {
    whole(c.buyTaxBps, 0, 1000); whole(c.sellTaxBps, 0, 1000);
    ensure(c.buyTaxBps + c.sellTaxBps > 0 && c.buyTaxBps % 100 === 0 && c.sellTaxBps % 100 === 0,
      'INVALID_TAX', 'At least one buy/sell tax must be positive; use whole percentages encoded as basis points.');
    for (const allocation of [c.marketingBps, c.burnBps, c.dividendBps, c.liquidityBps]) {
      whole(allocation, 0, 10000); ensure(allocation % 100 === 0, 'INVALID_ALLOCATION', 'Tax allocation accepts integer percentages only.');
    }
    ensure(c.marketingBps + c.burnBps + c.dividendBps + c.liquidityBps === 10000, 'INVALID_ALLOCATION', 'Tax allocation must total 100%.');
    const wallet = address(c.marketingWallet, true), reward = address(c.rewardToken, true); whole(c.rewardMode, 0, 2); uint(c.minimumHolding);
    if (linked) ensure(c.marketingBps > 0, 'INVALID_ALLOCATION', 'Tax-linked mining needs a positive marketing allocation.');
    else if (c.marketingBps > 0) ensure(wallet !== ZeroAddress && ![launch.expectedAddress, this.deployment.portal, this.deployment.router, '0x000000000000000000000000000000000000dEaD'].some(target => same(wallet, target)), 'INVALID_RECIPIENT', 'Marketing requires a valid recipient separate from infrastructure.');
    if (c.rewardMode === 1) { await this.assetCode(reward, b); ensure(!same(reward, launch.expectedAddress), 'INVALID_REWARD', 'Use self mode for the token itself.'); }
    else ensure(reward === ZeroAddress, 'INVALID_REWARD', 'Native/self mode uses a zero custom reward address.');
    if (c.dividendBps > 0) {
      ensure(c.minimumHolding >= 10000n * 10n ** 18n && c.minimumHolding <= launch.supply, 'INVALID_DIVIDEND', 'Dividend minimum is at least 10000 tokens and cannot exceed supply.');
      ensure(m.dividendImplementation && m.dividendHash, 'INVALID_DEPLOYMENT', 'Dividend creation needs reviewed implementation pins.');
      await this.pin(m.dividendImplementation, m.dividendHash, b);
      ensure(same(await new Contract(m.dividendImplementation, V1_DIVIDEND_ABI, this.provider).getFunction('initializationFactory')({blockTag: b.blockNumber}), m.factory), 'BINDING_MISMATCH', 'Dividend implementation has a different initialization authority.');
    }
    return [c.buyTaxBps, c.sellTaxBps, c.marketingBps, c.burnBps, c.dividendBps, c.liquidityBps, wallet, c.rewardMode, reward, c.minimumHolding];
  }
  /** Caller supplies an explicit creator-bound salt/predicted address and reviewed quote target. No vanity search or first buy is hidden here. */
  async buildCreateToken(mechanismId: string, account: string, launch: V1TokenLaunch,
    options: {tax?: V1TaxConfig; staking?: V1LinkedStakingConfig} = {}): Promise<V1UnsignedTransaction> {
    const from = address(account), b = await this.block(), {domain, mechanism: m, factory} = await this.creationAt(mechanismId, b), at = {blockTag: b.blockNumber};
    const expected = address(launch.expectedAddress), quoteAsset = address(launch.quoteAsset, true);
    ensure(typeof launch.name === 'string' && toUtf8Bytes(launch.name).length > 0 && toUtf8Bytes(launch.name).length <= 128
      && typeof launch.symbol === 'string' && toUtf8Bytes(launch.symbol).length > 0 && toUtf8Bytes(launch.symbol).length <= 32,
      'INVALID_METADATA', 'Use 1–128 UTF-8 bytes for the name and 1–32 for the symbol.');
    uint(launch.supply, true); ensure(launch.supply >= 2n && launch.supply / 2n <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Token supply must fit two uint112 inventory halves.');
    ensure(/^0x[0-9a-fA-F]{64}$/.test(launch.salt) && same('0x' + launch.salt.slice(2, 42), from), 'INVALID_SALT', 'The first 20 salt bytes must equal the creator address.');
    const predicted = getCreate2Address(domain.factory, launch.salt, domain.creationCodeHash);
    ensure(same(expected, predicted) && expected.toLowerCase().endsWith('1111')
      && same(await factory.getFunction('predictToken')(launch.salt, at), expected), 'INVALID_PREPARED_ADDRESS', 'Salt must produce the supplied fresh ADD 1111 address.');
    ensure(await this.provider.getCode(expected, b.blockNumber) === '0x', 'ADDRESS_USED', 'Predicted token address is already deployed.');
    v1Deadline(launch.deadline, b.timestamp); uint(launch.targetNative, true); uint(launch.quoteTarget, true);
    ensure(typeof launch.customTarget === 'boolean', 'INVALID_PARAMETER', 'Specify standard or custom target explicitly.');
    ensure(quoteAsset !== this.deployment.wrappedNative && !same(quoteAsset, expected), 'INVALID_ASSET', 'Quote asset cannot be the wrapper or issued token.');
    const p = new Contract(this.deployment.portal, V1_PORTAL_ABIS[this.chainId], this.provider);
    const [defaultTarget, minimum, customEnabled, quoted] = await Promise.all([
      p.getFunction(this.chainId === 1 ? 'DEFAULT_TARGET_ETH' : 'DEFAULT_TARGET_BNB')(at),
      p.getFunction(this.chainId === 1 ? 'MIN_TARGET_ETH' : 'MIN_TARGET_BNB')(at), p.getFunction('customTargetsEnabled')(at),
      p.getFunction('quoteGraduationTarget')(quoteAsset, launch.targetNative, at),
    ]);
    ensure(launch.targetNative >= minimum && (launch.customTarget ? customEnabled === true : launch.targetNative === defaultTarget), 'INVALID_TARGET', 'Target is below the minimum, differs from the current default, or custom targets are closed.');
    ensure(launch.quoteTarget === quoted[0] && launch.quoteTarget <= V1_MAX_POOL_AMOUNT, 'QUOTE_CHANGED', 'Quote target differs from the current Portal conversion.');
    const metadata = launch.metadataURI ?? ''; ensure(typeof metadata === 'string' && toUtf8Bytes(metadata).length <= 2048, 'INVALID_METADATA', 'Metadata URI exceeds 2048 UTF-8 bytes.');
    const args: unknown[] = [[launch.name, launch.symbol, launch.supply, launch.salt, expected, quoteAsset, launch.targetNative, launch.quoteTarget, launch.deadline, launch.customTarget, metadata]];
    let method = 'createToken';
    if (m.kind === 'standard') ensure(options.tax === undefined && options.staking === undefined, 'INVALID_PARAMETER', 'Standard creation has no tax or mining parameters.');
    else {
      ensure(options.tax, 'INVALID_TAX', 'Tax creation requires explicit fixed tax configuration.');
      args.push(await this.taxConfigAt(options.tax, launch, m, b, options.staking !== undefined));
      if (options.staking) {
        ensure(m.kind === 'staking-tax', 'INVALID_PARAMETER', 'Only the staking-tax V2 factory can create linked mining.');
        const s = options.staking, lock = v1PrincipalLock(s.principalLock), custom = address(s.customStake, true);
        whole(s.cycleDays, 1, 360); whole(s.stakeMode, 0, 2);
        ensure(s.stakeMode === 2 || custom === ZeroAddress, 'INVALID_ASSET', 'Self/LP modes must not include a custom staking asset.');
        if (s.stakeMode === 2) await this.assetCode(custom, b, true);
        const mining = this.deployment.staking.find(d => d.kind === 'tax' && same(d.factory, m.factory));
        ensure(mining, 'INVALID_DEPLOYMENT', 'Missing reviewed linked staking V2 implementation.');
        await this.pin(mining.poolImplementation, mining.poolHash, b);
        ensure(same(await factory.getFunction('stakingImplementation')(at), mining.poolImplementation), 'BINDING_MISMATCH', 'Linked staking template differs from the reviewed pin.');
        args.push([[lock.mode, lock.initialDays, lock.intervalDays, lock.batches], s.cycleDays, s.stakeMode, custom]); method = 'createTokenWithStaking';
      }
    }
    await this.stable(b); return this.transaction(from, domain.factory, factory.interface.encodeFunctionData(method, args));
  }
  private async standaloneFactoryAt(b: BlockReference): Promise<{deployment: V1StakingDeployment; factory: Contract}> {
    const d = this.deployment.staking.find(item => item.kind === 'standalone');
    ensure(d, 'INVALID_DEPLOYMENT', 'No reviewed standalone staking V2 factory on this chain.');
    if (d.startBlock !== undefined) ensure(b.blockNumber >= d.startBlock, 'BEFORE_DEPLOYMENT', 'Staking V2 factory was not deployed at this block.');
    await Promise.all([this.pin(d.factory, d.factoryHash, b), this.pin(d.poolImplementation, d.poolHash, b)]);
    const f = new Contract(d.factory, V1_STAKING_FACTORY_ABIS[this.chainId], this.provider), at = {blockTag: b.blockNumber};
    const [version, implementation, wrapped, authority] = await Promise.all([f.getFunction('VERSION')(at), f.getFunction('implementation')(at), f.getFunction('wrappedNative')(at),
      new Contract(d.poolImplementation, V1_STAKING_POOL_ABI, this.provider).getFunction('initializationFactory')(at)]);
    ensure(version === 2n && same(implementation, d.poolImplementation) && same(wrapped, d.wrappedNative)
      && same(wrapped, this.deployment.wrappedNative) && same(authority, d.factory), 'BINDING_MISMATCH', 'Standalone staking factory/template has different immutable bindings.');
    return {deployment: d, factory: f};
  }
  async buildPoolCreationApproval(account: string, rewardToken: string, amount: bigint): Promise<V1UnsignedTransaction> {
    uint(amount); ensure(amount <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Reward deposit exceeds uint112.');
    const b = await this.block(), {deployment: d} = await this.standaloneFactoryAt(b), asset = address(rewardToken);
    await this.assetCode(asset, b); const allowance = await this.allowanceAt(asset, account, d.factory, b);
    ensure(amount <= allowance.balance, 'INSUFFICIENT_BALANCE', 'Wallet balance is below the exact initial-reward approval.');
    await this.stable(b); return this.transaction(account, asset, tokenInterface.encodeFunctionData('approve', [d.factory, amount]));
  }
  async buildCreateStakingPool(account: string, params: V1PrepaidPoolCreation): Promise<V1UnsignedTransaction> {
    const b = await this.block(), {deployment: d, factory: f} = await this.standaloneFactoryAt(b), lock = v1PrincipalLock(params.principalLock);
    const reward = address(params.rewardToken), stake = address(params.stakingAsset, true), amount = uint(params.rewardAmount, true), minimum = v1MinimumReceived(params.minimumReceived, amount);
    ensure(amount <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Reward deposit exceeds uint112.');
    const duration = whole(params.durationSeconds, 1, 3650 * 86400), interval = whole(params.halvingIntervalSeconds ?? 0, 0, 3650 * 86400), count = whole(params.halvingCount ?? 0, 0, 32);
    ensure((interval === 0 && count === 0) || (interval > 0 && count > 0), 'INVALID_HALVING', 'Halving interval and count must both be enabled or both zero.');
    await Promise.all([this.assetCode(reward, b), this.assetCode(stake, b, true)]);
    const allowance = await this.allowanceAt(reward, account, d.factory, b);
    ensure(amount <= allowance.balance, 'INSUFFICIENT_BALANCE', 'Initial rewards exceed wallet balance.');
    ensure(amount <= allowance.allowance, 'INSUFFICIENT_ALLOWANCE', 'Confirm the exact initial-reward factory approval before creating a pool.');
    await this.stable(b); return this.transaction(account, d.factory, f.interface.encodeFunctionData('createPool',
      [[[lock.mode, lock.initialDays, lock.intervalDays, lock.batches], reward, stake, amount, minimum, duration, interval, count]]));
  }
  async buildCreateCyclePool(account: string, params: V1CyclePoolCreation): Promise<V1UnsignedTransaction> {
    const b = await this.block(), {deployment: d, factory: f} = await this.standaloneFactoryAt(b), lock = v1PrincipalLock(params.principalLock);
    const reward = address(params.rewardAsset, true), stake = address(params.stakingAsset, true), amount = uint(params.initialRewardAmount), minimum = v1MinimumReceived(params.minimumReceived, amount);
    ensure(amount <= V1_MAX_POOL_AMOUNT, 'INVALID_AMOUNT', 'Initial funding exceeds uint112.'); whole(params.cycleDays, 1, 360);
    await Promise.all([this.assetCode(reward, b, true), this.assetCode(stake, b, true)]);
    if (amount > 0n) {
      const allowed = reward === ZeroAddress ? null : await this.allowanceAt(reward, account, d.factory, b);
      const balance = allowed ? allowed.balance : await this.provider.getBalance(address(account), b.blockNumber);
      ensure(balance >= amount, 'INSUFFICIENT_BALANCE', 'Initial cycle rewards exceed wallet balance before gas.');
      ensure(allowed === null || allowed.allowance >= amount, 'INSUFFICIENT_ALLOWANCE', 'Confirm the exact initial-reward factory approval before creating a cycle pool.');
    }
    await this.stable(b); return this.transaction(account, d.factory, f.interface.encodeFunctionData('createCyclePool',
      [[[lock.mode, lock.initialDays, lock.intervalDays, lock.batches], reward, stake, params.cycleDays, amount, minimum]]), reward === ZeroAddress ? amount : 0n);
  }
}
