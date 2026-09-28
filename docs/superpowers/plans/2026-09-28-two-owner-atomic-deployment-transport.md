# Two-Owner Atomic Deployment and Submission Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the vault to exactly two Safe owners, create it atomically in its final guarded topology, and submit only exact already-authorized Safe or ready-Delay calls through a non-authorizing HTTPS relayer boundary.

**Architecture:** Remove the recovery role from every onchain and offchain interface first. Predict guard, Delay, and maintenance addresses from a reviewed deployer nonce sequence, derive the Safe proxy address from the resulting call-only initializer, and emit one deterministic unsigned plan. A typed HTTPS protocol snapshots exact authorization data, while a separate relayer validator re-reads chain state before an injected gas-paying broadcaster sends unchanged calldata.

**Tech Stack:** Solidity 0.8.24, TypeScript 5, Node.js, Hardhat, viem 2.56.7, Safe Smart Account 1.5.0, `@safe-global/safe-deployments` 1.37.63, Safe passkey 0.2.0, Zodiac Delay 1.1.1, Mocha/Chai, Slither.

**Spec:** `docs/superpowers/specs/2026-09-25-atomic-safe-deployment-submission-transport-design.md`

## Global Constraints

- The Safe has exactly two owners: the configured passkey signer contract and Burner card account, at threshold 1.
- No recovery address, third owner, recovery-only selector, dormant recovery path, fallback handler, extra module, or auxiliary custody Safe may remain.
- Loss of the passkey can lock the vault; loss of Burner can leave only bounded base spending. The UI-facing diagnostics and runbook must say so.
- `TieredSpendingGuard` remains installed in both guard slots; Zodiac Delay remains the only Safe module and the Safe remains Delay owner/avatar/target/only proposer.
- Base authorization is the canonical Safe contract signature from the configured passkey. Step-up, queue, cancellation, freeze, and repair require that passkey signature plus the exact Burner extension.
- All setup batch entries are `CALL`; the Safe performs only the one initializer delegatecall to the verified Safe 1.5 `MultiSendCallOnly`.
- Plans are unsigned, deterministic, Sepolia-only for live output, and fail closed on deployer nonce drift, missing evidence, bytecode/config mismatch, or partial prerequisite deployment.
- The relayer pays gas only. It is never an owner, signer, module, cancellation authority, repair authority, or policy authority.
- No key, passkey material, Burner PIN, provider/RPC credential, or raw signature may be persisted or logged.
- No mainnet, production-readiness, email recovery, ERC-4337 module, approval, Permit/Permit2, batch execution, arbitrary calldata, or direct-wallet fallback is added.
- Every production-code change follows red-green-refactor. Each task ends with its own focused verification and commit.

## Review Focus

- A deployment sender nonce changes after review but before any prerequisite broadcast: Task 3 must reject the plan before emitting or submitting a mismatched transaction.
- One prerequisite deployment succeeds and the next fails: Task 4 must invalidate the remaining plan and prove no initialized Safe exists.
- A relayer times out after broadcast: Task 6 must return an indeterminate/submitted result and reconcile canonical chain state instead of rebroadcasting changed data.
- An idempotency key is reused with a different payload: Task 5 must reject before network or broadcaster access.
- A Safe transaction is still correctly signed but policy counters or the Safe nonce changed during review: Task 6 must return `stale` and never broadcast.

---

### Task 1: Remove the Recovery Role from the Onchain Security Core

**Files:**
- Modify: `contracts/TieredSpendingGuard.sol`
- Modify: `contracts/GuardReplacementMaintenance.sol`
- Modify: `contracts/libraries/PolicyDigest.sol`
- Modify: `test/helpers/safe.ts`
- Modify: `test/unit/guard/signatures.test.ts`
- Modify: `test/unit/guard/spending.test.ts`
- Modify: `test/integration/guard-signatures.test.ts`
- Modify: `test/integration/guard-spending.test.ts`
- Modify: `test/integration/delayed-tier.test.ts`
- Replace: `test/integration/recovery.test.ts` with `test/integration/two-owner-maintenance.test.ts`
- Modify: `test/integration/adversarial.test.ts`
- Modify: `test/invariant/call-graph.invariant.ts`

