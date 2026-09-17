import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { resolveVerifiedDeployments } from "../src/config/deployments";

function revive(value: unknown): unknown { if (Array.isArray(value)) return value.map(revive); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)])); if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return BigInt(value); return value; }
const path = process.env.VAULT_PLAN_INPUT; const rpc = process.env.VAULT_RPC_URL;
if (!path || !rpc) throw new Error("fail closed: set VAULT_PLAN_INPUT and VAULT_RPC_URL");
const raw = revive(JSON.parse(readFileSync(path, "utf8"))) as any;
const client = createPublicClient({ transport: http(rpc), chain: { id: raw.policy.chainId, name: "reviewed-target", nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } });
async function main(): Promise<void> {
  const official = await resolveVerifiedDeployments({ getBytecode: ({ address }) => client.getBytecode({ address }) }, raw.policy.chainId);
  throw new Error(`fail closed: official registry has no reviewed guard deployment evidence; resolved ${official.dependencies.safeSingleton.version} Safe evidence is insufficient for setup`);
}
void main();
