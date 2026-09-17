import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export type PublicDeploymentConfig = Readonly<Record<string, unknown>>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const SECRET_KEY = /(private|secret|seed|mnemonic|password|pin|credential|rpcurl|rpc_url|apikey|api_key)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: unknown): `0x${string}` {
  return `0x${createHash("sha256").update(canonical(value)).digest("hex")}` as `0x${string}`;
}

function assertPublic(value: unknown, path = "config"): asserts value is PublicDeploymentConfig {
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      if (child && typeof child === "object") assertPublic(child, `${path}[${index}]`);
    });
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) throw new Error(`${path}.${key} is secret material; remove it`);
    if (child && typeof child === "object") assertPublic(child, `${path}.${key}`);
  }
}

function address(value: unknown, path: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${path} must be a 20-byte hex address`);
  return value.toLowerCase();
}

function hash(value: unknown, path: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error(`${path} must be a 32-byte hex hash`);
  return value.toLowerCase();
}

function unsignedInteger(value: unknown, path: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  throw new Error(`${path} must be a non-negative decimal integer`);
}

function evidenceHashes(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an explicit array of hashes`);
  return value.map((entry, index) => hash(entry, `${path}[${index}]`));
}

function validatePolicy(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing policy");
  const policy = value as Record<string, unknown>;
  if (policy.periodSeconds !== 86400) throw new Error("policy.periodSeconds must be 86400");
  unsignedInteger(policy.periodAnchor, "policy.periodAnchor");
  unsignedInteger(policy.cooldownSeconds, "policy.cooldownSeconds");
  unsignedInteger(policy.expirationSeconds, "policy.expirationSeconds");
  if (unsignedInteger(policy.expirationSeconds, "policy.expirationSeconds") < unsignedInteger(policy.cooldownSeconds, "policy.cooldownSeconds")) throw new Error("policy.expirationSeconds must be at least cooldownSeconds");
  if (!Array.isArray(policy.assets) || policy.assets.length === 0) throw new Error("policy.assets must be a non-empty array");
  for (const [index, rawAsset] of policy.assets.entries()) {
    const path = `policy.assets[${index}]`;
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) throw new Error(`${path} must be an object`);
    const asset = rawAsset as Record<string, unknown>;
    address(asset.token, `${path}.token`);
    const basePerTransaction = unsignedInteger(asset.basePerTransaction, `${path}.basePerTransaction`);
    const stepUpPerTransaction = unsignedInteger(asset.stepUpPerTransaction, `${path}.stepUpPerTransaction`);
    const baseDailyLimit = unsignedInteger(asset.baseDailyLimit, `${path}.baseDailyLimit`);
    const instantDailyLimit = unsignedInteger(asset.instantDailyLimit, `${path}.instantDailyLimit`);
    if (baseDailyLimit === 0n || baseDailyLimit >= instantDailyLimit) throw new Error(`${path}: 0 < baseDailyLimit < instantDailyLimit is required`);
    if (basePerTransaction === 0n || basePerTransaction > baseDailyLimit) throw new Error(`${path}.basePerTransaction must be positive and no greater than baseDailyLimit`);
    if (stepUpPerTransaction === 0n || stepUpPerTransaction > instantDailyLimit) throw new Error(`${path}.stepUpPerTransaction must be positive and no greater than instantDailyLimit`);
    if (!Array.isArray(asset.recipients) || asset.recipients.length === 0) throw new Error(`${path}.recipients must be a non-empty array`);
    asset.recipients.forEach((recipient, recipientIndex) => address(recipient, `${path}.recipients[${recipientIndex}]`));
  }
}

export function buildDeploymentPlan(config: PublicDeploymentConfig) {
  assertPublic(config);
  if (config.network !== "sepolia" || config.chainId !== 11155111) throw new Error("planner is Sepolia-only");
  if (!Array.isArray(config.setupTransactionHashes) || !Array.isArray(config.expectedQueueFingerprints)) throw new Error("evidence arrays must be explicit");
  const setupTransactionHashes = evidenceHashes(config.setupTransactionHashes, "setupTransactionHashes");
  const queueFingerprints = evidenceHashes(config.expectedQueueFingerprints, "expectedQueueFingerprints");
  const deployments = {
    safe: address(config.safe, "safe"),
    guard: address(config.guard, "guard"),
    delay: address(config.delay, "delay"),
    passkey: address(config.passkey, "passkey"),
    burner: address(config.burner, "burner"),
    recovery: address(config.recovery, "recovery"),
  };
  const singleton = config.safeSingleton as Record<string, unknown>;
  const delayDependency = config.delayDependency as Record<string, unknown>;
  if (!singleton || !delayDependency) throw new Error("missing dependency records");
  const setupCalls = config.setupCalls;
  if (!Array.isArray(setupCalls)) throw new Error("setupCalls must be an array");
  const calls = setupCalls.map((call, index) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) throw new Error(`setupCalls[${index}] must be an object`);
    const item = call as Record<string, unknown>;
    if ("signature" in item || "privateKey" in item) throw new Error(`setupCalls[${index}] must be unsigned`);
    return { description: String(item.description ?? ""), to: address(item.to, `setupCalls[${index}].to`), value: String(item.value ?? "0"), data: String(item.data ?? "0x").toLowerCase() };
  });
  const policy = config.policy;
  validatePolicy(policy);
  return {
    formatVersion: 1,
    network: "sepolia",
    chainId: 11155111,
    unsigned: true,
    broadcast: false,
    deployments,
    dependencies: {
      safeSingleton: { address: address(singleton.address, "safeSingleton.address"), runtimeCodeHash: hash(singleton.runtimeCodeHash, "safeSingleton.runtimeCodeHash") },
      delay: { address: address(delayDependency.address, "delayDependency.address"), runtimeCodeHash: hash(delayDependency.runtimeCodeHash, "delayDependency.runtimeCodeHash") },
      guardRuntimeCodeHash: hash(config.guardRuntimeCodeHash, "guardRuntimeCodeHash"),
    },
    policyHash: sha256(policy),
    setupTransactionHashes,
    queueFingerprints,
    setupCalls: calls,
  };
}

function main(): void {
  const input = process.argv[2] ?? "config/sepolia.example.json";
  const output = process.argv[3];
  const plan = buildDeploymentPlan(JSON.parse(readFileSync(input, "utf8")) as PublicDeploymentConfig);
  const rendered = `${JSON.stringify(plan, null, 2)}\n`;
  if (output) writeFileSync(output, rendered, "utf8");
  else process.stdout.write(rendered);
}

if (require.main === module) main();
