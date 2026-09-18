# Slither baseline

The gate runs Slither with `slither.config.json`, excludes legacy and test support, and accepts exit 255 only when the JSON report is readable and every finding is in `slither-baseline.json`. Any tool error or unlisted finding fails the gate. Informational findings are excluded by configuration; no security detector is globally disabled.

The reviewed baseline is narrow and intentional:

- `timestamp` and `divide-before-multiply`: the daily window is deliberately anchored to `block.timestamp`; integer division is the exact period-floor calculation, not a financial conversion.
- `incorrect-equality`: equality to the current window distinguishes current-period spend from stale state; stale state is treated as zero.
- `reentrancy-no-eth` in `GuardReplacementMaintenance.replaceGuards`: the lock is set before the two Safe self-calls and replacement configuration call, and is cleared only after all checks succeed. A revert rolls back both guard-slot writes and the lock. The remaining detector is retained as a review reminder, not suppressed.
- `unused-return`: signature decoder tuple fields are intentionally discarded after the decoder validates the exact signature shape; Safe performs the authoritative signature check immediately afterward.
- `cache-array-length`: `policyHash` is a read-only inventory loop over a bounded configuration array; this is an optimization-only finding.

This is a reviewed baseline, not an assertion that the code is audited or production-ready.
