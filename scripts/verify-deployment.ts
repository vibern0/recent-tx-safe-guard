import { readFileSync } from "node:fs";
import { buildDeploymentPlan, sha256, type PublicDeploymentConfig } from "./plan-deployment";

export type VerificationReport = Readonly<{ ok: boolean; failures: string[]; reportHash: `0x${string}` }>;

function equal(expected: unknown, actual: unknown): boolean { return JSON.stringify(expected) === JSON.stringify(actual); }
function check(failures: string[], condition: boolean, message: string): void { if (!condition) failures.push(message); }

export function verifyDeployment(config: PublicDeploymentConfig, observed: unknown): VerificationReport {
  const failures: string[] = [];
  let plan: ReturnType<typeof buildDeploymentPlan>;
  try { plan = buildDeploymentPlan(config); } catch (error) { failures.push(`public config: ${error instanceof Error ? error.message : String(error)}`); return { ok: false, failures, reportHash: sha256(failures) }; }
  if (!observed || typeof observed !== "object" || Array.isArray(observed)) {
    failures.push("observed snapshot must be an object");
    return { ok: false, failures, reportHash: sha256(failures) };
  }
  const snapshot = observed as Record<string, any>;
  try {
  check(failures, snapshot.chainId === 11155111, "chain ID mismatch");
  check(failures, snapshot.safe?.address?.toLowerCase() === plan.deployments.safe, "Safe address mismatch");
  check(failures, equal(snapshot.safe?.owners, [plan.deployments.passkey, plan.deployments.burner, plan.deployments.recovery]), "owners mismatch");
  check(failures, snapshot.safe?.threshold === 1, "threshold mismatch");
  check(failures, snapshot.safe?.fallbackHandler?.toLowerCase() === "0x0000000000000000000000000000000000000000", "fallback handler mismatch");
  check(failures, snapshot.safe?.transactionGuard?.toLowerCase() === plan.deployments.guard, "transaction guard mismatch");
  check(failures, snapshot.safe?.moduleGuard?.toLowerCase() === plan.deployments.guard, "module guard mismatch");
  check(failures, equal(snapshot.safe?.enabledModules, [plan.deployments.delay]), "Safe module mismatch");
  check(failures, snapshot.guard?.address?.toLowerCase() === plan.deployments.guard, "guard address mismatch");
  check(failures, snapshot.guard?.runtimeCodeHash?.toLowerCase() === plan.dependencies.guardRuntimeCodeHash, "guard bytecode hash mismatch");
  check(failures, snapshot.dependencies?.safeSingletonRuntimeCodeHash?.toLowerCase() === plan.dependencies.safeSingleton.runtimeCodeHash, "Safe singleton bytecode hash mismatch");
  check(failures, snapshot.dependencies?.delayRuntimeCodeHash?.toLowerCase() === plan.dependencies.delay.runtimeCodeHash, "Delay bytecode hash mismatch");
  const guardConfig = snapshot.guard?.config ?? {};
  for (const [key, expected] of Object.entries({ safe: plan.deployments.safe, passkey: plan.deployments.passkey, burner: plan.deployments.burner, recovery: plan.deployments.recovery, delay: plan.deployments.delay, periodSeconds: (config.policy as any).periodSeconds, periodAnchor: (config.policy as any).periodAnchor })) check(failures, String(guardConfig[key]).toLowerCase() === String(expected).toLowerCase(), `guard ${key} mismatch`);
  check(failures, snapshot.delay?.address?.toLowerCase() === plan.deployments.delay, "Delay address mismatch");
  for (const key of ["owner", "avatar", "target"]) check(failures, snapshot.delay?.[key]?.toLowerCase() === plan.deployments.safe, `Delay ${key} mismatch`);
  check(failures, equal(snapshot.delay?.enabledUpstreamModules, [plan.deployments.safe]), "Delay upstream module mismatch");
  check(failures, String(snapshot.delay?.cooldownSeconds) === String((config.policy as any).cooldownSeconds), "cooldown mismatch");
  check(failures, String(snapshot.delay?.expirationSeconds) === String((config.policy as any).expirationSeconds), "expiration mismatch");
  check(failures, Array.isArray(snapshot.queueFingerprints) && equal(snapshot.queueFingerprints, plan.queueFingerprints), "queue fingerprint mismatch");
  check(failures, Array.isArray(snapshot.setupTransactionHashes) && equal(snapshot.setupTransactionHashes, plan.setupTransactionHashes), "setup transaction hash mismatch");
  if (config.policyHash !== undefined) check(failures, config.policyHash === plan.policyHash, "policy hash mismatch");
  check(failures, snapshot.notifications?.stepUp === true, "step-up notification mismatch");
  check(failures, snapshot.notifications?.delayedLifecycle === true, "delayed notification mismatch");
  check(failures, snapshot.guard?.counters !== undefined, "X/Y counters missing");
  if (config.expectedCounters !== undefined) check(failures, equal(snapshot.guard?.counters, config.expectedCounters), "X/Y counter mismatch");
  check(failures, equal(snapshot.guard?.assets?.map((asset: any) => ({ token: asset.token, basePerTransaction: String(asset.basePerTransaction), stepUpPerTransaction: String(asset.stepUpPerTransaction), baseDailyLimit: String(asset.baseDailyLimit), instantDailyLimit: String(asset.instantDailyLimit) })), (config.policy as any).assets?.map((asset: any) => ({ token: asset.token, basePerTransaction: String(asset.basePerTransaction), stepUpPerTransaction: String(asset.stepUpPerTransaction), baseDailyLimit: String(asset.baseDailyLimit), instantDailyLimit: String(asset.instantDailyLimit) }))), "X/Y policy mismatch");
  } catch (error) {
    failures.push(`observed snapshot malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = { ok: failures.length === 0, failures };
  return { ...report, reportHash: sha256(report) };
}

function main(): void {
  const manifestPath = process.argv[2] ?? "deployments/sepolia.example.json";
  const snapshotPath = process.argv[3];
  if (!snapshotPath) throw new Error("verification is read-only: provide a public observed snapshot path");
  const report = verifyDeployment(JSON.parse(readFileSync(manifestPath, "utf8")), JSON.parse(readFileSync(snapshotPath, "utf8")));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();
