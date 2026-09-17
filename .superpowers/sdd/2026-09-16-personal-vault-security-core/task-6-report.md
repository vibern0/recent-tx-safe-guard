# Task 6 report

Status: implemented and verified; testnet research prototype only.

Implemented:

- `GuardReplacementMaintenance`: Delay-only, Safe-context-only atomic dual-guard replacement; exact two self-calls, interface checks, expected-slot checks, rollback, reentrancy lock, and no arbitrary batch surface.
- `TieredSpendingGuard`: verified Delay-only module path, delayed queue proposal validation, delayed transfer execution validation, recovery nonce-advance cancellation recognition, immediate freeze, and maintenance-only delegatecall admission.
- Exact `repairSigner` and `repairPolicy` APIs with Delay-only module execution, recovery-only queue repair authorization, signer distinctness, exact calldata, and fail-closed arbitrary-selector rejection.
- Immediate policy changes are limited to initialization or monotonic numeric tightening with recipient deletion-only updates.
- `src/queue/delay.ts`: `queueFingerprint`, queue/cancellation/execution builders, and queue-item read call builder using the pinned Zodiac Delay 1.1-compatible ABI.
- Safe 1.5 integration coverage for arbitrary-module rejection, delayed module restrictions, and atomic dual-guard replacement.
- `docs/security/call-graph.md` updated for owner, Delay, cancellation, emergency, and maintenance paths.

Verification:

- `npx hardhat test test/integration/delayed-tier.test.ts`: 1 passing.
- `npm test`: 33 passing.
- `npm run build`: passed.
- `git diff --check`: passed.

Concerns:

- The maintenance path necessarily uses one narrowly whitelisted `DELEGATECALL` because Safe 1.5 guard setters require Safe self-calls; arbitrary delegatecall and batching remain denied.
- Zodiac Delay deployment bytecode/topology and queue lifecycle must still be independently verified on the target test network before funds are deposited.
- The integration test exercises the Safe 1.5 module-guard boundary with a Delay-compatible module caller; deployed Zodiac Delay bytecode/topology still requires independent target-network verification.
- No production-readiness or audit claim is made.
