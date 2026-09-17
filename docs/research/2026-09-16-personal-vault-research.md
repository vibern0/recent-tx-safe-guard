# Personal Vault: Wallet-Security Research and Product Direction

**Status:** Research baseline
**Date:** 2026-09-16
**Repository:** `recent-tx-safe-guard`

## Executive summary

The original project idea remains valuable, but it should no longer be framed as a single Safe transaction guard. The stronger product is a personal smart-account vault with two transaction lanes:

1. A bounded fast lane for ordinary payments, enforced onchain through per-transaction, per-period, per-token, destination, and function restrictions.
2. A slow lane for large or unusual actions that requires multiple signers and then remains cancellable during a mandatory delay.

The desired primitives now exist across Safe, Zodiac, passkeys, and inexpensive NFC hardware signers. Gnosis Pay is production evidence that a Safe can be combined with Roles and Delay modules to create constrained immediate spending plus delayed administrative actions. Argent previously shipped a closely related consumer experience, while Loopring provides daily quotas and guardian controls. ERC-8238 now proposes a near-exact vault model, but it is still a draft with a small reference implementation.

No currently available general-purpose consumer wallet found in this research packages all of the following into one approachable product:

- A Safe-based vault
- A passkey as the convenient daily signer
- A Burner NFC card as a step-up signer
- Per-transaction and daily limits
- Mandatory post-approval delays for larger transfers
- Independent alerts and cancellation
- Recovery that cannot immediately bypass the vault policy
- A bank-like interface that hides the account/module topology

The opportunity is therefore not merely another timelock contract. It is a safe composition, verification, and consumer experience around existing audited components, with as little new security-critical Solidity as possible.

## Problem statement

Conventional self-custody usually has a binary failure model: a valid signature can authorize the complete loss of the account. Hardware wallets make key extraction harder, and multisig requires more keys, but neither necessarily protects a user who is shown false transaction details and legitimately signs the wrong operation.

The system should instead make one compromised credential, one deceptive interface, or one mistaken approval survivable. It should provide the same useful property that bank transfer controls provide: routine activity can happen promptly, while unusually valuable activity creates time and an independent opportunity to intervene.

This matters more as phishing, impersonation, malicious interfaces, and targeted social engineering become cheaper to produce. AI changes the volume and personalization of attacks; it does not change the underlying security requirement. Deterministic onchain policy should remain the authority. AI may help explain, simulate, or flag a transaction, but it must not be a root authorizer.

## Security objectives

The product should satisfy these properties:

1. **Bounded compromise:** Compromise of the daily passkey or its phone cannot immediately drain the vault. Loss is bounded by onchain limits and permissions.
2. **Post-approval delay:** A large action remains delayed even after all required signers approve it.
3. **Exact authorization:** An approval is bound to the intended chain, account, destination, value, calldata, operation, and nonce. It cannot become an open time window for an unrelated transaction.
4. **Non-bypassable execution:** Direct owner calls, enabled modules, delegate calls, multisends, token approvals, Permit/Permit2, and arbitrary EIP-1271 signatures cannot silently bypass the policy.
5. **Independent cancellation:** A queued action produces an alert on a separate channel and can be cancelled or paused before execution.
6. **Delayed weakening:** Increasing limits, shortening delays, adding signers or modules, expanding permissions, or disabling enforcement is itself delayed.
7. **Safe recovery:** Recovery restores control without becoming an immediate withdrawal path.
8. **Understandable operation:** The interface expresses policy in user terms: “instant up to X today,” “available after this time,” and “cancel this transfer.”
9. **Fail-closed behavior:** Unknown calls and unsupported assets do not fall through an empty fallback or permissive default.
10. **Recoverability without a backdoor:** No vendor, relayer, or hosted service can unilaterally spend. Loss of one user factor does not permanently lock the account.

## Threat model

### In scope

- A malicious browser extension or dapp
- A compromised phone, browser, or wallet front end
- Theft of one signer or one authenticated session
- Deceptive transaction presentation and blind signing
- Malicious token approvals or signed messages
- Incorrect or malicious module configuration
- Front-end or dependency supply-chain compromise
- Loss of a phone, passkey, or Burner card
- An attacker attempting to weaken policy before withdrawing
- A legitimate user making an irreversible mistake
- Coercion or duress where the attacker has access to the daily signer but not every independent recovery/cancellation factor

