import { hashTypedData, type Address, type Hex, type TypedDataDefinition } from "viem";

export type SafeTxMessage = Readonly<{
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
}>;

export type SafeTxTypedData = Readonly<{
  domain: Readonly<{ chainId: number; verifyingContract: Address }>;
  types: Readonly<Record<string, readonly Readonly<{ name: string; type: string }>[]>>;
  primaryType: "SafeTx";
  message: SafeTxMessage;
}>;

export type SafeSignerRequest = Readonly<{
  chainId: number;
  safe: Address;
  safeTxHash: Hex;
  typedData: SafeTxTypedData;
}>;

export type SafeSigner = Readonly<{
  address: Address;
  sign(request: SafeSignerRequest): Promise<Hex>;
}>;

export type Eip1193Provider = Readonly<{
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  providers?: readonly Eip1193Provider[];
}>;

export const SAFE_TX_TYPES = [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
  { name: "nonce", type: "uint256" },
] as const;

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export function snapshotSafeSignerRequest(input: SafeSignerRequest): SafeSignerRequest {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("invalid chain");
  if (input.typedData.primaryType !== "SafeTx") throw new Error("invalid typed data");
  if (input.typedData.domain.chainId !== input.chainId) throw new Error("typed data chain mismatch");
  if (!sameAddress(input.typedData.domain.verifyingContract, input.safe)) throw new Error("typed data Safe mismatch");
  const safeTxHash = hashTypedData(input.typedData as unknown as TypedDataDefinition) as Hex;
  if (safeTxHash.toLowerCase() !== input.safeTxHash.toLowerCase()) throw new Error("Safe transaction hash mismatch");
  const typedData = JSON.parse(JSON.stringify(input.typedData, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value), (_, value: unknown) => typeof value === "string" && /^-?\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value) as SafeTxTypedData;
  return Object.freeze({ ...input, typedData: Object.freeze(typedData) });
}

export function sameSignerRequest(left: SafeSignerRequest, right: SafeSignerRequest): boolean {
  return left.chainId === right.chainId && sameAddress(left.safe, right.safe) && left.safeTxHash.toLowerCase() === right.safeTxHash.toLowerCase() &&
    JSON.stringify(left.typedData, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value) ===
    JSON.stringify(right.typedData, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value);
}

export function assertSameSignerRequest(expected: SafeSignerRequest, actual: SafeSignerRequest): void {
  if (!sameSignerRequest(expected, actual)) throw new Error("signer request mutated");
}
