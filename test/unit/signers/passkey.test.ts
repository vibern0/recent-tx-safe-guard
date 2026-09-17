import { expect } from "chai";
import { hashTypedData, keccak256, toHex, type Address, type Hex } from "viem";
import { createPasskeySigner } from "../../../src/signers/passkey";
import type { SafeSignerRequest } from "../../../src/signers/types";

const PASSKEY = "0x00000000000000000000000000000000000000a1" as Address;
const SAFE = "0x00000000000000000000000000000000000000b2" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const typedData = (chainId: number, safe: Address, nonce = 7n) => ({
  domain: { chainId, verifyingContract: safe },
  types: { SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ] as const },
  primaryType: "SafeTx" as const,
  message: { to: SAFE, value: 1n, data: "0x" as Hex, operation: 0 as const, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
});

const request = (overrides: Partial<SafeSignerRequest> = {}): SafeSignerRequest => ({
  chainId: 31337,
  safe: SAFE,
  safeTxHash: hashTypedData(typedData(31337, SAFE)),
  typedData: typedData(31337, SAFE),
  ...overrides,
});

describe("passkey SafeSigner", () => {
  it("returns one canonical Safe contract-signature slot", async () => {
    const raw = "0x1234" as Hex;
    const signer = createPasskeySigner({ address: PASSKEY, sign: async () => raw, verify: async () => true });
    const signature = await signer.sign(request());
    expect(signature).to.equal(`0x${PASSKEY.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(2n, { size: 32 }).slice(2)}1234${"0".repeat(60)}`);
  });

  it("rejects a passkey response that fails the configured ERC-1271 verifier", async () => {
    const signer = createPasskeySigner({ address: PASSKEY, sign: async () => "0x12", verify: async () => false });
    await expect(signer.sign(request())).to.be.rejectedWith("ERC-1271");
  });

  it("rejects a mutated chain, Safe, hash, or typed-data payload", async () => {
    const signer = createPasskeySigner({ address: PASSKEY, sign: async () => "0x12", verify: async () => true });
    await expect(signer.sign(request({ chainId: 1 }))).to.be.rejectedWith("chain");
    await expect(signer.sign(request({ safe: PASSKEY }))).to.be.rejectedWith("Safe");
    await expect(signer.sign(request({ safeTxHash: keccak256(toHex("other")) }))).to.be.rejectedWith("hash");
    await expect(signer.sign(request({ typedData: typedData(1, SAFE) }))).to.be.rejectedWith("typed data");
  });
});