**Interfaces:**
- Produces: `GuardConfig(address safe,address passkey,address burner,address delay,uint64 periodSeconds,uint64 periodAnchor)`.
- Produces: `repairSigner(uint8 role,address expectedOld,address replacement)` with valid roles `0 = passkey`, `1 = Burner`; every other role reverts.
- Preserves: passkey-only base, passkey-plus-Burner step-up/queue/emergency/repair, dual guards, atomic counter rollback.

- [ ] **Step 1: Write failing two-owner guard and maintenance tests**

Add assertions that the constructor/config ABI has six fields, role `2` is rejected, Burner-only and arbitrary EOAs cannot authorize any path, passkey-only cannot freeze/cancel/repair, and passkey-plus-Burner can freeze, cancel, and queue either signer replacement through Delay. Assert the Safe owner set is exactly `[passkey, burner]` and contains no third address.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test:unit -- --grep "two-owner|TieredSpendingGuard" && npm run test:integration -- --grep "two-owner|recovery|delayed|adversarial"`

Expected: FAIL because `GuardConfig`, maintenance config decoding, and recovery-only branches still expose the third role.

- [ ] **Step 3: Implement the minimal onchain refactor**

Remove `recovery` from `GuardConfig`, policy hashes, signer distinctness, repair roles, signature decoding modes, queue authorization, emergency authorization, comments, and ABI checks. Replace recovery-special cases with one rule: the Safe-valid owner slot must be the configured passkey contract signature, and emergency/queue/repair paths must also carry a valid unused Burner extension over the same Safe transaction hash.

Update `GuardReplacementMaintenance` to decode the six-field config, accept roles `< 2`, preserve threshold 1 while replacing one of exactly two owners, and verify replacement guards have exactly the same Safe/Delay/passkey/Burner binding.

- [ ] **Step 4: Run focused suites and verify GREEN**

Run: `npm run test:unit -- --grep "TieredSpendingGuard" && npm run test:integration -- --grep "two-owner|delayed|adversarial" && npm run test:invariant`

Expected: PASS with no recovery-only test or public/state surface.

- [ ] **Step 5: Commit**

Run: `git add contracts test && git commit -m "refactor: enforce two-owner vault policy"`

---

### Task 2: Align Typed Policy, Signers, Topology Verification, and Security Baselines

**Files:**
- Modify: `src/config/policy.ts`
- Modify: `src/policy/classify.ts`
- Modify: `src/signers/eip1193.ts`
- Modify: `src/topology/build.ts`
- Modify: `src/topology/verify.ts`
- Modify: `scripts/plan-deployment.ts`
- Modify: `scripts/verify-deployment.ts`
- Modify: `config/sepolia.example.json`
- Modify: `deployments/sepolia.example.json`
- Modify: matching unit and integration tests under `test/unit/{policy,signers,topology,deployment}` and `test/integration/{signer-flow,topology,rehearsal}.test.ts`
- Modify: `docs/research/2026-09-16-personal-vault-research.md`
- Modify: `docs/superpowers/plans/2026-09-16-personal-vault-security-core.md`
- Modify: `docs/security/signer-provider-evaluation.md`

**Interfaces:**
- Produces: `VaultPolicy` without a `recovery` property.
- Produces: `verifyTopology(input): Promise<TopologyReport>` requiring ordered owners `[policy.passkey, policy.burner]` and the six-field guard config.
- Removes: `createRecoverySigner`; preserves `createBurnerSigner` and the generic internal EIP-1193 exact-typed-data implementation.

- [ ] **Step 1: Write failing TypeScript boundary tests**

Update fixtures to omit recovery. Assert unknown `recovery` input is rejected by public deployment configuration, topology verification rejects any third owner, no recovery signer factory is exported, and classifier inputs cannot name or classify a recovery-only target/path.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:unit -- --grep "policy|signer|topology|deployment runbook" && npm run test:integration -- --grep "signer flow|setup integration|rehearsal"`

