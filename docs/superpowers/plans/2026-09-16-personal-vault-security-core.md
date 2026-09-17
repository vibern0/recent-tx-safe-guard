# Personal Vault Security Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove a testnet-only Safe/Zodiac security core with bounded instant transfers and mandatory, cancellable delayed withdrawals.

**Architecture:** A 2-of-3 Control Safe authorizes slow-lane operations through a Zodiac Delay module, while a narrowly scoped passkey role authorizes limited fast-lane transfers through Zodiac Roles. A separate Vault Safe holds assets and exposes no unrestricted human-owner spending path after atomic setup. The repository supplies deployment/configuration builders, verification, signing adapters, monitoring, and adversarial integration tests; it does not create a new general-purpose guard.

**Tech Stack:** TypeScript, Node.js, Hardhat, viem, Safe Smart Account 1.5.x, `@gnosis-guild/zodiac`, Zodiac Roles SDK/deployments, Solidity only for test fixtures or a narrowly justified adapter, Mocha/Chai, Slither, and a Sepolia fork for real-contract integration.

**Spec:** `docs/research/2026-09-16-personal-vault-research.md`

## Global Constraints

- This plan produces a testnet security-core prototype, not a mainnet-ready wallet.
- Use Safe Smart Account 1.5.0 or a later version only after reviewing its release notes, audits, deployment support, and bytecode.
- Resolve Zodiac deployments through the current `@gnosis-guild/zodiac` registry and reject known-faulty versions or addresses.
- Pin exact dependency versions and commit the lockfile; no security dependency may use a caret, tilde, tag, branch, or unreviewed Git commit.
- Do not deploy or modify the historical `RecentTransactionGuard`; preserve it under `legacy/` as negative reference material.
- Test with actual Safe behavior. `GnosisSafeMock` is not acceptable evidence for authorization, signatures, modules, guards, or execution.
- The fast lane supports native transfers and selected ERC-20 `transfer` calls only.
- The fast lane denies delegate calls, batches, approvals, Permit, Permit2, arbitrary messages, configuration changes, and unknown calldata.
- Limits are denominated per token; no fiat oracle or aggregate USD limit is introduced.
- Every security-weakening change uses the slow lane and delay. Security-tightening changes may be immediate only when the onchain call graph proves that property.
- The UI or client classifier is advisory; onchain Roles and Delay enforcement is authoritative.
- No unrestricted human-owner or alternate module path may remain on the Vault Safe after setup.
- No production deployment occurs without independent topology review and an audit of every new security-critical contract.
- Stop the implementation if current Safe/Zodiac contracts cannot enforce a required property without new Solidity. Write a focused design and audit plan for that gap before coding it.

---

## File structure

The completed security-core prototype should have these responsibilities:

```text
AGENTS.md                                      Repository instructions and reading order
docs/research/2026-09-16-personal-vault-research.md
                                               Threat model, landscape, and approved architecture
docs/security/dependency-review.md             Exact versions, releases, audits, hashes, and rejected versions
docs/security/call-graph.md                    Every authorized call path and privileged transition
docs/security/signer-provider-evaluation.md    Passkey, Burner, Cometh, and provider-adapter acceptance rules
docs/security/testnet-runbook.md               Deploy, verify, rehearse, recover, and tear down
docs/superpowers/plans/2026-09-16-personal-vault-security-core.md
                                               This executable plan
legacy/contracts/                              Preserved 2024 prototype, excluded from compilation
legacy/test/                                   Preserved historical tests, excluded from the active suite
src/config/policy.ts                           Typed user policy and constants
src/config/deployments.ts                      Safe/Zodiac address and bytecode verification
src/policy/classify.ts                         Advisory fast/slow/blocked UX classifier
src/policy/roles.ts                            Roles permission and allowance encoding
src/topology/types.ts                          Account/module graph types
src/topology/build.ts                          Deterministic setup transaction construction
src/topology/verify.ts                         Onchain post-deployment invariant checks
src/queue/delay.ts                             Queue, execute, expire, and cancellation builders
src/signers/types.ts                           Signer boundary shared by passkey and wallet providers
src/signers/passkey.ts                         Safe passkey adapter
src/signers/eip1193.ts                         WalletConnect/EIP-1193 adapter for Burner and hardware wallets
src/monitoring/delay-events.ts                 TransactionAdded decoding and canonical fingerprints
src/monitoring/notifier.ts                     Notification port and non-authorizing transports
scripts/plan-deployment.ts                     Offline setup plan generation
scripts/verify-dependencies.ts                 Read-only dependency/address/code verification
scripts/verify-deployment.ts                   Read-only topology verification
scripts/watch-queue.ts                         Queue-event monitor
scripts/rehearse.ts                            Testnet send/queue/cancel/execute exercise
contracts/test/ERC20Mock.sol                   Active local test token only
test/unit/                                     Pure policy, encoding, fingerprint, and validator tests
test/integration/                              Real Safe/Zodiac fork tests
test/fixtures/                                 Deterministic accounts, tokens, and fork helpers
```

