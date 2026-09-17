import { expect } from "chai";
import { keccak256, type Address, type Hex } from "viem";
import { verifyTopology, type TopologyInput } from "../../../src/topology/verify";
import { policyHash } from "../../../src/topology/build";
import { type VaultPolicy } from "../../../src/config/policy";

const a = (n: number) => (`0x${n.toString(16).padStart(40, "0")}`) as Address;
const policy: VaultPolicy = { chainId: 31337, safe: a(1), passkey: a(2), burner: a(3), recovery: a(4), delay: a(5), periodSeconds: 86400, periodAnchor: 0n, cooldownSeconds: 3600, expirationSeconds: 86400, assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20)] }] };
const code = "0x6001" as Hex; const hash = keccak256(code); const zero = a(0);
const values: Record<string, unknown> = { masterCopy: a(30), VERSION: "1.5.0", getOwners: [a(2), a(3), a(4)], getThreshold: 1n, getFallbackHandler: zero, getGuard: a(6), getModuleGuard: a(6), getModules: [a(5)], isModuleEnabled: true, config: [a(1), a(2), a(3), a(4), a(5), 86400n, 0n], getConfiguredTokens: [a(10)], assetPolicy: [10n, 100n, 100n, 1000n], getPolicyRecipients: [a(20)], policyHash: policyHash(policy), spendState: [0n, 0n, 0n], txCooldown: 3600n, txExpiration: 86400n, owner: a(1), avatar: a(1), target: a(1) };
function fixture(overrides: Record<string, unknown> = {}): TopologyInput { const data = { ...values, ...overrides }; return { chainId: 31337, policy, safe: a(1), guard: a(6), delay: a(5), safeSingleton: a(30), expectedSafeVersion: "1.5.0", expectedSafeProxyCodeHash: hash, expectedGuardCodeHash: hash, expectedDelayCodeHash: hash, client: { getBytecode: async () => code, readContract: async ({ functionName }: { functionName: string }) => data[functionName] } }; }

describe("verifyTopology", () => {
  it("returns verified only when every Safe, guard, asset, and Delay invariant is readable and exact", async () => { const report = await verifyTopology(fixture()); expect(report.ok).to.equal(true); expect(report.failures).to.deep.equal([]); });
  for (const [name, override] of [["singleton", { masterCopy: a(9) }], ["version", { VERSION: "1.3.0" }], ["owners", { getOwners: [a(2), a(9), a(4)] }], ["threshold", { getThreshold: 2n }], ["fallback", { getFallbackHandler: a(9) }], ["transaction guard", { getGuard: a(9) }], ["module guard", { getModuleGuard: a(9) }], ["modules", { getModules: [a(5), a(9)] }], ["guard config", { config: [a(9), a(2), a(3), a(4), a(5), 86400n, 0n] }], ["policy hash", { policyHash: keccak256("0x99") }], ["asset", { assetPolicy: [11n, 100n, 100n, 1000n] }], ["recipients", { getPolicyRecipients: [a(21)] }], ["counter", { spendState: [0n, 101n, 0n] }], ["Delay owner", { owner: a(9) }], ["Delay avatar", { avatar: a(9) }], ["Delay target", { target: a(9) }], ["cooldown", { txCooldown: 1n }], ["expiration", { txExpiration: 1n }]] as const) it(`fails closed on mutated ${name}`, async () => { const report = await verifyTopology(fixture(override)); expect(report.ok).to.equal(false); });
  it("fails closed on missing bytecode or unavailable enumeration", async () => { const noCode = fixture(); noCode.client.getBytecode = async () => undefined; expect((await verifyTopology(noCode)).ok).to.equal(false); expect((await verifyTopology(fixture({ getConfiguredTokens: undefined }))).ok).to.equal(false); });
});
