import { decodeEventLog, getAddress, parseAbi, type Address, type Hex } from "viem";
import type { ActivityAlert } from "./notifier";

export const guardEventAbi = parseAbi([
  "event TransferAuthorized(uint8 tier,address token,address recipient,uint256 amount,uint256 baseSpent,uint256 instantSpent,uint256 window)",
  "event AuthorizationUsed(uint8 tier,address token,address recipient,uint256 amount,uint256 baseSpent,uint256 instantSpent,uint256 window)",
  "event SpendingUpdated(address token,uint256 baseSpent,uint256 instantSpent,uint256 window)",
]);

export type MonitoringIdentity = Readonly<{ chainId: number; safe: Address; guard: Address; delay: Address; confirmations: number }>;
export type MonitorLog = Readonly<{ address: Address; chainId?: number; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number; topics: readonly Hex[]; data: Hex; removed?: boolean }>;
export type GuardBinding = Readonly<{ expectedSafe?: Address; expectedTransaction?: Readonly<{ to: Address; value: bigint; data: Hex; operation: number }>; readTransaction?: (hash: Hex) => Promise<Readonly<{ to: Address; value: bigint; data: Hex; operation: number }>>; readSpendState?: (token: Address) => Promise<Readonly<{ baseSpent: bigint; instantSpent: bigint; window: bigint }>> }>;

export class MonitoringDecodeError extends Error {}

function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
function identity(log: MonitorLog, expected: MonitoringIdentity): void {
  if (!same(log.address, expected.guard) || (log.chainId !== undefined && log.chainId !== expected.chainId)) throw new MonitoringDecodeError("guard event identity mismatch");
  if (log.removed) throw new MonitoringDecodeError("reorged guard event");
  if (!Number.isInteger(expected.confirmations) || expected.confirmations < 1) throw new MonitoringDecodeError("invalid confirmation depth");
}
function confirmed(log: MonitorLog, expected: MonitoringIdentity, latestBlock: bigint): boolean { return latestBlock - log.blockNumber + 1n >= BigInt(expected.confirmations); }
function equalTx(a: Readonly<{ to: Address; value: bigint; data: Hex; operation: number }>, b: Readonly<{ to: Address; value: bigint; data: Hex; operation: number }>): boolean {
  return same(a.to, b.to) && a.value === b.value && a.data.toLowerCase() === b.data.toLowerCase() && a.operation === b.operation;
}

export function decodeGuardLog(log: MonitorLog, expected: MonitoringIdentity, latestBlock: bigint, binding?: GuardBinding): ActivityAlert | undefined {
  identity(log, expected);
  if (!confirmed(log, expected, latestBlock)) return undefined;
  let decoded: { eventName: string; args: readonly unknown[] };
  try {
    decoded = decodeEventLog({ abi: guardEventAbi, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] }) as unknown as typeof decoded;
  } catch { throw new MonitoringDecodeError("malformed guard event"); }
  if (decoded.eventName === "SpendingUpdated") return undefined;
  if (decoded.eventName !== "TransferAuthorized" && decoded.eventName !== "AuthorizationUsed") return undefined;
  const values = Array.isArray(decoded.args) ? decoded.args : Object.values(decoded.args);
  const [tier, token, recipient, amount, baseSpent, instantSpent, window] = values as [number, Address, Address, bigint, bigint, bigint, bigint];
  if (Number(tier) !== 1) return undefined;
  if (binding?.expectedSafe) throw new MonitoringDecodeError("guard transaction binding missing Safe field");
  // The log is only a candidate. Callers with an RPC client must call
  // verifyGuardBinding before handing the alert to a notifier.
  return { kind: "step-up-executed", chainId: expected.chainId, safe: expected.safe, guard: expected.guard, transactionHash: log.transactionHash, blockNumber: log.blockNumber, logIndex: log.logIndex, token: getAddress(token), recipient: getAddress(recipient), amount, baseSpent, instantSpent, window };
}

export async function verifyGuardBinding(alert: ActivityAlert, binding: Required<Pick<GuardBinding, "readTransaction" | "readSpendState">> & Pick<GuardBinding, "expectedTransaction">, expected: MonitoringIdentity): Promise<ActivityAlert> {
  if (!binding.expectedTransaction || !equalTx(await binding.readTransaction(alert.transactionHash), binding.expectedTransaction)) throw new MonitoringDecodeError("guard transaction binding mismatch");
  if (alert.token && alert.baseSpent !== undefined && alert.instantSpent !== undefined && alert.window !== undefined) {
    const state = await binding.readSpendState(alert.token);
    if (state.baseSpent !== alert.baseSpent || state.instantSpent !== alert.instantSpent || state.window !== alert.window) throw new MonitoringDecodeError("guard spend state binding mismatch");
  }
  if (!same(alert.safe, expected.safe) || !same(alert.guard ?? "0x0", expected.guard)) throw new MonitoringDecodeError("guard binding identity mismatch");
  return alert;
}
