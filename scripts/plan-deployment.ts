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

export function buildDeploymentPlan(config: PublicDeploymentConfig) {
  assertPublic(config);
  if (config.network !== "sepolia" || config.chainId !== 11155111) throw new Error("planner is Sepolia-only");
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
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("missing policy");
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
