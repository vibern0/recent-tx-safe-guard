import { readFileSync } from "node:fs";
import { buildVaultPlan } from "../src/topology/build";
function revive(value: unknown): unknown { if (Array.isArray(value)) return value.map(revive); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)])); if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return BigInt(value); return value; }
const path = process.env.VAULT_PLAN_INPUT;
if (!path) throw new Error("fail closed: set VAULT_PLAN_INPUT to a reviewed JSON input; no addresses are invented");
const plan = buildVaultPlan(revive(JSON.parse(readFileSync(path, "utf8"))) as Parameters<typeof buildVaultPlan>[0]);
process.stdout.write(JSON.stringify(plan, (_, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
