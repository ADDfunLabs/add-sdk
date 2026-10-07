# ADD SDK

Official TypeScript / JavaScript toolkit for ADD **new V1 on BSC and Ethereum**, staking V2 and per-token dividends. **0.2.0** includes SDK source, types, ESM and CommonJS. It reads contracts and prepares unsigned transactions; it never stores private keys, requests signatures or broadcasts.

- BSC mainnet, chain ID **56**: native BNB; graduation to PancakeSwap V2.
- Ethereum mainnet, chain ID **1**: native ETH; graduation to Uniswap V2.
- `AddV1Client` uses new V1. `AddClient` remains the historical BSC v12/v13 client. Choose the protocol explicitly: changing a Portal address does not convert its ABI.

[Platform docs](https://add.fun/docs/en/) · [API reference](https://add.fun/sdk/reference.html) · [中文](https://add.fun/sdk/zh.html) · [GitHub](https://github.com/ADDfunLabs/add-sdk)

## Install

Node.js 20 or newer. Distributed from the official website and GitHub; **not yet published to the npm registry**.

```sh
npm install https://add.fun/sdk/releases/add-fun-sdk-0.2.0.tgz
```

Verify the download against [release.json](https://add.fun/sdk/release.json) or its `.tgz.sha256` file. The manifest includes version, SHA-256, npm integrity and the allowlisted file inventory. Do not obtain trust pins from token metadata.

## Quick start

```ts
import { JsonRpcProvider, parseEther } from 'ethers';
import { AddV1Client } from '@add-fun/sdk';

const add = new AddV1Client(new JsonRpcProvider(RPC_URL), { chainId: 1 });
const token = await add.readToken(TOKEN_ADDRESS);
console.log(token.name, token.phase, token.quoteAsset, token.quoteTarget);

if (token.phase === 'active' && token.reviewed) {
  const quote = await add.quoteBuy(token.token, parseEther('0.01'));
  const request = await add.buildTrade(quote, WALLET_ADDRESS, {
    deadline: BigInt(quote.timestamp + 300), slippageBps: 50,
  });
  await add.simulate(request);
  // Your application reviews the request and asks the wallet to sign/send.
  // The SDK does neither. Requote if state changes or submission is delayed.
}
```

Use `{ chainId: 56 }` and a BSC provider for BSC. Wallet connection, switching and final submission belong to the application. Simulation reflects one block; it does not guarantee future execution.

## Units and quotes

Amounts are **bigint in base units**. Native BNB/ETH use 18 decimals; token input/output use their own precision; `reserve` and `quoteTarget` use `quoteDecimals`. USDT precision differs between chains. `ZeroAddress` means native asset in target/creation inputs; wrapped native is an ERC20 and not an interchangeable approval target.

Reads pin related calls to one numbered block and recheck its canonical hash. Quotes include chain, block/hash/time and pool identity. A builder accepts only the original frozen quote issued by the **same client**, not a copied or JSON-restored object. Quotes expire after 120 seconds of block time. Deadlines must be after the current block and within 15 minutes.

Ordinary trade slippage is an integer 0–1000 BPS, default 50 (0.5%). Remaining-supply buys have a separately bounded 0–300 BPS payment buffer, default 300 (3%). The Portal refunds final excess native payment. Builders preserve original input/minimum output and check current phase, price boundaries, balance and allowance. No SDK method routes graduated tokens through the inner market.

Confirm exact approval before simulating a sell or refund. Approval and trade are independent operations; re-read/rebuild after other transactions change state.

## Public API

### Market

- `new AddV1Client(provider, { chainId, deployment? })`: committed chain-specific runtime pins. A complete override is for separately reviewed deployments/local fixtures, never arbitrary user metadata.
- `readToken(token, { blockTag? })`: metadata, inventory split, reserve/target denominations, phase, factory/creator/pair, current fee recipient, reviewed mechanism. Unknown external pools may be inspected; fund-moving builders reject them.
- `getLaunchTarget(quoteAsset?, { targetNative?, blockTag? })`: current default/custom target and quote-asset amount; existing targets are locked snapshots.
- `quoteBuy(token, paymentNative, options?)`, `quoteSell(token, amount, options?)`, `quoteRemainingBuy(token, options?)`, `quoteRefund(token, amount, options?)`.
- `buildTrade(quote, account, { deadline, slippageBps? })`: unsigned buy/sell/refund; `buildSwap` and `buildRefund` are dedicated variants.
- `buildApproval(token, account, amount)` and `readAllowance(token, account, options?)`: exact approval/balance for this Portal, including eligible refunds.
- `simulate(request)`: `eth_call` of an unchanged request issued by this client; no Gas payment or broadcast.
- `decodePortalLog(log)` and `getPortalEvents(fromBlock, toBlock)`: this Portal only, inclusive ranges of at most 2000 blocks. Providers may require smaller ranges.

### Taxes and dividends

- `readTax(token, options?)`: fixed allocation, registered dividend/mining addresses, threshold and pending balances.
- `buildProcessTaxes(token, account)`: public processing for a graduated reviewed token. Contract thresholds and price/execution protections still apply; no payout is guaranteed.
- `readDividend(token, { account?, blockTag? })`: independent ledger, reward asset, minimum holding, total funded/claimed and holder claimable amount.
- `buildDividendClaim(token, gasPayer, { unwrapNative?, holder? })`: own claim or `claimFor(holder)`. A third-party Gas payer cannot redirect rewards. `claimFor` pays the holder in ERC20/wrapped units; unwrapping is available only for own native-reward claims.

### Staking V2

- `readStakingPool(pool, { account?, blockTag? })`: registered factory/clone, assets, cycle, schedule, account reward and principal locks; pending linked pools expose graduation-waiting state.
- `readStakingPositions(pool, account, { offset?, limit?, blockTag? })`: paginated independent deposits.
- `readStakingAllowance` / `buildStakingApproval`: `{ purpose?: 'stake' | 'fund' }` selects principal/reward asset. Exact approval to the verified pool; native assets need no ERC20 approval.
- `buildStake(pool, account, amount, { minimumReceived? })`: actual receipt determines principal; optional minimum defaults to zero.
- `buildWithdraw(pool, account, amount, { receiver?, unwrapNative? })`: unlocked principal only, no platform principal fee.
- `buildStakingClaim(pool, account, { receiver?, wrappedReward? })`: rewards, with the contract's fixed 1% fee in the reward asset.
- `buildCheckpoint(pool, account)`: recognize incoming cycling funds/linked activation. If activation is required, confirm checkpoint and re-read final LP/reward bindings before building a stake.
- `previewAddRewards(pool, assumedReceived, 'extend' | 'recalculate', options?)` / `buildAddRewards(pool, account, amount, { mode?, minimumReceived? })`: prepaid funding modes or cycling funding as supported by the pool. A preview is not a receipt promise.

Types, public ABI maps and `V1_DEPLOYMENTS` are exported. Use `*_ABIS[chainId]` for chain-specific tuple names; `*_ABI` aliases use BSC. Owner, internal and initialization mutators are omitted. A public ABI alone is not a hosted token-creation workflow.

## Current deployments and mechanics

- BSC new V1: `0x933bc9fe78c9beaedc5a82bd24b5359d01e8fd7b`, start block `125996705`. Default reference **4 BNB**, a constant in this deployment.
- ETH new V1: `0x5247dD1586923176bF92FeA99aadD21cEDDbA0e5`, start block `26139958`. Initial default **1 ETH**; owner can change the default for later launches.
- Each chain has separate standard, tax and tax-linked staking V2 factory/template pins. Retired staking V1 is not offered for new pools.

The Portal splits actual received inventory equally between sale and liquidity. Pricing is fixed relative to the recorded fundraising asset. Graduation is attempted when unsold sale inventory is **strictly below 1% of total admitted inventory**, using actual reserves; collecting the reference target in full is not required. Inner trades charge 1% of actual native settlement. Zero transfer tax does not waive this fee.

Failed graduation preserves the settled last buy, pauses inner trading and protects reserves. Anyone can retry original graduation; owner may attempt a protected alternative settlement or permanently enable proportional refunds in the original fundraising asset. Previous fees are not refunded. New V1 owner withdrawals are limited to **unprotected surplus**, not active/refund reserves. Factory admission, new-target/external-admission switches and ownership remain managed. Removing a factory does not change existing pools. These permissions differ from v12/v13.

Taxes begin after graduation at fixed rates; wallet transfers are exempt. Tax tokens accrue before qualifying later sells/public processing handle them. Mining income uses marketing allocation, not an extra fifth tax. Dividends and staking rewards are claimed. Staking V2 has no owner, upgrade or rescue entry. [Permissions](https://add.fun/docs/en/permissions/).

## Events and legacy compatibility

New V1 event names/units differ from historical `BuyEvent`, `TokenSaleCreated` and `swapExactInput`. Decode with the selected ABI. Index successful receipts by `(chainId, transactionHash, logIndex)`, retain block hashes and handle removed/reorganized logs. The SDK is not a durable indexer, database, RPC service or finality oracle.

`AddClient` preserves the original three BSC v12/v13 pins, primary `0xf58b88C2C263e49737BA92a73D3F5d53480Bd0d4`. Legacy phase is `launch`, fee field `feeBNB`, event query `(portal, fromBlock, toBlock)`; new V1 uses `active`, `nativeFee` and `(fromBlock, toBlock)`. Historical BSC `0x5247…` shares an address with ETH new V1 on another chain; ABI, bytecode and pins differ. Never choose a chain solely by address.

Original 0.1.0 downloads remain unchanged. Creator metadata signatures/upload, images, vanity salt search/reservation, administration and post-graduation DEX trades are outside this toolkit. Rebasing, reflection and sender-extra-debit assets are not advertised as supported. Runtime checks and local tests are not a third-party independent audit.

## Errors and build

`AddSdkError.code` distinguishes checks including `WRONG_CHAIN`, `CODE_MISMATCH`, `BINDING_MISMATCH`, `BLOCK_CHANGED`, `UNREGISTERED_TOKEN`, `INVALID_QUOTE`, `STALE_QUOTE`, `INVALID_DEADLINE`. ethers/RPC errors may also propagate. Show failures, requote and reconfirm when needed; never substitute zero prices or automatically broadcast replacement trades.

```sh
npm install --ignore-scripts
npm test
npm pack
```

An extracted SDK source package can install dev dependencies, build and test independently. The private monorepo uses lockfiles and `node scripts/sync-sdk.cjs --check`; integration tests execute generated requests against actual Solidity on a local EVM. Public packages contain SDK source/interfaces/public pins only, never platform frontend/backend, Solidity implementations, private configuration or keys.

## Creation requests

Creation helpers prepare **unsigned** requests for current reviewed factories. They do not search vanity salts, reserve addresses, upload images/metadata, create a wallet signer or automatically make a first purchase.

- `readCreationDomain(mechanismId, options?)` / `predictToken(mechanismId, salt, options?)`: reviewed factory, implementation, CREATE2 domain and prediction. IDs are `variable-v1`, `auto-tax-v1`, `staking-tax-v2` on each chain.
- `buildCreateToken(mechanismId, account, launch, { tax?, staking? })`: standard/tax/linked token creation. Supply is raw 18-decimal units. Salt is bytes32 whose first 20 bytes equal the creator; the fresh expected address must end in `1111`. Provide the actual quote asset, current `targetNative` / `quoteTarget`, deadline and explicit default/custom mode. A changed default/asset conversion requires re-preparation. Metadata URI is optional and is not uploaded by this call.
- Tax rates and allocation are integer percentages encoded in BPS: 1% = 100. At least one buy/sell side is positive and four allocations total 10000. Native/self reward modes use zero custom reward address; dividends require a minimum of 10000 whole tokens. Linked staking config chooses self/LP/custom principal and a 1–360 day cycle; its pool receives the marketing allocation.
- `buildPoolCreationApproval(account, rewardToken, amount)`: exact reward approval to the current standalone V2 factory.
- `buildCreateStakingPool(account, params)`: prepaid ERC20 rewards, principal asset, duration, optional finite halvings and independent principal lock. BNB/ETH principal uses ZeroAddress; prepaid native rewards use the wrapper ERC20. Initial actual receipt is authoritative.
- `buildCreateCyclePool(account, params)`: cycle duration 1–360 days, native/ERC20 principal and reward, optional initial reward amount including zero. Native initial funds use transaction value; ERC20 initial funds require factory approval.

For any ERC20 transfer builder, **confirm the exact approval first**, then build and simulate the fund-moving request. Approval helpers permit zero to revoke/reset allowances; tokens such as USDT may require a zero approval before a new nonzero allowance. Gas budget must be reserved separately. Process-tax requests set a 3,500,000 Gas limit because this contract requires substantial starting Gas; that is a limit, not the consumed amount.

```ts
import { ZeroAddress, parseUnits } from 'ethers';

// PREPARED_SALT is supplied by your separate creator-bound vanity preparation.
const expectedAddress = await add.predictToken('variable-v1', PREPARED_SALT);
const target = await add.getLaunchTarget(ZeroAddress);
const creation = await add.buildCreateToken('variable-v1', WALLET_ADDRESS, {
  name: 'Example', symbol: 'EX', supply: parseUnits('1000000', 18),
  salt: PREPARED_SALT, expectedAddress, quoteAsset: ZeroAddress,
  targetNative: target.targetNative, quoteTarget: target.quoteTarget,
  deadline: BigInt(target.timestamp + 300), customTarget: false,
});
await add.simulate(creation);
// Application requests wallet confirmation/submission separately.
```

The [public deployment pins](https://add.fun/sdk/deployments.json) list the reviewed per-chain Portal, factories, implementations and staking bindings used by this SDK. This is a versioned integration catalog, not permission to trust arbitrary replacement entries. Buy requests set a 6,000,000 Gas limit to budget a possible graduation attempt; actual Gas usage may be lower.
