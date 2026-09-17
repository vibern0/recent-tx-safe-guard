import { expect } from "chai";
import { keccak256, type Address } from "viem";
import { buildVaultPlan } from "../../../src/topology/build";
import { type VaultPolicy } from "../../../src/config/policy";

const a = (n: number) => (`0x${n.toString(16).padStart(40, "0")}`) as Address;
const policy: VaultPolicy = { chainId: 31337, safe: a(1), passkey: a(2), burner: a(3), recovery: a(4), delay: a(5), periodSeconds: 86400, periodAnchor: 0n, cooldownSeconds: 3600, expirationSeconds: 86400, assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20), a(21)] }] };

describe("buildVaultPlan", () => {
  it("produces deterministic unsigned one-Safe topology and exact policy hash", () => {
    const input = { policy, safeAddress: a(1), guardAddress: a(6), delayAddress: a(5), safeSingleton: a(30), safeProxyFactory: a(31), guardCodeHash: keccak256("0x6001"), delayCodeHash: keccak256("0x6002") } as const;
    const first = buildVaultPlan(input); const second = buildVaultPlan({ ...input });
    expect(JSON.stringify(first, (_, value) => typeof value === "bigint" ? value.toString() : value)).to.equal(JSON.stringify(second, (_, value) => typeof value === "bigint" ? value.toString() : value)); expect(first.unsigned).to.equal(true);
    expect(first.deployments).to.deep.equal({ safe: a(1), guard: a(6), delay: a(5), safeSingleton: a(30), safeProxyFactory: a(31) }); expect(first.safe.owners).to.deep.equal([a(2), a(3), a(4)]);
    expect(first.safe.threshold).to.equal(1); expect(first.safe.fallbackHandler).to.equal(a(0)); expect(first.safe.guards).to.deep.equal({ transaction: a(6), module: a(6) }); expect(first.safe.modules).to.deep.equal([a(5)]);
    expect(first.delay).to.deep.equal({ owner: a(1), avatar: a(1), target: a(1), upstreamModules: [a(1)], cooldownSeconds: 3600, expirationSeconds: 86400 }); expect(first.policyHash).to.match(/^0x[0-9a-f]{64}$/); expect(first.setup.every((x) => !("signature" in x))).to.equal(true); expect(first.extraAccounts).to.deep.equal([]);
  });
  it("rejects a policy whose Safe address differs from the requested topology", () => { expect(() => buildVaultPlan({ policy, safeAddress: a(9), guardAddress: a(6), delayAddress: a(5), safeSingleton: a(30), safeProxyFactory: a(31), guardCodeHash: keccak256("0x6001"), delayCodeHash: keccak256("0x6002") })).to.throw("safe address"); });
});
