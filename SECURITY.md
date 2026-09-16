# Security

## Supported release

The current public release is 0.1.x. Keep the SDK and ethers dependency current and verify the official release checksum.

## Reporting a vulnerability

For a potential vulnerability, contact the ADD team privately through [the official X account](https://x.com/ADDfunLabs) first. Use [the official Telegram contact](https://t.me/ADD_FU) to request a private security contact if necessary; do not post exploit details, private keys or credentials in public issues or groups. No response deadline or bug bounty is promised.

## Boundaries

The SDK checks known BSC Portal deployments and prepares unsigned transactions. Applications remain responsible for trustworthy RPC access, wallet confirmation, finality, slippage presentation and transaction submission. Simulation cannot guarantee future execution. The deployed Portal retains owner management and emergency recovery powers; see [permissions](https://add.fun/docs/en/permissions/). This SDK has not received an independent security audit.
