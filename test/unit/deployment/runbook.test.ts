import { expect } from "chai";
import { buildDeploymentPlan } from "../../../scripts/plan-deployment";
import { verifyDeployment } from "../../../scripts/verify-deployment";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const config = {
  network: "sepolia",
  chainId: 11155111,
  safe: address(1),
  guard: address(2),
  delay: address(3),
  passkey: address(4),
  burner: address(5),
  recovery: address(6),
  safeSingleton: { address: address(7), runtimeCodeHash: hash(7) },
  delayDependency: { address: address(3), runtimeCodeHash: hash(3) },
  guardRuntimeCodeHash: hash(2),
  policy: {
    periodSeconds: 86400,
    periodAnchor: "0",
    cooldownSeconds: 86400,
    expirationSeconds: 172800,
    assets: [{ token: address(8), basePerTransaction: "10", stepUpPerTransaction: "100", baseDailyLimit: "100", instantDailyLimit: "1000", recipients: [address(9)] }],
  },
  setupCalls: [{ to: address(1), value: "0", data: "0x", description: "atomic setup placeholder" }],
} as const;

const observed = {
  chainId: 11155111,
  dependencies: { safeSingletonRuntimeCodeHash: hash(7), delayRuntimeCodeHash: hash(3) },
  safe: { address: address(1), owners: [address(4), address(5), address(6)], threshold: 1, fallbackHandler: address(0), transactionGuard: address(2), moduleGuard: address(2), enabledModules: [address(3)] },
  guard: { address: address(2), runtimeCodeHash: hash(2), config: { safe: address(1), passkey: address(4), burner: address(5), recovery: address(6), delay: address(3), periodSeconds: 86400, periodAnchor: "0" }, assets: [{ token: address(8), basePerTransaction: "10", stepUpPerTransaction: "100", baseDailyLimit: "100", instantDailyLimit: "1000" }], counters: [{ token: address(8), window: "0", baseSpent: "0", instantSpent: "0" }] },
  delay: { address: address(3), runtimeCodeHash: hash(3), owner: address(1), avatar: address(1), target: address(1), enabledUpstreamModules: [address(1)], cooldownSeconds: 86400, expirationSeconds: 172800 },
  queueFingerprints: [],
  setupTransactionHashes: [],
  notifications: { stepUp: true, delayedLifecycle: true },
};

describe("Sepolia deployment runbook scripts", () => {
  it("builds byte-stable unsigned plans without signatures or broadcast instructions", () => {
    const first = buildDeploymentPlan(config);
    const second = buildDeploymentPlan({ ...config });
    expect(JSON.stringify(first)).to.equal(JSON.stringify(second));
    expect(first.unsigned).to.equal(true);
    expect(first.broadcast).to.equal(false);
    expect(first.setupCalls.every((call) => !("signature" in call))).to.equal(true);
  });

  it("fails closed when any topology, policy, queue, or notification invariant differs", () => {
    const report = verifyDeployment(config, { ...observed, safe: { ...observed.safe, moduleGuard: address(99) } });
    expect(report.ok).to.equal(false);
    expect(report.failures.join(" ")).to.contain("module guard");
  });

  it("accepts an exact public observed snapshot", () => {
    const report = verifyDeployment(config, observed);
    expect(report.ok).to.equal(true);
    expect(report.failures).to.deep.equal([]);
  });
});
