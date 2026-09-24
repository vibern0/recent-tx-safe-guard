# Policy Engine lessons

**Reviewed commit:** `405ba1d91e85d0fd26abf0f645bf216822c8c595` from `safe-research/policy-engine` `main` (2026-09-17)

**Status:** Prior art only. The Policy Engine is unaudited and is not a deployment dependency for this prototype.

## Provenance and license

The source was reviewed at the commit above in the Safe Research GitHub repository: <https://github.com/safe-research/policy-engine/tree/405ba1d91e85d0fd26abf0f645bf216822c8c595>. Its repository license and per-file SPDX notices govern any later reuse. This repository does not copy its implementation. The README itself warns that the code is unaudited and may contain serious security holes.

## Security lessons recorded

- `SafePolicyGuard` must occupy both Safe guard slots: `setGuard` for owner transactions and `setModuleGuard` for module transactions. Install both atomically where possible; one slot alone leaves a complete authorization bypass.
- `CoSignerPolicy`, `IncreasedThresholdPolicy`, and `SignatureExtension` demonstrate that context is untrusted caller-supplied data. It is acceptable only as self-authenticating material, such as a signature over a recomputed digest; it is never an identity claim.
- Exact digest verification must bind every transaction field that matters. A policy must not authorize an open-ended context window or an unrelated Safe transaction.
- Stateful checks require `safeTxGas == 0` so a failed inner owner call cannot commit accounting state. Module failures need the module after-execution hook to revert as well; otherwise a failed module call can consume state without moving funds.
- `gasPrice == 0` removes Safe refund payment from the policy surface. Refund fields then cannot move value outside the policy, but this is a deliberate invariant that must be enforced.
- Reentrancy gating surrounds top-level policy checks. Recursive checks are limited to the same Safe, and policy state must be namespaced by `(policy guard, safe)` so one Safe cannot consume another Safe's state.
- Stateful-policy tests show that failed-module rollback, same-Safe recursion, and cross-Safe isolation are security properties, not optional test conveniences.

## Interface and topology notes

Safe 1.5 exposes separate transaction-guard and module-guard interfaces. Owner execution enters the transaction guard before `execTransaction` and invokes its after-execution hook; module execution enters the module guard before `execTransactionFromModule` (and its return-data variant) and invokes the module after-execution hook. Safe increments its nonce as part of owner execution before the guard's post-signature execution path; exact digest reconstruction must account for the nonce selected for the signed transaction.

Safe contract signatures use the Safe signature encoding, including EIP-1271 contract-signature slots; approved-hash signatures are persistent and therefore are not an acceptable substitute for exact, per-transaction authorization here. The fallback handler is a separate Safe routing surface and must be explicitly constrained or left unset.

The Delay proposer/execution path is a module call that queues an exact target/value/calldata/operation tuple, waits for its cooldown, and then permits execution by an unprivileged executor. Its proposer and upstream Safe/module relationships must be checked from the deployed instance; an old or independently enabled module can bypass the intended delay.

These notes are verification requirements for later integration, not evidence that this repository has audited or deployed the Policy Engine, Safe, passkey, or Delay composition.
