import { expect } from "chai";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import {
  buildCancellationTransaction,
  buildExecutionTransaction,
  buildQueueTransaction,
  queueFingerprint,
  readQueueItem,
  type DelayQueueItem,
} from "../../../src/queue/delay";

const SAFE = getAddress("0x0000000000000000000000000000000000000001");
const DELAY = getAddress("0x0000000000000000000000000000000000000002");
const TOKEN = getAddress("0x0000000000000000000000000000000000000003");
const RECIPIENT = getAddress("0x0000000000000000000000000000000000000004");
const transferAbi = parseAbi(["function transfer(address,uint256)"]);

describe("Delay transaction builders", () => {
  const item: DelayQueueItem = {
    safe: SAFE,
    delay: DELAY,
    to: TOKEN,
    value: 0n,
    data: encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [RECIPIENT, 42n] }),
    operation: 0,
    queueNonce: 7n,
  };

  it("builds the exact single-tuple queue call and stable fingerprint", () => {
    const tx = buildQueueTransaction(item);
    const decoded = decodeFunctionData({ abi: parseAbi(["function execTransactionFromModule(address,uint256,bytes,uint8)"]), data: tx.data });
    expect(decoded.functionName).to.equal("execTransactionFromModule");
    expect(decoded.args).to.deep.equal([item.to, item.value, item.data, item.operation]);
    expect(queueFingerprint(item)).to.equal(queueFingerprint({ ...item, data: item.data.toLowerCase() as Hex }));
  });

  it("builds cancellation, execution, and read calls without widening the tuple", () => {
    expect(buildCancellationTransaction(DELAY, 7n).data).to.match(/^0x/);
    expect(buildExecutionTransaction(item).to).to.equal(DELAY);
    const call = readQueueItem(DELAY, 7n);
    expect(call.to).to.equal(DELAY);
    expect(call.data.length).to.equal(2 + 8 + 64);
  });
});
