import { encodeFunctionData, encodeAbiParameters, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../../src/config/policy";
import { policyHash } from "../../src/topology/build";

export type UnsignedSetupCall = Readonly<{ to: Address; value: bigint; data: Hex; operation: 0 | 1 }>;
export type VerifiedCodeEvidence = Readonly<{ address: Address; version: string; runtimeCodeHash: Hex; source: string; evidence: "verified" }>;
export type TopologyDeploymentEvidence = Readonly<{
  safeSingleton: VerifiedCodeEvidence & Readonly<{ supportsModuleGuards: true }>;
  safeProxyFactory: VerifiedCodeEvidence;
  guard: VerifiedCodeEvidence;
  delay: VerifiedCodeEvidence;
}>;
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

function requireEvidence(name: string, item: { address?: Address; runtimeCodeHash?: Hex; version?: string; source?: string; evidence?: string }): void {
  if (item.evidence !== "verified" || !item.address || item.address.toLowerCase() === ZERO || !item.runtimeCodeHash || !item.version || !item.source) throw new Error(`fail closed: ${name} lacks verified deployment evidence`);
}

export function buildVaultPlanDraft(input: Readonly<{ policy: VaultPolicy; safeProxy: Address; safeProxySaltNonce: bigint; deployments: TopologyDeploymentEvidence }>): VaultPlanDraft {
  assertValidVaultPolicy(input.policy);
  for (const [name, item] of Object.entries(input.deployments)) requireEvidence(name, item);
  if (input.deployments.safeSingleton.supportsModuleGuards !== true) throw new Error("fail closed: Safe singleton lacks module guards");
  if (input.policy.delay.toLowerCase() !== input.deployments.delay.address.toLowerCase()) throw new Error("policy Delay address does not match verified deployment Delay address");
  if (input.policy.safe.toLowerCase() !== input.safeProxy.toLowerCase()) throw new Error("Safe proxy does not match policy");
  if (input.safeProxySaltNonce < 0n) throw new Error("salt nonce must not be negative");
  const owners = [input.policy.passkey, input.policy.burner, input.policy.recovery] as const;
  const safeInitializer = encodeFunctionData({ abi: SAFE_ABI, functionName: "setup", args: [owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO] });
  const safeProxyDeployment: UnsignedSetupCall = { to: input.deployments.safeProxyFactory.address, value: 0n, operation: 0, data: encodeFunctionData({ abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [input.deployments.safeSingleton.address, safeInitializer, input.safeProxySaltNonce] }) };
  const setup: UnsignedSetupCall[] = [];
  for (const asset of input.policy.assets) setup.push({ to: input.deployments.guard.address, value: 0n, operation: 0, data: encodeFunctionData({ abi: GUARD_ABI, functionName: "setAssetPolicy", args: [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]] }) });
  setup.push({ to: input.safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setGuard", args: [input.deployments.guard.address] }) });
  setup.push({ to: input.safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "setModuleGuard", args: [input.deployments.guard.address] }) });
  setup.push({ to: input.safeProxy, value: 0n, operation: 0, data: encodeFunctionData({ abi: SAFE_ABI, functionName: "enableModule", args: [input.deployments.delay.address] }) });
  return { unsigned: true, chainId: input.policy.chainId, deployments: { ...input.deployments, safeProxy: input.safeProxy }, safeInitializer, safeProxyDeployment, safe: { owners, threshold: 1, fallbackHandler: ZERO, guards: { transaction: input.deployments.guard.address, module: input.deployments.guard.address }, modules: [input.deployments.delay.address] }, delay: { owner: input.safeProxy, avatar: input.safeProxy, target: input.safeProxy, upstreamModules: [input.safeProxy], cooldownSeconds: input.policy.cooldownSeconds, expirationSeconds: input.policy.expirationSeconds }, policyHash: policyHash(input.policy), setup, extraAccounts: [] };
}