Expected: FAIL on existing required recovery fields, three-owner snapshots, and recovery adapter exports.

- [ ] **Step 3: Implement the two-owner TypeScript model**

Delete the recovery field and adapter surface, update canonical policy hashing and strict key validation, require two distinct signers, update topology reads and plan schemas, and convert all fixtures/rehearsals to passkey plus Burner. Keep the generic EIP-1193 helper private to the Burner adapter unless another reviewed signer role consumes it.

- [ ] **Step 4: Amend the binding baseline documents**

Record the user-approved two-owner decision and deferred recovery in the research baseline, mark the old three-owner plan sections as superseded by this plan rather than silently rewriting historical evidence, and update the signer-provider note. State the accepted lost-factor denial-of-service behavior explicitly.

- [ ] **Step 5: Run focused suites and verify GREEN**

Run: `npm run test:unit && npm run test:integration && git diff --check`

Expected: PASS; `rg -n "policy\.recovery|config\.recovery|createRecoverySigner|owners.*recovery" src scripts config deployments test contracts` returns no active recovery role.

- [ ] **Step 6: Commit**

Run: `git add src scripts config deployments test docs/research docs/security/signer-provider-evaluation.md docs/superpowers/plans/2026-09-16-personal-vault-security-core.md && git commit -m "refactor: align two-owner vault interfaces"`

---

### Task 3: Verify Infrastructure Evidence and Derive the Circular Address Set

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Modify: `yarn.lock`
- Modify: `src/config/deployment-validation.ts`
- Modify: `src/config/deployments.ts`
- Create: `src/topology/addressing.ts`
- Create: `src/topology/evidence.ts`
- Modify: `test/unit/config/deployments.test.ts`
- Create: `test/unit/topology/addressing.test.ts`
- Create: `test/unit/topology/evidence.test.ts`
- Modify: `docs/security/dependency-review.md`

**Interfaces:**
- Produces: `deriveComponentAddresses(input: { deployer: Address; startingNonce: bigint }): { guard: Address; delay: Address; maintenance: Address }` using contiguous `CREATE` nonces `N`, `N+1`, `N+2`.
- Produces: `deriveSafeProxyAddress(input: { factory: Address; singleton: Address; proxyCreationCode: Hex; initializer: Hex; saltNonce: bigint }): Address` matching Safe 1.5 `createProxyWithNonce`.
- Produces: `VerifiedComponent = Readonly<{ name: "passkeySigner" | "guard" | "delay" | "maintenance"; address: Address; runtimeCodeHash: Hex; bindingHash: Hex; source: string }>` only after runtime and configuration reads match the plan.
- Produces: branded `VerifiedDeploymentInfrastructure = Readonly<{ chainId: number; deployer: Address; observedDeployerNonce: bigint; safeSingleton: VerifiedDependency; safeProxyFactory: VerifiedDependency; passkeySignerFactory: VerifiedDependency; passkeySignerVerifier: VerifiedDependency; multiSendCallOnly: VerifiedDependency; passkeySigner: VerifiedComponent }>` from `resolveVerifiedDeploymentInfrastructure(client, input)`.
- Produces: `isVerifiedDeploymentInfrastructure(value): value is VerifiedDeploymentInfrastructure`; the brand stays module-private and cannot be constructed from configuration JSON.
- Defers: guard, Delay, and maintenance instance verification until Task 4, after their planned transactions have succeeded and immediately before Safe creation.

- [ ] **Step 1: Pin and document the official deployment registry**

Add exact dependency `@safe-global/safe-deployments@1.37.63`. Replace the unused `multiSend` registry role with `multiSendCallOnly`; for Safe 1.5 canonical Sepolia, assert address `0xA83c336B20401Af773B6219BA5027174338D1836` and code hash `0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663` from the pinned official asset. Record package integrity, source, license, release, and review date.