The consumer wallet UI is deliberately a separate plan. Its implementation starts only after Tasks 1–11 prove the security core and freeze its interfaces.

## Requirement coverage

| Security objective | Implemented and proved by |
|---|---|
| Bound compromise of the daily signer | Tasks 2, 5, and 10 |
| Delay remains after complete approval | Tasks 6 and 10 |
| Exact transaction binding and replay resistance | Tasks 6 and 10 |
| No direct-owner, extra-module, or calldata bypass | Tasks 4, 5, 7, and 10 |
| Independent queue observation | Task 9 |
| Immediate cancellation and daily-signer revocation | Tasks 5, 6, and 10 |
| Delayed security weakening | Tasks 4, 6, 7, and 10 |
| Two-of-three recovery without an instant withdrawal path | Tasks 8, 10, and 11 |
| Fail-closed dependencies, decoding, and verification | Tasks 2, 3, and 7 |
| Understandable fast/slow/blocked classification | Task 2; the consumer presentation is a follow-on plan |
| Reproducible testnet operation | Task 11 |

---

### Task 1: Preserve the prototype and establish reproducible dependencies

**Files:**
- Create: `legacy/README.md`
- Move: `contracts/RecentTransactionGuard.sol` → `legacy/contracts/RecentTransactionGuard.sol`
- Move: `contracts/GnosisSafeMock.sol` → `legacy/contracts/GnosisSafeMock.sol`
- Move: `test/RecentTransactionGuard.ts` → `legacy/test/RecentTransactionGuard.ts`
- Move: `contracts/ERC20Mock.sol` → `contracts/test/ERC20Mock.sol`
- Create: `docs/security/dependency-review.md`
- Modify: `package.json`
- Modify: `hardhat.config.ts`
- Create: `package-lock.json`

**Interfaces:**
- Consumes: Current repository and the version/advisory links in the research document.
- Produces: A clean active build, exact dependency pins, and a written dependency allowlist used by every later task.

- [ ] **Step 1: Record the untouched baseline**

Run:

```bash
git status --short
npm view @safe-global/safe-smart-account version dist.integrity
npm view @gnosis-guild/zodiac version dist.integrity
npm view zodiac-roles-sdk version dist.integrity
npm view zodiac-roles-deployments version dist.integrity
```

Expected: the worktree state is understood and every selected package reports a concrete version and registry integrity hash. If a current release differs from the research snapshot, review its release notes and advisories before selecting it.

- [ ] **Step 2: Quarantine the historical code**

Use `git mv` for the three historical implementation/test files and the ERC-20 fixture. Write `legacy/README.md` with this exact warning:

```markdown
# Historical prototype

This directory preserves the 2024 RecentTransactionGuard experiment. It is excluded from the active build and must not be deployed. Its authorization is disabled, its validation is not bound to a transaction, and its mock does not reproduce Safe security behavior. See `docs/research/2026-09-16-personal-vault-research.md`.
```

- [ ] **Step 3: Replace deprecated dependencies and add reproducible scripts**

Remove `@gnosis.pm/safe-contracts`. Add the reviewed exact versions of Safe Smart Account, Zodiac registry, Roles SDK, and Roles deployments with `npm install --save-exact`. Change `package.json` to include these scripts:

```json
{
  "scripts": {
    "build": "hardhat compile",
    "test": "hardhat test",
    "test:unit": "hardhat test test/unit/**/*.test.ts",
    "test:integration": "hardhat test test/integration/**/*.test.ts",
    "check": "npm run build && npm run test",
    "plan:deployment": "tsx scripts/plan-deployment.ts",
    "verify:dependencies": "tsx scripts/verify-dependencies.ts",
    "verify:deployment": "tsx scripts/verify-deployment.ts",
    "watch:queue": "tsx scripts/watch-queue.ts"
  }
}
```

- [ ] **Step 4: Document dependency evidence**

For each selected Safe/Zodiac package or deployed contract, record version, package integrity, repository tag/commit, audit link, supported networks, canonical address source, runtime bytecode hash, known-vulnerable predecessor, and review date in `docs/security/dependency-review.md`. Explicitly reject Roles 2.1.0 and Delay 1.1.0 unless current upstream documentation has retracted those advisories with evidence.

- [ ] **Step 5: Verify the clean baseline**

Run:

```bash
npm ci
npm run build
npm run test
git diff --check
```

