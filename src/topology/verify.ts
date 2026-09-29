import { keccak256, parseAbi, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";
import { policyHash } from "./build";
import { isOfficialVerifiedDeployments, type VerifiedDeployments } from "../config/deployments";

export type TopologyReadClient = {
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  getStorageAt(args: { address: Address; slot: Hex }): Promise<Hex | undefined>;
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
};
export type TopologyInput = Readonly<{ chainId: number; policy: VaultPolicy; safe: Address; guard: Address; delay: Address; expectedSafeProxyCodeHash: Hex; deployments: VerifiedDeployments; client: TopologyReadClient }>;
export type TopologyReport = Readonly<{ ok: boolean; failures: readonly string[]; checked: readonly string[] }>;

const ABI = parseAbi([
  "function masterCopy() view returns (address)", "function VERSION() view returns (string)", "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function getModulesPaginated(address,uint256) view returns (address[],address)", "function isModuleEnabled(address) view returns (bool)",
  "function config() view returns (address,address,address,address,uint64,uint64)", "function assetPolicy(address) view returns (uint256,uint256,uint256,uint256)", "function spendState(address) view returns (uint256,uint256,uint256)", "function getPolicyRecipients(address) view returns (address[])", "function getConfiguredTokens() view returns (address[])", "function policyHash() view returns (bytes32)",
  "function owner() view returns (address)", "function avatar() view returns (address)", "function target() view returns (address)", "function txCooldown() view returns (uint256)", "function txExpiration() view returns (uint256)",
]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SENTINEL_MODULES = "0x0000000000000000000000000000000000000001" as Address;
const FALLBACK_HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5" as Hex;
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as Hex;
const MODULE_GUARD_SLOT = "0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947" as Hex;
const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
const tuple = (value: unknown): readonly unknown[] | undefined => Array.isArray(value) ? value : undefined;
const storageAddress = (word: Hex | undefined): Address | undefined => word ? `0x${word.slice(-40)}` as Address : undefined;

export async function verifyTopology(input: TopologyInput): Promise<TopologyReport> {
  const failures: string[] = []; const checked: string[] = [];
  if (!isOfficialVerifiedDeployments(input.deployments)) {
    return { ok: false, failures: ["deployments: official resolver evidence required"], checked };
  }
  const check = (name: string, condition: boolean) => { checked.push(name); if (!condition) failures.push(name); };
  try { assertValidVaultPolicy(input.policy); } catch (error) { failures.push("policy: " + (error instanceof Error ? error.message : "invalid")); return { ok: false, failures, checked }; }
  check("chain id", input.chainId === input.policy.chainId && input.deployments.chainId === input.chainId); check("safe address", same(input.safe, input.policy.safe)); check("Delay address", same(input.delay, input.policy.delay) && same(input.delay, input.deployments.dependencies.delay.address)); check("guard address", same(input.guard, input.deployments.dependencies.guard.address));
  const code = async (label: string, address: Address, expected: Hex) => { try { const actual = await input.client.getBytecode({ address }); check(label + " bytecode", !!actual && actual !== "0x"); check(label + " code hash", !!actual && keccak256(actual).toLowerCase() === expected.toLowerCase()); } catch { check(label + " bytecode", false); check(label + " code hash", false); } };
  await code("Safe proxy", input.safe, input.expectedSafeProxyCodeHash); await code("guard", input.guard, input.deployments.dependencies.guard.runtimeCodeHash); await code("Delay", input.delay, input.deployments.dependencies.delay.runtimeCodeHash);
  const read = async (label: string, address: Address, functionName: string, args: readonly unknown[] = []): Promise<unknown> => { try { return await input.client.readContract({ address, abi: ABI, functionName, args }); } catch { failures.push(label + " read"); return undefined; } };
  const storage = async (label: string, slot: Hex): Promise<Address | undefined> => { try { return storageAddress(await input.client.getStorageAt({ address: input.safe, slot })); } catch { failures.push(label + " read"); return undefined; } };
  const masterCopy = await read("Safe singleton", input.safe, "masterCopy"); check("Safe proxy singleton", same(masterCopy, input.deployments.dependencies.safeSingleton.address)); check("Safe version", (await read("Safe version", input.safe, "VERSION")) === input.deployments.dependencies.safeSingleton.version);
  const owners = tuple(await read("owners", input.safe, "getOwners")); check("owners", !!owners && owners.length === 2 && owners.every((x, i) => same(x, [input.policy.passkey, input.policy.burner][i])));
  check("threshold", (await read("threshold", input.safe, "getThreshold")) === 1n); check("fallback handler", same(await storage("fallback handler", FALLBACK_HANDLER_SLOT), ZERO)); check("transaction guard", same(await storage("transaction guard", GUARD_SLOT), input.guard)); check("module guard", same(await storage("module guard", MODULE_GUARD_SLOT), input.guard));
  const modulesPage = tuple(await read("modules", input.safe, "getModulesPaginated", [SENTINEL_MODULES, 10n])); const modules = tuple(modulesPage?.[0]); check("only Delay module", !!modulesPage && modulesPage.length === 2 && !!modules && modules.length === 1 && same(modules[0], input.delay) && same(modulesPage[1], SENTINEL_MODULES));
  const config = tuple(await read("guard config", input.guard, "config")); check("guard config", !!config && same(config[0], input.safe) && same(config[1], input.policy.passkey) && same(config[2], input.policy.burner) && same(config[3], input.delay) && config[4] === 86400n && config[5] === input.policy.periodAnchor); check("policy hash", (await read("policy hash", input.guard, "policyHash")) === policyHash(input.policy));
  const configuredTokens = tuple(await read("configured assets", input.guard, "getConfiguredTokens")); check("configured assets", !!configuredTokens && configuredTokens.length === input.policy.assets.length && configuredTokens.every((x, i) => same(x, input.policy.assets[i]?.token)));
  for (const asset of input.policy.assets) { const configured = tuple(await read("asset policy " + asset.token, input.guard, "assetPolicy", [asset.token])); check("asset policy " + asset.token, !!configured && configured[0] === asset.basePerTransaction && configured[1] === asset.stepUpPerTransaction && configured[2] === asset.baseDailyLimit && configured[3] === asset.instantDailyLimit); const recipients = tuple(await read("recipients " + asset.token, input.guard, "getPolicyRecipients", [asset.token])); check("recipients " + asset.token, !!recipients && recipients.length === asset.recipients.length && recipients.every((x, i) => same(x, asset.recipients[i]))); const state = tuple(await read("counter " + asset.token, input.guard, "spendState", [asset.token])); check("counter " + asset.token, !!state && state.length === 3 && typeof state[0] === "bigint" && (state[1] as bigint) <= asset.baseDailyLimit && (state[2] as bigint) <= asset.instantDailyLimit); }
  check("Delay owner", same(await read("Delay owner", input.delay, "owner"), input.safe)); check("Delay avatar", same(await read("Delay avatar", input.delay, "avatar"), input.safe)); check("Delay target", same(await read("Delay target", input.delay, "target"), input.safe)); check("Delay cooldown", (await read("Delay cooldown", input.delay, "txCooldown")) === BigInt(input.policy.cooldownSeconds)); check("Delay expiration", (await read("Delay expiration", input.delay, "txExpiration")) === BigInt(input.policy.expirationSeconds)); const upstreamPage = tuple(await read("Delay upstream module enumeration", input.delay, "getModulesPaginated", [SENTINEL_MODULES, 10n])); const upstream = tuple(upstreamPage?.[0]); check("only Safe upstream module", !!upstreamPage && upstreamPage.length === 2 && !!upstream && upstream.length === 1 && same(upstream[0], input.safe) && same(upstreamPage[1], SENTINEL_MODULES));
  return { ok: failures.length === 0, failures, checked };
}
