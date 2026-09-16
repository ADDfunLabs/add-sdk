# ADD SDK

[![ADD — Fixed price. Clear launch rules.](assets/brand/add-social-preview.png)](https://add.fun/)

Official TypeScript / JavaScript SDK for the ADD.fun launch market on **BNB Smart Chain mainnet (56)**. Version **0.1.0**.

[中文](README.zh-CN.md) · [How ADD works](docs/how-add-works.md) · [API documentation](https://add.fun/sdk/reference.html) · [Release](https://github.com/ADDfunLabs/add-sdk/releases/tag/v0.1.0) · [Brand assets](assets/brand/)

## About ADD.fun

ADD is a BSC token launchpad with a **fixed exchange rate during the launch phase**, denominated in each token's selected fundraising asset. More buys advance the launch toward its target without moving up a rising launch-price curve.

- **1 BNB current default target**, with custom targets available to creators. Existing token targets remain fixed.
- **BNB, USDT and compatible custom fundraising assets**, with BNB payments and proceeds at the launch Portal.
- **Automatic graduation to PancakeSwap V2** when the launch meets its target; all LP tokens received by ADD go to the dead address.
- **Standard zero-transfer-tax and post-graduation tax mechanisms**, with their fees and permissions explained in the [platform overview](docs/how-add-works.md).

Fixed pricing applies in the fundraising asset. Conversion rates and post-graduation prices can move. The non-upgradeable Portal retains owner management and emergency recovery powers; read the [permission disclosure](https://add.fun/docs/en/permissions/).

Official links: [Website](https://add.fun/) · [Platform docs](https://add.fun/docs/en/) · [SDK docs](https://add.fun/sdk/) · [X](https://x.com/ADDfunLabs) · [Telegram](https://t.me/ADD_FU)

## Install

```sh
npm install https://add.fun/sdk/releases/add-fun-sdk-0.1.0.tgz
```

The package name is `@add-fun/sdk`. Version 0.1.0 is available from the official website and [GitHub Releases](https://github.com/ADDfunLabs/add-sdk/releases/tag/v0.1.0); it is not yet published on the npm registry. Both ESM and CommonJS, TypeScript declarations, source and examples are included. Node.js 20+ or a modern browser bundler with BigInt support is required. The only runtime dependency is ethers v6.

The published v0.1.0 package and tag are immutable release snapshots. Repository documentation and brand assets may advance independently on `main`; this documentation update does not replace the released archive.

## Read a token and quote a buy

```ts
import { JsonRpcProvider, parseEther, formatUnits } from 'ethers';
import { AddClient } from '@add-fun/sdk';

const provider = new JsonRpcProvider(process.env.BSC_RPC_URL);
const add = new AddClient(provider);
const token = '0x71be68c0bd800de27f1d48de4876215ed3c21111';
const state = await add.readToken(token);
console.log(state.portal, state.phase, formatUnits(state.target, state.quoteDecimals));
if (state.phase === 'launch') {
  const quote = await add.quoteBuy(token, parseEther('0.01'));
  console.log(formatUnits(quote.outputAmount, state.decimals), quote.feeBNB);
}
```

Use your own BSC RPC endpoint. The SDK does not configure a private RPC key or depend on ADD's website RPC proxy. Reads are pinned to one numbered block with a hash check after completion; unavailable data and hash mismatches fail instead of being converted into zeroes. RPC providers may have stricter request/range limits. A trusted RPC is still required.

## Prepare a wallet transaction

```ts
const quote = await add.quoteBuy(token, parseEther('0.01'));
const tx = await add.buildSwap(quote, connectedWalletAddress, {
  deadline: BigInt(quote.timestamp + 300),
  slippageBps: 50, // 0.5%
});
await add.simulate(tx); // eth_call; does not broadcast or spend gas
// Present the original quote and transaction to the user for confirmation.
// The application, not this SDK, decides when to call signer.sendTransaction(tx).
```

`buildSwap` only accepts an unmodified quote from the **same client instance**. It checks chain, code, registration, current phase, canonical quote block and a maximum quote age of 120 seconds. Deadlines must be in the next 15 minutes. It retains the quote's input budget and minimum-output protection; it does not silently increase the user's spending limit. Gas, account balance, nonce and final signing belong to the caller. Simulation does not guarantee later execution.

For a sell, call `readAllowance`, prepare `buildApproval(token, account, amount)` if needed, have the user sign that exact-amount approval and wait for confirmation. Then request a fresh sell quote with `quoteSell`, call `buildSwap`, simulate again and obtain separate user confirmation. A sell sends `value: 0n`. The approval spender is always the token's own supported Portal; no unlimited allowance is generated.

## Buy the complete remaining launch supply

```ts
const quote = await add.quoteRemainingBuy(token); // default buffer: 300 BPS = 3%
const tx = await add.buildSwap(quote, connectedWalletAddress, {
  deadline: BigInt(quote.timestamp + 300),
});
```

`inputAmount` is the maximum BNB payment, at most 103% of `quotedPaymentBNB`, rounded down to wei. `outputAmount` is the full remaining token amount. The builder always uses that exact full output as the minimum, even if a slippage option is supplied. The Portal charges actual executed input and refunds unused BNB during an inner-market fill. The quote reconciles the conversion, fee and refund with the Portal's own `quoteBuy` result. A smaller wallet balance is not silently substituted.

This is not a reservation. Another transaction may change inventory or graduate the token before inclusion. The current shared Portal rejects post-graduation swaps; the legacy v12 Portal can instead use its DEX path and spend the submitted budget. A remaining-fill refund is therefore not guaranteed across a phase change on that legacy Portal. Applications must disclose this and recheck before wallet submission.

## Public API

- `new AddClient(provider, { portals? })`: defaults to the three pinned public BSC deployments. A custom `portals` array replaces these trust pins and is for separately reviewed deployments or local test adapters only. Do not populate it from token metadata or arbitrary user input.
- `readToken(token, { blockTag? })`: returns name, symbol, bound Portal, version, phase, fixed fundraising asset/target/route/pair, reserves, sold supply, remaining supply, fee recipient and recovery state. `progressBps` is the reserve/target ratio in basis points during launch and `null` after launch; use `phase`, not progress, to recognize manual graduation.
- `getLaunchTarget(quoteAsset?, portal?, { blockTag? })`: reads the current default target and precision. Native BNB is `ZeroAddress`; the current primary Portal is the default. It does not hardcode 1 BNB into future launches.
- `quoteBuy(token, paymentBNB, { blockTag? })`: input is gross BNB in wei; returns actual token output, BNB principal, fee and refund.
- `quoteSell(token, tokenAmount, { blockTag? })`: input is raw token units; output is net BNB in wei. `principalBNB` is the gross BNB proceeds before the platform fee.
- `quoteRemainingBuy(token, { blockTag?, bufferBps? })`: exact remaining fill, buffer integer 0..300.
- `buildSwap(quote, account, { deadline, slippageBps? })`: unsigned transaction; ordinary slippage integer 0..1000 BPS, default 50.
- `buildApproval(token, account, amount)`: exact ERC-20 approval for an active launch token.
- `readAllowance(token, account)`: allowance and balance at one block.
- `simulate(transaction)`: returns raw `eth_call` result; never sends a transaction. Simulate a sell after its approval confirms.
- `decodePortalLog(log)`: decodes known Portal events, or returns `null` for foreign/unknown/malformed logs. Decoding alone does not prove receipt success or chain finality.
- `getPortalEvents(portal, fromBlock, toBlock)`: queries an explicit inclusive range of at most 2,000 blocks, starting no earlier than the deployment. Reduce the range if your RPC limits it.
- `minimumOutput`, `remainingBuyBudget`, `tokenPageUrl`, `pancakeSwapUrl`: validated utilities.
- `BSC_PORTALS`, `PRIMARY_PORTAL`, `CHAIN_ID`, `PORTAL_ABI`, `TOKEN_ABI`: public deployment pins and limited integration interfaces. ABI events/errors preserve contract names; no owner transaction helpers are included.

Amounts are **bigint**, never JavaScript floating-point numbers. Token amounts use the token precision; reserve/target use `quoteDecimals`; BNB values always use 18 decimals. Serialize BigInt explicitly, for example `JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v)`.

## Indexing and GMGN integration

The current primary Portal is `0xf58b88C2C263e49737BA92a73D3F5d53480Bd0d4`, start block `122016858`. Older tokens stay on their original Portals. The SDK resolves each token's `factory()` and checks registration and the Portal's pinned runtime code. Changing the website primary does not change old token bindings. Discovery directory: https://add.fun/api/v1/portals . Full address notes: https://add.fun/docs/en/contracts/ . New deployments require reviewed SDK pins, not blind trust in a remote directory.

Index these events from each supported Portal:

- `TokenSaleCreated`: token, creator, optional initial purchase and metadata reference.
- `QuoteConfigured`: actual reserve asset, precision and target. The legacy field name `default18BNB` in `LaunchProfile` means “created using default mode” in v13, not necessarily 18 BNB.
- `BuyEvent` / `SellEvent`: BNB trading amounts, token amounts and platform fee. `feeToFactory` is a legacy name; actual fees go to the Portal's current `feeRecipient`. For the gas-paying trader, use a successful transaction receipt's `from`, rather than inferring it from ERC-20 transfers.
- `QuoteSettlement`: for non-native launches, separates reserve-asset amounts from BNB principal. Do not confuse their units.
- `LiquidityAdded`: graduation pair and LP result. `ethAmount` can be a non-BNB reserve-asset amount; use the token's fundraising asset and precision.
- `ManualGraduation`: owner-triggered early graduation; do not wait for 100% progress to detect it.

Persist `(chainId, transactionHash, logIndex)` identities, use confirmed/finalized blocks, verify receipt success and handle chain reorganizations. The decoder preserves `removed`; callers must invalidate removed logs and roll back their own derived records. The SDK does not run a database, maintain a durable cursor or promise finality. After graduation, obtain DEX quotes/data directly from PancakeSwap and your market-data stack; the SDK will not route new DEX trades through ADD.

## Mechanism and trust boundaries

The launch exchange rate is fixed **relative to the fundraising asset**, not USD or every other asset. The current default is 1 BNB, but the owner can change defaults for future launches and creators can choose a custom target. Existing token targets are fixed. Launch buys/sells pay a 1% BNB platform fee. A standard “zero-tax” token does not waive that fee. Non-BNB conversions can move in price. Standard tax tokens use the same untaxed token-transfer path before graduation; their token taxes start after graduation.

The shared Portal is non-upgradeable. Its owner still retains management and emergency recovery powers, including permanently stopping the Portal and withdrawing reserves. See https://add.fun/docs/en/permissions/ . Code hash matching and local tests are not an independent security audit.

Version 0.1.0 covers reading, launch-market trading and Portal event integration. It does **not** implement hosted RPC service, image uploads, CA reservation/signing, one-click token creation, owner administration, reward processing or post-graduation swaps. The existing ADD website remains the token-creation interface. Later compatible external mechanisms may require their own review and SDK additions; no unlaunched mechanism is advertised as live.

## Errors and recovery

`AddSdkError.code` identifies SDK checks, including `WRONG_CHAIN`, `UNTRUSTED_PORTAL`, `CODE_MISMATCH`, `VERSION_MISMATCH`, `BLOCK_UNAVAILABLE`, `BLOCK_CHANGED`, `INVALID_AMOUNT`, `INVALID_QUOTE`, `QUOTE_CHANGED`, `STALE_QUOTE`, `INVALID_DEADLINE`, `PORTAL_IN_RECOVERY` and `EXTERNAL_TRADING_ONLY`. Underlying ethers/RPC errors can also propagate. Never convert failure into a zero price or automatically broadcast a replacement trade. Ask for a new quote/confirmation when parameters change.

## Build from source

```sh
npm install --ignore-scripts
npm test
npm pack
```

In a standalone extracted package, the commands above install development dependencies and rebuild/test the included source. In the ADD monorepo use the committed lockfile with `npm ci --ignore-scripts`; `node scripts/sync-sdk.cjs --check` checks interface/catalog drift. The monorepo also executes SDK-generated transactions against its real Solidity contracts on a local EVM. Real wallet submission and independent third-party audit are separate activities.

## License and brand

SDK code and explanatory documentation are provided under the [MIT license](LICENSE). The ADD name and artwork follow the separate [brand asset notice](assets/brand/LICENSE). This public repository contains the SDK, documentation and official brand assets; platform application source, full contract source, deployment configuration and credentials are not included.