Expected: active sources compile without `@gnosis.pm/safe-contracts`; no historical test runs; the lockfile is stable.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs legacy package.json package-lock.json hardhat.config.ts contracts/test
git commit -m "chore: establish personal vault security baseline"
```

---

### Task 2: Define the policy model and advisory classifier

**Files:**
- Create: `src/config/policy.ts`
- Create: `src/policy/classify.ts`
- Create: `test/unit/policy/classify.test.ts`

**Interfaces:**
- Consumes: Token/destination choices supplied by the caller.
- Produces: `VaultPolicy`, `PolicyAction`, `SpendState`, `Lane`, and `classifyAction(action, policy, spent)` for deployment planning and future UI use.

- [ ] **Step 1: Write the policy types and failing table tests**

Define this public boundary in `src/config/policy.ts`:

```ts
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type AssetPolicy = Readonly<{
  token: Address; // zero address means native asset
  perTransaction: bigint;
  perPeriod: bigint;
  periodSeconds: number;
  recipients: readonly Address[];
}>;

export type VaultPolicy = Readonly<{
  chainId: number;
  vault: Address;
  cooldownSeconds: number;
  expirationSeconds: number;
  assets: readonly AssetPolicy[];
}>;

export type PolicyAction = Readonly<{
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
}>;

export type SpendState = Readonly<Record<Address, bigint>>;
export type Lane = "fast" | "slow" | "blocked";
```

Create table tests covering native transfer, ERC-20 transfer, over-per-transaction, over-period, unknown token, unapproved recipient, `approve`, Permit, Permit2, multisend, delegate call, owner/module/guard mutation, malformed calldata, and unknown function.

- [ ] **Step 2: Run the tests and observe the missing implementation**

Run:

```bash
npm run test:unit -- --grep "classifyAction"
```

Expected: FAIL because `classifyAction` does not exist.

- [ ] **Step 3: Implement the closed classifier**

Export this exact signature:

```ts
export function classifyAction(
  action: PolicyAction,
  policy: VaultPolicy,
  spent: SpendState,
): Lane;
```

Return `fast` only for a decoded native transfer or ERC-20 `transfer(address,uint256)` that matches an asset, recipient, per-transaction cap, and remaining period cap. Return `slow` only for a recognized native/ERC-20 transfer that exceeds a fast-lane limit, an explicitly enumerated Safe/Roles/Delay configuration selector, or an explicitly enumerated signer-recovery selector. Return `blocked` for delegate calls, batches, approvals, Permit/Permit2, arbitrary message signing, malformed calldata, and every selector outside those allowlists.

- [ ] **Step 4: Prove boundary behavior**

Run:

```bash
npm run test:unit -- --grep "classifyAction"
```

Expected: all table rows pass, including exact-limit acceptance and one-unit-over rejection.

- [ ] **Step 5: Commit**

```bash
git add src/config/policy.ts src/policy/classify.ts test/unit/policy/classify.test.ts
git commit -m "feat: define closed vault transaction policy"
```

---

### Task 3: Verify Safe and Zodiac deployments before encoding transactions

**Files:**
- Create: `src/config/deployments.ts`
- Create: `scripts/verify-dependencies.ts`
- Create: `test/unit/config/deployments.test.ts`
- Create: `test/fixtures/deployments.ts`

**Interfaces:**
- Consumes: chain ID, public viem client, Safe/Zodiac registry metadata, and the dependency-review allowlist.
- Produces: `resolveVerifiedDeployments(client, chainId): Promise<VerifiedDeployments>`.

- [ ] **Step 1: Write rejection-first tests**

Define:

```ts
export type VerifiedContract = Readonly<{
  address: Address;
  version: string;
  runtimeCodeHash: Hex;
}>;

export type VerifiedDeployments = Readonly<{
  safeSingleton: VerifiedContract;
  safeProxyFactory: VerifiedContract;
  multiSend: VerifiedContract;
  roles: VerifiedContract;
  delay: VerifiedContract;
}>;
```

Tests must reject an unsupported chain, zero code, a mismatched code hash, an unknown version, Roles 2.1.0, and Delay 1.1.0. The success fixture must contain only values copied from `docs/security/dependency-review.md`.

- [ ] **Step 2: Run the validator tests and confirm failure**

Run:

```bash
npm run test:unit -- --grep "resolveVerifiedDeployments"
```

Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement registry resolution and bytecode verification**

Use the official registries for candidate addresses, fetch runtime code with viem, hash it with `keccak256`, and compare it to the committed allowlist. Throw typed errors before producing transaction calldata when any check fails. Do not silently select the newest version.

- [ ] **Step 4: Run unit and live read-only checks**

Run:

```bash
npm run test:unit -- --grep "resolveVerifiedDeployments"
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run verify:dependencies -- --chain-id 11155111
```

Expected: unit tests pass; the live command prints matching versions and code hashes without sending a transaction.

- [ ] **Step 5: Commit**

```bash
git add src/config/deployments.ts scripts/verify-dependencies.ts test/unit/config test/fixtures/deployments.ts docs/security/dependency-review.md
git commit -m "feat: verify safe and zodiac deployments"
```

---

### Task 4: Build the deterministic account topology and atomic setup plan

**Files:**
- Create: `src/topology/types.ts`
- Create: `src/topology/build.ts`
- Create: `test/unit/topology/build.test.ts`
- Create: `scripts/plan-deployment.ts`
- Create: `docs/security/call-graph.md`

**Interfaces:**
- Consumes: three Control Safe signer addresses, threshold `2`, policy, verified deployments, and a temporary bootstrap address.
- Produces: `buildVaultPlan(input): VaultDeploymentPlan`, including Safe deployments and one atomic Vault Safe setup batch.

- [ ] **Step 1: Define the topology boundary and failing snapshot test**

Define:

```ts
export type MetaTransaction = Readonly<{
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
}>;