### Outside the first MVP

- Privacy-preserving transfers
- Cross-chain policy synchronization
- Arbitrary DeFi calldata and protocol adapters
- Aggregate USD limits that depend on price oracles
- Automated fraud scoring as an authorization mechanism
- Protection after an attacker simultaneously controls every signer and the cancellation channel
- Formal coercion resistance comparable to a mature, audited implementation of the ERC-8238 proposal

## What exists today

### Safe smart accounts

Safe separates proposing, signing, and executing. A signer does not need to hold funds or gas. This is a strong foundation for separating day-to-day authorization from vault custody.

Safe supports WebAuthn passkeys as ERC-1271 signers for Safe accounts version 1.3 and later. A passkey can therefore be an owner without representing the vault as a conventional seed phrase. See [Safe passkeys](https://docs.safe.global/advanced/passkeys/passkeys-safe).

Safe v1.5 introduced module guards. This closes an important structural gap: before module guards, an enabled module could bypass the Safe transaction guard. A serious design must constrain both owner transactions and module transactions. See the [Safe v1.5 module-guard announcement](https://safefoundation.org/blog/introducing-safe-v1-5-0-module-guards-enhanced-smart-account-features).

Guards are also dangerous. A defective guard can deny service to the Safe, so every enforcement mechanism needs a deliberately designed recovery path. Safe documents this risk in the [`setGuard` reference](https://docs.safe.global/reference-smart-account/guards/setGuard).

Safe’s first-party Spending Limit module provides delegated one-time, daily, weekly, or monthly token allowances. It is useful prior art, but a delegate spends without the normal owner threshold and the feature does not provide mandatory delayed execution or cancellation for larger actions. See [Safe spending limits](https://help.safe.global/articles/3961440620-set-up-and-use-spending-limits).

Safe’s signed-message support also matters. An account may authorize offchain messages using threshold owner signatures and ERC-1271. A policy that protects only `execTransaction` can still be undermined by broad token approvals, Permit2, or an unrestricted message-signing path. See [Safe signed messages](https://help.safe.global/articles/7507962149-what-are-signed-messages).

### Zodiac Roles and Delay

The [Zodiac Roles Modifier](https://docs.zodiac.eco/developers/roles) gives a module fine-grained permissions over targets, functions, parameters, ETH value, and allowances. Its allowance model supports refill periods such as daily, weekly, or monthly. A value allowance alone does not restrict where funds go, so destination and function restrictions must be composed with it. See [Roles allowances](https://docs.zodiac.eco/developers/roles/allowances).

The [Zodiac Delay Modifier](https://docs.zodiac.eco/developers/delay) queues a module transaction for a cooldown period. The owner can invalidate queued transactions, anyone can execute after cooldown, and an optional expiration can prevent stale execution. The queue is ordered.

The central caveat is routing. Delay affects only calls that pass through it. Direct Safe-owner transactions or a separately enabled module can bypass it. A secure topology must remove those alternative spending paths or constrain them with an equivalent policy.

Version selection is security-critical. Current Zodiac documentation identifies old Roles 2.1.0 and Delay 1.1.0 releases as vulnerable. An implementation must resolve versions through the current registry, reject known-faulty releases, pin exact dependencies, and verify deployed bytecode rather than copying addresses from an old article or deployment.

### Gnosis Pay: production evidence for the composition

Gnosis Pay is the closest deployed architectural precedent. Each user account is a Safe with Zodiac modules. Roles limits the card path by amount and permitted settlement recipient. Delay protects slower administrative and withdrawal actions. Their documented architecture transfers Safe ownership to an inaccessible sentinel address, preventing a human EOA owner from bypassing module controls with a direct Safe transaction. See the [Gnosis Pay architecture](https://docs.analytics.gnosis.io/protocols/gnosis-pay/) and [self-custody explanation](https://help.gnosis.io/en/articles/15326301-how-does-gnosis-enable-card-payments-while-remaining-self-custodial).

This is evidence that the proposed composition is technically viable. It is not evidence that an old Gnosis Pay deployment or configuration should be copied verbatim. The pattern is reusable; every dependency, version, permission, and privileged path still requires current verification.

### Argent

Argent previously offered a particularly close consumer model: transfers under a daily limit were immediate, while an over-limit transfer waited 24 hours and could be approved or blocked with a guardian. See [Argent’s historical hardware-wallet and transfer-limit design](https://www.argent.xyz/blog/how-to-use-your-hardware-wallet-with-argent).

Argent later emphasized trusted addresses and guardians, and new Ethereum Vault wallets are no longer available to new users. See [Argent Vault availability](https://support.argent.xyz/hc/en-us/articles/5975236743569-Argent-Vault). The precedent validates the user experience but is not a currently open general-purpose path for this project.

### Loopring Smart Wallet

Loopring provides a daily quota, guardian locking and recovery, and delayed whitelist changes. The documented quota is ecosystem-specific and historically denominated in ETH with limitations. It is useful product prior art rather than a direct Safe-based solution. See [daily quota](https://docs-wallet.loopring.io/security/daily-quota) and [guardians](https://docs-wallet.loopring.io/security/guardians).

### Ambire

Ambire materially improves Safe operation through simulation, batching, clearer signing, and a smoother multisig flow. It supports using Safe accounts without relying on the Safe web interface. See [executing Safe transactions with fewer steps](https://help.ambire.com/en/articles/16146238-execute-safe-transactions-with-fewer-steps) and the [Ambire security model](https://help.ambire.com/en/articles/13714175-ambire-wallet-security-model).

Ambire addresses usability and transaction understanding, but this research did not find the complete general policy of bounded instant spending plus mandatory, cancellable delayed large withdrawals.

### Rhinestone

Rhinestone exposes developer infrastructure for passkeys, MFA, spending-limit hooks, smart sessions, and timelocked cold-storage behavior across modular accounts. It is evidence that these controls are converging into reusable wallet infrastructure. It remains an SDK/infrastructure option rather than the requested finished consumer experience. See [Rhinestone’s module SDK overview](https://www.rhinestone.dev/blog/modulesdk-now-supports-12-core-modules-and-smart-sessions-9a6c54d49472) and [spending-limit policy](https://docs.rhinestone.dev/smart-wallet/smart-sessions/policies/spending-limit).

### Safe Research Policy Engine

The [Safe Research Policy Engine](https://github.com/safe-research/policy-engine) is a promising general enforcement layer. It can install policy guards on transaction and module paths, apply deny-by-default policies, require co-signers or higher thresholds, restrict transfers, and delay configuration or guard removal.

It is not currently a production dependency for this project. Its README explicitly warns that it is unaudited and may contain serious security holes. It should be tracked as a possible future consolidation of the architecture, not treated as audited infrastructure.

### ERC-8238

[ERC-8238: Coercion-Resistant Vault](https://ethereum-magicians.org/t/erc-8238-coercion-resistant-vault/28130) proposes hot-wallet epoch limits, delayed vault withdrawals, cancellation, guardians, emergency pause, delayed configuration changes, per-token limits, and DeFi whitelists. It is remarkably close to the target product.

The proposal remains an [open ERC pull request](https://github.com/ethereum/ERCs/pull/1703), not an established standard. Its [reference repository](https://github.com/DeFiRe-business/eip-proposal-5wrench) is small and should be regarded as research code until the proposal, implementation, audits, and adoption mature.

## Burner NFC card assessment

[Burner](https://www.burner.pro/) is an NFC secure-element hardware wallet. It can connect to dapps, including Safe, through WalletConnect. Its private key is designed to be non-extractable, it uses a PIN, and it supports encrypted card-to-card backup rather than a seed phrase. See Burner’s [key and backup explanation](https://help.burner.pro/articles/why-doesn-t-burner-have-a-seed-phrase-and-how-is-my-private-key-secured).

The underlying [libhalo library](https://github.com/arx-research/libhalo) supports signing data, including EIP-191/EIP-712-related flows. This makes the card technically suitable as a secp256k1 Safe owner or signer exposed through a wallet connection.

The limitation is transaction display. The card has no screen on which it can independently render the destination, token, amount, chain, and consequences. The phone or browser constructs and displays the request. A compromised interface may therefore deceive both the phone passkey and the Burner card into signing a malicious operation. Two signatures made through one compromised display are not fully independent security factors.

Burner should consequently be treated as:

- A strong possession factor and protection against key extraction
- A convenient step-up signer for the Control Safe
- A recoverable physical signer when paired with a duplicate stored separately
- Not an independent trusted transaction display
- Not a replacement for onchain policy, mandatory delay, and independent alerts

For high-value use, a second device or display should verify the transaction fingerprint and human-readable details. The importance of this property was reinforced by the Bybit/Safe incident, where compromised infrastructure could deceive legitimate signers. The Ethereum ecosystem’s [clear-signing initiative](https://blog.ethereum.org/2026/05/12/clear-signing-announcement) addresses this class of failure.

## Passkey and onboarding-provider assessment

The security-core prototype should start with Safe-native signer paths rather than choosing an embedded-wallet vendor as a foundation. Safe's passkey module can make a WebAuthn credential a Safe owner, while a standard EIP-1193 or WalletConnect provider can represent Burner and other hardware wallets. These are the narrow signer primitives the vault needs.

Pimlico and `permissionless.js` are useful account-abstraction infrastructure for bundlers, paymasters, gas sponsorship, and ERC-4337 user-operation transport. They should be treated as execution infrastructure, not as the authority for vault policy. The onchain Safe, Roles, and Delay configuration remains the source of truth.

[Cometh Connect](https://docs.cometh.io/) remains a credible onboarding option. Its current documentation describes a white-labeled Web/TypeScript SDK for ERC-4337 smart wallets controlled with biometrics, built on WebAuthn and Gnosis Safe. This makes it relevant for the future consumer wallet. It should not be selected as the MVP's security baseline until it proves that it can control or integrate with the exact Control Safe topology without introducing an alternate wallet, recovery, relayer, or owner path that bypasses Roles or Delay.

Other embedded-wallet and smart-wallet SDKs, including Privy, Dynamic, Turnkey, ZeroDev, Kernel, Biconomy, and Alchemy smart wallets, should be evaluated the same way. The question is not whether they offer passkeys or gasless transactions; many do. The required question is whether they can act through the project's signer adapter while preserving the verified Safe/Zodiac call graph.

The implementation should therefore expose a small signer boundary first:

- Safe-native passkey adapter
- Generic EIP-1193 / WalletConnect adapter for Burner and other hardware wallets
- Optional future provider adapters, such as Cometh, only after conformance tests prove they sign the exact Safe transaction and cannot bypass the configured policy

## Recommended architecture

### Account topology

```text
Passkey ── small payment ──> Roles policy ──────────────> Vault Safe
             per-tx cap       per-token period cap
             allowed calls    allowed destinations

Passkey + Burner ──> Control Safe ──> Delay queue ─────> Vault Safe
Recovery signer ────┘                  24–72 hours
                                       │
Control Safe ── emergency-only Roles permission ─────> cancel / revoke daily signer
Independent alert channel ───────── observe and prompt cancellation
```

### Control Safe

The Control Safe holds no user funds. It is a 2-of-3 account with:

- A passkey for convenient approval
- A Burner card for physical step-up approval
- An offline recovery signer on a separate device or hardware wallet

Its responsibilities are to propose slow-lane transactions, cancel queued transactions, and control recovery/configuration flows. A 2-of-2 design is simpler but has unacceptable lockout risk if either factor is lost.

For the highest assurance, the root passkey should be device-bound or held on a hardware security key. A synced passkey is still materially stronger than SMS or a reusable password, but its cloud-account recovery domain must be included in the threat model.

### Vault Safe

The Vault Safe holds assets. Its human signers must not retain an unrestricted direct execution path after setup. Otherwise, a valid owner transaction can bypass Roles or Delay.

The preferred topology follows the Gnosis Pay concept:

- Bootstrap the Vault Safe under temporary control.
- Configure the approved Roles and Delay modules atomically.
- Verify every target, owner, module, guard, and permission.
- Replace the bootstrap owner with the deliberately inaccessible `0x0000000000000000000000000000000000000002` precompile only after recovery and cancellation have been proven.
- Permit value movement only through the fast and slow module paths.

Both Roles and Delay should be owned by the Vault Safe. This makes their configuration callable by the Vault only, so a weakening change can be queued through Delay and later executed by the Vault. The Control Safe should be enabled as a proposer on Delay, but it should not own Delay directly; direct ownership would let two compromised Control Safe signers shorten the cooldown immediately.

Cancellation and fast-lane freeze use a second, narrowly scoped Roles permission. The Control Safe is a member of an emergency role that permits the Vault Safe to call only `Delay.setTxNonce` and to revoke the fixed passkey from the fixed fast-lane role. This lets any valid 2-of-3 Control Safe combination invalidate queued items or stop a compromised daily signer immediately while providing no permission to queue, execute, transfer assets, raise limits, shorten delays, add members, or otherwise reconfigure the system. The exact ABI, parameter conditions, owner semantics, and call path must be proved against the selected Roles and Delay versions before testnet deployment.

### Fast lane

The daily passkey receives a narrowly scoped Roles permission:

- Native ETH transfers and explicitly supported ERC-20 `transfer` calls only
- A maximum per transaction for each asset
- A maximum per period for each asset
- Explicit destination policy
- No delegate calls
- No arbitrary contract calls
- No token `approve`, Permit, Permit2, Safe owner changes, module changes, guard changes, or policy changes
- Deny by default for unrecognized calldata

The first MVP should use token-denominated limits. USD-denominated aggregate limits require price oracles, staleness handling, manipulation resistance, and failure behavior that do not belong in the initial security core.

### Slow lane

The Control Safe’s threshold approval queues the exact action through Delay. Approval does not immediately execute it. The queue record must bind:

- Chain ID
- Vault Safe address
- Destination
- Native value
- Calldata
- Call/delegate-call operation
- Queue nonce
- Earliest execution time
- Expiration, if configured

The default target for the prototype should be a 24-hour cooldown with a finite expiration. Higher-value production profiles may use 48–72 hours.

Anyone may execute a valid queued transaction after cooldown; execution should not depend on the original signer remaining online or holding gas. A relayer may improve usability, but it must have no authorization beyond executing an already-valid queue item.

### Cancellation, alerts, and pause

A delay is useful only if the owner learns about queued actions and can respond. Every `TransactionAdded` event must be monitored. Alerts should include decoded human-readable details and a canonical transaction fingerprint.

At least one notification channel must be independent from the proposing browser session. Examples include a second-device push notification, email with no signing capability, or an operator-selected webhook. Notification compromise must not authorize spending.

The Control Safe must be able to invalidate a queue item and revoke a compromised daily signer with any valid 2-of-3 recovery combination. For the prototype, both actions travel through the emergency-only Roles permission described above. A later production design may evaluate a separate one-factor cancellation guardian, but only if it cannot queue, execute, reconfigure, expand permissions, or withdraw. Any new cancellation contract is security-critical and requires dedicated specification, invariants, and audit.

### Policy and recovery changes

Changes that weaken security must not become effective immediately:

- Raising a limit
- Shortening a cooldown or extending queue expiration
- Adding a token, recipient, function, signer, module, or guard exception
- Removing a signer, guard, or module that participates in enforcement
- Expanding message-signing capability
- Changing recovery authority

Security-tightening actions may be immediate:

- Pausing the fast lane
- Lowering a limit
- Removing an allowed recipient or function
- Cancelling a queued transaction
- Disabling a compromised daily signer

This asymmetry is a required property, not merely a UI convention. The effective onchain call graph must enforce it.

### Signed messages and approvals

Transaction-only policy is insufficient. The design must explicitly address:

- Safe EIP-1271 message validation
- Token `approve` and `increaseAllowance`
- EIP-2612 Permit
- Permit2
- Session keys and smart sessions
- Pre-existing allowances created before installation
- Multisend and nested calls

The MVP should deny arbitrary fast-lane message signing and all approval mechanisms. A slow-lane exact approval may be supported after the UI can clearly show spender, token, amount, expiry, and revocation behavior. Unlimited approvals should not be part of the supported product path.

## User experience

The interface should hide the two-Safe topology while remaining honest about the security state.

### Onboarding

1. Create or select a passkey.
2. Connect a Burner card.
3. Register an independent recovery signer.
4. Choose conservative per-token instant limits.
5. Choose the delay period and alert channel.
6. Deploy the Control Safe and Vault Safe.
7. Show a verifiable summary of owners, modules, limits, and recovery.
8. Require a test queue, cancellation, and recovery exercise before accepting substantial deposits.

### Sending

The send screen classifies an action before signature:

- **Instant:** within the remaining fast-lane policy.
- **Delayed:** requires Control Safe approval and shows the exact execution time.
- **Unsupported:** cannot be represented safely by the current policy.

The UI’s classification is advisory. The onchain Roles and Delay contracts are authoritative.

### Queue

The queue must show:

- Human-readable asset, amount, and recipient
- Raw address and chain
- Calldata decoding and warnings
- Who proposed and approved
- Earliest execution and expiration
- Transaction fingerprint
- A prominent cancellation action
- Execution and cancellation history

### Recovery

Recovery should be rehearsed. The product should periodically remind the owner to verify the backup Burner card and offline recovery signer without moving funds or exposing secrets.

## Assessment of the existing repository

The current code is a historical prototype and should not be hardened incrementally into production.

### Critical findings

1. `RecentTransactionGuard.onlySafe()` contains no authorization check. Any caller can change the validator and timing parameters.
2. `validateNext()` records only a block number. It does not bind validation to a Safe, chain, transaction hash, destination, value, calldata, operation, or nonce.
3. `checkTransaction()` ignores every transaction argument and treats a recent block marker as authorization for the next call.
4. State is global rather than isolated per Safe.
5. The contract creates neither a delayed queue nor a cancellation mechanism.
6. There are no per-transaction, daily, per-token, destination, function, or approval restrictions.
7. The fallback silently accepts unknown calls, which is incompatible with fail-closed enforcement.
8. The mock disables authorization and omits meaningful Safe signature and after-execution behavior, so its tests do not establish real Safe compatibility or security.
9. The project depends on `@gnosis.pm/safe-contracts` 1.3.0 and predates Safe 1.5 module guards.

The old code remains useful as a record of intent and as negative test material. New work should preserve it under `legacy/`, construct the new topology from current Safe/Zodiac components, and test against real Safe behavior rather than the permissive mock.

## Options considered

### Option A: Safe + Zodiac composition — recommended prototype

Use current Safe, Roles, and Delay contracts, plus a reference client that creates, verifies, monitors, and operates the topology.

**Advantages**

- Reuses established, audited primitives
- Strong ecosystem compatibility
- Closely follows a production-proven Gnosis Pay pattern
- Minimizes new Solidity
- Can support passkey and Burner signers

**Costs and risks**

- Complex topology and setup
- Privileged configuration and cancellation paths require careful proof
- More gas and more contracts
- Consumer UX must hide substantial machinery
- Current versions and deployed bytecode must be continuously verified

### Option B: Safe Research Policy Engine

Use a single policy system across owner and module paths.

**Advantages**

- More uniform enforcement
- Policies can compose and default-deny
- Potentially simpler mental model after maturity

**Costs and risks**

- Explicitly unaudited today
- Policy interactions and guard recovery remain complex
- Not appropriate for production funds without maturation and independent audit

### Option C: Standalone ERC-8238-style vault

Build or adopt a native vault account centered on hot limits, delayed withdrawals, guardians, and pause.

**Advantages**

- Closest semantic match
- Can enforce all paths in one purpose-built state machine
- Avoids accidental Safe module/owner bypasses

**Costs and risks**

- Draft standard and immature ecosystem
- Largest new audit surface
- Less interoperability and tooling than Safe
- Risks duplicating work underway elsewhere

## Recommendation and product position

Proceed with Option A as a security-core prototype. Track Options B and C as possible future consolidation paths.

Position the product as:

> A personal self-custody vault with bounded instant spending and cancellable delayed withdrawals, using a passkey for convenience and an NFC card for step-up authorization.

The primary differentiation is the complete consumer workflow:

- Safe defaults
- Automatic fast/slow classification
- NFC tap as understandable step-up approval
- Delay after approval rather than before approval
- Independent notification and cancellation
- Recovery without an immediate withdrawal backdoor
- Verifiable configuration and plain-language signing

## MVP scope

The first security-core prototype should include:

- One EVM test network
- A 2-of-3 Control Safe
- A Vault Safe with no unrestricted daily-owner spending path
- One native asset and selected ERC-20 assets
- Per-transaction and per-period token-denominated limits
- Explicit recipient/function permissions
- A 24-hour delayed slow lane with expiration
- Queue listing, execution, and cancellation
- Passkey and generic EIP-1193 hardware-wallet signer adapters
- Burner through its supported WalletConnect path
- No default embedded-wallet SDK dependency; Cometh and similar providers are evaluated later through the signer-adapter boundary
- Independent queue-event notifications
- Full topology/configuration verification
- Adversarial integration tests using real Safe behavior

The first prototype should not support arbitrary DeFi, bridges, NFT operations, batch calls, delegate calls, arbitrary EIP-1271 messages, Permit2, unlimited approvals, multiple chains, or mainnet deployment.

## Delivery gates

1. **Architecture proof:** Every execution and configuration path is diagrammed and tested. No unrestricted direct owner or extra module path remains.
2. **Adversarial proof:** Tests demonstrate bounded fast-lane loss, mandatory slow-lane delay, successful cancellation, and inability to weaken policy immediately.
3. **Testnet rehearsal:** Setup, send, queue, alert, cancel, execute, lost-factor recovery, and signer rotation are exercised from clean accounts.
4. **Independent review:** A Safe/Zodiac specialist reviews topology and assumptions.
5. **Audit:** Any new Solidity and the complete configured call graph receive professional review before production funds.
6. **Product pilot:** A small invited cohort uses strict caps on a testnet and then a deliberately low-value production pilot.

## Immediate next actions

1. Execute the linked security-core implementation plan.
2. Contact Safe, Gnosis Guild, Burner/Arx, and the ERC-8238 authors to validate assumptions and avoid duplicating active work.
3. Produce a separate wallet-UX implementation plan only after the onchain topology passes its architecture and adversarial gates.
4. Do not deploy the historical guard or place funds in the prototype.

## Primary sources

- [Safe passkeys](https://docs.safe.global/advanced/passkeys/passkeys-safe)
- [Safe v1.5 module guards](https://safefoundation.org/blog/introducing-safe-v1-5-0-module-guards-enhanced-smart-account-features)
- [Safe guard recovery warning](https://docs.safe.global/reference-smart-account/guards/setGuard)
- [Safe modules](https://help.safe.global/articles/5490514177-what-is-a-module)
- [Safe spending limits](https://help.safe.global/articles/3961440620-set-up-and-use-spending-limits)
- [Safe signed messages](https://help.safe.global/articles/7507962149-what-are-signed-messages)
- [Safe hardware-wallet verification guidance](https://help.safe.global/articles/4369997924-how-to-verify-safewallet-transactions-on-a-hardware-wallet)
- [Zodiac Delay](https://docs.zodiac.eco/developers/delay)
- [Zodiac Delay reference](https://docs.zodiac.eco/developers/delay/reference)
- [Zodiac Roles](https://docs.zodiac.eco/developers/roles)
- [Zodiac Roles allowances](https://docs.zodiac.eco/developers/roles/allowances)
- [Gnosis Pay architecture](https://docs.analytics.gnosis.io/protocols/gnosis-pay/)
- [Gnosis Pay self-custody explanation](https://help.gnosis.io/en/articles/15326301-how-does-gnosis-enable-card-payments-while-remaining-self-custodial)
- [Safe Research Policy Engine](https://github.com/safe-research/policy-engine)
- [ERC-8238 discussion](https://ethereum-magicians.org/t/erc-8238-coercion-resistant-vault/28130)
- [ERC-8238 pull request](https://github.com/ethereum/ERCs/pull/1703)
- [ERC-8238 reference implementation](https://github.com/DeFiRe-business/eip-proposal-5wrench)
- [Burner](https://www.burner.pro/)
- [Burner key and backup model](https://help.burner.pro/articles/why-doesn-t-burner-have-a-seed-phrase-and-how-is-my-private-key-secured)
- [libhalo](https://github.com/arx-research/libhalo)
- [Cometh documentation](https://docs.cometh.io/)
- [Pimlico permissionless.js](https://docs.pimlico.io/references/permissionless/)
- [Ambire Safe flow](https://help.ambire.com/en/articles/16146238-execute-safe-transactions-with-fewer-steps)
- [Ambire security model](https://help.ambire.com/en/articles/13714175-ambire-wallet-security-model)
- [Argent historical transfer limits](https://www.argent.xyz/blog/how-to-use-your-hardware-wallet-with-argent)
- [Argent Vault availability](https://support.argent.xyz/hc/en-us/articles/5975236743569-Argent-Vault)
- [Loopring daily quota](https://docs-wallet.loopring.io/security/daily-quota)
- [Loopring guardians](https://docs-wallet.loopring.io/security/guardians)
- [Rhinestone modular wallet infrastructure](https://www.rhinestone.dev/blog/modulesdk-now-supports-12-core-modules-and-smart-sessions-9a6c54d49472)
- [Ethereum clear-signing initiative](https://blog.ethereum.org/2026/05/12/clear-signing-announcement)
