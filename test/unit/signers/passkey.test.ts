import { expect } from "chai";
import { hashTypedData, keccak256, toHex, type Address, type Hex } from "viem";
import { createPasskeySigner } from "../../../src/signers/passkey";
import type { Eip1193Provider, SafeSignerRequest } from "../../../src/signers/types";

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

function verifierProvider(result = "0x1626ba7e"): Eip1193Provider {
  return { request: async ({ method }) => {
    if (method === "eth_call") return result;
    throw new Error(`unexpected provider method ${method}`);
  }};
}

describe("passkey SafeSigner", () => {
  it("returns one canonical Safe contract-signature slot", async () => {
    const raw = "0x1234" as Hex;
    const signer = createPasskeySigner({ address: PASSKEY, verifier: PASSKEY, provider: verifierProvider(), sign: async () => raw });
    const signature = await signer.sign(request());
    expect(signature).to.equal(`0x${PASSKEY.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(2n, { size: 32 }).slice(2)}1234${"0".repeat(60)}`);
  });

  it("rejects a passkey response that fails the configured ERC-1271 verifier", async () => {
    const signer = createPasskeySigner({ address: PASSKEY, verifier: PASSKEY, provider: verifierProvider("0xffffffff"), sign: async () => "0x12" });
    await expect(signer.sign(request())).to.be.rejectedWith("ERC-1271");
  });

  it("rejects a mutated chain, Safe, hash, or typed-data payload", async () => {
    const signer = createPasskeySigner({ address: PASSKEY, verifier: PASSKEY, provider: verifierProvider(), sign: async () => "0x12" });
    await expect(signer.sign(request({ chainId: 1 }))).to.be.rejectedWith("chain");
    await expect(signer.sign(request({ safe: PASSKEY }))).to.be.rejectedWith("Safe");
    await expect(signer.sign(request({ safeTxHash: keccak256(toHex("other")) }))).to.be.rejectedWith("hash");
    await expect(signer.sign(request({ typedData: typedData(1, SAFE) }))).to.be.rejectedWith("typed data");
  });

  it("rejects a verifier identity that is not the configured Safe-native passkey", async () => {
    expect(() => createPasskeySigner({ address: PASSKEY, verifier: SAFE, provider: verifierProvider(), sign: async () => "0x12" })).to.throw("verifier");
  });

  it("rejects non-canonical SafeTx typed data before contacting the verifier", async () => {
    let calls = 0;
    const provider: Eip1193Provider = { request: async () => { calls++; return "0x1626ba7e"; } };
    const malformed = request({ typedData: { ...request().typedData, types: { ...request().typedData.types, Extra: [] } } as never });
    await expect(createPasskeySigner({ address: PASSKEY, verifier: PASSKEY, provider, sign: async () => "0x12" }).sign(malformed)).to.be.rejectedWith("canonical");
    expect(calls).to.equal(0);
  });

  it("rejects extra domain and message fields, wrong primary type, and non-SafeTx field definitions", async () => {
    const provider = verifierProvider();
    const cases = [
      { typedData: { ...request().typedData, domain: { ...request().typedData.domain, name: "Safe" } } },
      { typedData: { ...request().typedData, message: { ...request().typedData.message, extra: 1n } } },
      { typedData: { ...request().typedData, primaryType: "Other" } },
      { typedData: { ...request().typedData, types: { SafeTx: [{ name: "to", type: "bytes32" }] } } },
    ];
    for (const candidate of cases) {
      await expect(createPasskeySigner({ address: PASSKEY, verifier: PASSKEY, provider, sign: async () => "0x12" }).sign({ ...request(), typedData: candidate.typedData } as never)).to.be.rejectedWith(/canonical|typed data/);
    }
  });
});
