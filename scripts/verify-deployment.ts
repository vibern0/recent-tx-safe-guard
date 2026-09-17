import { readFileSync } from "node:fs";
import { buildDeploymentPlan, sha256, type PublicDeploymentConfig } from "./plan-deployment";

export type VerificationReport = Readonly<{ ok: boolean; failures: string[]; reportHash: `0x${string}` }>;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const object = (v: unknown, p: string): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${p} must be an object`); return v as Record<string, unknown>; };
const exact = (v: Record<string, unknown>, keys: readonly string[], p: string): void => { const allowed = new Set(keys); for (const k of Object.keys(v)) if (!allowed.has(k)) throw new Error(`${p}.${k} is unknown`); for (const k of keys) if (!(k in v)) throw new Error(`${p}.${k} is required`); };
const str = (v: unknown, p: string): string => { if (typeof v !== "string") throw new Error(`${p} must be a string`); return v; };
const addr = (v: unknown, p: string): string => { const s = str(v, p); if (!ADDRESS.test(s)) throw new Error(`${p} must be a 20-byte hex address`); return s.toLowerCase(); };
const hsh = (v: unknown, p: string): string => { const s = str(v, p); if (!HASH.test(s)) throw new Error(`${p} must be a 32-byte hex hash`); return s.toLowerCase(); };
const dec = (v: unknown, p: string): string => { const s = str(v, p); if (!DECIMAL.test(s)) throw new Error(`${p} must be a decimal string`); return s; };
const numberLike = (v: unknown, expected: number, p: string): void => { if (v !== expected && v !== String(expected)) throw new Error(`${p} mismatch`); };
const hashes = (v: unknown, p: string): string[] => { if (!Array.isArray(v)) throw new Error(`${p} must be an array`); return v.map((x, i) => hsh(x, `${p}[${i}]`)); };

function validateSnapshot(value: unknown, plan: ReturnType<typeof buildDeploymentPlan>, config: PublicDeploymentConfig): void {
  const s = object(value, "observed snapshot");
  exact(s, ["chainId", "dependencies", "safe", "guard", "delay", "queueFingerprints", "setupTransactionHashes", "notifications"], "snapshot");
  if (s.chainId !== 11155111) throw new Error("chain ID mismatch");
  const d = object(s.dependencies, "snapshot.dependencies"); exact(d, ["safeSingletonRuntimeCodeHash", "delayRuntimeCodeHash"], "snapshot.dependencies");
  if (hsh(d.safeSingletonRuntimeCodeHash, "snapshot.dependencies.safeSingletonRuntimeCodeHash") !== plan.dependencies.safeSingleton.runtimeCodeHash) throw new Error("Safe singleton bytecode hash mismatch");
  if (hsh(d.delayRuntimeCodeHash, "snapshot.dependencies.delayRuntimeCodeHash") !== plan.dependencies.delay.runtimeCodeHash) throw new Error("Delay bytecode hash mismatch");
  const safe = object(s.safe, "snapshot.safe"); exact(safe, ["address", "owners", "threshold", "fallbackHandler", "transactionGuard", "moduleGuard", "enabledModules"], "snapshot.safe");
  if (addr(safe.address, "snapshot.safe.address") !== plan.deployments.safe) throw new Error("Safe address mismatch");
  if (!Array.isArray(safe.owners) || !equal(safe.owners.map((x, i) => addr(x, `snapshot.safe.owners[${i}]`)), [plan.deployments.passkey, plan.deployments.burner, plan.deployments.recovery])) throw new Error("owners mismatch");
  if (safe.threshold !== 1) throw new Error("threshold mismatch");
  if (addr(safe.fallbackHandler, "snapshot.safe.fallbackHandler") !== zeroAddress()) throw new Error("fallback handler mismatch");
  if (addr(safe.transactionGuard, "snapshot.safe.transactionGuard") !== plan.deployments.guard) throw new Error("transaction guard mismatch");
  if (addr(safe.moduleGuard, "snapshot.safe.moduleGuard") !== plan.deployments.guard) throw new Error("module guard mismatch");
  if (!Array.isArray(safe.enabledModules) || !equal(safe.enabledModules.map((x, i) => addr(x, `snapshot.safe.enabledModules[${i}]`)), [plan.deployments.delay])) throw new Error("Safe module mismatch");
  const g = object(s.guard, "snapshot.guard"); exact(g, ["address", "runtimeCodeHash", "config", "assets", "counters"], "snapshot.guard");
  if (addr(g.address, "snapshot.guard.address") !== plan.deployments.guard) throw new Error("guard address mismatch");
  if (hsh(g.runtimeCodeHash, "snapshot.guard.runtimeCodeHash") !== plan.dependencies.guardRuntimeCodeHash) throw new Error("guard bytecode hash mismatch");
  const gc = object(g.config, "snapshot.guard.config"); exact(gc, ["safe", "passkey", "burner", "recovery", "delay", "periodSeconds", "periodAnchor"], "snapshot.guard.config");
  for (const k of ["safe", "passkey", "burner", "recovery", "delay"]) if (addr(gc[k], `snapshot.guard.config.${k}`) !== plan.deployments[k as keyof typeof plan.deployments]) throw new Error(`guard ${k} mismatch`);
  const policy = object(config.policy, "config.policy");
  numberLike(gc.periodSeconds, Number(policy.periodSeconds), "guard periodSeconds"); if (dec(gc.periodAnchor, "snapshot.guard.config.periodAnchor") !== String(policy.periodAnchor)) throw new Error("guard periodAnchor mismatch");
  const assets = objectArray(g.assets, "snapshot.guard.assets"); for (const [i, a] of assets.entries()) { exact(a, ["token", "basePerTransaction", "stepUpPerTransaction", "baseDailyLimit", "instantDailyLimit"], `snapshot.guard.assets[${i}]`); addr(a.token, `snapshot.guard.assets[${i}].token`); for (const k of ["basePerTransaction", "stepUpPerTransaction", "baseDailyLimit", "instantDailyLimit"]) dec(a[k], `snapshot.guard.assets[${i}].${k}`); }
  const expectedAssets = (policy.assets as unknown[]).map((raw, i) => { const a = object(raw, `config.policy.assets[${i}]`); return { token: addr(a.token, `config.policy.assets[${i}].token`), basePerTransaction: String(a.basePerTransaction), stepUpPerTransaction: String(a.stepUpPerTransaction), baseDailyLimit: String(a.baseDailyLimit), instantDailyLimit: String(a.instantDailyLimit) }; });
  const observedAssets = assets.map((a) => ({ token: addr(a.token, "snapshot.guard.assets.token"), basePerTransaction: dec(a.basePerTransaction, "snapshot.guard.assets.basePerTransaction"), stepUpPerTransaction: dec(a.stepUpPerTransaction, "snapshot.guard.assets.stepUpPerTransaction"), baseDailyLimit: dec(a.baseDailyLimit, "snapshot.guard.assets.baseDailyLimit"), instantDailyLimit: dec(a.instantDailyLimit, "snapshot.guard.assets.instantDailyLimit") }));
  if (!equal(observedAssets, expectedAssets)) throw new Error("X/Y policy mismatch");
  const counters = objectArray(g.counters, "snapshot.guard.counters"); for (const [i, c] of counters.entries()) { exact(c, ["token", "window", "baseSpent", "instantSpent"], `snapshot.guard.counters[${i}]`); addr(c.token, `snapshot.guard.counters[${i}].token`); for (const k of ["window", "baseSpent", "instantSpent"]) dec(c[k], `snapshot.guard.counters[${i}].${k}`); }
  const delay = object(s.delay, "snapshot.delay"); exact(delay, ["address", "runtimeCodeHash", "owner", "avatar", "target", "enabledUpstreamModules", "cooldownSeconds", "expirationSeconds"], "snapshot.delay");
  if (addr(delay.address, "snapshot.delay.address") !== plan.deployments.delay || hsh(delay.runtimeCodeHash, "snapshot.delay.runtimeCodeHash") !== plan.dependencies.delay.runtimeCodeHash) throw new Error("Delay dependency mismatch");
  for (const k of ["owner", "avatar", "target"]) if (addr(delay[k], `snapshot.delay.${k}`) !== plan.deployments.safe) throw new Error(`Delay ${k} mismatch`);
  if (!Array.isArray(delay.enabledUpstreamModules) || !equal(delay.enabledUpstreamModules.map((x, i) => addr(x, `snapshot.delay.enabledUpstreamModules[${i}]`)), [plan.deployments.safe])) throw new Error("Delay upstream module mismatch");
  numberLike(delay.cooldownSeconds, Number(policy.cooldownSeconds), "cooldown"); numberLike(delay.expirationSeconds, Number(policy.expirationSeconds), "expiration");
  if (!equal(hashes(s.queueFingerprints, "snapshot.queueFingerprints"), plan.queueFingerprints) || !equal(hashes(s.setupTransactionHashes, "snapshot.setupTransactionHashes"), plan.setupTransactionHashes)) throw new Error("deployment evidence mismatch");
  const n = object(s.notifications, "snapshot.notifications"); exact(n, ["stepUp", "delayedLifecycle"], "snapshot.notifications"); if (n.stepUp !== true || n.delayedLifecycle !== true) throw new Error("notification mismatch");
  if (config.expectedCounters !== undefined && !equal(g.counters, config.expectedCounters)) throw new Error("X/Y counter mismatch");
}
function objectArray(v: unknown, p: string): Record<string, unknown>[] { if (!Array.isArray(v)) throw new Error(`${p} must be an array`); return v.map((x, i) => object(x, `${p}[${i}]`)); }
function zeroAddress(): string { return `0x${"0".repeat(40)}`; }
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export function verifyDeployment(config: PublicDeploymentConfig, observed: unknown): VerificationReport { const failures: string[] = []; try { validateSnapshot(observed, buildDeploymentPlan(config), config); } catch (e) { failures.push(e instanceof Error ? e.message : String(e)); } const report = { ok: failures.length === 0, failures }; return { ...report, reportHash: sha256(report) }; }
function main(): void { const manifest = process.argv[2] ?? "deployments/sepolia.example.json"; const snapshot = process.argv[3]; if (!snapshot) throw new Error("verification is read-only: provide a public observed snapshot path"); const report = verifyDeployment(JSON.parse(readFileSync(manifest, "utf8")), JSON.parse(readFileSync(snapshot, "utf8"))); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ok) process.exitCode = 1; }
if (require.main === module) main();
