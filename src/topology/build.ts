import { encodeFunctionData, encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";

export type UnsignedSetupCall = Readonly<{ to: Address; value: bigint; data: Hex; operation: 0 | 1 }>;
export type VerifiedCodeEvidence = Readonly<{ address: Address; version: string; runtimeCodeHash: Hex; source: string; evidence: "verified" }>;
export type TopologyDeploymentEvidence = Readonly<{
  safeSingleton: VerifiedCodeEvidence & Readonly<{ supportsModuleGuards: true }>;
  safeProxyFactory: VerifiedCodeEvidence;
  guard: VerifiedCodeEvidence;
  delay: VerifiedCodeEvidence;
}>;
export type AtomicSetupEncoder = (calls: readonly UnsignedSetupCall[]) => Hex;
export type VaultPlanInput = Readonly<{ policy: VaultPolicy; safeProxy: Address; safeProxySaltNonce: bigint; deployments: TopologyDeploymentEvidence; atomicSetupEncoder?: AtomicSetupEncoder }>;
export type VaultDeploymentPlan = Readonly<{
  unsigned: true; chainId: number; deployments: TopologyDeploymentEvidence & Readonly<{ safeProxy: Address }>;
  safeInitializer: Hex; safeProxyDeployment: UnsignedSetupCall;
  safe: { owners: readonly Address[]; threshold: 1; fallbackHandler: Address; guards: { transaction: Address; module: Address }; modules: readonly Address[] };
  delay: { owner: Address; avatar: Address; target: Address; upstreamModules: readonly Address[]; cooldownSeconds: number; expirationSeconds: number };
  policyHash: Hex; setup: readonly UnsignedSetupCall[]; atomicSetup: Hex; extraAccounts: readonly Address[];
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

function requireEvidence(name: string, item: VerifiedCodeEvidence): void {
  if (item.evidence !== "verified" || !item.address || item.address.toLowerCase() === ZERO || !item.runtimeCodeHash || !item.source) throw new Error(`fail closed: ${name} lacks verified deployment evidence`);
}

/** Builds calldata only. It never signs, broadcasts, or accepts caller-supplied code hashes. */
export function buildVaultPlan(input: VaultPlanInput): VaultDeploymentPlan {
  assertValidVaultPolicy(input.policy);
  for (const [name, item] of Object.entries(input.deployments)) requireEvidence(name, item);
  if (input.deployments.safeSingleton.supportsModuleGuards !== true) throw new Error("fail closed: Safe singleton lacks module guards");
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
  if (!input.atomicSetupEncoder) throw new Error("fail closed: no reviewed atomic setup encoder; refusing a partially protected Safe");
  const atomicSetup = input.atomicSetupEncoder(setup);
  if (!atomicSetup || atomicSetup === "0x") throw new Error("fail closed: atomic setup encoder returned empty calldata");
  return { unsigned: true, chainId: input.policy.chainId, deployments: { ...input.deployments, safeProxy: input.safeProxy }, safeInitializer, safeProxyDeployment, safe: { owners, threshold: 1, fallbackHandler: ZERO, guards: { transaction: input.deployments.guard.address, module: input.deployments.guard.address }, modules: [input.deployments.delay.address] }, delay: { owner: input.safeProxy, avatar: input.safeProxy, target: input.safeProxy, upstreamModules: [input.safeProxy], cooldownSeconds: input.policy.cooldownSeconds, expirationSeconds: input.policy.expirationSeconds }, policyHash: policyHash(input.policy), setup, atomicSetup, extraAccounts: [] };
}
