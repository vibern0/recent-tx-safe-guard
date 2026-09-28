import { isAddress, type Address } from "viem";

export type AssetPolicy = Readonly<{
  token: Address;
  basePerTransaction: bigint;
  stepUpPerTransaction: bigint;
  baseDailyLimit: bigint;
  instantDailyLimit: bigint;
  recipients: readonly Address[];
}>;

export type VaultPolicy = Readonly<{
  chainId: number;
  safe: Address;
  passkey: Address;
  burner: Address;
  delay: Address;
  periodSeconds: 86400;
  periodAnchor: bigint;
  cooldownSeconds: number;
  expirationSeconds: number;
  assets: readonly AssetPolicy[];
}>;

export type AssetSpendState = Readonly<{
  window: bigint;
  baseSpent: bigint;
  instantSpent: bigint;
}>;

const ZERO = "0x0000000000000000000000000000000000000000";
const POLICY_KEYS = ["chainId", "safe", "passkey", "burner", "delay", "periodSeconds", "periodAnchor", "cooldownSeconds", "expirationSeconds", "assets"] as const;
const ASSET_KEYS = ["token", "basePerTransaction", "stepUpPerTransaction", "baseDailyLimit", "instantDailyLimit", "recipients"] as const;

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not allowed`);
  for (const key of allowed) if (!(key in value)) throw new Error(`${path}.${key} is required`);
}

function assertAddress(name: string, value: Address): void {
  if (!isAddress(value)) throw new Error(`${name} must be an address`);
}

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) throw new Error(`${name} must not be negative`);
}

export function assertValidVaultPolicy(policy: VaultPolicy): void {
  assertExactKeys(policy as unknown as Record<string, unknown>, POLICY_KEYS, "policy");
  if (!Number.isSafeInteger(policy.chainId) || policy.chainId <= 0) throw new Error("invalid chainId");
  if (policy.periodSeconds !== 86400) throw new Error("periodSeconds must be 86400");
  if (policy.periodAnchor % BigInt(policy.periodSeconds) !== 0n) throw new Error("periodAnchor is not aligned");
  if (!Number.isSafeInteger(policy.cooldownSeconds) || policy.cooldownSeconds <= 0) throw new Error("invalid cooldownSeconds");
  if (!Number.isSafeInteger(policy.expirationSeconds) || policy.expirationSeconds <= 0) throw new Error("invalid expirationSeconds");
  assertAddress("safe", policy.safe);
  assertAddress("passkey", policy.passkey);
  assertAddress("burner", policy.burner);
  assertAddress("delay", policy.delay);
  const signers = [policy.passkey.toLowerCase(), policy.burner.toLowerCase()];
  if (new Set(signers).size !== signers.length) throw new Error("signers must be distinct");
  if (policy.assets.length === 0) throw new Error("at least one asset is required");

  const tokens = new Set<string>();
  for (const [index, asset] of policy.assets.entries()) {
    assertExactKeys(asset as unknown as Record<string, unknown>, ASSET_KEYS, `assets[${index}]`);
    assertAddress(`assets[${index}].token`, asset.token);
    const token = asset.token.toLowerCase();
    if (tokens.has(token)) throw new Error("asset tokens must be distinct");
    tokens.add(token);
    for (const [name, value] of Object.entries(asset)) {
      if (name !== "token" && name !== "recipients") assertNonNegative(`assets[${index}].${name}`, value as bigint);
    }
    if (asset.basePerTransaction <= 0n || asset.stepUpPerTransaction <= 0n) throw new Error("transaction caps must be positive");
    if (asset.baseDailyLimit <= 0n || asset.instantDailyLimit <= asset.baseDailyLimit) throw new Error("must satisfy 0 < X < Y");
    if (asset.basePerTransaction > asset.baseDailyLimit || asset.stepUpPerTransaction > asset.instantDailyLimit) throw new Error("transaction cap exceeds daily limit");
    if (asset.recipients.length === 0) throw new Error("asset recipients must not be empty");
    const recipients = new Set<string>();
    for (const recipient of asset.recipients) {
      assertAddress("recipient", recipient);
      if (recipient.toLowerCase() === ZERO) throw new Error("zero recipient is not allowed");
      if (recipients.has(recipient.toLowerCase())) throw new Error("recipients must be distinct");
      recipients.add(recipient.toLowerCase());
    }
  }
}

export const validateVaultPolicy = assertValidVaultPolicy;
