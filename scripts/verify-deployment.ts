import { readFileSync } from "node:fs";
import { buildDeploymentPlan, sha256, type PublicDeploymentConfig } from "./plan-deployment";

export type VerificationReport = Readonly<{ ok: boolean; failures: string[]; reportHash: `0x${string}` }>;

function equal(expected: unknown, actual: unknown): boolean { return JSON.stringify(expected) === JSON.stringify(actual); }
function check(failures: string[], condition: boolean, message: string): void { if (!condition) failures.push(message); }

export function verifyDeployment(config: PublicDeploymentConfig, observed: Record<string, any>): VerificationReport {
  const failures: string[] = [];
  let plan: ReturnType<typeof buildDeploymentPlan>;
  try { plan = buildDeploymentPlan(config); } catch (error) { failures.push(`public config: ${error instanceof Error ? error.message : String(error)}`); return { ok: false, failures, reportHash: sha256(failures) }; }
  check(failures, observed.chainId === 11155111, "chain ID mismatch");
  check(failures, observed.safe?.address?.toLowerCase() === plan.deployments.safe, "Safe address mismatch");
  check(failures, equal(observed.safe?.owners, [plan.deployments.passkey, plan.deployments.burner, plan.deployments.recovery]), "owners mismatch");
  check(failures, observed.safe?.threshold === 1, "threshold mismatch");
  check(failures, observed.safe?.fallbackHandler?.toLowerCase() === "0x0000000000000000000000000000000000000000", "fallback handler mismatch");
  check(failures, observed.safe?.transactionGuard?.toLowerCase() === plan.deployments.guard, "transaction guard mismatch");
  check(failures, observed.safe?.moduleGuard?.toLowerCase() === plan.deployments.guard, "module guard mismatch");
  check(failures, equal(observed.safe?.enabledModules, [plan.deployments.delay]), "Safe module mismatch");
  check(failures, observed.guard?.address?.toLowerCase() === plan.deployments.guard, "guard address mismatch");
  check(failures, observed.guard?.runtimeCodeHash?.toLowerCase() === plan.dependencies.guardRuntimeCodeHash, "guard bytecode hash mismatch");
  check(failures, observed.dependencies?.safeSingletonRuntimeCodeHash?.toLowerCase() === plan.dependencies.safeSingleton.runtimeCodeHash, "Safe singleton bytecode hash mismatch");
  check(failures, observed.dependencies?.delayRuntimeCodeHash?.toLowerCase() === plan.dependencies.delay.runtimeCodeHash, "Delay bytecode hash mismatch");
  const guardConfig = observed.guard?.config ?? {};
  for (const [key, expected] of Object.entries({ safe: plan.deployments.safe, passkey: plan.deployments.passkey, burner: plan.deployments.burner, recovery: plan.deployments.recovery, delay: plan.deployments.delay, periodSeconds: (config.policy as any).periodSeconds, periodAnchor: (config.policy as any).periodAnchor })) check(failures, String(guardConfig[key]).toLowerCase() === String(expected).toLowerCase(), `guard ${key} mismatch`);
  check(failures, observed.delay?.address?.toLowerCase() === plan.deployments.delay, "Delay address mismatch");
  for (const key of ["owner", "avatar", "target"]) check(failures, observed.delay?.[key]?.toLowerCase() === plan.deployments.safe, `Delay ${key} mismatch`);
  check(failures, equal(observed.delay?.enabledUpstreamModules, [plan.deployments.safe]), "Delay upstream module mismatch");
  check(failures, String(observed.delay?.cooldownSeconds) === String((config.policy as any).cooldownSeconds), "cooldown mismatch");
  check(failures, String(observed.delay?.expirationSeconds) === String((config.policy as any).expirationSeconds), "expiration mismatch");
  check(failures, equal(observed.queueFingerprints ?? [], config.expectedQueueFingerprints ?? []), "queue fingerprint mismatch");
  check(failures, equal(observed.setupTransactionHashes ?? [], config.setupTransactionHashes ?? []), "setup transaction hash mismatch");
  if (config.policyHash !== undefined) check(failures, config.policyHash === plan.policyHash, "policy hash mismatch");
  check(failures, observed.notifications?.stepUp === true, "step-up notification mismatch");
  check(failures, observed.notifications?.delayedLifecycle === true, "delayed notification mismatch");
  check(failures, observed.guard?.counters !== undefined, "X/Y counters missing");
  if (config.expectedCounters !== undefined) check(failures, equal(observed.guard?.counters, config.expectedCounters), "X/Y counter mismatch");
  check(failures, equal(observed.guard?.assets?.map((asset: any) => ({ token: asset.token, basePerTransaction: String(asset.basePerTransaction), stepUpPerTransaction: String(asset.stepUpPerTransaction), baseDailyLimit: String(asset.baseDailyLimit), instantDailyLimit: String(asset.instantDailyLimit) })), (config.policy as any).assets?.map((asset: any) => ({ token: asset.token, basePerTransaction: String(asset.basePerTransaction), stepUpPerTransaction: String(asset.stepUpPerTransaction), baseDailyLimit: String(asset.baseDailyLimit), instantDailyLimit: String(asset.instantDailyLimit) }))), "X/Y policy mismatch");
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