export type VaultDeploymentPlan = Readonly<{
  chainId: number;
  controlSafe: Address;
  vaultSafe: Address;
  roles: Address;
  delay: Address;
  setupTransactions: readonly MetaTransaction[];
  expectedRuntime: Readonly<{
    controlThreshold: 2;
    controlOwners: readonly [Address, Address, Address];
    vaultModules: readonly [Address, Address]; // Roles and Delay only
    unrestrictedVaultOwners: 0;
  }>;
}>;

export type RolesConfigurationPlan = Readonly<{
  fastLaneRole: Hex;
  emergencyRole: Hex;
  transactions: readonly MetaTransaction[];
}>;
```

`buildVaultPlan` accepts a `RolesConfigurationPlan`. The snapshot test must assert deterministic addresses and ordered setup operations for a fixed salt; use a fully decoded fixture plan until Task 5 supplies the real encoder.

- [ ] **Step 2: Add negative setup tests**

Reject duplicate Control Safe owners, zero addresses, thresholds other than 2, unsupported chains, expiration not greater than cooldown, empty asset policy, an unverified module, and any final state containing a human Vault Safe owner or an extra module.

- [ ] **Step 3: Implement deterministic planning**

Build the Control Safe as 2-of-3. Build the Vault Safe setup as one atomic MultiSend that makes the Vault Safe the owner/avatar/target of Roles and Delay, includes the supplied Roles configuration, enables the Control Safe as a Delay proposer, enables exactly Roles and Delay on the Vault, and replaces the bootstrap owner with `0x0000000000000000000000000000000000000002` only after every earlier operation is encoded. Reject a Roles plan that does not contain exactly one fast-lane role and one emergency role. The Control Safe must not be the owner of Roles or Delay. The planner must generate calldata but never send it.

- [ ] **Step 4: Write the call graph before execution support**

In `docs/security/call-graph.md`, enumerate these paths with caller, callee, authorization, value capability, configuration capability, and cancellation capability:

```text
passkey -> Roles -> Vault Safe -> native/ERC20 recipient
Control Safe -> Delay queue -> Vault Safe -> recognized slow-lane target
Control Safe -> emergency-only Roles role -> Vault Safe -> Delay.setTxNonce
Control Safe -> emergency-only Roles role -> Vault Safe -> Roles.assignRoles(fixed passkey, fixed role, false)
bootstrap owner -> atomic setup -> removed final state
relayer -> execute eligible Delay queue item
```

Also enumerate and mark forbidden direct owner execution, unlisted modules, delegate calls, batches, approvals, arbitrary EIP-1271 messages, immediate weakening changes, direct Control Safe ownership of Roles/Delay, and every Roles permission broader than the two declared roles.

- [ ] **Step 5: Run deterministic plan tests**

Run:

```bash
npm run test:unit -- --grep "buildVaultPlan"
npm run plan:deployment -- --config test/fixtures/policy.json --out /tmp/personal-vault-plan.json
git diff --check
```

Expected: tests pass; repeated planning produces byte-identical JSON; no transaction is broadcast.

- [ ] **Step 6: Commit**

```bash
git add src/topology test/unit/topology scripts/plan-deployment.ts docs/security/call-graph.md
git commit -m "feat: build deterministic vault topology plan"
```

---

### Task 5: Encode the fast-lane Roles policy

**Files:**
- Create: `src/policy/roles.ts`
- Create: `test/unit/policy/roles.test.ts`
- Create: `test/integration/roles-fast-lane.test.ts`
- Create: `test/fixtures/fork.ts`
- Modify: `src/topology/build.ts`
- Modify: `test/unit/topology/build.test.ts`

**Interfaces:**
- Consumes: `VaultPolicy`, passkey member address, verified Roles deployment, and Vault Safe address.
- Produces: `buildRolesConfiguration(input): RolesConfigurationPlan` and `verifyRolesPolicy(input): Promise<PolicyVerification>` for both the fast-lane and emergency-only roles.

- [ ] **Step 1: Write encoding tests for native and ERC-20 permissions**

Tests must decode the produced calldata and prove that each token has one per-transaction cap, one period allowance, the exact period duration, the exact recipients, and only the required execution options. Prove that the Control Safe's second role permits only the selected Delay's `setTxNonce(uint256)` and the exact revocation call `Roles.assignRoles(fixedPasskey, [fastLaneRole], [false])`. Include negative assertions that it cannot assign a role, revoke another member, change an allowance, call another Delay, or invoke any other target/function. Also prove that no `approve`, Permit, Permit2, MultiSend, Safe configuration selector, wildcard target, wildcard function, or delegate-call permission appears.

- [ ] **Step 2: Run the encoding tests and confirm failure**

Run:

```bash
npm run test:unit -- --grep "buildRolesConfiguration"
```

Expected: FAIL because the Roles encoder is missing.

- [ ] **Step 3: Implement configuration using official Roles ABI/SDK**

Encode only the permission graph required by `VaultPolicy`. Name the spending role deterministically from `keccak256(abi.encode(chainId, vaultSafe, "FAST_LANE_V1"))` and the emergency role from `keccak256(abi.encode(chainId, vaultSafe, "EMERGENCY_V1"))`. Keep onchain allowance identifiers deterministic per token and reject SDK output that contains a target, selector, parameter condition, or execution option not derived from the input policy. The Roles owner must be the Vault Safe. Integrate the returned `RolesConfigurationPlan` into `buildVaultPlan` and prove the final atomic batch contains the exact decoded permissions before the sentinel-owner replacement.

- [ ] **Step 4: Prove enforcement on a Sepolia fork**

The integration test must use an actual Safe and the verified deployed Roles implementation. Assert:

```text
PASS  transfer below per-transaction and remaining period limits
PASS  two transfers whose sum equals the period limit
FAIL  one unit above the per-transaction limit
FAIL  one unit above the period limit
FAIL  unapproved recipient
FAIL  unknown token
FAIL  approve / Permit2 / arbitrary call
FAIL  delegate call
FAIL  execution by an unassigned address
PASS  Control Safe calls Delay.setTxNonce through its emergency role
PASS  Control Safe revokes only the fixed passkey from the fixed fast-lane role
FAIL  Control Safe uses the emergency role to add a member or call anything else
```

- [ ] **Step 5: Run the fast-lane suite**

Run:

```bash
npm run test:unit -- --grep "Roles"
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run test:integration -- --grep "fast lane"
```

Expected: every allowed case succeeds and every forbidden case reverts at the onchain enforcement layer.

- [ ] **Step 6: Commit**

```bash
git add src/policy/roles.ts test/unit/policy/roles.test.ts test/integration/roles-fast-lane.test.ts test/fixtures/fork.ts
git commit -m "feat: encode bounded roles fast lane"
```

---

### Task 6: Implement delayed queue, cancellation, expiry, and execution builders

**Files:**
- Create: `src/queue/delay.ts`
- Create: `test/unit/queue/delay.test.ts`
- Create: `test/integration/delay-slow-lane.test.ts`

**Interfaces:**
- Consumes: exact `PolicyAction`, chain ID, Vault Safe, Control Safe, verified Delay deployment, queue nonce, cooldown, and expiration.
- Produces: `queueFingerprint`, `buildQueueTransaction`, `buildCancellationTransaction`, `buildExecutionTransaction`, and `readQueueItem`.

- [ ] **Step 1: Define the queue item and failing hash tests**

Define:

```ts
export type QueueItem = Readonly<{
  chainId: number;
  delay: Address;
  vault: Address;
  nonce: bigint;
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  executableAt: bigint;
  expiresAt: bigint;
}>;

