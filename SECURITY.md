# Security

## Supported release

The current SDK release line is **0.2.x**. `AddV1Client` supports the reviewed new V1 deployments on BSC mainnet (chain ID 56) and Ethereum mainnet (chain ID 1), per-token claim dividends, and staking V2. Verify the official release checksum and use the matching chain-specific deployment pins.

`AddClient` and the original 0.1.x package remain historical BSC v12/v13 compatibility. They do not become new V1 clients by replacing a Portal address. Retired staking V1 is not a supported new-pool template. Historical deployments retain their own permissions and risks.

## Reporting a vulnerability

For a potential vulnerability, contact the ADD team privately through [the official X account](https://x.com/ADDfunLabs) first. Use [the official Telegram contact](https://t.me/ADD_FU) to request a private security contact if necessary; do not post exploit details, private keys or credentials in public issues or groups. No response deadline or bug bounty is promised.

## Boundaries

The SDK reads public contracts and prepares **unsigned** requests for trades, refunds, creation, tax processing, dividend claims and staking V2. It does not hold private keys, request signatures or broadcast. Applications remain responsible for trustworthy RPC access, wallet confirmation, Gas reserves, confirmed approvals, finality, slippage presentation and final submission. Simulation reflects a block and cannot guarantee later execution.

Default trust checks use explicit chain identity, committed runtime hashes, exact implementation clones and factory registrations. Quotes must be the original unchanged object issued by the same client, remain within the age/deadline limits, and pass current phase and price checks. A custom deployment override is a trust decision for separately reviewed contracts, not permission to accept arbitrary addresses from token metadata. Bytecode checks do not prove the honesty of a compromised RPC provider or guarantee the safety of external reward assets.

New V1 Portal owners retain factory admission, new-launch switches, fee-recipient management, protected recovery and ownership-transfer permissions. They may withdraw only **unprotected surplus**; active fundraising reserves and refund liabilities are protected. Failed graduation can be retried or enter irreversible proportional refunds; an alternative graduation must satisfy its on-chain protections. Previously collected fees are not refunded. Removing a factory revokes new admission without changing existing pool bindings. See the current [permissions](https://add.fun/docs/en/permissions/) before relying on these boundaries; do not apply them to legacy v12/v13.

Current per-token dividend ledgers and staking V2 pools have no owner, upgrade or asset-rescue entry. `claimFor(holder)` sends rewards to the named holder, never to an arbitrary receiver selected by the Gas payer. Staking principal is subject to its fixed per-deposit unlock rules; rewards charge the fixed 1% maintenance fee in the reward asset. Unsupported rebasing, reflection or sender-extra-debit assets can invalidate integration assumptions.

The SDK, local contract tests and published source checks are **not a third-party independent security audit**. This repository contains the SDK, public documentation and brand assets; it does not contain the platform frontend/backend, private configuration, deployment wallets or production data.
