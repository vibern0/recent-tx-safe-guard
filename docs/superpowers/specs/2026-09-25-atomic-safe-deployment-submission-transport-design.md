# Atomic Safe Deployment and Submission Transport Design

**Status:** Approved design for implementation  
**Date:** 2026-09-25  
**Issue:** [#5](https://github.com/vibern0/recent-tx-safe-guard/issues/5)  
**Blocks:** [#4](https://github.com/vibern0/recent-tx-safe-guard/issues/4)

## Purpose

Complete the security-core prerequisites for a live testnet wallet without widening custody authority. The result must produce a deterministic unsigned plan that creates one Vault Safe in its final protected topology and a narrow transport that can pay gas for an already-authorized transaction without changing or authorizing it.

This remains security research and a testnet prototype. A live Sepolia rehearsal is a separate human signing gate and is not evidence of production readiness.

## Binding security properties

- Exactly one Safe holds assets.
- The Safe starts with the configured passkey, Burner, and recovery owners at threshold 1, no fallback handler, `TieredSpendingGuard` in both guard slots, and Zodiac Delay as its only enabled module.
- The Safe is Delay's owner, avatar, target, and only enabled upstream proposer.
- The setup transaction never exposes a bootstrap owner, unguarded initialized Safe, alternate module, fallback handler, or partially applied policy.
- The passkey signer, guard, and Delay may be deployed before Safe creation against the deterministically predicted Safe address. They are supporting contracts, not additional custody accounts.
- The guard and Delay remain the authorization authorities. The planner, transport, relayer, monitoring service, and UI are non-authorizing.
- Every deployment and submission decision fails closed on missing or inconsistent chain, bytecode, topology, policy, counter, signer, nonce, calldata, signature, or fingerprint evidence.
- No private key, passkey material, Burner PIN, provider credential, RPC secret, or raw signature is persisted in repository artifacts or logs.

## Chosen architecture

### 1. Verified prerequisite deployments

The planner consumes only the branded result of `resolveVerifiedDeployments`. The registry is extended to cover the Safe 1.5 `MultiSendCallOnly` deployment used during initialization. Every required address must have a pinned version, authoritative source, committed runtime bytecode hash, and matching live bytecode before planning begins.

The passkey signer, non-upgradeable `TieredSpendingGuard`, reviewed Zodiac Delay instance, and reviewed guard-maintenance helper are deployed before the Safe. Their constructors or initializers bind them to the predicted Safe address and final signer/policy values. The predicted address is derived from the verified Safe proxy factory, singleton, initializer, and salt nonce; caller-supplied proxy addresses are accepted only when they equal that derivation.

This design does not add a custom deployment or setup contract. If the existing contracts cannot be initialized safely through the approved path, implementation stops for a focused design proposal as required by `AGENTS.md`.

### 2. Atomic Safe initialization

Safe `setup` delegates once to the verified `MultiSendCallOnly`. Its packed inner operations are all `CALL` operations and are encoded canonically in this exact order:

1. Configure each guard asset policy.
2. Configure the reviewed maintenance helper if required by the final call graph.
3. Enable the Safe as Delay's sole upstream module/proposer.
4. Install `TieredSpendingGuard` as the Safe transaction guard.
5. Install the same guard as the Safe module guard.
6. Enable Delay as the Safe's sole module.

The initializer simultaneously establishes the exact three owners, threshold 1, zero fallback handler, zero setup payment, and zero payment receiver. Any failed inner call reverts proxy creation, so no initialized partial Safe remains.

The generated plan contains the predicted Safe, initializer, proxy-factory call, prerequisite deployment evidence, canonical decoded setup calls, policy hash, expected topology, and hashes needed for human review. It contains no signature or broadcast instruction and must serialize byte-for-byte identically for identical input.

### 3. Submission transport boundary

The repository exposes one provider-neutral `SubmissionTransport` interface and an HTTPS relayer implementation. A request contains:

- protocol version and idempotency key;
- chain ID and verified deployment evidence hash;
- Safe address and current Safe nonce;
- the complete Safe transaction fields;
- the exact Safe transaction hash and canonical signatures;
- expected policy/counter snapshot and transaction fingerprint;
- an operation kind: authorized Safe execution or permissionless ready-Delay execution.

The client validates and snapshots the request before network I/O. The relayer re-reads the chain, dependency bytecode, Safe topology, guard policy/counters, nonce, queue state where applicable, and recomputed transaction hash immediately before broadcast. It rejects any drift and never edits the request.

For Safe execution, the relayer only calls `Safe.execTransaction` with the supplied immutable fields and signatures. For Delay execution, it only calls `executeNextTx` for an already-recorded queue tuple that is ready and unexpired. Its gas-paying key is not a Safe owner, module, signer, recovery authority, or policy authority.

The transport returns a typed discriminated result:

- `submitted` with the outer transaction hash;
- `confirmed` with the canonical receipt identity;
- `reverted`;
- `stale` for nonce, policy, counter, queue, or fingerprint drift;
- `unsupported-chain`;
- `rpc-inconsistent`;
- `transport-unavailable`.

Unknown responses, response/request mismatches, duplicate idempotency keys with different payloads, redirects, non-HTTPS endpoints, embedded URL credentials, and sensitive response fields fail closed.

The first implementation defines the protocol, client, validation, and an injectable broadcast boundary. Operator key custody and hosted-service deployment remain outside this repository; the live rehearsal connects the reviewed boundary to human-approved testnet infrastructure without committing credentials.

## Data flows

### Planning

1. Read public policy input and verified dependency registry.
2. Verify runtime code on the selected chain.
3. Derive the canonical Safe initializer and predicted proxy address.
4. Prove every prerequisite contract binds to that address and policy.
5. Encode the call-only setup batch and proxy-factory transaction.
6. Render an unsigned canonical plan and human-readable review summary.
7. Refuse output if any invariant is missing or inconsistent.

### Authorized Safe submission

1. The existing classifier and signer adapters produce an exact reviewed Safe transaction and signatures.
2. The transport client snapshots and locally validates the request.
3. The relayer independently revalidates current verified chain state.
4. The relayer broadcasts the exact `execTransaction` call and returns typed status.
5. The caller reconciles confirmation from canonical RPC data; it does not treat an HTTP success as execution success.

### Ready Delay execution

1. The queue read model identifies the current ordered item and proves cooldown has elapsed without expiry or cancellation.
2. The transport request carries the exact stored tuple and queue identity.
3. The relayer re-reads Delay state and broadcasts the exact `executeNextTx` call.
4. Confirmation is derived from canonical receipt and post-state, not an optimistic response.

## Error handling

Validation errors are structured and safe to expose without secrets. Provider, RPC, and relayer exceptions are normalized into the typed transport outcomes; raw provider payloads and credentials are not forwarded to callers or logs.

Retries are allowed only for byte-identical requests with the same idempotency key. A changed request must use a new key and pass the complete review and signing flow again. A timeout is indeterminate until canonical chain state is checked.

## Testing strategy

Implementation follows red-green-refactor and commits after each completed task.

- Unit tests cover address prediction, canonical call-only batch encoding, deterministic serialization, exact field preservation, secret rejection, idempotency, typed errors, and mutation of every request field.
- Real Safe 1.5 integration tests create a proxy through the production planner and prove the final topology in the creation transaction. They prove proxy creation reverts if any setup operation fails.
- Adversarial tests cover fabricated deployment evidence, wrong bytecode, wrong chain/Safe/nonce, stale policy or counters, alternate modules/fallbacks, signature mutation/replay, transport response tampering, redirect/downgrade behavior, and relayer overreach.
- Delay tests prove an unprivileged relayer can execute only the exact current ready queue item and cannot create, mutate, reorder, cancel, or prematurely execute it.
- Failure tests prove reverted Safe or module execution does not consume guard counters or authorization.
- Repository gates include the focused tests, full `npm test`, invariant suite, coverage, Slither gate, local rehearsal, and `git diff --check`.

## Documentation and evidence

The implementation updates:

- `docs/security/call-graph.md` with prerequisite deployment, atomic setup, Safe submission, and Delay relay paths;
- `docs/security/dependency-review.md` with `MultiSendCallOnly` and any transport dependency or service assumption;
- `docs/security/testnet-runbook.md` with the human review, signing, funding, relay, evidence, and stop conditions;
- the security-core implementation-plan checkboxes so they match demonstrated evidence.

The live Sepolia rehearsal records only public addresses, dependency and policy hashes, transaction hashes, queue fingerprints, topology reports, and redacted outcome evidence. Human approval is required before signing or broadcasting the unsigned plan.

## Rejected alternatives

### Staged bootstrap-owner setup

Creating a usable Safe and configuring guards/modules in later transactions would create an unrestricted interval and violate the non-bypassable topology requirement.

### Custom deployment/setup contract

A new helper could deploy and configure everything in one transaction, but it would add security-critical Solidity beyond the approved guard and internal helpers. The verified Safe initializer plus `MultiSendCallOnly` already provides the necessary atomic boundary.

### ERC-4337/paymaster authority

Adding an account-abstraction module or session key solely for gas sponsorship would widen the call graph. The selected relayer pays gas for an already-authorized Safe or ready Delay call without becoming an authorization path.

### Direct browser wallet fallback

Requesting an unrelated injected wallet to fund or submit the transaction would expose account and chain switching behavior and contradict the bank-like wallet requirements. Missing relay configuration remains a typed fail-closed condition.

## Explicit non-goals

- Mainnet deployment or production-readiness claims.
- A second custody Safe or any unrestricted owner, module, session key, fallback handler, or relayer authority.
- Fiat funding, swaps, bridges, CCTP, DeFi, NFTs, batches, token approvals, Permit/Permit2, arbitrary calldata, or arbitrary message signing.
- Building the consumer PWA tracked by #4.
- Persisting or operating production relayer credentials inside this repository.

## Completion boundary

Code completion means the deterministic planner, atomic real-Safe integration path, typed transport, adversarial proofs, documentation, and unsigned Sepolia rehearsal package pass their gates. Issue completion additionally requires the human-reviewed low-value Sepolia rehearsal and redacted evidence bundle. If the human signing gate has not occurred, the pull request must state that limitation and must not mark #5 complete.
