import { toHex, type Address, type Hex } from "viem";
import { SAFE_TX_TYPES } from "../../src/signers/types";

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const BURNER_SIGNATURE_TYPE_HASH = "0xb730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9" as Hex;

export const safeTxTypes = { SafeTx: SAFE_TX_TYPES } as const;

export function fn(name: string, inputs: readonly object[], outputs: readonly object[] = []): readonly object[] {
  return [{ name, type: "function", stateMutability: "nonpayable", inputs, outputs }] as const;
}

export const transferAbi = fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]);
export const queueAbi = fn("execTransactionFromModule", [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }]);

type SafeNonceReader = Readonly<{
  address: Address;
  read: Readonly<{ nonce: () => Promise<bigint> }>;
}>;

type TypedDataSigner = Readonly<{
  signTypedData(args: any): Promise<Hex>;
}>;

export async function signSafeTransaction(
  safe: SafeNonceReader,
  signer: TypedDataSigner,
  to: Address,
  data: Hex,
  options: Readonly<{ chainId?: number; value?: bigint; operation?: 0 | 1; nonce?: bigint }> = {},
): Promise<Hex> {
  const value = options.value ?? 0n;
  const operation = options.operation ?? 0;
  const nonce = options.nonce ?? await safe.read.nonce();
  return signer.signTypedData({
    domain: { chainId: options.chainId ?? 31337, verifyingContract: safe.address },
    types: safeTxTypes,
    primaryType: "SafeTx",
    message: { to, value, data, operation, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
  });
}

export function passkeySignature(address: Address): Hex {
  return `0x${address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
}

export function burnerEnvelope(passkey: Address, burnerSignature: Hex): Hex {
  return `${passkeySignature(passkey)}${burnerSignature.slice(2)}${toHex((burnerSignature.length - 2) / 2, { size: 32 }).slice(2)}${BURNER_SIGNATURE_TYPE_HASH.slice(2)}` as Hex;
}
