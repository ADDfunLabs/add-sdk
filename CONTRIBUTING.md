# Contributing to ADD SDK

This repository contains the public SDK only. Read [the API reference](README.md) and [中文说明](README.zh-CN.md) before changing integration behavior.

Use Node.js 22 or 24. Run `npm ci --ignore-scripts`, then `npm test`. `npm run build` produces ESM, CommonJS and TypeScript declarations. `npm pack` builds an installable archive.

Submit focused pull requests with a concrete behavior change and tests. Preserve BigInt amounts, supported Portal validation, per-token bindings, immutable quotes and unsigned transaction boundaries. Never add signing keys, RPC credentials, production data, platform backend/frontend source or deployment scripts.

Changes to generated public ABI or Portal pins require review against the actual deployed contracts; do not add unknown addresses automatically. Financial-flow changes require integration validation against the corresponding contracts before release. Unit tests alone are not a security audit.
