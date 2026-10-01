import { type Address, type Hex } from "viem";
import { type AssetSpendState } from "../config/policy";
import { type SafeTxMessage } from "../signers/types";

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
  transaction: SafeTxMessage;
  safeTxHash: Hex;
  signatures: Hex;
  expectedSpend: AssetSpendState;
}>;

export type DelayExecutionRequest = Readonly<{
  version: 1;
  kind: "delay-execution";
  idempotencyKey: Hex;
  chainId: number;
  deploymentsHash: Hex;
  policyHash: Hex;
  safe: Address;
  guard: Address;
  delay: Address;
  queueNonce: bigint;
  queueFingerprint: Hex;
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0;
  createdAt: bigint;
  cooldownSeconds: bigint;
  expirationSeconds: bigint;
}>;

export type SubmissionRequest = SafeExecutionRequest | DelayExecutionRequest;

export type SubmissionResult =
  | { kind: "submitted"; requestHash: Hex; transactionHash: Hex }
  | { kind: "confirmed"; requestHash: Hex; transactionHash: Hex; blockNumber: bigint; blockHash: Hex }
  | { kind: "reverted" | "stale" | "unsupported-chain" | "rpc-inconsistent" | "transport-unavailable"; requestHash: Hex; reason: string };

export type SubmissionTransport = Readonly<{
  submit(request: SubmissionRequest): Promise<SubmissionResult>;
}>;
