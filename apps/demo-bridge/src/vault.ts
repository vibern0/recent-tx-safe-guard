import { encodeFunctionData, hashTypedData, parseAbi, type Address, type Hex } from "viem";
import type { VaultProvisioningResult } from "./server";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const EURC_ABI = parseAbi(["function transfer(address to,uint256 amount) returns (bool)"]);
const SAFE_TX_TYPES = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const;

export type SafeExecutionRequest = Readonly<{
  version: 1;
  kind: "safe-execution";
  idempotencyKey: Hex;
  chainId: number;
  deploymentsHash: Hex;
  policyHash: Hex;
  safe: Address;
  guard: Address;
  asset: Address;
  transaction: Readonly<{ to: Address; value: bigint; data: Hex; operation: 0; safeTxGas: 0n; baseGas: 0n; gasPrice: 0n; gasToken: Address; refundReceiver: Address; nonce: bigint }>;
  safeTxHash: Hex;
  signatures: Hex;
  expectedSpend: Readonly<{ window: bigint; baseSpent: bigint; instantSpent: bigint }>;
}>;

export type PreparedEurcTransfer = Readonly<{
  chainId: number;
  safe: Address;
  guard: Address;
  eurc: Address;
  configuredEurc: Address;
  recipient: Address;
  amount: bigint;
  nonce: bigint;
  deploymentHash: Hex;
  policyHash: Hex;
  idempotencyKey: Hex;
  signatures: Hex;
  expectedSpend: Readonly<{ window: bigint; baseSpent: bigint; instantSpent: bigint }>;
  allowedRecipients: readonly Address[];
}>;

export type ReviewedDeploymentEvidence = Readonly<{
  verified: true;
  chainId: 11155111;
  safeSingleton: Address;
  safeProxyFactory: Address;
  passkeySignerFactory: Address;
  delayArtifactHash: Hex;
}>;

export type FreshVaultProvisioner = Readonly<{
  deploy: (input: Readonly<{ chainId: 11155111; eurc: Address; primaryCredentialId: string; secondaryCredentialId: string; artifacts: ReviewedDeploymentEvidence }>) => Promise<VaultProvisioningResult>;
}>;

function assertHex(value: Hex, label: string): void {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${label} is invalid`);
}

function assertAddress(value: Address, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is invalid`);
}

function assertExactInput(input: PreparedEurcTransfer): void {
  const allowed = new Set(["chainId", "safe", "guard", "eurc", "configuredEurc", "recipient", "amount", "nonce", "deploymentHash", "policyHash", "idempotencyKey", "signatures", "expectedSpend", "allowedRecipients"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`unknown transfer field: ${key}`);
}

export async function prepareEurcTransfer(input: PreparedEurcTransfer): Promise<SafeExecutionRequest> {
  assertExactInput(input);
  if (input.chainId !== 11155111) throw new Error("only Sepolia is supported");
  assertAddress(input.safe, "safe"); assertAddress(input.guard, "guard"); assertAddress(input.eurc, "eurc"); assertAddress(input.recipient, "recipient");
  if (input.eurc.toLowerCase() !== input.configuredEurc.toLowerCase()) throw new Error("EURC address is not the configured Circle EURC candidate");
  if (input.eurc === ZERO || input.recipient === ZERO || input.amount <= 0n || input.nonce < 0n) throw new Error("invalid EURC transfer bounds");
  if (!input.allowedRecipients.some((address) => address.toLowerCase() === input.recipient.toLowerCase())) throw new Error("recipient is not allowlisted");
  assertHex(input.deploymentHash, "deploymentHash"); assertHex(input.policyHash, "policyHash"); assertHex(input.idempotencyKey, "idempotencyKey"); assertHex(input.signatures, "signatures");
  if (input.signatures.length < 132) throw new Error("primary Safe signature is required before submission");
  const data = encodeFunctionData({ abi: EURC_ABI, functionName: "transfer", args: [input.recipient, input.amount] });
  const transaction = { to: input.eurc, value: 0n, data, operation: 0 as const, safeTxGas: 0n as const, baseGas: 0n as const, gasPrice: 0n as const, gasToken: ZERO, refundReceiver: ZERO, nonce: input.nonce };
  const safeTxHash = hashTypedData({ domain: { chainId: input.chainId, verifyingContract: input.safe }, types: { SafeTx: SAFE_TX_TYPES }, primaryType: "SafeTx", message: transaction });
  return Object.freeze({ version: 1, kind: "safe-execution", idempotencyKey: input.idempotencyKey, chainId: input.chainId, deploymentsHash: input.deploymentHash, policyHash: input.policyHash, safe: input.safe, guard: input.guard, asset: input.eurc, transaction, safeTxHash, signatures: input.signatures, expectedSpend: input.expectedSpend });
}

export async function provisionFreshVault(input: Readonly<{
  chainId: number;
  eurc: Address;
  primaryCredentialId: string;
  secondaryCredentialId: string;
  relayPrivateKey?: string;
  artifacts: ReviewedDeploymentEvidence;
  provisioner: FreshVaultProvisioner;
}>): Promise<VaultProvisioningResult> {
  if (input.chainId !== 11155111) throw new Error("only Sepolia vault provisioning is supported");
  if (!input.relayPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(input.relayPrivateKey)) throw new Error("local relay secret is required");
  if (!input.primaryCredentialId || !input.secondaryCredentialId || input.primaryCredentialId === input.secondaryCredentialId) throw new Error("distinct primary and secondary credentials are required");
  if (input.artifacts.verified !== true || input.artifacts.chainId !== 11155111) throw new Error("reviewed deployment evidence is required");
  return input.provisioner.deploy({ chainId: 11155111, eurc: input.eurc, primaryCredentialId: input.primaryCredentialId, secondaryCredentialId: input.secondaryCredentialId, artifacts: input.artifacts });
}