- [ ] **Step 2: Write failing address and evidence tests**

Cover exact CREATE nonce derivation, Safe proxy CREATE2 derivation against a real Safe 1.5 factory, negative/overflowing nonces, wrong initializer/singleton/factory/salt, unbranded infrastructure, absent code, code-hash mismatch, passkey signer address/binding mismatch, and a changed deployment sender nonce.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm run test:unit -- --grep "deployment|address derivation|vault evidence"`

Expected: FAIL because the new derivation and branded aggregate do not exist.

- [ ] **Step 4: Implement derivation and evidence verification**

Use viem address/CREATE2 primitives and the verified factory `proxyCreationCode`. Keep the brand module-private. Verify official infrastructure from the pinned package plus live bytecode, and verify the selected passkey signer instance from its exact address, runtime hash, and read-only binding. Do not claim that the not-yet-deployed guard, Delay, or maintenance instances are verified.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm run test:unit -- --grep "deployment|address derivation|vault evidence" && npm run verify:dependencies && git diff --check`

Expected: PASS locally; the Sepolia verifier may report an explicit evidence-absent stop until public component deployments exist, never partial success.

- [ ] **Step 6: Commit**

Run: `git add package.json package-lock.json pnpm-lock.yaml yarn.lock src/config src/topology test/unit docs/security/dependency-review.md && git commit -m "feat: verify deterministic vault deployment evidence"`

---

### Task 4: Build and Prove the Atomic Safe Initialization Plan

**Files:**
- Modify: `src/topology/build.ts`
- Create: `src/topology/multisend.ts`
- Modify: `scripts/plan-deployment.ts`
- Modify: `test/unit/topology/build.test.ts`
- Create: `test/unit/topology/multisend.test.ts`
- Modify: `test/integration/topology.test.ts`
- Modify: `test/integration/rehearsal.test.ts`
- Modify: `docs/security/call-graph.md`

**Interfaces:**
- Produces: `VaultPlanInput = Readonly<{ policy: VaultPolicy; deployer: Address; startingNonce: bigint; safeProxySaltNonce: bigint; guardCreationCode: Hex; delayCreationCode: Hex; maintenanceCreationCode: Hex; deployments: VerifiedDeploymentInfrastructure }>` and `buildVaultPlan(input: VaultPlanInput): VaultDeploymentPlan`.
- Produces: `encodeCallOnlyBatch(calls: readonly UnsignedSetupCall[]): Hex`; rejects nonzero operation, malformed data, and empty setup.
- Produces: ordered unsigned transactions for guard, Delay, maintenance, then `SafeProxyFactory.createProxyWithNonce`, each with fixed sender nonce and expected created address.
- Produces: branded `VerifiedVaultPrerequisites = Readonly<{ guard: VerifiedComponent; delay: VerifiedComponent; maintenance: VerifiedComponent }>` from `verifyVaultPrerequisites(client, plan)` only after all three deployments match the planned addresses, runtime hashes, and Safe/policy bindings.
- Produces: `assertSafeCreationReady(plan, prerequisites, observedDeployerNonce): void`; it rejects evidence for another plan and any nonce other than `startingNonce + 3n` before the Safe factory transaction may be submitted.

- [ ] **Step 1: Write failing deterministic-plan tests**

Assert byte-identical output for identical input; exact owners `[passkey,burner]`; threshold 1; zero fallback/payment; setup order `setAssetPolicy*`, `setMaintenance`, Delay `enableModule(Safe)`, `setGuard`, `setModuleGuard`, Safe `enableModule(Delay)`; all inner operations `CALL`; and exact expected addresses/nonces. Add the Review Focus tests for sender nonce drift and partial prerequisite deployment. Prove `assertSafeCreationReady` rejects zero, one, or two deployed prerequisites, a mismatched plan, and nonce drift.

- [ ] **Step 2: Write the failing real-Safe atomicity test**

