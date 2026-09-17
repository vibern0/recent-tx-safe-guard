# Security-core call graph

This document records the Task 6 execution paths. The repository remains a testnet security prototype.

## Instant owner path

`Safe.execTransaction` → transaction guard `TieredSpendingGuard.checkTransaction` → exact Safe signature and policy check → Safe target call → `checkAfterExecution`.

Only native transfers and selected ERC-20 `transfer` calls are admitted. The guard rejects delegate calls, batches, approvals, Permit/Permit2, arbitrary messages, unknown calldata, and non-passkey transfer signatures. Failed execution rolls back the counter update.

## Delayed proposal and execution

`Safe.execTransaction` → transaction guard → `Delay.execTransactionFromModule(to,value,data,operation)` with the exact single queued tuple → Delay queue.

After cooldown and before expiration, an unprivileged relayer calls pinned Zodiac Delay v1.1.1 `executeNextTx(to,value,data,operation)` → Safe `execTransactionFromModule` → module guard `checkModuleTransaction` → exact native/ERC-20 transfer → `checkAfterModuleExecution`. The module guard admits only the configured Delay address and supported `CALL` transfer tuples; Delay owns cooldown, FIFO ordering, expiration, `skipExpired`, and nonce cancellation semantics.

## Cancellation and emergency freeze

The recovery owner may submit only the configured Delay `setTxNonce(uint256)` cancellation or the guard `freeze()` call. The configured passkey plus Burner may authorize the same emergency actions. Queue builders expose the next nonce so callers can enumerate all ordered queue items invalidated by cancellation before signing.

Immediate `setAssetPolicy` is accepted only for an unset token or a numeric decrease/equal value with a recipient subset. Policy increases and recipient additions are rejected on the owner path. `repairSigner(uint8,address,address)` (`0x28033279`) and `repairPolicy(address,uint256,uint256,uint256,uint256,address[])` (`0xc4f605f4`) are admitted only as exact `CALL` executions from the configured Delay; role values, signer distinctness, policy invariants, and exact ABI encoding are checked onchain. Recovery may queue only these exact repair calls, with no arbitrary `bytes` repair surface. Immediate Delay tightening uses `setTxCooldown(uint256)` (`0xebb2b4a2`) and `setTxExpiration(uint256)` (`0x9b56d5be`); `setAssetPolicy(address,uint256,uint256,uint256,uint256,address[])` is `0x7291b570`.

## Atomic dual-guard replacement

`Delay` → Safe module execution with `DELEGATECALL` → `GuardReplacementMaintenance.replaceGuards(address,address)` (`0x7ec60d4f`) or `replaceSigner(address,uint8,address,address,address,uint256)` (`0x95cf0a80`). `replaceGuards` accepts only deployed code whose runtime hash is the reviewed `TieredSpendingGuard` artifact hash `0x2ce73f0d8f57f18abfb7198fa0b027f1f4d025169518dac8b12c5da172b6f377`; it also checks both guard slots, Safe/Delay identity, 24-hour period, and distinct nonzero role signers before installation.

The module guard permits this one target, selector, and operation only when the caller module is the configured Delay. In Safe storage, the maintenance code verifies both current guard slots, verifies both interfaces on the replacement, sets a reentrancy lock, and performs exactly two Safe self-calls: `setGuard` and `setModuleGuard`. Any failure reverts the complete operation. No arbitrary target list, calldata batch, or general delegatecall is exposed.

Signer repair atomically updates guard configuration and rotates the corresponding Safe owner; replacement guards receive the same maintenance authorization before the old guard can be removed. Both currently installed guard slots and the old guard's Safe, Delay, and role-signer configuration are checked before rotation. Role 0 additionally requires deployed replacement code and an ERC-1271-compatible passkey signer response; roles 1 and 2 retain their Burner/recovery rotation semantics. All other module addresses, targets, selectors, and operations are denied by the module guard.
