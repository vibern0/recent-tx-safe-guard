# Security-core call graph

This document records the complete Option B topology and execution paths. The repository remains a testnet security prototype; the planner is unsigned and the verifier must pass before funds are deposited.

## Topology authority

One asset-holding Safe has exactly three owners: the configured primary passkey, YubiKey Safe-contract secondary, and Burner ECDSA secondary, with threshold 1 and no fallback handler. The same TieredSpendingGuard occupies both Safe transaction-guard and module-guard slots. Zodiac Delay is the only Safe module. Delay has the Safe as owner, avatar, and target, and the Safe is its only upstream module. No second Safe, recovery signer, module, or custody account is created.

`buildVaultPlan` never signs, broadcasts, invents registry addresses, or accepts unverified infrastructure evidence. It requires a resolver-branded deployment infrastructure object, the exact observed deployer nonce, expected runtime code hashes for the four prerequisites, Safe proxy creation code, the deterministic four-prerequisite CREATE sequence, and a policy Delay address that matches that sequence. The selected atomic path uses `SafeAtomicSetupHelper` as the one Safe setup delegatecall target; the helper is stateless and derives the final Safe as `address(this)` so the initializer does not embed the Safe address. The production plan derives the Safe proxy address from the Safe factory, singleton, proxy creation code, initializer, and salt, and rejects a policy Safe that differs. The production plan emits unsigned transactions only: setup helper, guard, Delay, maintenance, then Safe proxy factory creation.

Before the Safe factory transaction is ready for submission, `verifyVaultPrerequisites` must re-read all four planned prerequisite deployments at their deterministic addresses, compare live runtime hashes with the expected planned hashes, brand their evidence, and confirm guard, Delay, and maintenance bindings against the same plan. `assertSafeCreationReady` then rejects unbranded evidence, evidence from another plan, and any deployer nonce other than `startingNonce + 4`. `scripts/plan-deployment.ts` remains the public snapshot/runbook planner and fails closed if asked to emit atomic Safe creation without the `buildVaultPlan` prerequisite evidence flow. `verifyTopology` first requires the runtime brand returned by the official resolver, then re-reads proxy bytecode/singleton/version, Safe graph, guard policy/configuration/counters/asset enumeration/recipients, and Delay settings; structurally fabricated deployment objects fail before any topology check or RPC read.

## Task 7 setup sequence

1. Resolve verified deployment infrastructure and compare every runtime hash from RPC; absent evidence is a hard stop.
2. Plan and deploy setup helper, guard, Delay, and maintenance instances at the four contiguous deployer nonces, verify their runtime/binding evidence, then call the official Proxy Factory with sorted `setup([primary passkey, YubiKey secondary, Burner secondary], 1, setupHelper, setupData, 0, 0, 0, 0)` only when the deployer nonce is exactly `startingNonce + 4`.
3. In the helper's fixed Safe-originated sequence, configure every asset, configure the YubiKey secondary before guard installation, set maintenance, install the same guard in both guard slots, enable Delay as the only Safe module, and enable the Safe as Delay's only upstream module. Delay owner/avatar/target are the Safe.
4. Re-run `verifyTopology`; do not fund until it passes.

## Instant owner path

`Safe.execTransaction` → transaction guard `TieredSpendingGuard.checkTransaction` → exact Safe signature and policy check → Safe target call → `checkAfterExecution`.

The offchain signer path is provider-neutral: the passkey adapter accepts only the resolver-branded aggregate returned by the official deployment-verification boundary, selects its exact `passkeySignerVerifier` record, pins provider chain identity before and after signing, and emits the one canonical Safe contract-signature slot only after an `eth_call` to that exact Safe-native passkey/ERC-1271 verifier identity. A caller cannot substitute `evidence: "verified"` or an arbitrary runtime hash because cloned/unbranded aggregates fail at the signer boundary. The Burner adapter uses `eth_signTypedData_v4` only after checking the configured chain/account and recovers the exact SafeTx locally. Every request must use the canonical SafeTx domain keys, `SAFE_TX_TYPES`, `primaryType`, and message fields before any provider call. The Burner extension is terminal and versioned; Burner-only EOA output is never sufficient because the guard first requires the configured passkey contract-signature slot.

Only native transfers and selected ERC-20 `transfer` calls are admitted. The guard rejects delegate calls, batches, approvals, Permit/Permit2, arbitrary messages, unknown calldata, and non-passkey transfer signatures. Failed execution rolls back the counter update.

## Delayed proposal and execution

`Safe.execTransaction` → transaction guard → `Delay.execTransactionFromModule(to,value,data,operation)` with the exact single queued tuple → Delay queue.

After cooldown and before expiration, an unprivileged relayer calls pinned Zodiac Delay v1.1.1 `executeNextTx(to,value,data,operation)` → Safe `execTransactionFromModule` → module guard `checkModuleTransaction` → exact native/ERC-20 transfer → `checkAfterModuleExecution`. The module guard admits only the configured Delay address and supported `CALL` transfer tuples; Delay owns cooldown, FIFO ordering, expiration, `skipExpired`, and nonce cancellation semantics.

