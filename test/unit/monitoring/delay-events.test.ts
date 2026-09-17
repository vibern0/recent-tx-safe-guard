import { expect } from "chai";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbiItem, toHex } from "viem";
import {
  decodeDelayLog,
  delayEventAbi,
  verifyDelayBinding,
  type DelayMonitoringContext,
} from "../../../src/monitoring/delay-events";

const context: DelayMonitoringContext = {
  chainId: 31337,
  safe: getAddress("0x0000000000000000000000000000000000000001"),
  delay: getAddress("0x0000000000000000000000000000000000000003"),
  confirmations: 1,
  cooldownSeconds: 10n,
  expirationSeconds: 60n,
};

function log(eventName: "TransactionAdded" | "TransactionExecuted" | "TxNonceSet", args: readonly unknown[], overrides = {}) {
  const item = parseAbiItem(eventName === "TransactionAdded"
    ? "event TransactionAdded(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)"
    : eventName === "TransactionExecuted"
      ? "event TransactionExecuted(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)"
      : "event TxNonceSet(uint256 nonce)");
  const indexed = eventName === "TransactionAdded" || eventName === "TransactionExecuted" ? 2 : 0;
  const types = eventName === "TransactionAdded" || eventName === "TransactionExecuted"
    ? [{ type: "address" }, { type: "uint256" }, { type: "bytes" }, { type: "uint8" }]
    : [{ type: "uint256" }];
  const encoded = { topics: encodeEventTopics({ abi: [item], eventName, args: args as never }), data: encodeAbiParameters(types, args.slice(indexed) as never) };
  return {
    address: context.delay,
    chainId: context.chainId,
    blockNumber: 20n,
    blockHash: keccak256(toHex("block")),
    transactionHash: keccak256(toHex("tx")),
    logIndex: 0,
    topics: [...encoded.topics] as `0x${string}`[],
    data: encoded.data,
    ...overrides,
  };
}

describe("Delay activity decoding", () => {
  it("decodes a confirmed queue item with the monitoring fingerprint", () => {
    const result = decodeDelayLog(log("TransactionAdded", [4n, keccak256(toHex("hash")), context.safe, 0n, "0x", 0]), context, 21n, 100n);
    expect(result.kind).to.equal("delayed-queued");
    expect(result.queueNonce).to.equal(4n);
    expect(result.queueFingerprint).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("derives expiry only from an observed queue creation time", () => {
    const result = decodeDelayLog(log("TransactionAdded", [4n, keccak256(toHex("hash")), context.safe, 0n, "0x", 0]), context, 21n, 171n, 100n);
    expect(result.kind).to.equal("delayed-expired");
  });

  it("fails closed on a wrong Delay, malformed log, and unbound queue target", () => {
    expect(() => decodeDelayLog(log("TxNonceSet", [5n], { address: context.safe }), context, 21n, 100n)).to.throw(/identity/i);
    expect(() => decodeDelayLog({ ...log("TxNonceSet", [5n]), data: "0x12" }, context, 21n, 100n)).to.throw(/malformed/i);
    expect(() => decodeDelayLog(log("TransactionAdded", [4n, keccak256(toHex("hash")), context.delay, 0n, "0x", 0]), context, 21n, 100n)).to.throw(/binding/i);
  });

  it("requires queue hash and tuple revalidation before a lifecycle alert", async () => {
    const result = decodeDelayLog(log("TransactionAdded", [4n, keccak256(toHex("hash")), context.safe, 0n, "0x", 0]), context, 21n, 100n);
    const item = { txHash: result.queueFingerprint!, createdAt: 100n, to: context.safe, value: 0n, data: "0x" as const, operation: 0 };
    await expect(verifyDelayBinding(result, { readQueue: async () => item }, context)).to.be.fulfilled;
    await expect(verifyDelayBinding(result, { readQueue: async () => ({ ...item, value: 1n }) }, context)).to.be.rejectedWith(/binding/i);
  });
});
