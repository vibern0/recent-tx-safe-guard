# Sepolia testnet runbook

This runbook is for the two-owner single-Safe security-core prototype on Sepolia only (`chainId 11155111`). It is security research, not a production wallet. Never use it for mainnet, production funds, or live broadcast from the planner. The examples are redacted, not deployed, and contain no secrets.

The active prototype has exactly two Safe owners, the configured passkey and Burner, and no recovery owner, signer adapter, fallback handler, extra module, or auxiliary custody Safe. The loss of either factor is an accepted testnet availability risk: funds may become unavailable until a future delayed recovery design is separately written, reviewed, implemented, and rehearsed. That boundary is deliberate because an immediate recovery path would weaken the current two-owner call graph.

## Hard stop rules

Stop immediately and do not sign, broadcast, deposit funds, or continue rehearsal if any read-only check differs from the reviewed plan. A mismatch in any of the following is a hard failure:

- chain, Safe address, or exactly two owners `[passkey, Burner]`;
- threshold, zero fallback handler, transaction guard, or module guard;
- enabled Safe modules (Delay must be the only one);
- guard or Delay address, runtime bytecode hash, signer identity, policy hash, or dependency hash;
- X/Y asset policy, per-transaction caps, token/recipient allowlist, counter values, period anchor, or 86,400-second period;
- Delay owner, avatar, target, only enabled upstream module, cooldown Z, or expiration;
- queue transaction fingerprint, setup transaction hash, or independently observed notification;
- any unexpected approval, message-signing, batch, delegate-call, fallback, module, owner, recovery, or signer-repair path.

The verifier must fail closed on missing RPC reads, missing bytecode, malformed data, unknown addresses, unavailable counters, or an unexpected extra field that changes the reviewed call graph. Monitoring and UI classification are evidence only; neither authorizes execution.

## Inputs and outputs

`config/sepolia.example.json` is the public, redacted planner and verifier configuration. The verifier does not consume a deployment-plan output as its configuration: it consumes this config plus a separately collected observed snapshot. Replace example addresses and hashes only after a separate human review; never add private keys, passkey material, Burner PINs, seed phrases, provider tokens, or private RPC credentials.

The observed snapshot must include the recomputed `policyHash`, nested Safe singleton and Delay dependency address/code-hash records, Safe-to-singleton and Delay-to-dependency topology bindings, exact recipient arrays, and one unique counter record for every configured token. Counter values must be canonical decimal strings and remain within the configured per-token daily limits.

Generate an unsigned, reproducible plan:

```sh
npx ts-node scripts/plan-deployment.ts config/sepolia.example.json /tmp/sepolia-plan.json
```

Review every decoded setup call against `docs/security/call-graph.md` before any human-controlled signing workflow. The output must say `"unsigned": true` and `"broadcast": false`. This script never signs or broadcasts.

Create the public review package:

```sh
npm run package:sepolia-rehearsal -- config/sepolia.example.json /tmp/recent-tx-safe-guard-issue-5-rehearsal
```

The package directory contains only `unsigned-plan.json`, `decoded-review.json`, `public-manifest.json`, and `expected-evidence-hashes.json`. It must not contain signatures, private keys, RPC URLs, passkey material, Burner PINs, broadcast instructions, or recovery fields. Treat the package as input to human review; it is not an instruction to submit any transaction.

Verify using a separately collected public read-only snapshot:

```sh
npx ts-node scripts/verify-deployment.ts config/sepolia.example.json /tmp/sepolia-observed.json
```

Archive the unsigned plan, decoded review, public manifest, expected evidence hashes, observed snapshot, verification report, report hash, block number, and source revision as the evidence bundle. Redact logs before sharing.

## Atomic setup and exact Safe submission

Prerequisite deployment is separate from Safe creation. First deploy the reviewed setup helper, guard, Delay, and maintenance instances at the deterministic nonce sequence. Then re-read their runtime hashes and constructor/configuration bindings. Only after `assertSafeCreationReady` proves the deployer nonce is exactly `startingNonce + 4` may the official Safe proxy factory transaction be prepared.

