<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Wallet state flows through `src/lib/vault-store.tsx` (a `VaultSnapshot`-shaped provider); screens never compute authorization themselves — swap the simulated provider for a chain-backed one without touching UI.
- Euro amounts are bigint base units via `src/lib/euro.ts`; never use floats for balances or limits.
- Time-dependent activity states (queued/ready/expired) are derived with `effectiveStatus`, never trusted from storage.
- Signer roles are called first signer and second signer throughout the app; device-specific methods belong only in technical details because PR #7 supports multiple signer kinds.
