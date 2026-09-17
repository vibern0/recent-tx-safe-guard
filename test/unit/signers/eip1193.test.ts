import { expect } from "chai";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, type Address, type Hex } from "viem";
import { createEip1193Signer, createBurnerSigner, createRecoverySigner } from "../../../src/signers/eip1193";
import type { Eip1193Provider, SafeSignerRequest } from "../../../src/signers/types";

const account = privateKeyToAccount("0x0123456789012345678901234567890123456789012345678901234567890123");
const OTHER = "0x00000000000000000000000000000000000000b2" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const types = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
  { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
  { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const };
const request: SafeSignerRequest = {
  chainId: 31337, safe: OTHER, safeTxHash: hashTypedData({ domain: { chainId: 31337, verifyingContract: OTHER }, types, primaryType: "SafeTx", message: { to: OTHER, value: 1n, data: "0x" as Hex, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: 0n } }),
  typedData: { domain: { chainId: 31337, verifyingContract: OTHER }, types, primaryType: "SafeTx", message: { to: OTHER, value: 1n, data: "0x" as Hex, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: 0n } },
};

function provider(overrides: Record<string, unknown> = {}): Eip1193Provider {
  return { request: async ({ method, params }) => {
    if (method === "eth_chainId") return overrides[method] ?? "0x7a69";
    if (method === "eth_accounts") return overrides[method] ?? [account.address];
    if (method === "eth_signTypedData_v4") return overrides[method] ?? account.signTypedData(JSON.parse(String((params as unknown[])[1])));
    return overrides[method];
  }};
}

describe("EIP-1193 SafeSigner", () => {
  it("verifies the local account and exact recovered typed-data address", async () => {
    const signer = createEip1193Signer({ provider: provider(), account: account.address });
    const signature = await signer.sign(request);
    expect(signature).to.match(/^0x[0-9a-f]{130}$/);
  });

  it("returns the exact Burner extension and rejects duplicate append attempts", async () => {
    const signer = createBurnerSigner({ provider: provider(), account: account.address });
    const extension = await signer.sign(request);
    expect(extension.endsWith(signer.typeHash.slice(2))).to.equal(true);
    expect(extension.slice(2, 132)).to.have.length(130);
    await expect(signer.sign({ ...request, typedData: { ...request.typedData, message: { ...request.typedData.message, nonce: 1n } } })).to.be.rejected;
  });

  it("rejects wrong account, provider changes, user rejection, and extension ambiguity", async () => {
    const wrong = privateKeyToAccount("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    await expect(createEip1193Signer({ provider: provider(), account: wrong.address }).sign(request)).to.be.rejectedWith("account");
    await expect(createEip1193Signer({ provider: provider({ eth_accounts: [wrong.address] }), account: account.address }).sign(request)).to.be.rejectedWith("account");
    await expect(createEip1193Signer({ provider: provider({ eth_signTypedData_v4: Promise.reject(new Error("User rejected")) }), account: account.address }).sign(request)).to.be.rejectedWith("rejected");
    await expect(createEip1193Signer({ provider: { ...provider(), providers: [provider(), provider()] }, account: account.address }).sign(request)).to.be.rejectedWith("ambiguous");
  });

  it("keeps recovery on the same exact typed-data boundary", async () => {
    const signer = createRecoverySigner({ provider: provider(), account: account.address });
    expect(await signer.sign(request)).to.match(/^0x[0-9a-f]{130}$/);
  });
});