export function queueFingerprint(item: QueueItem): Hex;
```

Test that changing any field changes the fingerprint and that normalized input produces a stable fingerprint.

- [ ] **Step 2: Implement exact queue and execution encoding**

The queue builder must bind the complete action; the execution builder must read the onchain queue item rather than accepting an unverified replacement action. Reject delegate calls, approvals, Permit/Permit2, arbitrary message signing, and undecodable actions at the client boundary even if the slow lane could technically carry them. Configuration actions must use an explicit selector allowlist. Because the Vault Safe owns Roles and Delay, accepted configuration calls are queued through Delay and executed by the Vault after cooldown.

- [ ] **Step 3: Write real Delay integration tests**

Prove on a fork that:

```text
FAIL  execute before cooldown
PASS  cancel before cooldown
FAIL  execute cancelled item
PASS  execute exact item after cooldown
FAIL  substitute destination, value, calldata, operation, vault, chain, or nonce
FAIL  execute expired item
PASS  execute by an unprivileged relayer after cooldown
FAIL  non-Control Safe caller queues or cancels
FAIL  Control Safe changes Delay cooldown or Roles permissions directly
PASS  queued Vault Safe configuration call changes policy only after cooldown
```

- [ ] **Step 4: Prove approval does not skip the delay**

Add one integration test that collects the full Control Safe threshold and asserts that the recipient balance remains unchanged until the Delay cooldown elapses. This is the central acceptance test for the product.

- [ ] **Step 5: Run the queue suite**

Run:

```bash
npm run test:unit -- --grep "queueFingerprint"
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run test:integration -- --grep "slow lane"
```

Expected: all timing, mutation, cancellation, expiry, and relayer assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/queue test/unit/queue test/integration/delay-slow-lane.test.ts
git commit -m "feat: add cancellable delayed transaction lane"
```

