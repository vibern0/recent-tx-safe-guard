# Repository instructions

This repository explores a personal self-custody vault with bounded instant spending and cancellable delayed withdrawals. Treat it as security research and a testnet prototype until an independent review and professional audit say otherwise.

## Required reading

Read these documents in order before changing architecture, contracts, transaction encoding, signers, or dependencies:

1. [Research, threat model, and product direction](docs/research/2026-09-16-personal-vault-research.md)
2. [Security-core implementation plan](docs/superpowers/plans/2026-09-16-personal-vault-security-core.md)

Before adding or changing passkey, Burner, Cometh, embedded-wallet, account-abstraction, or WalletConnect behavior, also read [Signer provider evaluation](docs/security/signer-provider-evaluation.md).

The research document defines the intended security properties and scope. The implementation plan defines the approved sequence, file boundaries, tests, and delivery gates. If code and documentation disagree, stop and resolve the discrepancy explicitly; do not silently weaken the documented property.

## Historical code

`RecentTransactionGuard.sol`, `GnosisSafeMock.sol`, and their tests are a 2024 experiment. They are not a production foundation:

- Authorization is disabled.
- Validation is not bound to a specific transaction.
- There is no real queue, cancellation, or spending limit.
- The mock does not reproduce Safe signatures or authorization.
- The code predates Safe 1.5 module guards.

Preserve the prototype under `legacy/` when executing the plan. Do not deploy it, extend it, or cite its tests as security evidence.

## Non-negotiable security rules

- Prefer current audited Safe/Zodiac primitives over new security-critical Solidity.
- Verify exact versions, audit status, canonical addresses, and runtime bytecode before use.
- Pin exact dependency versions and commit the lockfile.
- Constrain both Safe owner transactions and module transactions.
- Leave no unrestricted direct-owner or unlisted-module spending path on the Vault Safe.
- Bind authorization to chain, Safe, destination, value, calldata, operation, and nonce.
- Keep the MVP fast lane to native transfers and selected ERC-20 `transfer` calls.
- Deny delegate calls, batches, approvals, Permit/Permit2, arbitrary messages, and unknown calldata on the fast lane.
- Enforce per-transaction and per-period limits onchain and per token.
- Require a mandatory delay after full approval for slow-lane operations.
- Delay security-weakening changes; permit immediate tightening only when enforced onchain.
- Treat monitoring as mandatory and non-authorizing.
- Test recovery and cancellation before removing bootstrap control.
- Never use the permissive historical mock as a substitute for actual Safe integration tests.
- Never deploy to mainnet or describe the system as production-ready without independent review and an audit.

## Working practices

- Follow the implementation plan task by task and keep its checkboxes current.
- Use test-driven development for policy, encoding, topology, queue, signer, and monitoring behavior.
- Every new execution path requires a corresponding update to `docs/security/call-graph.md` and adversarial tests.
- Every security dependency change requires an update to `docs/security/dependency-review.md`.
- Keep private keys, passkey material, Burner PINs, RPC secrets, and provider credentials out of the repository and logs.
- Generated deployment plans must be unsigned and reproducible before human review.
- Prefer read-only verification scripts that fail closed on missing or inconsistent RPC data.
- Stop and write a focused design proposal if an accepted security property requires custom Solidity not already covered by the plan.

## Scope boundaries

The first security-core prototype targets one EVM test network, token-denominated limits, selected native/ERC-20 transfers, a 2-of-3 Control Safe, a module-constrained Vault Safe, and a delayed slow lane.

Arbitrary DeFi, bridges, NFTs, cross-chain synchronization, fiat-oracle limits, broad message signing, unlimited approvals, and production deployment are outside the first plan.
