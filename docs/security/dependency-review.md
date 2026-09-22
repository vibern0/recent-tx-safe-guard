# Security dependency review

**Review date:** 2026-09-17
**Status:** Testnet security research baseline; not audited or production-ready.

This allowlist pins exact npm versions. Integrity values are the npm registry `dist.integrity` values queried on the review date. Runtime bytecode is intentionally `not deployed` for Task 1; later deployment verification must resolve official registry addresses, fetch runtime code, hash it, and fail closed on missing or mismatched data.

## Compiled or deployment-intended security dependencies

| Package | Exact version | npm integrity | Tag / source commit | Audit evidence | Supported chain | Canonical address source | Runtime code hash |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `@safe-global/safe-smart-account` | `1.5.0` | `sha512-VIMWxoeY/kNuZVsQVvAeOFKcQS3eojCXg0ecGnesBSLn5ypYshmBhVEEU5XiurJJGTs/MrcoLTbTxhs9W9GvdQ==` | npm `1.5.0`; `dc437e8fba8b4805d76bcbd1c668c9fd3d1e83be` | Safe official releases and audits: https://github.com/safe-global/safe-smart-account/tree/main/audits | One configured EVM test network only; chain support must be verified before deployment | Safe official deployments: https://github.com/safe-global/safe-deployments | Not deployed in Task 1 |
| `@safe-global/safe-passkey` | `0.2.0` | `sha512-B9IpVvwXLvK3m+BRhn9z8kCbEizFmua4YmaUBZ9yr0xM9YsX2PRTnxbFvC7pLph1OQ2u+9O2V3FEmPiS10YEIw==` | npm `0.2.0`; package source repository `safe-global/safe-modules` | Safe official release evidence; no independent audit claim made here | One configured EVM test network only; verify deployed support | Safe official deployments: https://github.com/safe-global/safe-deployments | Not deployed in Task 1 |
| `@gnosis-guild/zodiac` | `5.0.1` | `sha512-+fFXg+cSDFe6yQSKvyK7ivjEDkHXXwwcsh9g178u6OOM01gSII076ClKBXfp4ZX+JnQC5AP5gt6vyl/7RnRDkQ==` | npm `5.0.1`; `89352c4f05d4b223b9c555ca963a787fd930da2d` | Zodiac audit/release evidence: https://github.com/gnosisguild/zodiac/tree/main/audits | One configured EVM test network only; current Delay deployment must be verified separately | Zodiac official deployments/registry: https://github.com/gnosisguild/zodiac | Not deployed in Task 1 |
| `@openzeppelin/contracts` | `5.6.1` | `sha512-Ly6SlsVJ3mj+b18W3R8gNufB7dTICT105fJhodGAGgyC2oqnBAhqSiNDJ8V8DLY05cCz81GLI0CU5vNYA1EC/w==` | npm `5.6.1`; tagged release | OpenZeppelin audit/security information: https://www.openzeppelin.com/security-audits | Library code compiled for the configured EVM test network | No deployed address; library source only | Not applicable |
| `viem` | `2.56.7` | `sha512-8YXhttIOKikDnTLj4byvGQmF43Gi0FtEfxUWd6OqSJiuz9bxNYNGmzlS8ZaNiYSKUEfs5vmNprvwPIki9Lk4YA==` | npm `2.56.7` | Client library; no smart-contract audit claim | Testnet tooling only | Not applicable | Not applicable |

Safe v1.5 module guards are a hard requirement for later integration. The old `@gnosis.pm/safe-contracts@1.3.0` dependency is deliberately rejected and removed because the historical prototype predates module guards and is not an acceptable security baseline.

## Rejected versions and paths

- `@gnosis.pm/safe-contracts@1.3.0`: rejected; historical-only dependency and permissive mock integration.
- Zodiac Roles `2.1.0` and Delay `1.1.0`: rejected as vulnerable releases identified by the research baseline. No old deployment address is reused.
- Safe Research Policy Engine: rejected as a deployment dependency. Reviewed prior-art commit is `405ba1d91e85d0fd26abf0f645bf216822c8c595` from `safe-research/policy-engine` `main` on 2026-09-17. Its README warns that it is unaudited and may contain serious security holes. It is not compiled, deployed, or trusted by this repository.

## Evidence limits

Task 1 establishes reproducible package resolution and preserves the historical code. It does not verify deployed addresses, chain-specific runtime bytecode, Safe/passkey/Zodiac audit scope, or a production deployment. Those are explicit later-task gates. Missing RPC data, unknown releases, mismatched hashes, or absent audit evidence must fail closed.

Task 6 integration compiles the pinned Zodiac Delay v1.1.1 source at commit `30f3aafa9b3be3425bcac390fe6ab6bd9afb5f16` as `contracts/test/ZodiacDelayV1_1_1.sol`. This is a test fixture, not a production artifact or deployment claim. Its test-only Zodiac core compatibility surface exists solely because the installed zodiac-core package uses newer transient-storage syntax than the repository's pinned Solidity compiler; it is not a deployment dependency or a substitute for deployed bytecode verification. The production resolver fails closed when official deployment evidence is absent, before accepting an address or runtime hash.

Task 6 replacement evidence is implementation-bound: a replacement guard must have deployed runtime code matching the reviewed `TieredSpendingGuard` artifact hash `0x2ce73f0d8f57f18abfb7198fa0b027f1f4d025169518dac8b12c5da172b6f377`. Before either guard slot is changed, the maintenance path also checks the replacement's Safe, Delay, 24-hour period, and distinct nonzero role-signer configuration. A role-0 passkey replacement must have deployed code and return the ERC-1271 magic value for the compatibility probe; an EOA cannot satisfy this evidence. Task 7 also requires official verified records for the passkey factory, passkey verifier, TieredSpendingGuard, and Delay; all four are absent in the current registry, so planners and verification scripts reject caller-supplied addresses or hashes. Safe proxy verification requires runtime bytecode, `masterCopy() ==` the verified singleton, and `VERSION() == 1.5.0`. This is testnet security research evidence, not an audit or production-readiness claim.

## Codacy PR #2 dependency findings

Codacy PR #2 identified transitive `elliptic@6.5.4` and `ws` 7.x/8.x releases with security findings. `elliptic` is pinned through an npm override to `6.6.1`; `ws` is pinned by major family (`7.5.11` and `8.21.3`) so the Ethers 5 and Ethers 6 consumers retain their respective major APIs. These are tooling and signer-library transitive dependencies, not direct vault runtime dependencies. Their exact resolution is recorded in `package-lock.json`; rerun the test suite after any override change.

Codacy also reported `@openzeppelin/contracts@3.4.2-solc-0.7` under `@uniswap/v3-periphery`. For CVE-2021-39167, this is a package-alias false positive: [OpenZeppelin's advisory](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-fg47-3c2x-m2wr) explicitly lists `3.4.2-solc-0.7` as the patched release. Do not replace it with a different Solidity-major package to silence that finding.

The separate CVE-2021-46320 initializer finding is valid for this upstream package version, but its affected contracts are not part of this repository's compiled or executed code. The package is present only through Safe Passkey → Account Abstraction → Uniswap V3 Periphery; no first-party Solidity imports Uniswap or Account Abstraction contract sources. Keep its Codacy issue marked not exploitable for this repository, and revisit before introducing either dependency's Solidity sources into a build or deployment path. Other lower-severity `uuid` and `bn.js` findings are outside this critical/high remediation scope.
