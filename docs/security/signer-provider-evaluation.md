# Signer Provider Evaluation

**Status:** Security-core design note
**Date:** 2026-09-16

This project should not choose an embedded-wallet or account-abstraction provider as the security baseline. The baseline is the verified Safe/Zodiac topology:

- Safe-native passkey support for the convenient signer
- Generic EIP-1193 / WalletConnect signing for Burner and other hardware wallets
- `TieredSpendingGuard` and Zodiac Delay as the onchain policy authority
- Post-deployment topology verification before meaningful funds are deposited

Provider SDKs are useful only if they fit inside that topology.

## Baseline decision

The first security-core prototype uses Safe-native passkey contracts and a generic EIP-1193 signer boundary. This keeps the custody graph small enough to verify and avoids coupling the core vault to a vendor account model.

## Implemented signer boundary

Task 8 implements the provider-neutral boundary in `src/signers/types.ts`. A signer receives one immutable request containing `chainId`, the configured Safe, the exact `safeTxHash`, and the complete `SafeTx` EIP-712 typed data. The adapter rejects mismatched chain/Safe/domain/hash data before provider interaction and verifies provider state again after signing. No seed, passkey credential, Burner PIN, provider token, or RPC credential is accepted or logged by this boundary.

The passkey adapter accepts only the reviewed Safe-native WebAuthn raw signature. Its verifier must be the `passkeySignerVerifier` record returned by the official deployment-verification boundary: verified evidence, a non-empty committed runtime-code hash, and an address exactly equal to the configured passkey signer. Before signing and after verifier `eth_call`, it pins the provider chain to the request chain, then queries ERC-1271 at that exact address with the exact Safe transaction hash and raw signature. It emits exactly one canonical Safe contract-signature slot: configured signer address, `v = 0`, `s = 65`, and the length-prefixed raw WebAuthn payload. It does not accept a caller-supplied verifier callback, ECDSA, approved-hash, or arbitrary message signatures. All adapters reject non-canonical SafeTx domain keys, `SAFE_TX_TYPES`, `primaryType`, message keys, or value types before calling a provider.

The EIP-1193 adapter is used for Burner and offline recovery. It requests only `eth_signTypedData_v4`, verifies the selected account and chain before and after the request, recovers the EOA locally from the exact typed data, rejects user/provider failures and ambiguous injected-provider lists, and rejects duplicate Safe transaction hashes. Burner appends only the versioned `TieredSpendingGuard.BurnerSignature.v1` terminal extension; recovery returns the ECDSA signature without a Burner extension. Recovery authorization remains an onchain guard rule: cancellation, freeze, and enumerated delayed repairs only, never immediate transfers or policy broadening.

The adapters are transport components, not policy authorities. The deployed Safe 1.5 plus `TieredSpendingGuard` integration proves the matrix: passkey-only base succeeds, Burner-only/recovery-only transfer attempts fail, passkey plus Burner step-up succeeds within the shared immediate limit, delayed proposals are rejected before cooldown and execute after it, recovery invalidates a queued item, recovery-only tightening and freeze work, and recovery cannot spend.

Cometh Connect remains a credible future frontend/onboarding candidate because it supports WebAuthn, ERC-4337, and Gnosis Safe based smart wallets. It is not the default security dependency for the MVP. It may be added later as a provider adapter if it passes the acceptance tests below.

Pimlico and `permissionless.js` are account-abstraction infrastructure. They may help with bundlers, paymasters, gas sponsorship, and user-operation transport, but they are not the root policy layer.

Privy, Dynamic, Turnkey, ZeroDev, Kernel, Biconomy, Alchemy smart wallets, and similar systems should be evaluated by the same criteria. Their passkey support or gasless UX is not sufficient by itself.

## Acceptance tests for any provider

A provider adapter is acceptable only if it proves all of the following:

- It signs the exact Safe transaction typed data for the configured single Safe.
- The produced signature verifies against the expected Safe owner.
- It cannot switch chain, Safe, owner, account, or transaction hash after the user review step.
- It does not create a second smart account that holds assets outside the Vault Safe.
- It does not add or retain an unrestricted owner, module, session key, recovery path, relayer authority, or message-signing path.
- It cannot bypass the passkey-only X limit, the named Burner co-signature, or the shared immediate Y allowance enforced through `TieredSpendingGuard`.
- It cannot bypass Zodiac Delay for transfers above Y or security-weakening changes.
- It exposes user rejection, provider account changes, chain changes, and signature failures as hard failures.
- It can be exercised in tests without relying on undocumented NFC, passkey, or hosted-service behavior.

If any provider requires a different onchain topology to work, stop and write a focused design proposal before implementation. Do not hide a topology change behind a frontend integration.

## Current recommendation

Start with:

1. Safe-native passkey adapter.
2. Generic EIP-1193 / WalletConnect adapter for Burner.
3. Provider-neutral conformance tests against the exact transaction digest and signature-extension formats accepted by `TieredSpendingGuard`.

Evaluate Cometh after the security core passes, as a frontend acceleration path rather than as the authority for custody policy.
