import { toHex, type Address, type Hex } from "viem";
import { snapshotSafeSignerRequest, type SafeSigner, type SafeSignerRequest } from "./types";

export type PasskeySignerOptions = Readonly<{
  address: Address;
  sign(request: SafeSignerRequest): Promise<Hex>;
  verify(safeTxHash: Hex, rawSignature: Hex): Promise<boolean>;
}>;

/** Safe-native passkey adapter. The raw bytes are WebAuthn data; Safe owns ERC-1271 validation. */
export function createPasskeySigner(options: PasskeySignerOptions): SafeSigner {
  return Object.freeze({
    address: options.address,
    sign: async (input) => {
      const request = snapshotSafeSignerRequest(input);
      const rawSignature = await options.sign(request);
      if (!/^0x(?:[0-9a-f]{2})*$/i.test(rawSignature)) throw new Error("invalid passkey signature encoding");
      if (!await options.verify(request.safeTxHash, rawSignature)) throw new Error("invalid ERC-1271 passkey signature");
      const byteLength = (rawSignature.length - 2) / 2;
      const paddedLength = Math.ceil(byteLength / 32) * 64;
      return `0x${options.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(BigInt(byteLength), { size: 32 }).slice(2)}${rawSignature.slice(2).padEnd(paddedLength, "0")}` as Hex;
    },
  });
}
