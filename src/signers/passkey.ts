import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { snapshotSafeSignerRequest, type Eip1193Provider, type SafeSigner, type SafeSignerRequest } from "./types";

export type PasskeySignerOptions = Readonly<{
  address: Address;
  provider: Eip1193Provider;
  sign(request: SafeSignerRequest): Promise<Hex>;
  verifier: Address;
}>;

const ERC1271_ABI = [{ name: "isValidSignature", type: "function", stateMutability: "view", inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const;

/** Safe-native passkey adapter. ERC-1271 is queried at the configured signer identity. */
export function createPasskeySigner(options: PasskeySignerOptions): SafeSigner {
  if (options.verifier.toLowerCase() !== options.address.toLowerCase()) throw new Error("verifier must match configured passkey");
  return Object.freeze({
    address: options.address,
    sign: async (input) => {
      const request = snapshotSafeSignerRequest(input);
      const rawSignature = await options.sign(request);
      if (!/^0x(?:[0-9a-f]{2})*$/i.test(rawSignature)) throw new Error("invalid passkey signature encoding");
      const result = await options.provider.request({ method: "eth_call", params: [{ to: options.verifier, data: encodeFunctionData({ abi: ERC1271_ABI, functionName: "isValidSignature", args: [request.safeTxHash, rawSignature] }) }, "latest"] });
      if (typeof result !== "string" || (result.length !== 10 && result.length !== 66) || !/^0x[0-9a-f]{8}$/i.test(result.slice(0, 10)) || result.slice(0, 10).toLowerCase() !== "0x1626ba7e") throw new Error("invalid ERC-1271 passkey signature");
      const byteLength = (rawSignature.length - 2) / 2;
      const paddedLength = Math.ceil(byteLength / 32) * 64;
      return `0x${options.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(BigInt(byteLength), { size: 32 }).slice(2)}${rawSignature.slice(2).padEnd(paddedLength, "0")}` as Hex;
    },
  });
}
