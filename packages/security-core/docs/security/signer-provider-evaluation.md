# Signer Provider Evaluation

**Status:** Security-core design note
**Date:** 2026-09-16

This project should not choose an embedded-wallet or account-abstraction provider as the security baseline. The baseline is the verified Safe/Zodiac topology:

- Safe-native passkey support for the convenient signer
- Safe-native passkey support for a YubiKey-backed secondary signer
- Generic EIP-1193 / WalletConnect signing for Burner and other hardware wallets as ECDSA secondary signers
- `TieredSpendingGuard` and Zodiac Delay as the onchain policy authority
- Post-deployment topology verification before meaningful funds are deposited

Provider SDKs are useful only if they fit inside that topology.

## Baseline decision

The first security-core prototype uses Safe-native passkey contracts and a generic EIP-1193 signer boundary. This keeps the custody graph small enough to verify and avoids coupling the core vault to a vendor account model.

2026-10-01 update: the active Option B prototype has a primary passkey signer and two configured secondary signer forms: a YubiKey-backed Safe-contract passkey signer and a Burner WalletConnect ECDSA extension. The previous offline recovery EIP-1193 role is deferred, and no `createRecoverySigner` adapter is exported. This accepts a testnet denial-of-service tradeoff: loss of the primary passkey or all configured secondary factors can block operation until a future delayed recovery design is reviewed and implemented. That risk is intentionally narrower than keeping a recovery signer path that could become an immediate policy bypass.

## Implemented signer boundary

Task 8 implements the provider-neutral boundary in `src/signers/types.ts`. A signer receives one immutable request containing `chainId`, the configured Safe, the exact `safeTxHash`, and the complete `SafeTx` EIP-712 typed data. The adapter rejects mismatched chain/Safe/domain/hash data before provider interaction and verifies provider state again after signing. No seed, passkey credential, Burner PIN, provider token, or RPC credential is accepted or logged by this boundary.

The passkey adapter accepts only the reviewed Safe-native WebAuthn raw signature. Its `deployments` input must be the resolver-branded aggregate returned by the official deployment-verification boundary; it then selects `passkeySignerVerifier` and retains exact verified evidence, committed runtime-code-hash, and configured-passkey address checks. Cloned aggregates or caller-supplied `evidence: "verified"` and hashes are rejected before provider interaction. It also requires `deployments.chainId` to equal the request chain before signing. Before signing and after verifier `eth_call`, it pins the provider chain to the request chain, then queries ERC-1271 at that exact address with the exact Safe transaction hash and raw signature. It emits exactly one canonical Safe contract-signature slot: configured signer address, `v = 0`, `s = 65`, and the length-prefixed raw WebAuthn payload. It does not accept a caller-supplied verifier callback, ECDSA, approved-hash, or arbitrary message signatures. All adapters reject non-canonical SafeTx domain keys, `SAFE_TX_TYPES`, `primaryType`, message keys, or value types before calling a provider.

The role-neutral passkey adapter can be configured as the primary Safe-contract signer or as the YubiKey Safe-contract secondary signer. The EIP-1193 adapter is used for Burner WalletConnect as an ECDSA secondary signer. It requests only `eth_signTypedData_v4`, verifies the selected account and chain before and after the request, recovers the EOA locally from the exact typed data, rejects user/provider failures and ambiguous injected-provider lists, and rejects duplicate Safe transaction hashes. Burner appends only the versioned `TieredSpendingGuard.EcdsaSecondarySignature.v1` terminal extension. Direct Burner NFC/libhalo signing remains a future spike; no direct NFC adapter or libhalo dependency is part of the active security-core prototype.

The adapters are transport components, not policy authorities. The deployed Safe 1.5 plus `TieredSpendingGuard` integration proves the matrix: primary-only base succeeds, each secondary alone fails, two secondaries without the primary fail, primary plus YubiKey succeeds within the shared immediate limit, primary plus Burner succeeds within the shared immediate limit, and delayed proposals are rejected before cooldown and execute after it.

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
- It cannot bypass the primary-passkey-only X limit, the one-configured-secondary requirement above X, or the shared immediate Y allowance enforced through `TieredSpendingGuard`.
- It cannot bypass Zodiac Delay for transfers above Y or security-weakening changes.
- It exposes user rejection, provider account changes, chain changes, and signature failures as hard failures.
- It can be exercised in tests without relying on undocumented NFC, passkey, or hosted-service behavior.

If any provider requires a different onchain topology to work, stop and write a focused design proposal before implementation. Do not hide a topology change behind a frontend integration.

## Current recommendation

Start with:

1. Safe-native passkey adapter.
2. Safe-native passkey adapter configured as the YubiKey secondary.
3. Generic EIP-1193 / WalletConnect adapter for Burner as an ECDSA secondary.
4. Provider-neutral conformance tests against the exact transaction digest and signature formats accepted by `TieredSpendingGuard`.

Evaluate Cometh after the security core passes, as a frontend acceleration path rather than as the authority for custody policy.
