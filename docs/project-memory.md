# Project Memory: Recent Transaction Safe Guard

> Durable handoff for future sessions. This document records decisions and
> knowledge learned during the security-core implementation work. It is not a
> substitute for the research document, implementation plan, or audit.

**Last updated:** 2026-09-23

## Project position

This project is a personal self-custody vault security research prototype. It
is testnet-only, unaudited, and must not be described as production-ready or
used with real funds. The intended product is one Safe holding assets with
bounded instant spending and cancellable delayed withdrawals.

The original repository on `main` contains the 2024 permissive experiment.
The security-core implementation was developed on the separate branch
`codex/personal-vault-research-docs` for PR #2. Always check the branch before
assuming that the security-core files exist in the current checkout.

## Architecture decisions

1. **One Safe, not multiple spending Safes.** The Safe is the single asset
   holder. There is no Daily, Step-up, Control, or auxiliary Safe layer.
2. **Three Safe owners, threshold one.** The configured passkey signer,
   Burner signer, and offline recovery signer are owners. The guard enforces
   the stronger tier-specific authorization rules; the Safe threshold alone
   is not the spending policy.
3. **Custom code is narrowly limited.** `TieredSpendingGuard` is the approved
   custom security-critical contract. Other behavior should use current,
   reviewed Safe/Zodiac primitives. Any additional custom security contract
   requires a focused design proposal first.
4. **The guard is mandatory on both paths.** It is installed as both the Safe
   transaction guard and module guard in the same atomic setup. Owner
   transactions and module transactions must be constrained identically.
5. **Zodiac Delay is the only enabled module.** The Safe is Delay owner,
   avatar, and target. Delayed operations are queued, cancellable, and
   executable only after the configured cooldown; security-weakening changes
   are delayed, while mechanically monotonic tightening may be immediate.
6. **X/Y/Z policy.** Base passkey-only transfers consume the per-token X
   budget. Step-up transfers require the passkey plus the named Burner and
   consume the shared Y budget. Values above Y use the delayed Z lane.
   Counters are cumulative per token over one shared 86,400-second period.
7. **Authorization is transaction-exact.** Digests bind chain, Safe,
   destination, value, calldata, operation, gas/refund fields, and nonce.
   Burner approval is never a generic message or reusable approval.
8. **Fast-path calldata is intentionally small.** Instant lanes support only
   native transfers and selected ERC-20 `transfer` calls. Delegate calls,
   batches, approvals, Permit/Permit2, arbitrary messages, and unknown calldata
   are denied.
9. **Monitoring cannot authorize.** Event decoding, ledgers, and notifiers
   are observational only. Notification payloads contain an allowlisted public
   subset of activity fields and never signing or execution capabilities.
10. **Webhook delivery is fail-closed.** HTTPS is required, credentials and
    private/local destinations are rejected, every DNS answer must be public,
    and the actual TLS connection is pinned to the validated address to avoid
    DNS rebinding. Redirects are not followed.

## Dependency and security findings

- Exact dependency versions and the lockfile are part of the security
  boundary. Dependency changes require an update to
  `docs/security/dependency-review.md` and a fresh test run.
- Codacy PR #2 identified vulnerable transitive `elliptic` and `ws` copies.
  The remediation kept major-version families intact: `elliptic` 6.6.1,
  `ws` 7.5.11 for Ethers 5 consumers, and `ws` 8.21.3 for Ethers 6/other 8.x
  consumers.
- Codacy also reported OpenZeppelin 3.x through
  Safe Passkey → Account Abstraction → Uniswap V3 Periphery. The
  `3.4.2-solc-0.7` alias is the patched release for CVE-2021-39167, while the
  initializer advisory applies to upstream code not imported or compiled by
  this repository. Do not replace the Solidity-0.7 compatibility package with
  an incompatible major version just to silence a scanner finding.
- Lower-severity `uuid` and `bn.js` findings were outside that remediation
  scope. A future dependency refresh must reassess them rather than assuming
  the current exception is permanent.
- Codacy analysis can lag the pushed PR head. Confirm the analyzed SHA before
  interpreting an issue list.

## Repository map

The intended security-core layout is:

```text
contracts/
  TieredSpendingGuard.sol       on-chain policy and Safe/module guard
  libraries/                    canonical digest and Safe signature helpers
  test/ERC20Mock.sol            test-only token
src/
  config/                       policy and verified deployment records
  policy/                       fail-closed transaction classification
  topology/                     deterministic build and read-only verification
  queue/                        Delay queue/cancel/execute builders
  signers/                      passkey, Burner, recovery adapter boundaries
  monitoring/                   event decoders, ledger, non-authorizing notifier
scripts/
  rehearse.ts                   safe local rehearsal inputs
  plan-deployment.ts            unsigned deterministic deployment plan
  verify-*.ts                   dependency, deployment, and topology gates
  watch-activity.ts             monitoring entry point
test/
  unit/                         policy, encoding, topology, signer, monitoring tests
  integration/                  real Safe/Delay integration boundary
  invariant/                    cumulative and adversarial properties
  fixtures/                     pinned deployment and chain evidence
legacy/
  2024 prototype                preserved for history; not security evidence
docs/
  research/                     product and threat-model decisions
  security/                     call graph, dependency and signer evidence
  superpowers/plans/            task sequence and delivery gates
  testing/                      executable manual and automated test roadmap
```

The historical `RecentTransactionGuard.sol`, `GnosisSafeMock.sol`, and their
tests are not a production foundation. Their authorization is disabled and
their mock does not reproduce Safe authorization or signatures.

## Working rules for future sessions

- Read `AGENTS.md`, the research document, and the implementation plan before
  changing architecture, contracts, encodings, signers, or dependencies.
- Treat every new execution path as requiring a call-graph update and
  adversarial tests.
- Use test-driven development for policy, encoding, topology, queue, signer,
  and monitoring behavior.
- Keep private keys, passkey material, Burner PINs, RPC secrets, and provider
  credentials out of the repository and logs.
- Prefer reproducible, unsigned deployment plans and fail-closed verification.
- Never use the historical mock as evidence of Safe integration.
- Never deploy to mainnet or claim production readiness without independent
  review and a professional audit.

## Current implementation status

The implementation work reached PR #2 on the security-core branch. The
notifier SSRF/DNS-rebinding issue was fixed, dependency findings were reduced,
and the Codacy reanalysis cleared the PR's critical and high findings. The
repository still needs a deliberate testing harness before it is pleasant for
humans to exercise interactively. The next work should follow
`docs/testing/2026-09-23-security-core-test-roadmap.md`.
