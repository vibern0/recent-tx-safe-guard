import { encodeFunctionData, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";

export type UnsignedSetupCall = Readonly<{ to: Address; value: bigint; data: Hex; operation: 0 | 1 }>;
export type VaultPlanInput = Readonly<{ policy: VaultPolicy; safeAddress: Address; guardAddress: Address; delayAddress: Address; safeSingleton: Address; safeProxyFactory: Address; guardCodeHash: Hex; delayCodeHash: Hex }>;
export type VaultDeploymentPlan = Readonly<{ unsigned: true; chainId: number; deployments: { safe: Address; guard: Address; delay: Address; safeSingleton: Address; safeProxyFactory: Address }; safe: { owners: readonly Address[]; threshold: 1; fallbackHandler: Address; guards: { transaction: Address; module: Address }; modules: readonly Address[] }; delay: { owner: Address; avatar: Address; target: Address; upstreamModules: readonly Address[]; cooldownSeconds: number; expirationSeconds: number }; policyHash: Hex; setup: readonly UnsignedSetupCall[]; extraAccounts: readonly Address[] }>;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SAFE_ABI = [
  { name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] },
] as const;
const GUARD_ABI = [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }], outputs: [] }] as const;
function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32[]" }], [BigInt(policy.chainId), policy.safe, policy.passkey, policy.burner, policy.recovery, policy.delay, BigInt(policy.periodSeconds), policy.periodAnchor, BigInt(policy.cooldownSeconds), BigInt(policy.expirationSeconds), assets]));
}
export function buildVaultPlan(input: VaultPlanInput): VaultDeploymentPlan {
  assertValidVaultPolicy(input.policy);
  if (input.policy.safe.toLowerCase() !== input.safeAddress.toLowerCase()) throw new Error("safe address does not match policy");
  if (input.policy.delay.toLowerCase() !== input.delayAddress.toLowerCase()) throw new Error("delay address does not match policy");
  if ([input.safeAddress, input.guardAddress, input.delayAddress, input.safeSingleton, input.safeProxyFactory].some((x) => x.toLowerCase() === ZERO)) throw new Error("topology address must not be zero");
  const safe = input.safeAddress; const guard = input.guardAddress; const delay = input.delayAddress; const setup: UnsignedSetupCall[] = [];
  for (const asset of input.policy.assets) setup.push({ to: guard, value: 0n, operation: 0, data: encodeFunctionData({ abi: GUARD_ABI, functionName: "setAssetPolicy", args: [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]] }) });
  setup.push({ to: safe, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setGuard", args: [guard] }) });
  setup.push({ to: safe, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setModuleGuard", args: [guard] }) });
  setup.push({ to: safe, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "enableModule", args: [delay] }) });
  return { unsigned: true, chainId: input.policy.chainId, deployments: { safe, guard, delay, safeSingleton: input.safeSingleton, safeProxyFactory: input.safeProxyFactory }, safe: { owners: [input.policy.passkey, input.policy.burner, input.policy.recovery], threshold: 1, fallbackHandler: ZERO, guards: { transaction: guard, module: guard }, modules: [delay] }, delay: { owner: safe, avatar: safe, target: safe, upstreamModules: [safe], cooldownSeconds: input.policy.cooldownSeconds, expirationSeconds: input.policy.expirationSeconds }, policyHash: policyHash(input.policy), setup, extraAccounts: [] };
}