Deploy prerequisites at the planned nonces, invoke the planned Safe factory call, and assert the created Safe immediately has two owners, both guards, only Delay, zero fallback, complete policy, maintenance, and Delay bindings. Mutate each inner call to revert and assert proxy creation leaves no initialized Safe at the predicted address.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm run test:unit -- --grep "buildVaultPlan|call-only batch" && npm run test:integration -- --grep "atomic two-owner topology"`

Expected: FAIL because production planning still throws its fail-closed placeholder.

- [ ] **Step 4: Implement the production planner**

Replace the placeholder with canonical packed `MultiSendCallOnly` setup encoding and a structured unsigned plan. Re-read/compare the deployment sender nonce at the planner boundary, require every caller-supplied address to match Task 3 derivation, and include decoded review records plus hashes without signatures or broadcast flags. Verify the deployed guard, Delay, and maintenance instances after their transactions land; require the resulting branded evidence and exact next sender nonce before exposing the Safe creation transaction to the submission script.

- [ ] **Step 5: Run focused and topology suites and verify GREEN**

Run: `npm run test:unit -- --grep "buildVaultPlan|call-only batch" && npm run test:integration -- --grep "atomic two-owner topology|setup integration|rehearsal" && git diff --check`

Expected: PASS; no test-only draft encoder remains as an alternate production path.

- [ ] **Step 6: Commit**

Run: `git add src/topology scripts/plan-deployment.ts test docs/security/call-graph.md && git commit -m "feat: plan atomic two-owner safe deployment"`

---

### Task 5: Define the Exact Submission Protocol and HTTPS Client

**Files:**
- Create: `src/transport/types.ts`
- Create: `src/transport/validate.ts`
- Create: `src/transport/https.ts`
- Create: `test/unit/transport/validate.test.ts`
- Create: `test/unit/transport/https.test.ts`

**Interfaces:**
- Produces: `SafeExecutionRequest = Readonly<{ version: 1; kind: "safe-execution"; idempotencyKey: Hex; chainId: number; deploymentsHash: Hex; policyHash: Hex; safe: Address; guard: Address; asset: Address; transaction: SafeTxMessage; safeTxHash: Hex; signatures: Hex; expectedSpend: AssetSpendState }>`.
- Produces: `DelayExecutionRequest = Readonly<{ version: 1; kind: "delay-execution"; idempotencyKey: Hex; chainId: number; deploymentsHash: Hex; policyHash: Hex; safe: Address; guard: Address; delay: Address; queueNonce: bigint; queueFingerprint: Hex; to: Address; value: bigint; data: Hex; operation: 0; createdAt: bigint; cooldownSeconds: bigint; expirationSeconds: bigint }>` and `SubmissionRequest = SafeExecutionRequest | DelayExecutionRequest`.
- Produces: `SubmissionResult = { kind: "submitted"; requestHash: Hex; transactionHash: Hex } | { kind: "confirmed"; requestHash: Hex; transactionHash: Hex; blockNumber: bigint; blockHash: Hex } | { kind: "reverted" | "stale" | "unsupported-chain" | "rpc-inconsistent" | "transport-unavailable"; requestHash: Hex; reason: string }`.
- Produces: `SubmissionTransport = Readonly<{ submit(request: SubmissionRequest): Promise<SubmissionResult> }>`.
- Produces: `snapshotSubmissionRequest(input: unknown): SubmissionRequest` and `createHttpsSubmissionTransport(options: Readonly<{ endpoint: URL; fetch: typeof globalThis.fetch; timeoutMs: number }>): SubmissionTransport`.

- [ ] **Step 1: Write failing strict-schema tests**

Cover every field mutation/type mismatch, unknown/missing fields, noncanonical bigint/hex/address forms, malformed Safe signatures, mismatched transaction/fingerprint hashes, sensitive fields, and both operation variants. Add the Review Focus test rejecting one idempotency key reused for a different canonical payload.

- [ ] **Step 2: Write failing HTTPS boundary tests**

Reject HTTP, URL credentials, redirects, cross-origin response identity, unknown response fields, request/result hash mismatch, sensitive response fields, non-JSON and oversized bodies. Verify timeout/network failures normalize to `transport-unavailable` without logging the request/signature.

- [ ] **Step 3: Run tests and verify RED**

Run: `npm run test:unit -- --grep "submission request|HTTPS submission"`

Expected: FAIL because `src/transport` does not exist.

- [ ] **Step 4: Implement validation and the HTTPS client**

Use strict exact-key validation and immutable snapshots. Inject `fetch` and an in-memory idempotency registry; do not add a server framework or persistence layer. Send one POST with canonical JSON and `redirect: "error"`; expose no logger that receives request bodies.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm run test:unit -- --grep "submission request|HTTPS submission" && git diff --check`

