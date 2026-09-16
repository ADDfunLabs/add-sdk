# Contributing to ADD SDK

This repository contains the public SDK, platform documentation and official brand assets. Read [the API reference](README.md), [how ADD works](docs/how-add-works.md) and [中文说明](README.zh-CN.md) before changing integration behavior. Preserve the separate [brand asset notice](assets/brand/LICENSE).

Use Node.js 22 or 24. Run `npm ci --ignore-scripts`, then `npm test`. `npm run build` produces ESM, CommonJS and TypeScript declarations. `npm pack` builds an installable archive.

Submit focused pull requests with a concrete behavior change and tests. Preserve BigInt amounts, supported Portal validation, per-token bindings, immutable quotes and unsigned transaction boundaries. Never add signing keys, RPC credentials, production data, platform backend/frontend source or deployment scripts.

Changes to generated public ABI or Portal pins require review against the actual deployed contracts; do not add unknown addresses automatically. Financial-flow changes require integration validation against the corresponding contracts before release. Unit tests alone are not a security audit.

Keep platform documentation aligned with the deployed mechanisms and pair English changes with the Chinese explanation. Documentation and brand-only updates on `main` do not replace previously published package bytes or release tags. Package changes require a new version before publication.
