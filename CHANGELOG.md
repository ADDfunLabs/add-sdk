# Changelog

## 0.2.0 — 2026-10-08

Separate explicit-chain `AddV1Client` for current BSC/Ethereum new V1: runtime/clone/factory trust pins, same-block reads, quotes and unsigned buy/sell/refund operations; tax processing, per-token dividend reading/claims, staking V2 reads/approvals/stake/withdraw/claim/funding. Add unsigned standard/tax/linked-token and prepaid/cyclic-pool creation helpers, prediction and exact approvals. Preserve historical BSC v12/v13 `AddClient` and original 0.1.0 download. Rewrite developer guides/examples for chain-specific units, inventory graduation, protected recovery and principal locks. Official website/GitHub distribution; not yet npm-registry published.

## 0.1.0 — 2026-09-16

Initial official release for BSC mainnet: three pinned Portal deployments, fixed-price launch state and current target reads, exact buy/sell quotes, remaining-supply buy with a maximum 3% budget buffer, unsigned exact-amount approvals/swaps, simulation and Portal event decoding/querying. ESM/CommonJS, TypeScript definitions, source and examples included. Distribution via the ADD website; token-creation/upload flows and DEX execution are outside this release.