Expected: PASS.

- [ ] **Step 6: Commit**

Run: `git add src/transport test/unit/transport && git commit -m "feat: add exact HTTPS submission protocol"`

---

### Task 6: Revalidate Chain State and Broadcast Without Authority

**Files:**
- Create: `src/transport/relayer.ts`
- Create: `src/transport/calldata.ts`
- Create: `test/unit/transport/relayer.test.ts`
- Create: `test/integration/submission-transport.test.ts`
- Modify: `test/integration/delayed-tier.test.ts`

**Interfaces:**
- Produces: `validateAndBroadcast(request: SubmissionRequest, context: RelayerContext): Promise<SubmissionResult>`.
- `RelayerContext` contains `readers: Readonly<{ chainId(): Promise<number>; deployments(): Promise<VerifiedDeploymentInfrastructure>; topology(safe: Address): Promise<TopologyReport>; safeNonce(safe: Address): Promise<bigint>; policyHash(guard: Address): Promise<Hex>; spendState(guard: Address, asset: Address): Promise<AssetSpendState>; delayItem(delay: Address, nonce: bigint): Promise<QueueItem>; blockTimestamp(): Promise<bigint>; receipt(hash: Hex): Promise<CanonicalReceipt | undefined> }>` and `broadcaster: Readonly<{ executeSafe(target: Address, exactCalldata: Hex): Promise<Hex>; executeDelay(target: Address, exactCalldata: Hex): Promise<Hex> }>`.
- Produces: `CanonicalReceipt = Readonly<{ transactionHash: Hex; blockNumber: bigint; blockHash: Hex; status: "success" | "reverted" }>`; reuse the existing verified `QueueItem` shape from `src/monitoring/delay-events.ts`.
- Produces: canonical `encodeSafeExecutionCalldata(request)` and `encodeDelayExecutionCalldata(request)`; broadcaster receives only these bytes and target address.

- [ ] **Step 1: Write failing read-before-broadcast tests**

Cover wrong chain, unverified deployment aggregate, topology failure, nonce drift, policy/counter drift, transaction-hash mismatch, signer mutation, queue nonce/tuple/cooldown/expiration/cancellation drift, and broadcaster calldata mutation. Assert broadcaster call count remains zero for every rejection.

- [ ] **Step 2: Write failing real Safe/Delay integration tests**

Submit a passkey base transaction, passkey-plus-Burner step-up transaction, and ready Delay tuple through the relayer context. Assert exact balances/counters/queue transitions. Prove the gas-paying account is not an owner/module and cannot authorize a transfer, queue, cancellation, freeze, or repair.

- [ ] **Step 3: Add timeout reconciliation test**

Simulate broadcaster timeout after accepting the exact bytes. Require canonical receipt/nonce reconciliation to return `submitted` or `confirmed` for the same outer hash and never issue a second broadcast with changed data.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npm run test:unit -- --grep "relayer validation" && npm run test:integration -- --grep "submission transport"`

Expected: FAIL because the relayer validator and calldata encoders do not exist.

- [ ] **Step 5: Implement minimal relayer validation and broadcast**

Reuse `verifyTopology`, policy hashing, signer encoding, and queue helpers; do not duplicate policy classification. Perform all reads at a coherent observed block where the client supports it, recheck nonce/queue immediately before the injected broadcaster call, and return only the typed result union.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npm run test:unit -- --grep "relayer validation" && npm run test:integration -- --grep "submission transport|delayed" && git diff --check`

