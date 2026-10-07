# How ADD works — current new V1

Updated 8 October 2026. [Full docs](https://add.fun/docs/en/) · [SDK reference](https://add.fun/sdk/reference.html).

ADD supports BSC (56) and Ethereum (1) with independent contracts and assets. Graduation uses PancakeSwap V2 on BSC and Uniswap V2 on ETH. BSC new V1's default reference is a constant **4 BNB**; ETH initially **1 ETH**, changeable by the owner for future launches. Existing projects retain their own recorded targets.

## Inventory, trades and graduation

Supply is chosen by the creator, not universally one billion. Actual admitted inventory is split into equal integer sale and liquidity halves; an odd smallest unit is surplus. Native, USDT or compatible custom quote assets require the contract's precision and wrapped-native V2 route checks.

```text
fixed launch exchange rate = recorded quote target / sale allocation
```

Pricing is fixed relative to the fundraising asset, not native conversion rates, USD or DEX prices. Inner buyers pay native BNB/ETH and sellers receive it; non-native quote assets are converted. Actual native settlement charges 1%. A zero-transfer-tax token still pays this inner fee.

Graduation is attempted when unsold inventory is **strictly below 1% of total admitted inventory**. For an even inventory, more than 98% of the sale half has sold. Actual reserves and the liquidity half are added to V2; collecting the full reference target is not required. Excess payment is refunded to the last buyer, unsold tokens stay in the Portal, and received LP goes to the dead address. Successful graduation closes inner trading.

Failed liquidity preserves the last settled buy, fee and excess-payment refund, pauses inner trading and protects reserves. Anyone can retry original graduation. The owner may attempt a protected alternative asset settlement, which rolls back if unsuccessful, or permanently enable proportional refunds. Holders return launched tokens for original quote reserves; previous fees are not refunded, and refund exits add no platform fee. Refund mode abandons graduation.

## Taxes, dividends and mining

Buy/sell rates are separate and fixed at creation; whole percentages 0–10, at least one positive side. Taxes begin after graduation. Wallet transfers are exempt; recognized V2 pool transfers can include manual adding/removing liquidity. Platform automatic liquidity operations are exempt.

Four allocations split already collected tax and total 100%:

- Marketing to the chosen recipient or linked mining pool.
- Burn transfers launched tokens to the dead address, without reducing ERC20 totalSupply.
- Dividends create an independent per-token ledger when allocation is positive: native, specified ERC20 or self rewards, with at least 10000-token eligible holding. Earned rights are claimed; this is not a 50-address payout loop.
- Liquidity adds V2 reserves; received LP goes to the dead address.

Accumulated token tax is processed by qualifying later sells or public processTaxes, subject to price, Gas and threshold conditions. Initial threshold is supply × 0.001%, halved every 365 days after graduation with a smallest-unit floor; per-call cap remains supply × 0.01%. No immediate payout is promised on every trade. Anyone may pay Gas for claimFor(holder), but the reward goes to that holder.

Linked mining uses marketing allocation, not an additional tax. The factory binds self-token, LP or custom principal; graduation activates actual settlement/pair bindings before mining liabilities. Staking, claiming or checkpointing recognizes new income. Mid-cycle receipts spread over remaining time; fresh income after an ended cycle starts the same 1–360 day duration. Already earned, unclaimed rewards are never reset.

## Staking V2 and authority

Standalone pools offer prepaid rewards with optional finite halvings, or cycling funding. Flexible, cliff or equal-batch principal rules are fixed at creation; each deposit has its own clock. Rewards remain claimable while principal is locked. No stakers pauses reward active time, while principal wall-clock unlocking continues. Actual receipts govern accounting. Claims charge 1% of the reward asset to the fixed maintenance recipient; principal withdrawal has no platform fee.

Staking V2 has no owner, upgrade or rescue entry. It distributes only its configured reward asset, not other dividends attached to principal. Rebasing, reflection and sender-extra-debit assets are not advertised as compatible.

New V1 Portal owner manages factory admission, new custom/external admission switches and recovery, and can withdraw only **unprotected surplus**. Active/refund reserves are protected. Factory removal affects new admission, not existing bindings. Ownership transfers require acceptance; the Portal is not upgradeable. [Full permissions](https://add.fun/docs/en/permissions/).

## SDK and legacy boundaries

SDK 0.2.0 uses AddV1Client with explicit chain ID for reads/quotes and unsigned trade/refund/creation, tax processing, dividends and staking V2. The application provides RPC, confirmed approvals, wallet signing/submission and reorganization handling. No SDK keys or broadcast. Metadata hosting, vanity preparation and DEX trading are separate.

AddClient/0.1.0 remain historical BSC v12/v13 compatibility. Those old targets and owner powers follow old contracts; do not apply new V1 explanations to old tokens. Public source/runtime checks are not an independent audit. This repository contains SDK code, explanations and brand assets, not the complete platform or private deployment configuration.