## Cancellation and emergency freeze

The configured passkey plus Burner may submit the configured Delay `setTxNonce(uint256)` cancellation or the guard `freeze()` call. Queue builders expose the next nonce so callers can enumerate all ordered queue items invalidated by cancellation before signing.

Immediate `setAssetPolicy` is accepted only for an unset token or a numeric decrease/equal value with a recipient subset. Policy increases and recipient additions are rejected on the owner path. `repairPolicy(address,uint256,uint256,uint256,uint256,address[])` (`0xc4f605f4`) is admitted only as an exact `CALL` execution from the configured Delay after passkey plus Burner queued the action; policy invariants and exact ABI encoding are checked onchain. Direct queued `repairSigner(uint8,address,address)` (`0x28033279`) calls to the guard are denied; signer repair is available only through `GuardReplacementMaintenance.replaceSigner` so guard signers and Safe owners rotate atomically. Role `2` and every other role value revert. A queued `repairPolicy` change becomes effective only through the verified Delay module after cooldown. Immediate Delay tightening uses `setTxCooldown(uint256)` (`0xebb2b4a2`) and `setTxExpiration(uint256)` (`0x9b56d5be`); `setAssetPolicy(address,uint256,uint256,uint256,uint256,address[])` is `0x7291b570`.

## Atomic dual-guard replacement

`Delay` → Safe module execution with `DELEGATECALL` → `GuardReplacementMaintenance.replaceGuards(address,address)` (`0x7ec60d4f`) or `replaceSigner(address,uint8,address,address,address,uint256,bytes)` (`0x2d72b26a`). `replaceGuards` accepts only deployed code whose runtime hash is the reviewed `TieredSpendingGuard` artifact hash `0x74a42af9d3b62c8a2fdb2d10f87a492581cd35943a59b9cebaf965e5596f4978`; it also checks both guard slots and requires the replacement guard to preserve the current Safe, Delay, 24-hour period, primary passkey, YubiKey secondary, and Burner secondary bindings before installation.

The module guard permits this one target, selector, and operation only when the caller module is the configured Delay. In Safe storage, the maintenance code verifies both current guard slots, verifies both interfaces on the replacement, sets a reentrancy lock, and performs exactly two Safe self-calls: `setGuard` and `setModuleGuard`. Any failure reverts the complete operation. No arbitrary target list, calldata batch, or general delegatecall is exposed.

Signer repair atomically updates guard configuration and rotates the corresponding Safe owner; replacement guards receive the same maintenance authorization before the old guard can be removed. Both currently installed guard slots and the old guard's Safe, Delay, and role-signer configuration are checked before rotation. Role 0 additionally requires deployed replacement code and an ERC-1271 response over the exact domain-separated passkey-replacement proof hash; role 1 rotates the Burner EOA and requires empty replacement proof bytes; role 2 reverts. All other module addresses, targets, selectors, and operations are denied by the module guard.

## Forbidden paths

Direct owner transfers, unlisted modules, a second enabled module, nonzero fallback handler, delegatecalls outside fixed maintenance, batches, approvals, Permit/Permit2, arbitrary messages, unknown calldata, unknown assets/recipients, malformed Delay calls, nonzero Safe gas/refunds, approved-hash authorization, and any missing or inconsistent verification read are rejected. Monitoring and relaying can observe or execute an already-delay-approved item, but neither is an authorizer.

## Repository security-contract ABI inventory

The following is the complete ABI surface of the repository security contracts. Every entry is classified by mutability and authorization role; imported Safe/Zodiac ABIs are out of scope for this inventory.

| Surface | Classification |
| --- | --- |
| `TieredSpendingGuard.BURNER_SIGNATURE_TYPE_HASH` | view constant |
| `TieredSpendingGuard.allowedRecipient` | view state |
| `TieredSpendingGuard.assetPolicy` | view state |
| `TieredSpendingGuard.burnerAuthorizationUsed` | view state |
| `TieredSpendingGuard.burnerSecondary` | view state |
| `TieredSpendingGuard.checkAfterExecution` | state-changing, Safe-only callback |
| `TieredSpendingGuard.checkAfterModuleExecution` | state-changing, Safe-only callback |
| `TieredSpendingGuard.checkModuleTransaction` | state-changing, Safe-only callback |
| `TieredSpendingGuard.checkTransaction` | state-changing, Safe-only callback |
| `TieredSpendingGuard.computeSafeTransactionHash` | view pure computation |
| `TieredSpendingGuard.config` | view state |
| `TieredSpendingGuard.configureYubiKeySecondary` | state-changing, Safe-only setup |
| `TieredSpendingGuard.decodeBurnerExtension` | view decoder |
| `TieredSpendingGuard.decodePasskeySignature` | view decoder |
| `TieredSpendingGuard.freeze` | state-changing, Safe-only emergency action |
| `TieredSpendingGuard.frozen` | view state |
| `TieredSpendingGuard.getConfiguredTokens` | view inventory |
| `TieredSpendingGuard.getPolicyRecipients` | view inventory |
| `TieredSpendingGuard.maintenance` | view state |
| `TieredSpendingGuard.policyHash` | view inventory |
| `TieredSpendingGuard.primarySigner` | view state |
| `TieredSpendingGuard.repairPolicy` | state-changing, Safe-only delayed repair |
| `TieredSpendingGuard.repairSigner` | state-changing, Safe-only delayed repair |
| `TieredSpendingGuard.setAssetPolicy` | state-changing, Safe-only monotonic policy action |
| `TieredSpendingGuard.setMaintenance` | state-changing, Safe-only one-time setup |
| `TieredSpendingGuard.spendState` | view state |
| `TieredSpendingGuard.supportsInterface` | pure interface probe |
| `TieredSpendingGuard.yubiKeySecondary` | view state |
| `GuardReplacementMaintenance.delay` | view immutable configuration |
| `GuardReplacementMaintenance.replaceGuards` | state-changing, configured Delay-only maintenance |
| `GuardReplacementMaintenance.replaceSigner` | state-changing, configured Delay-only maintenance |
| `GuardReplacementMaintenance.safe` | view immutable configuration |

