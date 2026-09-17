import { expect } from "chai";
import { keccak256, type Address, type Hex } from "viem";
import { buildVaultPlan, type TopologyDeploymentEvidence } from "../../src/topology/build";

const a = (n: number) => (`0x${n.toString(16).padStart(40, "0")}`) as Address;
const ev = (address: Address, version: string): any => ({ address, version, runtimeCodeHash: keccak256("0x6001"), source: "official-test-evidence", evidence: "verified" });
const policy = { chainId: 31337, safe: a(1), passkey: a(2), burner: a(3), recovery: a(4), delay: a(5), periodSeconds: 86400 as const, periodAnchor: 0n, cooldownSeconds: 3600, expirationSeconds: 86400, assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20)] }] };
const deployments: TopologyDeploymentEvidence = { safeSingleton: { ...ev(a(30), "1.5.0"), supportsModuleGuards: true }, safeProxyFactory: ev(a(31), "1.5.0"), guard: ev(a(6), "task7-reviewed"), delay: ev(a(5), "1.1.1") };

describe("one-Safe setup integration gate", () => {
  it("fails closed instead of producing a partially protected deployment when no atomic production path is reviewed", () => {
    expect(() => buildVaultPlan({ policy, safeProxy: a(1), safeProxySaltNonce: 0n, deployments })).to.throw("atomic setup encoder");
  });
  it("accepts only an explicitly supplied test encoder and emits no signatures", () => {
    const plan = buildVaultPlan({ policy, safeProxy: a(1), safeProxySaltNonce: 0n, deployments, atomicSetupEncoder: (calls): Hex => (`0x${calls.length.toString(16)}`) as Hex });
    expect(plan.safeProxyDeployment.value).to.equal(0n); expect(plan.setup.every((call) => call.value === 0n && call.operation === 0)).to.equal(true); expect(plan.extraAccounts).to.deep.equal([]); expect(JSON.stringify(plan, (_, value) => typeof value === "bigint" ? value.toString() : value)).not.to.contain("signature");
  });
});