---

### Task 7: Add post-deployment topology verification

**Files:**
- Create: `src/topology/verify.ts`
- Create: `test/unit/topology/verify.test.ts`
- Create: `test/integration/topology-verification.test.ts`
- Create: `scripts/verify-deployment.ts`

**Interfaces:**
- Consumes: public client, `VaultDeploymentPlan`, and deployed addresses.
- Produces: `verifyTopology(input): Promise<TopologyReport>` with structured checks and a nonzero process exit on any mismatch.

- [ ] **Step 1: Write mismatch tests**

Create fixtures for an extra Vault module, retained human owner, wrong Safe threshold, wrong Delay cooldown, wrong expiration, wrong Roles member, widened target, widened function, increased allowance, incorrect owner, and mismatched bytecode.

- [ ] **Step 2: Implement fail-closed verification**

Define:

```ts
export type TopologyCheck = Readonly<{
  name: string;
  ok: boolean;
  expected: string;
  actual: string;
}>;

export type TopologyReport = Readonly<{
  ok: boolean;
  checks: readonly TopologyCheck[];
}>;
```

Verify Safe singleton/version, owners, threshold, guards, modules, module guards, Roles owner/member/targets/functions/conditions/allowances, Delay owner/modules/cooldown/expiration/target/avatar, and runtime code hashes. Never return `ok: true` after an RPC read failure.

- [ ] **Step 3: Verify the expected final graph on a fork**

Deploy the full plan from Task 4 in the integration fixture, execute the atomic setup, and assert `report.ok === true`. Mutate one setting per test and assert `report.ok === false` with the exact failed check.

- [ ] **Step 4: Run verification tests**

Run:

```bash
npm run test:unit -- --grep "verifyTopology"
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run test:integration -- --grep "topology verification"
```

Expected: the approved topology passes; every unauthorized drift fails.

- [ ] **Step 5: Commit**

```bash
git add src/topology/verify.ts test/unit/topology/verify.test.ts test/integration/topology-verification.test.ts scripts/verify-deployment.ts
git commit -m "feat: verify deployed vault topology"
```

---

### Task 8: Add passkey and Burner-compatible signer boundaries

**Files:**
- Create: `src/signers/types.ts`
- Create: `src/signers/passkey.ts`
- Create: `src/signers/eip1193.ts`
- Modify: `docs/security/signer-provider-evaluation.md`
- Create: `test/unit/signers/passkey.test.ts`
- Create: `test/unit/signers/eip1193.test.ts`
- Create: `test/integration/control-safe-signing.test.ts`

**Interfaces:**
- Consumes: Safe typed data and either a Safe passkey signer or an EIP-1193 provider exposed by WalletConnect.
- Produces: a normalized `SafeSigner` whose output is always verified against its expected Safe owner before aggregation.

- [ ] **Step 0: Document provider selection rules**

Create `docs/security/signer-provider-evaluation.md` before coding adapters. Record that the security-core baseline uses Safe-native passkey support plus a generic EIP-1193 / WalletConnect adapter. Cometh Connect, Privy, Dynamic, Turnkey, Pimlico social-login flows, ZeroDev, Kernel, Biconomy, Alchemy smart wallets, and similar SDKs are optional future provider adapters only. A provider is acceptable only if tests prove that it signs the exact Safe transaction for the configured Control Safe owner and does not introduce an alternate wallet topology, recovery path, relayer authority, module, owner, session key, or message-signing capability that bypasses the verified Safe/Zodiac call graph.

- [ ] **Step 1: Define the signer port and failing conformance tests**

```ts
export interface SafeSigner {
  readonly owner: Address;
  readonly kind: "passkey" | "eip1193";
  signSafeTransaction(input: {
    chainId: number;
    safe: Address;
    safeTxHash: Hex;
    typedData: unknown;
  }): Promise<Hex>;
}
```

Conformance tests must reject chain mismatch, Safe mismatch, hash mismatch, wrong recovered EOA, invalid ERC-1271 response, duplicate signer, user rejection, provider account changes, and provider chain changes.

- [ ] **Step 2: Implement the passkey adapter**

Use Safe’s supported passkey/ERC-1271 flow. Verify the configured signer contract and resulting Safe owner identity. The adapter must not accept a raw assertion that is not bound to the expected Safe transaction typed data.