## Monitoring path

Read-only log polling → RPC chain identity/address/topic/confirmation checks → exact pinned `TieredSpendingGuard.TransferAuthorized` decoding → Safe transaction lookup whose outer RPC `to` must equal `MONITOR_SAFE`, exact Safe transaction fields/nonce, and event-block-tagged `spendState` re-read → suppress base-tier events → `step-up-executed` alert. Read-only log polling → exact pinned Delay ABI (`TransactionAdded`, `TxNonceSet`) → event-block-tagged queue tuple/hash/creation-time and nonce reads → `delayed-queued` or `delayed-cancelled` alert. Because the pinned fixture emits no execution/expiry lifecycle events, the watcher derives `delayed-executed` only from a successful canonical receipt to Delay whose receipt depth is at least the configured confirmation count, decoded `executeNextTx` tuple, and pre/post nonce transition exactly match persisted queue evidence; it derives `delayed-expired` only from a successful canonical receipt with the same confirmation depth for `skipExpired`, exact queue hash/creation-time state, post-expiry canonical block timestamp, and a nonce transition covering that item. Failed, unconfirmed, non-canonical, undecodable, ambiguous, or cancellation-covered observations produce no derived alert. Derived records use the receipt transaction hash, canonical receipt block hash, and synthetic log index 0 because no fixture lifecycle log exists. The durable monitoring ledger atomically persists a block cursor, log records, and pending notification outbox before notification; it fsyncs replacements, holds an exclusive writer lock, reconciles canonical block hashes, removes reorged records, and retries undelivered alerts after restart. Delivery is marked only after notifier success.

The notifier boundary accepts only public `ActivityAlert` data and exposes only `notify`. Stdout and webhook implementations cannot sign, send, execute, mutate chain state, or retain passkey, Burner, RPC-write, or session credentials. Unknown and malformed events fail closed; monitoring never changes guard, Safe, Delay, queue, signer, or policy state.

## Task 10 end-to-end proof matrix

The local security gate is `npm run security:check`. It is a reproducible testnet-prototype gate: compilation, the complete Hardhat suite, the call-graph invariant suite, coverage, Slither, a time-controlled local rehearsal, and whitespace validation must all pass. It does not deploy, sign, broadcast, use a secret, or claim an audit.

The adversarial integration suite proves split X/Y spending and anchored reset; state rollback after failed owner execution; wrong signer combinations; exact-signature mutation and replay; approved-hash authorization; arbitrary messages; fallback installation; approvals and unknown calldata; batches; delegatecalls; extra modules; one-guard-only topology; and direct Delay injection. The two-owner maintenance suite proves passkey-plus-Burner freeze/cancellation/repair only, no EOA-only asset movement, mandatory Delay timing, role-2 rejection, and cancellation that prevents stale queue collateral from executing. Existing Task 4–9 integration suites provide the detailed Safe/Delay evidence for expiry, ordered cancellation, delayed weakening, and atomic guard repair.

The invariant suite performs an executable ABI inventory for `TieredSpendingGuard` and `GuardReplacementMaintenance`, checks the Safe-only modifier on guard entry points, rejects public spend primitives, and checks explicit fail-closed branches for signatures, queues, calls, and two-owner repair validation. Its text search is only a static documentation cross-check; it cannot prove complete reachability or inventory imported Safe/Zodiac code, and the test states that limitation. Imported Safe and Zodiac code is not represented as this repository's audit. Slither is filtered to repository security code and excludes legacy/test support; `slither-baseline.json` records the reviewed detector/function findings and this gate fails on any unlisted finding or tool error.

The rehearsal runs only on Hardhat chain 31337 with controlled time. It refuses chain 1, non-local networks, signatures, RPC URLs, private keys, Burner PINs, secret-bearing environment variables, recovery fields, and broadcast mode. It exercises the adversarial and two-owner maintenance flows and emits only unsigned public evidence. The Sepolia rehearsal package contains only the unsigned plan, decoded review, public manifest, and expected evidence hashes; live low-value Sepolia execution remains outstanding until separately performed by a human. All outputs remain security research and a testnet prototype until independent review and professional audit.