The exact Safe submission is the factory call whose initializer is `setup([passkey, Burner], 1, setupHelper, setupData, 0, 0, 0, 0)`. The setup helper performs the atomic setup while `address(this)` is the final Safe: configure assets, set maintenance, install the same guard in both guard slots, enable Delay as the only Safe module, and enable the Safe as Delay's only upstream module. Any decoded submission that names a third owner, nonzero fallback handler, extra module, unlisted delegatecall, or mismatched Delay owner/avatar/target is a hard stop.

## Delay execution, cancellation/freeze, and signer repair

Delay execution happens only after the queued fingerprint has cooled down and before expiration. The relayer may call `executeNextTx`, but it has no authority beyond executing the already queued tuple. The module guard admits only the configured Delay module and supported `CALL` transfer or delayed-maintenance tuple.

Cancellation/freeze is available to the passkey plus Burner pair through the exact Delay nonce-advance cancellation or guard `freeze()` calls. Operators must enumerate the ordered queue items invalidated by a nonce advance before review. Signer repair is delayed and atomic through `GuardReplacementMaintenance.replaceSigner`, so the guard signer and Safe owner rotate together after Delay; direct guard signer repair and role-2 repair are forbidden.

## Forbidden paths

Direct owner transfers that do not satisfy the guard tier, unlisted modules, fallback handlers, delegatecalls outside the fixed maintenance path, batches, approvals, Permit/Permit2, arbitrary messages, approved-hash authorization, unknown calldata, unknown recipients, broad recovery fields, signer-only shortcuts, relayer discretion, and UI-only authorization are forbidden. Monitoring is mandatory evidence, not an authorizer.

## Rehearsal sequence

Use deliberately low-value test assets and clean test accounts. Refuse chain ID 1 at every step.

1. Read and record chain ID, bytecode, owners, threshold, fallback, both guard slots, the single Safe module, Delay topology, policy, counters, and notification destinations.
2. Verify the atomic setup plan is unsigned and byte-stable across two generations. Do not broadcast it from this repository.
3. Exercise a native/ERC-20 base transfer within per-transaction and X limits. Confirm it consumes both X and shared Y.
4. Exercise a step-up transfer requiring the configured passkey and Burner. Confirm it consumes shared Y, emits the step-up alert, and cannot be authorized by Burner alone.
5. Attempt unsupported calldata, approvals, Permit/Permit2, batches, delegate calls, arbitrary messages, unknown recipients, and direct owner/module bypasses. Each must fail closed.
6. Attempt a transfer above Y directly. Confirm it cannot execute; queue the exact fingerprint through Delay with passkey plus Burner approval.
7. Confirm the delayed lifecycle alert, cancel the queue item, and prove the cancelled fingerprint cannot execute. Repeat with expiry and prove stale execution fails.
8. Queue a fresh low-value delayed transfer, advance Z, execute it, and reconcile the exact fingerprint and alert.
9. Freeze instant tiers, rehearse the lost-factor availability failure, queue delayed signer repair, and run teardown. No future recovery boundary is active in this prototype; signer repair must use the delayed maintenance path and must not immediately transfer or weaken policy.
10. Re-run the complete read-only verifier after every state transition and retain failures. Do not accept “the UI showed the right tier” as proof.

## Evidence and architecture gate

The rehearsal is incomplete unless the evidence bundle proves one Safe holds assets, both guard paths are constrained, Delay is the only module, passkey-only spending is bounded by X, combined immediate spending by Y, transfers above Y wait Z and are cancellable, signer repair remains delayed, the lost-factor availability risk is visible, and both notification classes were independently observed.

The live low-value Sepolia rehearsal remains outstanding until a human reviews the public package, signs externally, executes with deliberately low-value test assets, and records real evidence. Do not fabricate transaction hashes and do not mark issue #5 complete from this package alone.

Any security property that depends only on UI classification, monitoring, relayer honesty, or operator discipline fails the architecture gate. Do not deploy to mainnet or describe this prototype as production-ready or audited. Independent review and a professional audit remain mandatory.
