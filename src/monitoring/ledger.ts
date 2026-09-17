import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import type { ActivityAlert } from "./notifier";

export type ActivityLogKey = Readonly<{ chainId: number; blockHash: Hex; transactionHash: Hex; logIndex: number }>;
export type LedgerCursor = Readonly<{ blockNumber: bigint; blockHash: Hex; logIndex: number }>;
export type OutboxEntry = Readonly<{ key: ActivityLogKey; alert: ActivityAlert }>;
export type LedgerState = { cursor?: LedgerCursor; records: Record<string, ActivityAlert>; outbox: Record<string, ActivityAlert> };
export interface ActivityStore { load(): LedgerState; save(state: LedgerState): void; close?(): void; }

export class InMemoryActivityStore implements ActivityStore {
  private state: LedgerState = { records: {}, outbox: {} };
  load(): LedgerState { return this.state; }
  save(state: LedgerState): void { this.state = state; }
}

export class FileActivityStore implements ActivityStore {
  private readonly lockPath: string;
  private lockFd: number | undefined;
  constructor(private readonly path: string) {
    this.lockPath = `${path}.lock`;
    mkdirSync(dirname(path), { recursive: true });
    try {
      this.lockFd = openSync(this.lockPath, "wx");
      writeFileSync(this.lockFd, `${process.pid}\n`, "utf8");
      fsyncSync(this.lockFd);
    } catch (error) {
      if (this.lockFd !== undefined) closeSync(this.lockFd);
      throw new Error(`monitor ledger writer lock unavailable: ${String(error)}`);
    }
  }
  load(): LedgerState {
    if (!existsSync(this.path)) return { records: {}, outbox: {} };
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as { cursor?: { blockNumber: string; blockHash: Hex; logIndex: number }; records?: Record<string, ActivityAlert>; outbox?: Record<string, ActivityAlert> };
    const records = raw.records ?? {};
    return { cursor: raw.cursor && { blockNumber: BigInt(raw.cursor.blockNumber), blockHash: raw.cursor.blockHash, logIndex: raw.cursor.logIndex }, records, outbox: raw.outbox ?? { ...records } };
  }
  save(state: LedgerState): void {
    if (this.lockFd === undefined) throw new Error("monitor ledger writer lock is closed");
    const temp = `${this.path}.${process.pid}.tmp`;
    const encoded = JSON.stringify(state, (_, value) => typeof value === "bigint" ? value.toString() : value) + "\n";
    const fd = openSync(temp, "w");
    try { writeFileSync(fd, encoded, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
    const dirFd = openSync(dirname(this.path), "r");
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  }
  close(): void {
    if (this.lockFd === undefined) return;
    closeSync(this.lockFd);
    this.lockFd = undefined;
    unlinkSync(this.lockPath);
  }
}

const id = (key: ActivityLogKey): string => `${key.chainId}:${key.transactionHash.toLowerCase()}:${key.logIndex}:${key.blockHash.toLowerCase()}`;

export class ActivityLedger {
  private state: LedgerState;
  constructor(private readonly store: ActivityStore) { this.state = store.load(); }
  cursor(): LedgerCursor | undefined { return this.state.cursor; }
  accept(key: ActivityLogKey, alert: ActivityAlert): boolean {
    const recordId = id(key);
    if (this.state.records[recordId]) return false;
    this.state.records[recordId] = alert;
    this.state.outbox[recordId] = alert;
    const cursor = this.state.cursor;
    if (!cursor || alert.blockNumber > cursor.blockNumber || (alert.blockNumber === cursor.blockNumber && key.logIndex > cursor.logIndex)) this.state.cursor = { blockNumber: alert.blockNumber, blockHash: key.blockHash, logIndex: key.logIndex };
    this.store.save(this.state);
    return true;
  }
  pending(): readonly OutboxEntry[] {
    return Object.entries(this.state.outbox).map(([recordId, alert]) => {
      const [chainId, transactionHash, logIndex, blockHash] = recordId.split(":");
      return { key: { chainId: Number(chainId), transactionHash: transactionHash as Hex, logIndex: Number(logIndex), blockHash: blockHash as Hex }, alert };
    });
  }
  markDelivered(key: ActivityLogKey): void { const recordId = id(key); if (this.state.outbox[recordId]) { delete this.state.outbox[recordId]; this.store.save(this.state); } }
  private rewindCursor(): void { let next: LedgerCursor | undefined; for (const [recordId, alert] of Object.entries(this.state.records)) { const parts = recordId.split(":"); const candidate = { blockNumber: alert.blockNumber, blockHash: parts[parts.length - 1] as Hex, logIndex: Number(parts[2]) }; if (!next || candidate.blockNumber > next.blockNumber || (candidate.blockNumber === next.blockNumber && candidate.logIndex > next.logIndex)) next = candidate; } this.state.cursor = next; }
  remove(key: ActivityLogKey): ActivityAlert | undefined { const recordId = id(key); const previous = this.state.records[recordId]; if (!previous) return undefined; delete this.state.records[recordId]; delete this.state.outbox[recordId]; this.rewindCursor(); this.store.save(this.state); return previous; }
  reconcileCanonical(chainId: number, canonical: (block: number) => Hex | undefined): number { let removed = 0; for (const [recordId, alert] of Object.entries(this.state.records)) { if (alert.chainId !== chainId) continue; const hash = canonical(Number(alert.blockNumber)); if (hash && hash.toLowerCase() !== recordId.slice(recordId.lastIndexOf(":") + 1).toLowerCase()) { delete this.state.records[recordId]; delete this.state.outbox[recordId]; removed++; } } if (removed) { this.rewindCursor(); this.store.save(this.state); } return removed; }
  records(): readonly ActivityAlert[] { return Object.values(this.state.records); }
}
