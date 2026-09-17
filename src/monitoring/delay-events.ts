import { decodeEventLog, getAddress, parseAbi, type Address, type Hex } from "viem";
import { queueFingerprint } from "../queue/delay";
import type { ActivityAlert } from "./notifier";
import { MonitoringDecodeError, type MonitorLog } from "./guard-events";

export const delayEventAbi = parseAbi([
  "event TransactionAdded(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)",
  "event TransactionExecuted(uint256 indexed queueNonce,bytes32 indexed txHash,address to,uint256 value,bytes data,uint8 operation)",
  "event TransactionCancelled(uint256 indexed queueNonce,bytes32 indexed txHash)",
  "event TransactionExpired(uint256 indexed queueNonce,bytes32 indexed txHash)",
  "event TxNonceSet(uint256 nonce)",
  "event Frozen(address indexed actor)",
  "event RepairQueued(uint256 indexed queueNonce,bytes32 indexed txHash,bytes4 selector)",
]);

export type DelayMonitoringContext = Readonly<{ chainId: number; safe: Address; delay: Address; confirmations: number; cooldownSeconds: bigint; expirationSeconds: bigint }>;
export type QueueBinding = Readonly<{ readQueue?: (queueNonce: bigint) => Promise<Readonly<{ txHash: Hex; createdAt: bigint; to?: Address; value?: bigint; data?: Hex; operation?: number }>> }>;

function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
function check(log: MonitorLog, context: DelayMonitoringContext): void {
  if (!same(log.address, context.delay) || (log.chainId !== undefined && log.chainId !== context.chainId)) throw new MonitoringDecodeError("Delay event identity mismatch");
  if (log.removed) throw new MonitoringDecodeError("reorged Delay event");
  if (!Number.isInteger(context.confirmations) || context.confirmations < 1) throw new MonitoringDecodeError("invalid confirmation depth");
}

export function decodeDelayLog(log: MonitorLog, context: DelayMonitoringContext, latestBlock: bigint, observedAt: bigint, createdAt?: bigint, binding?: QueueBinding): ActivityAlert {
  check(log, context);
  if (latestBlock - log.blockNumber + 1n < BigInt(context.confirmations)) throw new MonitoringDecodeError("unconfirmed Delay event");
  let decoded: { eventName: string; args: readonly unknown[] };
  try { decoded = decodeEventLog({ abi: delayEventAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] }) as unknown as typeof decoded; } catch { throw new MonitoringDecodeError("malformed Delay event"); }
  const values = Array.isArray(decoded.args) ? decoded.args : Object.values(decoded.args);
  const [first] = values;
  if (decoded.eventName === "TransactionAdded" || decoded.eventName === "TransactionExecuted") {
    const [queueNonce, txHash, to, value, data, operation] = values as [bigint, Hex, Address, bigint, Hex, number];
    if (same(to, context.delay)) throw new MonitoringDecodeError("Delay queue target binding mismatch");
    const created = createdAt ?? observedAt;
    const item = { safe: context.safe, delay: context.delay, to: getAddress(to), value, data, operation: operation as 0 | 1, queueNonce };
    const common = { chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, queueNonce, queueFingerprint: queueFingerprint(item), createdAt: created, expiresAt: context.expirationSeconds === 0n ? undefined : created + context.cooldownSeconds + context.expirationSeconds };
    if (context.expirationSeconds !== 0n && observedAt > created + context.cooldownSeconds + context.expirationSeconds) return { ...common, kind: "delayed-expired" };
    return { ...common, kind: decoded.eventName === "TransactionAdded" ? "delayed-queued" : "delayed-executed" };
  }
  if (decoded.eventName === "TransactionCancelled") {
    const [queueNonce] = values as [bigint, Hex];
    return { kind: "delayed-cancelled", chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, queueNonce };
  }
  if (decoded.eventName === "TransactionExpired") {
    const [queueNonce] = values as [bigint, Hex];
    return { kind: "delayed-expired", chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, queueNonce };
  }
  if (decoded.eventName === "TxNonceSet") return { kind: "delayed-cancelled", chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, cancelledThrough: first as bigint };
  if (decoded.eventName === "Frozen") return { kind: "delayed-frozen", chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex };
  if (decoded.eventName === "RepairQueued") return { kind: "delayed-repair", chainId: context.chainId, safe: context.safe, delay: context.delay, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, queueNonce: first as bigint, repairSelector: values[2] as Hex };
  throw new MonitoringDecodeError("unknown Delay event");
}

export async function verifyDelayBinding(alert: ActivityAlert, binding: Required<Pick<QueueBinding, "readQueue">>, context: DelayMonitoringContext): Promise<ActivityAlert> {
  if (alert.queueNonce === undefined || !alert.queueFingerprint) return alert;
  const item = await binding.readQueue(alert.queueNonce);
  const tupleMatches = item.to === undefined || item.value === undefined || item.data === undefined || item.operation === undefined || same(queueFingerprint({ safe: context.safe, delay: context.delay, to: item.to, value: item.value, data: item.data, operation: item.operation as 0 | 1, queueNonce: alert.queueNonce }), alert.queueFingerprint);
  if (!same(item.txHash, alert.queueFingerprint) || !tupleMatches || item.createdAt !== alert.createdAt) throw new MonitoringDecodeError("Delay queue binding mismatch");
  return alert;
}
