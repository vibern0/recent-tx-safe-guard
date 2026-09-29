import { getAddress, hashTypedData, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { queueFingerprint } from "../queue/delay";
import { SAFE_TX_TYPES, type SafeTxMessage } from "../signers/types";
import {
  type DelayExecutionRequest,
  type SafeExecutionRequest,
  type SubmissionRequest,
} from "./types";

export type {
  DelayExecutionRequest,
  SafeExecutionRequest,
  SubmissionRequest,
  SubmissionResult,
  SubmissionTransport,
} from "./types";

const SAFE_REQUEST_KEYS = ["version", "kind", "idempotencyKey", "chainId", "deploymentsHash", "policyHash", "safe", "guard", "asset", "transaction", "safeTxHash", "signatures", "expectedSpend"] as const;
const DELAY_REQUEST_KEYS = ["version", "kind", "idempotencyKey", "chainId", "deploymentsHash", "policyHash", "safe", "guard", "delay", "queueNonce", "queueFingerprint", "to", "value", "data", "operation", "createdAt", "cooldownSeconds", "expirationSeconds"] as const;
const SAFE_TX_KEYS = ["to", "value", "data", "operation", "safeTxGas", "baseGas", "gasPrice", "gasToken", "refundReceiver", "nonce"] as const;
const SPEND_KEYS = ["window", "baseSpent", "instantSpent"] as const;
const SENSITIVE = /private|secret|mnemonic|seed|pin|credential|provider|rpc|passkeyMaterial|burnerPin|rawSignature/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (SENSITIVE.test(key)) throw new Error(`sensitive ${label} field: ${key}`);
    if (!expected.includes(key)) throw new Error(`unknown ${label} field: ${key}`);
  }
  for (const key of expected) if (!(key in value)) throw new Error(`${label}.${key} is required`);
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value) || getAddress(value) !== value) throw new Error(`${label} must be a canonical address`);
  return value;
}

function hash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a canonical bytes32 hex value`);
  return value as Hex;
}

function hex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/.test(value)) throw new Error(`${label} must be canonical hex bytes`);
  return value as Hex;
}

function uint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${label} must be a non-negative bigint`);
  return value;
}

function chainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("chainId must be a positive safe integer");
  return value;
}

function safeTx(input: unknown): SafeTxMessage {
  if (!isRecord(input)) throw new Error("transaction must be an object");
  assertExactKeys(input, SAFE_TX_KEYS, "transaction");
  const operation = input.operation;
  if (operation !== 0 && operation !== 1) throw new Error("transaction.operation must be 0 or 1");
  return Object.freeze({
    to: address(input.to, "transaction.to"),
    value: uint(input.value, "transaction.value"),
    data: hex(input.data, "transaction.data"),
    operation,
    safeTxGas: uint(input.safeTxGas, "transaction.safeTxGas"),
    baseGas: uint(input.baseGas, "transaction.baseGas"),
    gasPrice: uint(input.gasPrice, "transaction.gasPrice"),
    gasToken: address(input.gasToken, "transaction.gasToken"),
    refundReceiver: address(input.refundReceiver, "transaction.refundReceiver"),
    nonce: uint(input.nonce, "transaction.nonce"),
  });
}

function spendState(input: unknown): SafeExecutionRequest["expectedSpend"] {
  if (!isRecord(input)) throw new Error("expectedSpend must be an object");
  assertExactKeys(input, SPEND_KEYS, "expectedSpend");
  return Object.freeze({
    window: uint(input.window, "expectedSpend.window"),
    baseSpent: uint(input.baseSpent, "expectedSpend.baseSpent"),
    instantSpent: uint(input.instantSpent, "expectedSpend.instantSpent"),
  });
}

function assertSafeSignatures(value: Hex): void {
  const bytes = (value.length - 2) / 2;
  if (bytes < 65) throw new Error("malformed Safe signatures");
}

function snapshotSafe(input: Record<string, unknown>): SafeExecutionRequest {
  assertExactKeys(input, SAFE_REQUEST_KEYS, "request");
  if (input.version !== 1) throw new Error("request.version must be 1");
  if (input.kind !== "safe-execution") throw new Error("request.kind mismatch");
  const request = {
    version: 1,
    kind: "safe-execution",
    idempotencyKey: hash(input.idempotencyKey, "idempotencyKey"),
    chainId: chainId(input.chainId),
    deploymentsHash: hash(input.deploymentsHash, "deploymentsHash"),
    policyHash: hash(input.policyHash, "policyHash"),
    safe: address(input.safe, "safe"),
    guard: address(input.guard, "guard"),
    asset: address(input.asset, "asset"),
    transaction: safeTx(input.transaction),
    safeTxHash: hash(input.safeTxHash, "safeTxHash"),
    signatures: hex(input.signatures, "signatures"),
    expectedSpend: spendState(input.expectedSpend),
  } satisfies SafeExecutionRequest;
  assertSafeSignatures(request.signatures);
  const computed = hashTypedData({ domain: { chainId: request.chainId, verifyingContract: request.safe }, types: { SafeTx: SAFE_TX_TYPES }, primaryType: "SafeTx", message: request.transaction });
  if (computed !== request.safeTxHash) throw new Error("Safe transaction hash mismatch");
  return Object.freeze(request);
}

function snapshotDelay(input: Record<string, unknown>): DelayExecutionRequest {
  assertExactKeys(input, DELAY_REQUEST_KEYS, "request");
  if (input.version !== 1) throw new Error("request.version must be 1");
  if (input.kind !== "delay-execution") throw new Error("request.kind mismatch");
  if (input.operation !== 0) throw new Error("delay operation must be 0");
  const request = {
    version: 1,
    kind: "delay-execution",
    idempotencyKey: hash(input.idempotencyKey, "idempotencyKey"),
    chainId: chainId(input.chainId),
    deploymentsHash: hash(input.deploymentsHash, "deploymentsHash"),
    policyHash: hash(input.policyHash, "policyHash"),
    safe: address(input.safe, "safe"),
    guard: address(input.guard, "guard"),
    delay: address(input.delay, "delay"),
    queueNonce: uint(input.queueNonce, "queueNonce"),
    queueFingerprint: hash(input.queueFingerprint, "queueFingerprint"),
    to: address(input.to, "to"),
    value: uint(input.value, "value"),
    data: hex(input.data, "data"),
    operation: 0,
    createdAt: uint(input.createdAt, "createdAt"),
    cooldownSeconds: uint(input.cooldownSeconds, "cooldownSeconds"),
    expirationSeconds: uint(input.expirationSeconds, "expirationSeconds"),
  } satisfies DelayExecutionRequest;
  if (queueFingerprint(request) !== request.queueFingerprint) throw new Error("queue fingerprint mismatch");
  return Object.freeze(request);
}

export function snapshotSubmissionRequest(input: unknown): SubmissionRequest {
  if (!isRecord(input)) throw new Error("submission request must be an object");
  if (input.kind === "safe-execution") return snapshotSafe(input);
  if (input.kind === "delay-execution") return snapshotDelay(input);
  throw new Error("unsupported submission request kind");
}

export function canonicalSubmissionJson(value: unknown): string {
  return JSON.stringify(toCanonicalJson(value));
}

export function submissionRequestHash(request: SubmissionRequest): Hex {
  return keccak256(stringToHex(canonicalSubmissionJson(request)));
}

function toCanonicalJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toCanonicalJson);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) output[key] = toCanonicalJson(value[key]);
    return output;
  }
  return value;
}
