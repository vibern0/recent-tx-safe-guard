import { isAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { assertValidVaultPolicy, type AssetPolicy, type AssetSpendState, type VaultPolicy } from "../config/policy";

export type Lane = "base" | "step-up" | "delayed" | "blocked";

export type ClassifiableAction = Readonly<{
  to: Address;
  value: bigint;
  data: Hex;
  operation: "call" | "delegatecall" | 0 | 1;
  signer: Address;
  burnerApproved?: boolean;
}>;

const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER_SELECTOR = "a9059cbb";
const DELAYED_SAFE_SELECTORS = new Set([
  "setGuard(address)",
  "setModuleGuard(address)",
  "enableModule(address)",
  "disableModule(address)",
  "addOwnerWithThreshold(address,uint256)",
  "removeOwner(address,address,address)",
  "swapOwner(address,address,address)",
  "changeThreshold(uint256)",
  "setFallbackHandler(address)",
  "setNonce(uint256)",
].map((signature) => toFunctionSelector(signature).slice(2)));

function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }

function currentWindow(policy: VaultPolicy, now: bigint): bigint {
  if (now < policy.periodAnchor) throw new Error("timestamp precedes policy anchor");
  return policy.periodAnchor + ((now - policy.periodAnchor) / BigInt(policy.periodSeconds)) * BigInt(policy.periodSeconds);
}

function decodeTransfer(action: ClassifiableAction, asset: AssetPolicy): bigint | undefined {
  const data = action.data.toLowerCase();
  if (same(asset.token, ZERO)) return data === "0x" && action.value > 0n && asset.recipients.some((allowed) => same(allowed, action.to)) ? action.value : undefined;
  if (!same(action.to, asset.token) || action.value !== 0n || !data.startsWith(`0x${TRANSFER_SELECTOR}`) || data.length !== 2 + 8 + 64 + 64) return undefined;
  const recipient = `0x${data.slice(10 + 24, 10 + 64)}`;
  if (!isAddress(recipient) || !asset.recipients.some((allowed) => same(allowed, recipient))) return undefined;
  return BigInt(`0x${data.slice(10 + 64, 10 + 128)}`);
}

function recognizedDelayedAction(policy: VaultPolicy, action: ClassifiableAction): boolean {
  if (same(action.to, policy.delay) || same(action.to, policy.recovery)) return true;
  if (!same(action.to, policy.safe) || action.data.length < 10) return false;
  return DELAYED_SAFE_SELECTORS.has(action.data.slice(2, 10).toLowerCase());
}

export function classifyAction(policy: VaultPolicy, action: ClassifiableAction, state: AssetSpendState, now: bigint, burnerApproved = action.burnerApproved ?? false): Lane {
  assertValidVaultPolicy(policy);
  if (action.operation === "delegatecall" || action.operation === 1 || !isAddress(action.to) || !isAddress(action.signer) || !same(action.signer, policy.passkey)) return "blocked";
  if (recognizedDelayedAction(policy, action)) return "delayed";
  const asset = policy.assets.find((candidate) => same(candidate.token, action.to) || (same(candidate.token, ZERO) && action.data === "0x"));
  if (!asset) return "blocked";
  const amount = decodeTransfer(action, asset);
  if (amount === undefined || amount <= 0n) return "blocked";
  if (amount > asset.instantDailyLimit) return "delayed";
  const window = currentWindow(policy, now);
  if (state.window < policy.periodAnchor || state.window % BigInt(policy.periodSeconds) !== 0n || state.window > window) return "blocked";
  const baseSpent = state.window === window ? state.baseSpent : 0n;
  const instantSpent = state.window === window ? state.instantSpent : 0n;
  if (baseSpent < 0n || instantSpent < 0n || baseSpent > asset.baseDailyLimit || instantSpent > asset.instantDailyLimit) return "blocked";
  if (amount <= asset.basePerTransaction && amount <= asset.baseDailyLimit - baseSpent && amount <= asset.instantDailyLimit - instantSpent) return "base";
  if (burnerApproved && amount <= asset.stepUpPerTransaction && amount <= asset.instantDailyLimit - instantSpent) return "step-up";
  return "blocked";
}
