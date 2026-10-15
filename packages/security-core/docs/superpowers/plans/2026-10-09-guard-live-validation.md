# Guard Validation, Then ERC-4337 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans`. Execute in order. Track evidence. Each behavior change: failing test, implementation, passing tests.

**Goal:** Validate ordinary Safe transactions on Ethereum Sepolia; then implement and validate ERC-4337.

**Architecture:** Sole Safe owner: primary passkey; threshold 1. Guard verifies secondary approvals independently. Recovery deferred. Both transports preserve exact signed Safe transactions.

**Tech Stack:** Safe 1.5, Safe passkey contracts, Zodiac Delay, Solidity, TypeScript, viem, Hardhat; Pimlico in phase two.

**Spec:** User-approved 2026-10-09 plan; research and signer-provider supersession implement that decision.

## Global Constraints

- Ethereum Sepolia 11155111 only. No WalletConnect. Testnet research only.
- Real passkey contracts; isolated automated P-256/WebAuthn credentials. No mock-signature live evidence.
- Funded EOA pays deployment/gas/funding; never authorizes vault policy. Secrets outside repository/logs/browser.
- Preserve exact binding, X/Y accounting, mandatory cancellable Z, constrained owner/module paths, and no arbitrary messages.
- Fresh vault per phase; same funder and scenario matrix. No migration claim.
- Ordinary live matrix must pass before phase two. Demo follows both phases.

## Phase One

- [x] Reconcile research, provider design, call graph, and baseline implementation plan.
- [x] Validate contract/ECDSA secondary approvals in guard without Safe ownership.
- [x] Update atomic setup, topology, adapters, and delayed rotation. Primary rotation swaps sole owner atomically; secondary rotation changes guard only.
- [x] Add real cryptographic automated WebAuthn harness and malformed/wrong-key/digest tests.
- [x] Add separate bootstrap live runner: plan, preflight, submit, resume, evidence. Preserve existing unsigned/local-only commands. Reconcile uncertain submissions before retry. The strict allowlist currently excludes vault deployment and spending.
- [x] Run `npm run security:check` in `packages/security-core`.
- [ ] Verify pinned dependencies, audit evidence, deployed code/bindings; generate reproducible unsigned review package. Artifact resolution and exact nonce sequencing are implemented and read-only rehearsed; the reviewed CLI adapter/package remain outstanding.
- [ ] Execute native/ERC-20 Sepolia matrix. Native X=0.00001 ETH, Y=0.00003 ETH; token X=10, Y=30. Per-tx caps X/Y; period=86400; Z=120; execution window=600 seconds.
- [ ] Enforce total native outlay ceiling 0.05 Sepolia ETH per phase, including gas/deployment/deposits/transfers. Estimate first; controlled recipients only.
- [ ] Record receipts, state, alerts, code evidence, failures. Close phase only with live evidence.

## Phase Two

- [ ] Review restricted fallback solution; standard Safe4337Module arbitrary-message support is forbidden. New security-critical contract requires focused proposal and review before implementation.
- [ ] Permit only zero-value CALL wrapper to same Safe's signed execTransaction. Reject direct module spending/delegatecall/other selectors.
- [ ] Add explicit nested execution states; prove reentrancy rejection, rollback, and accurate inner failure reporting.
- [ ] Retain SafeExecutionRequest; add 4337 adapter/evidence with UserOperation hash, tx hash, inner result; separate Safe/EntryPoint nonces.
- [ ] Fund capped EntryPoint deposit from funder; reject vault-funded prefund. Sponsorship deferred.
- [ ] Pin/review EntryPoint, module, restricted handler, clients; update call graph/dependency review; test both primary signatures.
- [ ] Repeat Sepolia matrix through Pimlico plus wrapper/fallback/prefund/bundler tests and ordinary-call regression.
- [ ] Close with onchain evidence, not bundler acceptance.

## Acceptance And Demo

- [ ] X/Y boundaries, splitting, signer matrix, exact binding, replay, counter rollback.
- [ ] Queue/early rejection/cancel/expiry/execution after real Z; freeze and delayed rotation.
- [ ] Reject approvals, Permit/Permit2, arbitrary messages, batches, delegatecalls, unlisted modules/assets/recipients, immediate weakening.
- [ ] Independent event evidence; distinguish reverted txs, simulations, and bundler rejections. Local-only rollover; no hardware-passkey claim.
- [ ] Demo last: verified chain provider behind vault-store; actual token units/timestamps; credentials only in local runner.
- [ ] Separate phase/demo reports with explorer links, costs, state, limitations.

