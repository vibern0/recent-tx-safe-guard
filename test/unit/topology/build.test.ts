import { expect } from "chai";
import { keccak256, type Address, type Hex } from "viem";
import { buildVaultPlan, type TopologyDeploymentEvidence } from "../../../src/topology/build";
import { type VaultPolicy } from "../../../src/config/policy";

const a = (n: number) => (`0x${n.toString(16).padStart(40, "0")}`) as Address;
const evidence = (address: Address, version: string): any => ({ address, version, runtimeCodeHash: keccak256("0x6001"), source: "official-test-evidence", evidence: "verified" });
const deployments: TopologyDeploymentEvidence = { safeSingleton: { ...evidence(a(30), "1.5.0"), supportsModuleGuards: true }, safeProxyFactory: evidence(a(31), "1.5.0"), guard: evidence(a(6), "task7-reviewed"), delay: evidence(a(5), "1.1.1") };
const policy: VaultPolicy = { chainId: 31337, safe: a(1), passkey: a(2), burner: a(3), recovery: a(4), delay: a(5), periodSeconds: 86400, periodAnchor: 0n, cooldownSeconds: 3600, expirationSeconds: 86400, assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20), a(21)] }] };
const encoder = (calls: readonly unknown[]): Hex => (`0x${calls.length.toString(16).padStart(2, "0")}`) as Hex;
const input = { policy, safeProxy: a(1), safeProxySaltNonce: 7n, deployments, atomicSetupEncoder: encoder } as const;

describe("buildVaultPlan", () => {
  it("produces deterministic Safe initializer, proxy deployment, policy setup, and exact topology", () => {
    const first = buildVaultPlan(input); const second = buildVaultPlan({ ...input });
    const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
    expect(json(first)).to.equal(json(second)); expect(first.unsigned).to.equal(true); expect(first.safeInitializer.slice(0, 10)).to.equal("0xb63e800d");
    expect(first.safe.owners).to.deep.equal([a(2), a(3), a(4)]); expect(first.safe.threshold).to.equal(1); expect(first.safe.fallbackHandler).to.equal(a(0)); expect(first.safe.guards).to.deep.equal({ transaction: a(6), module: a(6) }); expect(first.safe.modules).to.deep.equal([a(5)]);
    expect(first.delay).to.deep.equal({ owner: a(1), avatar: a(1), target: a(1), upstreamModules: [a(1)], cooldownSeconds: 3600, expirationSeconds: 86400 }); expect(first.setup).to.have.length(4); expect(first.extraAccounts).to.deep.equal([]); expect(first.atomicSetup).to.equal("0x04");
  });
  it("fails closed when no reviewed atomic setup encoder is available", () => { expect(() => buildVaultPlan({ policy, safeProxy: a(1), safeProxySaltNonce: 7n, deployments })).to.throw("atomic setup encoder"); });
  it("fails closed when any deployment evidence is not verified", () => { expect(() => buildVaultPlan({ ...input, deployments: { ...deployments, delay: { ...deployments.delay, evidence: "absent" as any } } })).to.throw("verified deployment evidence"); });
});
