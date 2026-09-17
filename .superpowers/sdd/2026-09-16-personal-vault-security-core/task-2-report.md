# Task 2 implementation report

**Task:** Define the X/Y/Z policy and advisory classifier
**Repository:** `/Users/bernardo/.codex/worktrees/308c/recent-tx-safe-guard`
**Security posture:** Testnet security research only. No deployment or production-readiness claim is made.

## Scope completed

- Added readonly `AssetPolicy`, `VaultPolicy`, and `AssetSpendState` models with validation for aligned 86,400-second periods, `0 < X < Y`, positive and bounded caps, distinct signers/assets/recipients, and valid addresses.
- Added fail-closed `classifyAction` support for native transfers and exact ERC-20 `transfer` calldata.
- Enforced recipient/token allowlists, passkey signer requirement, Burner requirement for step-up, cumulative remaining X/Y accounting, aligned reset windows, per-transaction caps, delayed recognized transfers above Y, and enumerated Safe/Delay/recovery actions.
- Added table-driven adversarial tests covering the Task 2 brief’s boundary, decoding, configuration, recovery, malformed-call, and fail-closed cases.

## Verification

```text
npx hardhat test test/unit/policy/classify.test.ts       # passed; 7 passing
git diff --check                                        # passed
```

The brief’s exact wrapper command was also attempted:

```text
npm run test:unit -- --grep "classifyAction"
```

It failed before running tests because the existing shell `if` wrapper appends `--grep` after `fi` (`syntax error near unexpected token '--grep'`). The equivalent direct Hardhat command was used for the red and green TDD checks. `npx tsc --noEmit` remains blocked by two pre-existing errors in `legacy/test/RecentTransactionGuard.ts` (lines 115 and 159); no Task 2 files are implicated.

## Concerns

- The classifier is advisory only; onchain enforcement remains a later guard task.
- The existing `test:unit` script should be repaired in a separate scoped task if argument forwarding is required.