Expected: PASS with exact broadcast calldata and zero relayer authority.

- [ ] **Step 7: Commit**

Run: `git add src/transport test/unit/transport test/integration && git commit -m "feat: revalidate and relay authorized vault calls"`

---

### Task 7: Finish Documentation, Rehearsal Packaging, and Security Gates

**Files:**
- Modify: `docs/security/call-graph.md`
- Modify: `docs/security/dependency-review.md`
- Modify: `docs/security/testnet-runbook.md`
- Modify: `docs/superpowers/plans/2026-09-16-personal-vault-security-core.md`
- Modify: `docs/superpowers/plans/2026-09-28-two-owner-atomic-deployment-transport.md`
- Modify: `config/sepolia.example.json`
- Modify: `deployments/sepolia.example.json`
- Modify: `scripts/rehearse.ts`
- Create: `scripts/package-sepolia-rehearsal.ts`
- Modify: `package.json`
- Modify: `test/unit/deployment/runbook.test.ts`
- Modify: `test/unit/security/rehearsal-inputs.test.ts`
- Modify: `test/integration/rehearsal.test.ts`

**Interfaces:**
- Produces: `npm run package:sepolia-rehearsal -- <public-config> <output-dir>` containing only unsigned plan, decoded review, public manifest, and expected evidence hashes.
- Preserves: `npm run rehearse` as local Hardhat-only, secret-rejecting, non-broadcast proof.

- [ ] **Step 1: Write failing rehearsal-package and documentation consistency tests**

Assert the package contains no signatures, secrets, RPC URLs, private keys, Burner PINs, or broadcast instruction; its owners are exactly passkey/Burner; all hashes match the canonical plan; recovery fields are rejected; and the checked-in call graph, research amendment, plan checklist, and runbook use the same two-owner terminology.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:unit -- --grep "Sepolia deployment runbook|rehearsal input|two-owner documentation"`

Expected: FAIL because the package command and aligned documents do not exist yet.

- [ ] **Step 3: Implement packaging and finish security documentation**

Document prerequisite deployment, atomic setup, Safe submission, Delay execution, cancellation/freeze, signer repair, forbidden paths, lost-factor availability risk, and the future-recovery design boundary. Mark only checks proven by committed automated evidence; leave the live low-value Sepolia rehearsal unchecked until a human reviews and signs the package.

- [ ] **Step 4: Run the complete repository gate**

Run: `npm run build && npm test && npm run test:invariant && npm run coverage && npm run slither && npm run rehearse && git diff --check`

Expected: all commands exit 0; 0 test failures; Slither has no unreviewed finding; local rehearsal reports Hardhat chain 31337, unsigned, non-broadcast.

- [ ] **Step 5: Generate and inspect the unsigned example package**

Run: `npm run package:sepolia-rehearsal -- config/sepolia.example.json /tmp/recent-tx-safe-guard-issue-5-rehearsal`

Expected: deterministic public artifacts only. Record the human signing/live-Sepolia gate as outstanding; do not fabricate transaction hashes or mark issue #5 complete.

- [ ] **Step 6: Commit**

Run: `git add docs config deployments scripts package.json test && git commit -m "docs: package two-owner testnet rehearsal"`

---

## Final Review and Pull Request

- [ ] Build the whole-branch review package from the merge base through `HEAD`.
- [ ] Request one fresh whole-branch security review focused on the Review Focus items, every ledger ruling, two-owner completeness, atomic setup, and relayer non-authority.
- [ ] Fix Critical/Important findings once, each through a new failing test then green focused/full suites; commit each coherent fix separately.
- [ ] Re-run the complete repository gate and `git status --short`.
- [ ] Push `codex/issue-5-atomic-deployment-transport` and open a pull request linked to #5. State plainly that the human-reviewed live Sepolia rehearsal remains outstanding unless it was actually executed, and do not use `Closes #5` while that gate is open.