## Execution Ledger

- 2026-10-09: Branch `codex/guard-live-validation`; preserve pre-existing user documentation changes. Work in current checkout to retain those changes; no shared-branch push or commit requested.
- Ruling: User-approved single-owner plan supersedes older three-owner and Burner-specific wording. This changes topology, not policy strength. Historical documents remain evidence only.
- Baseline tests started; live key must be supplied through a local secret path, not copied from conversation into commands.
- Baseline: 257 tests passed. Contract-secondary ownership separation, primary/secondary rotations, single-owner setup, post-setup topology binding, signer-instance selection, and canonical unpadded contract signatures implemented with regression tests.
- Automated WebAuthn: native/ERC-20 X/Y, both secondary kinds, delayed queue/cancel/expiry/execution, local daily rollover, replay and freeze exercised using real Safe passkey contracts and P-256 assertions. Delay remains a local compatibility fixture, not live evidence.
- Live bootstrap runner: immutable intents, decoded signed-envelope checks, capped reservation, durable-before-broadcast callback, no uncertain rebroadcast, receipt reconciliation, private external credential files, CLI stages, locked durable journal adapter, and canonical RPC receipt handling. The strict allowlist permits only a self-probe and exact official passkey-factory creation for local credentials. Vault deployment/scenario execution and monitoring evidence integration remain unfinished.
- Dependency gate: official Sepolia passkey address/runtime pins are committed and the public dependency verifier passes. Credential-specific primary signer runtime/factory binding verification passed live. Canonical Delay live artifact and audit scope remain to verify. No new package or lockfile changes.
- Review corrections: reject pre-setup topology evidence; verify live maintenance bindings; test sole-owner lower-address secondary; fix contract signature padding; bind signer output to intent; reject unsafe secret paths and blocking special files. Additional rollback-after-swap-failure coverage remains a limitation.
- 2026-10-12 Sepolia bootstrap evidence: self-probe `0x382e6cc309b7925fe462159edc35e411a10be3a9a0961194aff42d97ba2cc14a`, primary signer creation `0x43d5993748d43b19308d32982caaf45bc55b805b88936c1c57328eac74392496`, and secondary signer creation `0x916fb30007202b3f7ed2b250115c3e7604fdba04c8f53dbb30365778c8b48191` each succeeded. This does not satisfy the ordinary Safe matrix; phase two and demo remain gated.
- Local gate passed: `npm run security:check`, 280 full-suite tests; 4 invariants; coverage 278 passing and 2 deliberately skipped runtime-hash-bound cases; Slither 11 explicitly reviewed baseline findings; local rehearsal passed; whitespace clean. Two coverage skips are not failures of the ordinary non-instrumented tests. One pre-existing trailing space in Codacy instructions was removed without changing the instructions.
- `npm run verify:dependencies` verifies the five pinned public dependencies against Sepolia. The full primary-signer resolver was separately exercised using private local credential data and live factory binding; a public, reproducible signer-evidence input remains to be added.
- Codacy MCP analysis unavailable in this session (tool not exposed). TypeScript's standalone `tsc --noEmit` is not part of the security gate and currently reports dependency/legacy/existing-project errors; do not claim a clean typecheck.
- 2026-10-12 credential setup: user authorized local persistence of the supplied disposable testnet funding key. Stored actual files in a private external directory with mode 0600 and generated distinct primary/contract-secondary P-256 credentials. Ignored `.sepolia-local/` provides repository-local symlinks; use the external target paths with the secret loader. Funding key parsing and credential reload/signing succeeded without printing secret contents. No transaction sent. The local-secret prerequisite is now supplied; incomplete runner/dependency gates still apply. The chat-disclosed funding key must never secure real funds.
- 2026-10-14: `reviewed-artifacts.ts` now derives Safe factory proxy creation code, pinned Delay artifact payload, all prerequisite constructor payloads, and creation-simulated runtime hashes internally. `buildVaultPlan` rejects caller-shaped artifacts; topology verification obtains the proxy hash only from branded prerequisite evidence. `vault-runner.ts` accepts only the reviewed plan, reconciles every receipt before the next nonce, verifies prerequisite bindings before Safe creation, and verifies the final topology afterward. A read-only Sepolia rehearsal verified the live official dependencies, automated primary signer binding, fixed Delay source, all five runtime simulations, and unsigned-plan derivation at funder nonce 413. No deployment transaction was sent.
