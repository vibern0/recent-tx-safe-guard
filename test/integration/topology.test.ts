import { expect } from "chai";
import { keccak256, type Address } from "viem";
import { buildVaultPlan } from "../../src/topology/build";
const a = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
describe("one-Safe topology plan integration", () => {
  it("contains exactly one custody graph and no signing or broadcast material", () => {
    const policy = { chainId: 31337, safe: a(1), passkey: a(2), burner: a(3), recovery: a(4), delay: a(5), periodSeconds: 86400 as const, periodAnchor: 0n, cooldownSeconds: 3600, expirationSeconds: 86400, assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20)] }] };
    const plan = buildVaultPlan({ policy, safeAddress: a(1), guardAddress: a(6), delayAddress: a(5), safeSingleton: a(30), safeProxyFactory: a(31), guardCodeHash: keccak256("0x6001"), delayCodeHash: keccak256("0x6002") });
    expect(plan.deployments).to.have.all.keys("safe", "guard", "delay", "safeSingleton", "safeProxyFactory");
    expect(plan.extraAccounts).to.deep.equal([]); expect(plan.setup.every((call) => call.value === 0n && call.operation === 0)).to.equal(true);
  });
});
