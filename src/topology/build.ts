import { keccak256, encodeAbiParameters, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";
import { isOfficialVerifiedDeployments, type VerifiedDeployments } from "../config/deployments";

export type VaultPlanInput = Readonly<{ policy: VaultPolicy; safeProxy: Address; safeProxySaltNonce: bigint; deployments: VerifiedDeployments }>;

export function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32[]" }], [BigInt(policy.chainId), policy.safe, policy.passkey, policy.burner, policy.recovery, policy.delay, BigInt(policy.periodSeconds), policy.periodAnchor, BigInt(policy.cooldownSeconds), BigInt(policy.expirationSeconds), assets]));
}

/** Production planning is intentionally unavailable until a reviewed concrete atomic setup path exists. */
export function buildVaultPlan(input: VaultPlanInput): never {
  assertValidVaultPolicy(input.policy);
  if (!isOfficialVerifiedDeployments(input.deployments)) throw new Error("fail closed: deployments must come from the official resolver");
  const delay = input.deployments.dependencies.delay;
  if (input.policy.delay.toLowerCase() !== delay.address.toLowerCase()) throw new Error("fail closed: policy Delay address does not match verified deployment Delay address");
  throw new Error("fail closed: no reviewed concrete atomic setup path; no reproducible production plan is emitted");
}