- [ ] **Step 3: Implement the EIP-1193 adapter**

Use `eth_signTypedData_v4` through the connected provider and verify the recovered address equals `owner`. Treat Burner as this generic provider through its supported WalletConnect flow; do not depend on undocumented NFC commands or bypass the Burner application’s PIN/connection behavior.

- [ ] **Step 4: Prove 2-of-3 threshold behavior**

On a fork, verify that passkey alone, Burner-compatible EOA alone, and recovery signer alone fail; any two distinct configured owners pass; a duplicate signature fails; and a correctly signed slow-lane proposal only queues rather than executes.

- [ ] **Step 5: Run signer suites**

Run:

```bash
npm run test:unit -- --grep "SafeSigner"
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run test:integration -- --grep "Control Safe signing"
```

Expected: all signer conformance and threshold assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/signers test/unit/signers test/integration/control-safe-signing.test.ts
git commit -m "feat: add passkey and hardware signer adapters"
```

---

### Task 9: Monitor the queue and send non-authorizing alerts

**Files:**
- Create: `src/monitoring/delay-events.ts`
- Create: `src/monitoring/notifier.ts`
- Create: `scripts/watch-queue.ts`
- Create: `test/unit/monitoring/delay-events.test.ts`
- Create: `test/unit/monitoring/notifier.test.ts`

**Interfaces:**
- Consumes: verified Delay address, public client, event cursor, and a `Notifier` implementation.
- Produces: decoded queue alerts containing the canonical fingerprint and no signing or execution authority.

- [ ] **Step 1: Define event and notification ports**

```ts
export type QueueAlert = Readonly<{
  fingerprint: Hex;
  chainId: number;
  delay: Address;
  vault: Address;
  nonce: bigint;
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  executableAt: bigint;
  expiresAt: bigint;
  transactionHash: Hex;
  blockNumber: bigint;
}>;

