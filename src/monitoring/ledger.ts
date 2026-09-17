import type { Hex } from "viem";
import type { ActivityAlert } from "./notifier";

export type ActivityLogKey = Readonly<{ chainId: number; blockHash: Hex; transactionHash: Hex; logIndex: number }>;
type LedgerState = { cursor?: Readonly<{ blockNumber: bigint; blockHash: Hex; logIndex: number }>; records: Record<string, ActivityAlert> };

export interface ActivityStore { load(): LedgerState; save(state: LedgerState): void; }

export class InMemoryActivityStore implements ActivityStore {
  private state: LedgerState = { records: {} };
  load(): LedgerState { return this.state; }
  save(state: LedgerState): void { this.state = state; }
}

function id(key: ActivityLogKey): string { return `${key.chainId}:${key.transactionHash.toLowerCase()}:${key.logIndex}:${key.blockHash.toLowerCase()}`; }

export class ActivityLedger {
  private state: LedgerState;
  constructor(private readonly store: ActivityStore) { this.state = store.load(); }

  accept(key: ActivityLogKey, alert: ActivityAlert): boolean {
    const recordId = id(key);
    if (this.state.records[recordId]) return false;
    this.state.records[recordId] = alert;
    const cursor = this.state.cursor;
    if (!cursor || alert.blockNumber > cursor.blockNumber || (alert.blockNumber === cursor.blockNumber && key.logIndex > cursor.logIndex)) {
      this.state.cursor = { blockNumber: alert.blockNumber, blockHash: key.blockHash, logIndex: key.logIndex };
    }
    this.store.save(this.state);
    return true;
  }

  remove(key: ActivityLogKey): ActivityAlert | undefined {
    const recordId = id(key);
    const previous = this.state.records[recordId];
    if (!previous) return undefined;
    delete this.state.records[recordId];
    this.store.save(this.state);
    return previous;
  }

  records(): readonly ActivityAlert[] { return Object.values(this.state.records); }
}
