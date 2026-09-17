import { encodeFunctionData, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";
import { isOfficialVerifiedDeployments, type VerifiedDeployments } from "../config/deployments";

export type UnsignedSetupCall = Readonly<{ to: Address; value: bigint; data: Hex; operation: 0 | 1 }>;
export type VerifiedCodeEvidence = Readonly<{ address: Address; version: string; runtimeCodeHash: Hex; source: string; evidence: "verified" }>;
export type TopologyDeploymentEvidence = Readonly<{
  safeSingleton: VerifiedCodeEvidence & Readonly<{ supportsModuleGuards: true }>;
  safeProxyFactory: VerifiedCodeEvidence;
  guard: VerifiedCodeEvidence;
  delay: VerifiedCodeEvidence;
}>;
export type VaultPlanInput = Readonly<{ policy: VaultPolicy; safeProxy: Address; safeProxySaltNonce: bigint; deployments: VerifiedDeployments }>;
export type VaultPlanDraft = Readonly<{
  unsigned: true; chainId: number; deployments: TopologyDeploymentEvidence & Readonly<{ safeProxy: Address }>;
  safeInitializer: Hex; safeProxyDeployment: UnsignedSetupCall;
  safe: { owners: readonly Address[]; threshold: 1; fallbackHandler: Address; guards: { transaction: Address; module: Address }; modules: readonly Address[] };
  delay: { owner: Address; avatar: Address; target: Address; upstreamModules: readonly Address[]; cooldownSeconds: number; expirationSeconds: number };
  policyHash: Hex; setup: readonly UnsignedSetupCall[]; extraAccounts: readonly Address[];
}>;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SAFE_ABI = [
  { name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owners", type: "address[]" }, { name: "threshold", type: "uint256" }, { name: "to", type: "address" }, { name: "data", type: "bytes" }, { name: "fallbackHandler", type: "address" }, { name: "paymentToken", type: "address" }, { name: "payment", type: "uint256" }, { name: "paymentReceiver", type: "address" }], outputs: [] },
  { name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] },
] as const;
const FACTORY_ABI = [{ name: "createProxyWithNonce", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_singleton", type: "address" }, { name: "initializer", type: "bytes" }, { name: "saltNonce", type: "uint256" }], outputs: [{ name: "proxy", type: "address" }] }] as const;
const GUARD_ABI = [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }], outputs: [] }] as const;

export function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32[]" }], [BigInt(policy.chainId), policy.safe, policy.passkey, policy.burner, policy.recovery, policy.delay, BigInt(policy.periodSeconds), policy.periodAnchor, BigInt(policy.cooldownSeconds), BigInt(policy.expirationSeconds), assets]));
}

function requireEvidence(name: string, item: { address?: Address; runtimeCodeHash?: Hex; version?: string; source?: string; evidence?: string }): void {
  if (item.evidence !== undefined && item.evidence !== "verified") throw new Error(`fail closed: ${name} lacks verified deployment evidence`);
  if (!item.address || item.address.toLowerCase() === ZERO || !item.runtimeCodeHash || !item.version || !item.source) throw new Error(`fail closed: ${name} lacks verified deployment evidence`);
}

function buildDraft(policy: VaultPolicy, safeProxy: Address, safeProxySaltNonce: bigint, deployments: TopologyDeploymentEvidence): VaultPlanDraft {
  assertValidVaultPolicy(policy);
  for (const [name, item] of Object.entries(deployments)) requireEvidence(name, item);
  if (deployments.safeSingleton.supportsModuleGuards !== true) throw new Error("fail closed: Safe singleton lacks module guards");
  if (policy.delay.toLowerCase() !== deployments.delay.address.toLowerCase()) throw new Error("policy Delay address does not match verified deployment Delay address");
  if (policy.safe.toLowerCase() !== safeProxy.toLowerCase()) throw new Error("Safe proxy does not match policy");
  if (safeProxySaltNonce < 0n) throw new Error("salt nonce must not be negative");
  const owners = [policy.passkey, policy.burner, policy.recovery] as const;
  const safeInitializer = encodeFunctionData({ abi: SAFE_ABI, functionName: "setup", args: [owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO] });
  const safeProxyDeployment: UnsignedSetupCall = { to: deployments.safeProxyFactory.address, value: 0n, operation: 0, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [deployments.safeSingleton.address, safeInitializer, safeProxySaltNonce] }) };
  const setup: UnsignedSetupCall[] = [];
  for (const asset of policy.assets) setup.push({ to: deployments.guard.address, value: 0n, operation: 0, data: encodeFunctionData({ abi: GUARD_ABI, functionName: "setAssetPolicy", args: [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]] }) });
  setup.push({ to: safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setGuard", args: [deployments.guard.address] }) });
  setup.push({ to: safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setModuleGuard", args: [deployments.guard.address] }) });
  setup.push({ to: safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "enableModule", args: [deployments.delay.address] }) });
  return { unsigned: true, chainId: policy.chainId, deployments: { ...deployments, safeProxy }, safeInitializer, safeProxyDeployment, safe: { owners, threshold: 1, fallbackHandler: ZERO, guards: { transaction: deployments.guard.address, module: deployments.guard.address }, modules: [deployments.delay.address] }, delay: { owner: safeProxy, avatar: safeProxy, target: safeProxy, upstreamModules: [safeProxy], cooldownSeconds: policy.cooldownSeconds, expirationSeconds: policy.expirationSeconds }, policyHash: policyHash(policy), setup, extraAccounts: [] };
}

/** Test-only draft surface. Production callers must use buildVaultPlan. */
export function buildVaultPlanDraft(input: Readonly<{ policy: VaultPolicy; safeProxy: Address; safeProxySaltNonce: bigint; deployments: TopologyDeploymentEvidence }>): VaultPlanDraft {
  return buildDraft(input.policy, input.safeProxy, input.safeProxySaltNonce, input.deployments);
}

/** Production planning is intentionally unavailable until a reviewed concrete atomic setup path exists. */
export function buildVaultPlan(input: VaultPlanInput): never {
  assertValidVaultPolicy(input.policy);
  if (!isOfficialVerifiedDeployments(input.deployments)) throw new Error("fail closed: deployments must come from the official resolver");
  const delay = input.deployments.dependencies.delay;
  if (input.policy.delay.toLowerCase() !== delay.address.toLowerCase()) throw new Error("fail closed: policy Delay address does not match verified deployment Delay address");
  throw new Error("fail closed: no reviewed concrete atomic setup path; no reproducible production plan is emitted");
}