export interface Notifier {
  send(alert: QueueAlert): Promise<void>;
}
```

- [ ] **Step 2: Write reorg, duplicate, and malformed-event tests**

Tests must prove cursor persistence, idempotency by chain/log identity, confirmation depth, replay after restart, removal of reorged events, and rejection of events from an unverified Delay address.

- [ ] **Step 3: Implement JSON stdout and webhook notifiers**

The webhook payload contains only public transaction data and the canonical fingerprint. The notifier receives no private key, signer, session token, or method capable of queueing, cancelling, or executing.

- [ ] **Step 4: Implement the queue watcher**

Start from a configured block, wait the configured confirmation depth, decode `TransactionAdded`, re-read the queue item from the contract, compare it to the event, and only then notify. Exit nonzero on address/code mismatch or persistent RPC inconsistency.

- [ ] **Step 5: Run monitoring tests**

Run:

```bash
npm run test:unit -- --grep "QueueAlert"
```

Expected: all replay, reorg, verification, and least-authority assertions pass.

- [ ] **Step 6: Commit**

```bash
git add src/monitoring scripts/watch-queue.ts test/unit/monitoring
git commit -m "feat: monitor delayed vault transactions"
```

---

### Task 10: Add adversarial end-to-end tests and static analysis

**Files:**
- Create: `test/integration/adversarial.test.ts`
- Create: `test/integration/recovery.test.ts`
- Create: `scripts/rehearse.ts`
- Create: `slither.config.json`
- Modify: `package.json`
- Modify: `docs/security/call-graph.md`

**Interfaces:**
- Consumes: all security-core interfaces from Tasks 2–9.
- Produces: one command that proves the approved threat-model properties on a reproducible fork.

- [ ] **Step 1: Write end-to-end attack tests**

Implement one test per attack:

```text
daily signer attempts to drain more than one period limit
daily signer splits transfers to evade the per-transaction cap
daily signer calls an unapproved token or recipient
daily signer grants approval or signs an unsupported message path
Control Safe proposal attempts immediate execution
attacker mutates queued destination/value/calldata/operation/nonce
attacker enables an extra module or removes enforcement
attacker raises limits or shortens delay without the slow path
attacker uses MultiSend or delegate call
attacker exploits a retained bootstrap owner
attacker replays on another chain or Safe
attacker executes a cancelled or expired queue item
notification service attempts an authorized action
```

- [ ] **Step 2: Write loss and recovery tests**

Prove all three two-signer combinations can control the Control Safe, one lost signer does not lock the account, signer rotation uses the delayed path, and no recovery action moves Vault assets before cooldown.

- [ ] **Step 3: Add static and coverage commands**

Add exact scripts:

```json
{
  "scripts": {
    "coverage": "hardhat coverage",
    "slither": "slither . --config-file slither.config.json",
    "rehearse": "tsx scripts/rehearse.ts",
    "security:check": "npm run check && npm run coverage && npm run slither"
  }
}
```

If the prototype contains no active custom Solidity beyond fixtures, document that Slither applies only to fixtures and imported source, and do not present that result as an audit of deployed Safe/Zodiac bytecode.

- [ ] **Step 4: Implement the rehearsal script**

`scripts/rehearse.ts` must create or load a testnet plan, verify the topology, execute one fast transfer, queue one slow transfer, observe its alert, cancel it, prove it cannot execute, queue another, wait on a time-controlled local fork, and execute it. It must refuse mainnet chain ID `1`.

- [ ] **Step 5: Run the full gate**

Run:

```bash
npm run security:check
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run test:integration
npm run rehearse -- --network hardhat
git diff --check
```

Expected: all tests and analysis pass; no mainnet transaction is possible; the rehearsal logs the same queue fingerprints observed by the monitor.

- [ ] **Step 6: Commit**

```bash
git add test/integration scripts/rehearse.ts package.json package-lock.json slither.config.json docs/security/call-graph.md
git commit -m "test: prove vault threat model end to end"
```

---

### Task 11: Produce and execute the Sepolia testnet runbook

**Files:**
- Create: `docs/security/testnet-runbook.md`
- Create: `deployments/sepolia.example.json`
- Create: `config/sepolia.example.json`
- Modify: `scripts/plan-deployment.ts`
- Modify: `scripts/verify-deployment.ts`

**Interfaces:**
- Consumes: audited dependency allowlist, signer public addresses, policy, Sepolia RPC URL, and funded test accounts.
- Produces: reproducible unsigned deployment plans, verified deployment manifests, and evidence for the architecture gate.

- [ ] **Step 1: Write the runbook with explicit stop conditions**

Include preparation, signer enrollment, duplicate Burner backup check, plan generation, human review, transaction submission, bytecode verification, topology verification, fast transfer, over-limit rejection, delayed transfer, alert, cancellation, delayed execution, lost-signer recovery, and teardown. Stop if any code hash, owner, threshold, module, guard, permission, allowance, cooldown, expiration, or fingerprint differs.

- [ ] **Step 2: Define the public deployment manifest**

Use this structure and never include seed phrases, passkey secrets, PINs, provider tokens, or private RPC credentials:

```json
{
  "chainId": 11155111,
  "createdAt": "ISO-8601 timestamp",
  "controlSafe": "0x...",
  "vaultSafe": "0x...",
  "roles": "0x...",
  "delay": "0x...",
  "policyHash": "0x...",
  "setupTransactionHashes": [],
  "verificationReportHash": "0x..."
}
```

- [ ] **Step 3: Generate and review an unsigned plan**

Run:

```bash
SEPOLIA_RPC_URL="$SEPOLIA_RPC_URL" npm run plan:deployment -- --chain-id 11155111 --config config/sepolia.example.json --out /tmp/sepolia-vault-plan.json
```

Expected: the plan contains no secrets, selects only verified deployments, and prints the expected final owner/module graph before signing.

- [ ] **Step 4: Execute the rehearsal with deliberately low-value test assets**

Follow the runbook from clean signer accounts. Record transaction hashes and verification outputs in a copy of the deployment manifest. Do not send production assets.

- [ ] **Step 5: Hold the architecture gate**

Review the evidence against every security objective in the research document. If a property depends only on the client, UI, alert service, or operator discipline rather than onchain enforcement, mark the gate failed and return to the responsible task.

- [ ] **Step 6: Commit the runbook and redacted example only**

```bash
git add docs/security/testnet-runbook.md deployments/sepolia.example.json config/sepolia.example.json scripts/plan-deployment.ts scripts/verify-deployment.ts
git commit -m "docs: add personal vault testnet runbook"
```

---

## Completion criteria

This plan is complete only when:

- Every task checkbox is checked with its command output reviewed.
- The historical guard is excluded from the active build.
- Dependency versions and runtime code hashes are recorded and verified.
- The final Vault Safe has no unrestricted human-owner or unlisted-module spending path.
- Fast-lane loss is bounded onchain by per-transaction and per-period token policy.
- A fully approved slow-lane transaction cannot execute before cooldown.
- Queued transactions can be cancelled and cannot be mutated or replayed.
- Security-weakening configuration cannot take effect immediately.
- Signer loss and rotation do not create an immediate withdrawal path.
- Monitoring is independent and has no authorization capability.
- The complete threat-model suite passes against actual Safe/Zodiac behavior.
- A Sepolia rehearsal completes with deliberately low-value test assets.
- No claim of production readiness or audit is made.

## Follow-on plans

After this plan passes, write separate plans for:

1. The consumer wallet UI and onboarding experience.
2. Independent cancellation-only guardians, if the reviewed topology requires new Solidity.
3. Additional assets and carefully decoded DeFi actions.
4. External review, audit remediation, and a capped production pilot.
