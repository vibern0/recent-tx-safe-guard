import { expect } from "chai";
import { buildDeploymentPlan } from "../../../scripts/plan-deployment";
import { verifyDeployment } from "../../../scripts/verify-deployment";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

const config = {
  formatVersion: 1,
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
  expectedCounters: [{ token: address(8), window: "0", baseSpent: "0", instantSpent: "0" }],
  expectedQueueFingerprints: [hash(10)],
  setupTransactionHashes: [hash(11)],
  setupCalls: [{ to: address(1), value: "0", data: "0x", description: "atomic setup placeholder" }],
} as const;

const observed = {
  chainId: 11155111,
  policyHash: buildDeploymentPlan(config).policyHash,
  dependencies: { safeSingleton: { address: address(7), runtimeCodeHash: hash(7) }, delay: { address: address(3), runtimeCodeHash: hash(3) } },
  safe: { address: address(1), singletonAddress: address(7), owners: [address(4), address(5), address(6)], threshold: 1, fallbackHandler: address(0), transactionGuard: address(2), moduleGuard: address(2), enabledModules: [address(3)] },
  guard: { address: address(2), runtimeCodeHash: hash(2), config: { safe: address(1), passkey: address(4), burner: address(5), recovery: address(6), delay: address(3), periodSeconds: 86400, periodAnchor: "0" }, assets: [{ token: address(8), basePerTransaction: "10", stepUpPerTransaction: "100", baseDailyLimit: "100", instantDailyLimit: "1000", recipients: [address(9)] }], counters: [{ token: address(8), window: "0", baseSpent: "0", instantSpent: "0" }] },
  delay: { address: address(3), dependencyAddress: address(3), runtimeCodeHash: hash(3), owner: address(1), avatar: address(1), target: address(1), enabledUpstreamModules: [address(1)], cooldownSeconds: 86400, expirationSeconds: 172800 },
  queueFingerprints: [hash(10)],
  setupTransactionHashes: [hash(11)],
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
    const report = verifyDeployment({ ...config, policyHash: undefined }, { ...observed, policyHash: buildDeploymentPlan(config).policyHash });
    expect(report.ok).to.equal(true);
    expect(report.failures).to.deep.equal([]);
  });

  it("rejects an observed policy hash that does not match the recomputed policy", () => {
    const report = verifyDeployment(config, { ...observed, policyHash: hash(99) });
    expect(report.failures.join(" ")).to.contain("policy hash");
  });

  it("rejects recipient allowlist drift and dependency address drift", () => {
    expect(verifyDeployment({ ...config, policyHash: undefined }, { ...observed, policyHash: buildDeploymentPlan(config).policyHash, guard: { ...observed.guard, assets: [{ ...observed.guard.assets[0], recipients: [address(10)] }] } }).failures.join(" ")).to.contain("recipients");
    expect(verifyDeployment({ ...config, policyHash: undefined }, { ...observed, policyHash: buildDeploymentPlan(config).policyHash, safe: { ...observed.safe, singletonAddress: address(99) } }).failures.join(" ")).to.contain("singleton");
    expect(verifyDeployment({ ...config, policyHash: undefined }, { ...observed, policyHash: buildDeploymentPlan(config).policyHash, dependencies: { ...observed.dependencies, delay: { ...observed.dependencies.delay, address: address(99) } } }).failures.join(" ")).to.contain("Delay");
  });

  it("requires unique configured-token counters with bounded canonical decimal values", () => {
    const valid = { ...observed, policyHash: buildDeploymentPlan(config).policyHash };
    expect(verifyDeployment(config, { ...valid, guard: { ...valid.guard, counters: [] } }).failures.join(" ")).to.contain("counter");
    expect(verifyDeployment(config, { ...valid, guard: { ...valid.guard, counters: [{ ...valid.guard.counters[0] }, { ...valid.guard.counters[0] }] } }).failures.join(" ")).to.contain("unique");
    expect(verifyDeployment(config, { ...valid, guard: { ...valid.guard, counters: [{ ...valid.guard.counters[0], baseSpent: "101" }] } }).failures.join(" ")).to.contain("bounded");
    expect(verifyDeployment(config, { ...valid, guard: { ...valid.guard, counters: [{ ...valid.guard.counters[0], baseSpent: "00" }] } }).failures.join(" ")).to.contain("decimal");
  });

  it("rejects missing deployment evidence arrays", () => {
    const incomplete = { ...config } as Record<string, unknown>;
    delete incomplete.expectedQueueFingerprints;
    delete incomplete.setupTransactionHashes;
    expect(() => buildDeploymentPlan(incomplete)).to.throw("evidence arrays");
  });

  it("rejects missing expected counter coverage", () => {
    const incomplete = { ...config } as Record<string, unknown>;
    delete incomplete.expectedCounters;
    expect(() => buildDeploymentPlan(incomplete)).to.throw("expectedCounters");
  });

  it("rejects malformed evidence entries and invalid policy limits", () => {
    expect(() => buildDeploymentPlan({ ...config, setupTransactionHashes: ["0x1234"] })).to.throw("setupTransactionHashes[0]");
    expect(() => buildDeploymentPlan({ ...config, policy: { ...config.policy, assets: [{ ...config.policy.assets[0], baseDailyLimit: "1000", instantDailyLimit: "100" }] } })).to.throw("0 < baseDailyLimit < instantDailyLimit");
    expect(() => buildDeploymentPlan({ ...config, policy: { ...config.policy, periodSeconds: 60 } })).to.throw("periodSeconds must be 86400");
  });

  it("rejects unknown or missing public configuration fields", () => {
    expect(() => buildDeploymentPlan({ ...config, unexpected: true })).to.throw("config.unexpected");
    const incomplete = { ...config } as Record<string, unknown>;
    delete incomplete.safe;
    expect(() => buildDeploymentPlan(incomplete)).to.throw("config.safe");
    expect(() => buildDeploymentPlan({ ...config, policy: { ...config.policy, assets: [{ ...config.policy.assets[0], extra: true }] } })).to.throw("policy.assets[0].extra");
  });

  it("requires setup calls to use explicit decimal values and byte-aligned hex data", () => {
    expect(() => buildDeploymentPlan({ ...config, setupCalls: [{ ...config.setupCalls[0], value: 0 }] })).to.throw("setupCalls[0].value");
    expect(() => buildDeploymentPlan({ ...config, setupCalls: [{ ...config.setupCalls[0], value: "01" }] })).to.throw("setupCalls[0].value");
    expect(() => buildDeploymentPlan({ ...config, setupCalls: [{ ...config.setupCalls[0], data: "0x123" }] })).to.throw("setupCalls[0].data");
    expect(() => buildDeploymentPlan({ ...config, setupCalls: [{ ...config.setupCalls[0], description: undefined }] })).to.throw("setupCalls[0].description");
  });

  it("rejects unknown snapshot fields and incomplete or nullable evidence", () => {
    expect(verifyDeployment(config, { ...observed, extra: true }).failures.join(" ")).to.contain("snapshot.extra");
    expect(verifyDeployment(config, { ...observed, setupTransactionHashes: undefined }).failures.join(" ")).to.contain("setupTransactionHashes");
    expect(verifyDeployment(config, { ...observed, guard: { ...observed.guard, counters: null } }).failures.join(" ")).to.contain("counters");
    expect(verifyDeployment(config, { ...observed, notifications: { stepUp: true } }).failures.join(" ")).to.contain("delayedLifecycle");
  });

  it("returns a hashed failure report for malformed observed snapshots", () => {
    const report = verifyDeployment(config, null as unknown as Record<string, unknown>);
    expect(report.ok).to.equal(false);
    expect(report.failures.join(" ")).to.contain("observed snapshot");
    expect(report.reportHash).to.match(/^0x[0-9a-f]{64}$/);
  });
});
