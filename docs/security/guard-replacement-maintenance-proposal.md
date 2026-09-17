# Guard replacement maintenance proposal

## Gate

Task 6 is blocked. Safe 1.5 exposes `setGuard(address)` and `setModuleGuard(address)` as separate authorized calls and has no combined guard-replacement entry point. Executing them independently would create an intermediate state with only one guard slot protected, violating the single-Safe invariant.

The current plan also rejects fast-path batches and delegate calls. No implementation should queue or execute guard replacement until an atomic, fail-closed maintenance mechanism is explicitly reviewed.

## Candidate resolutions requiring approval

1. Add a narrowly scoped, reviewed maintenance contract that can be called only by the verified Delay module and performs both Safe setter calls atomically, with explicit reentrancy and rollback tests. This expands the custom security-critical surface and requires a new design review.
2. Use a verified Safe/Zodiac primitive that provides atomic maintenance without enabling arbitrary batches or delegate calls, after confirming its exact bytecode, call graph, and audit scope.
3. Change the topology invariant so a single immutable guard mediates maintenance without replacing both Safe slots. This would require revising the research property and all dependent tests; it must not be assumed.

## Stop condition

Until one resolution is accepted and its security properties are specified, Task 6 queue, recovery, and delayed configuration implementation must remain unstarted. The repository remains a testnet security prototype and makes no production-readiness claim.
