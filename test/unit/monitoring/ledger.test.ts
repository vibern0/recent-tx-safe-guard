import { expect } from "chai";
import { getAddress } from "viem";
import { ActivityLedger, FileActivityStore, InMemoryActivityStore, type ActivityLogKey } from "../../../src/monitoring/ledger";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ActivityAlert } from "../../../src/monitoring/notifier";

const alert: ActivityAlert = {
  kind: "delayed-queued",
  chainId: 31337,
  safe: getAddress("0x0000000000000000000000000000000000000001"),
  delay: getAddress("0x0000000000000000000000000000000000000002"),
  transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
  blockNumber: 5n,
  logIndex: 0,
};
const key = (blockHash: string): ActivityLogKey => ({ chainId: 31337, blockHash: blockHash as `0x${string}`, transactionHash: alert.transactionHash, logIndex: 0 });

describe("monitoring ledger", () => {
  it("persists a cursor and emits each confirmed log once", () => {
    const store = new InMemoryActivityStore();
    const ledger = new ActivityLedger(store);
    expect(ledger.accept(key("0x0000000000000000000000000000000000000000000000000000000000000005"), alert)).to.equal(true);
    expect(ledger.accept(key("0x0000000000000000000000000000000000000000000000000000000000000005"), alert)).to.equal(false);
    expect(store.load().cursor?.blockNumber).to.equal(5n);
    const restarted = new ActivityLedger(store);
    expect(restarted.accept(key("0x0000000000000000000000000000000000000000000000000000000000000005"), alert)).to.equal(false);
  });

  it("removes a reorged record and permits the replacement log", () => {
    const store = new InMemoryActivityStore();
    const ledger = new ActivityLedger(store);
    const oldKey = key("0x0000000000000000000000000000000000000000000000000000000000000005");
    const newKey = key("0x0000000000000000000000000000000000000000000000000000000000000006");
    ledger.accept(oldKey, alert);
    expect(ledger.remove(oldKey)).to.deep.equal(alert);
    expect(ledger.accept(newKey, { ...alert, blockNumber: 6n })).to.equal(true);
  });

  it("atomically persists and reloads cursor and records across process restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "vault-monitor-"));
    try {
      const store = new FileActivityStore(join(dir, "ledger.json"));
      const ledger = new ActivityLedger(store);
      ledger.accept(key("0x0000000000000000000000000000000000000000000000000000000000000005"), alert);
      const restarted = new ActivityLedger(new FileActivityStore(join(dir, "ledger.json")));
      expect(restarted.records()).to.have.length(1);
      expect(restarted.cursor()?.blockHash).to.equal("0x0000000000000000000000000000000000000000000000000000000000000005");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("reconciles records against canonical block hashes before replay", () => {
    const store = new InMemoryActivityStore();
    const ledger = new ActivityLedger(store);
    const old = key("0x0000000000000000000000000000000000000000000000000000000000000005");
    ledger.accept(old, alert);
    expect(ledger.reconcileCanonical(31337, () => "0x0000000000000000000000000000000000000000000000000000000000000006")).to.equal(1);
    expect(ledger.records()).to.have.length(0);
  });
});
