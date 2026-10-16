import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type JournalEntry = Readonly<{
  id: string;
  requestHash: string;
  state: "prepared" | "submitted" | "uncertain" | "confirmed" | "reverted";
  transactionHash?: string;
}>;

export type Reconciliation = Readonly<{ status: "confirmed" | "reverted"; transactionHash: string }>;

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) throw new Error(`${label} is invalid`);
}

export class SubmissionJournal {
  private readonly entries = new Map<string, JournalEntry>();
  private readonly path?: string;

  constructor(storagePath?: string) {
    if (storagePath !== undefined) {
      if (!isAbsolute(storagePath)) throw new Error("journal path must be absolute");
      const root = resolve(process.cwd());
      if (!relative(root, storagePath).startsWith("..")) throw new Error("journal must be outside the repository");
      this.path = storagePath;
      mkdirSync(dirname(storagePath), { recursive: true, mode: 0o700 });
      if (existsSync(storagePath)) this.load();
    }
  }

  prepare(id: string, requestHash: string): JournalEntry {
    assertIdentifier(id, "submission ID");
    if (!/^0x[0-9a-fA-F]{3,128}$/.test(requestHash)) throw new Error("request hash is invalid");
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("submission ID is already bound to another request");
      if (existing.state === "uncertain") throw new Error("reconcile uncertain broadcast before retry");
      return existing;
    }
    const entry = Object.freeze({ id, requestHash, state: "prepared" as const });
    this.entries.set(id, entry);
    this.persist();
    return entry;
  }

  markSubmitted(id: string, transactionHash: string): JournalEntry {
    const entry = this.require(id);
    this.assertHash(transactionHash);
    const next = Object.freeze({ ...entry, state: "submitted" as const, transactionHash });
    this.entries.set(id, next);
    this.persist();
    return next;
  }

  markUncertain(id: string): JournalEntry {
    const entry = this.require(id);
    const next = Object.freeze({ ...entry, state: "uncertain" as const });
    this.entries.set(id, next);
    this.persist();
    return next;
  }

  reconcile(id: string, result: Reconciliation): JournalEntry {
    const entry = this.require(id);
    this.assertHash(result.transactionHash);
    const next = Object.freeze({ ...entry, state: result.status, transactionHash: result.transactionHash });
    this.entries.set(id, next);
    this.persist();
    return next;
  }

  get(id: string): JournalEntry | undefined {
    return this.entries.get(id);
  }

  private require(id: string): JournalEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("unknown submission");
    return entry;
  }

  private assertHash(value: string): void {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("transaction hash is invalid");
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.path!, "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("journal is malformed");
      for (const item of parsed) {
        if (!item || typeof item !== "object") throw new Error("journal entry is malformed");
        const entry = item as JournalEntry;
        assertIdentifier(entry.id, "journal entry ID");
        if (!entry.requestHash || !entry.state) throw new Error("journal entry is incomplete");
        this.entries.set(entry.id, Object.freeze({ ...entry }));
      }
    } catch {
      throw new Error("journal could not be loaded safely");
    }
  }

  private persist(): void {
    if (!this.path) return;
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.entries.values()]), { encoding: "utf8", mode: 0o600, flag: "w" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.path);
    chmodSync(this.path, 0o600);
  }
}
