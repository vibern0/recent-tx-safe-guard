import { keccak256, encodeAbiParameters, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";
import { isOfficialVerifiedDeployments, type VerifiedDeployments } from "../config/deployments";

export type VaultPlanInput = Readonly<{
  policy: VaultPolicy;
  deployer: Address;
  startingNonce: bigint;
  safeProxySaltNonce: bigint;
  setupHelperCreationCode: Hex;
  guardCreationCode: Hex;
  delayCreationCode: Hex;
  maintenanceCreationCode: Hex;
  deployments: VerifiedDeployments;
}>;

export function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32[]" }], [BigInt(policy.chainId), policy.safe, policy.passkey, policy.burner, policy.delay, BigInt(policy.periodSeconds), policy.periodAnchor, BigInt(policy.cooldownSeconds), BigInt(policy.expirationSeconds), assets]));
}

/** Production planning is intentionally unavailable until live helper/component evidence exists. */
export function buildVaultPlan(input: VaultPlanInput): never {
  assertValidVaultPolicy(input.policy);
  if (!isOfficialVerifiedDeployments(input.deployments)) throw new Error("fail closed: deployments must come from the official resolver");
  throw new Error("fail closed: setup helper, guard, Delay, and maintenance runtime evidence is required before production plan emission");
}
