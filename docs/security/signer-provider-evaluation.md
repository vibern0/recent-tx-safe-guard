# Signer Provider Evaluation

**Status:** Security-core design note
**Date:** 2026-09-16

This project should not choose an embedded-wallet or account-abstraction provider as the security baseline. The baseline is the verified Safe/Zodiac topology:

- Safe-native passkey support for the convenient signer
- Generic EIP-1193 / WalletConnect signing for Burner and other hardware wallets
- Zodiac Roles and Delay as the onchain policy authority
- Post-deployment topology verification before meaningful funds are deposited

Provider SDKs are useful only if they fit inside that topology.

## Baseline decision

The first security-core prototype uses Safe-native passkey contracts and a generic EIP-1193 signer boundary. This keeps the custody graph small enough to verify and avoids coupling the core vault to a vendor account model.

Cometh Connect remains a credible future frontend/onboarding candidate because it supports WebAuthn, ERC-4337, and Gnosis Safe based smart wallets. It is not the default security dependency for the MVP. It may be added later as a provider adapter if it passes the acceptance tests below.

Pimlico and `permissionless.js` are account-abstraction infrastructure. They may help with bundlers, paymasters, gas sponsorship, and user-operation transport, but they are not the root policy layer.

Privy, Dynamic, Turnkey, ZeroDev, Kernel, Biconomy, Alchemy smart wallets, and similar systems should be evaluated by the same criteria. Their passkey support or gasless UX is not sufficient by itself.

## Acceptance tests for any provider

A provider adapter is acceptable only if it proves all of the following:

- It signs the exact Safe transaction typed data for the configured Control Safe.
- The produced signature verifies against the expected Safe owner.
- It cannot switch chain, Safe, owner, account, or transaction hash after the user review step.
- It does not create a second smart account that holds assets outside the Vault Safe.
- It does not add or retain an unrestricted owner, module, session key, recovery path, relayer authority, or message-signing path.
- It cannot bypass Zodiac Roles for fast-lane transfers.
- It cannot bypass Zodiac Delay for slow-lane transfers or security-weakening changes.
- It exposes user rejection, provider account changes, chain changes, and signature failures as hard failures.
- It can be exercised in tests without relying on undocumented NFC, passkey, or hosted-service behavior.

If any provider requires a different onchain topology to work, stop and write a focused design proposal before implementation. Do not hide a topology change behind a frontend integration.

## Current recommendation

Start with:

1. Safe-native passkey adapter.
2. Generic EIP-1193 / WalletConnect adapter for Burner.
3. Provider-neutral conformance tests.

Evaluate Cometh after the security core passes, as a frontend acceleration path rather than as the authority for custody policy.
