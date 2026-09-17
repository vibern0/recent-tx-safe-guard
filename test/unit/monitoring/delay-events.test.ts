import { expect } from "chai";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, parseAbiItem, toHex } from "viem";
import {
  decodeDelayLog,
  delayEventAbi,
  verifyDelayBinding,
  type DelayMonitoringContext,
} from "../../../src/monitoring/delay-events";
import { queueFingerprint } from "../../../src/queue/delay";

const context: DelayMonitoringContext = {
  chainId: 31337,
  safe: getAddress("0x0000000000000000000000000000000000000001"),
  delay: getAddress("0x0000000000000000000000000000000000000003"),
  confirmations: 1,
  cooldownSeconds: 10n,
  expirationSeconds: 60n,
};

function log(eventName: "TransactionAdded" | "TxNonceSet", args: readonly unknown[], overrides = {}) {
  const item = parseAbiItem(eventName === "TransactionAdded"
    ? "event TransactionAdded(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)"
    : "event TxNonceSet(uint256 nonce)");
  const indexed = eventName === "TransactionAdded" ? 2 : 0;
  const types = eventName === "TransactionAdded"
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
  const item = { txHash: queueFingerprint({ safe: context.safe, delay: context.delay, to: context.safe, value: 0n, data: "0x", operation: 0, queueNonce: 4n }), createdAt: 100n, to: context.safe, value: 0n, data: "0x" as const, operation: 0 };
  const binding = { readQueue: async () => item, readNonce: async () => 5n };

  it("decodes a confirmed queue item with the recomputed Zodiac hash", async () => {
    const result = await decodeDelayLog(log("TransactionAdded", [4n, item.txHash, context.safe, 0n, "0x", 0]), context, 21n, 100n, binding);
    expect(result.kind).to.equal("delayed-queued");
    expect(result.queueNonce).to.equal(4n);
    expect(result.queueFingerprint).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a fabricated indexed hash and unsupported lifecycle event", async () => {
    await expect(decodeDelayLog(log("TransactionAdded", [4n, keccak256(toHex("hash")), context.safe, 0n, "0x", 0]), context, 21n, 100n, binding)).to.be.rejectedWith(/hash/i);
  });

  it("fails closed on a wrong Delay, malformed log, and unbound queue target", async () => {
    await expect(decodeDelayLog(log("TxNonceSet", [5n], { address: context.safe }), context, 21n, 100n, binding)).to.be.rejectedWith(/identity/i);
    await expect(decodeDelayLog({ ...log("TxNonceSet", [5n]), data: "0x12" }, context, 21n, 100n, binding)).to.be.rejectedWith(/malformed/i);
    await expect(decodeDelayLog(log("TransactionAdded", [4n, item.txHash, context.delay, 0n, "0x", 0]), context, 21n, 100n, binding)).to.be.rejectedWith(/binding/i);
  });

  it("requires queue hash and tuple revalidation before a lifecycle alert", async () => {
    const result = await decodeDelayLog(log("TransactionAdded", [4n, item.txHash, context.safe, 0n, "0x", 0]), context, 21n, 100n, binding);
    await expect(verifyDelayBinding(result, binding, context)).to.be.fulfilled;
    await expect(verifyDelayBinding(result, { readQueue: async () => ({ ...item, value: 1n }), readNonce: binding.readNonce }, context)).to.be.rejectedWith(/binding/i);
  });

  it("uses the queue tuple and nonce as they existed at the event block", async () => {
    const readBlocks: bigint[] = [];
    const eventBinding = { readQueue: async (_nonce: bigint, blockNumber?: bigint) => { readBlocks.push(blockNumber!); return item; }, readNonce: async (blockNumber?: bigint) => { readBlocks.push(blockNumber!); return 5n; } };
    await decodeDelayLog(log("TransactionAdded", [4n, item.txHash, context.safe, 0n, "0x", 0]), context, 100n, 100n, eventBinding as never);
    expect(readBlocks).to.deep.equal([20n]);
  });

  it("does not accept an event ABI that is not emitted by the pinned Delay fixture", async () => {
    const item2 = parseAbiItem("event TransactionExecuted(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)");
    const encoded = encodeEventTopics({ abi: [item2], eventName: "TransactionExecuted", args: [4n, item.txHash, context.safe, 0n, "0x", 0] as never });
    await expect(decodeDelayLog({ ...log("TxNonceSet", [5n]), topics: encoded, data: "0x" } as never, context, 21n, 100n, binding)).to.be.rejectedWith(/malformed|unsupported/i);
  });
});
