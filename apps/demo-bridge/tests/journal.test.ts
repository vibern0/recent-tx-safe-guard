import { describe, expect, it } from "vitest";
import { SubmissionJournal } from "../src/journal";

describe("submission journal", () => {
  it("deduplicates requests and reconciles uncertain broadcasts before retry", () => {
    const journal = new SubmissionJournal();
    const first = journal.prepare("request-1", "0xaaa");
    const duplicate = journal.prepare("request-1", "0xaaa");
    expect(duplicate).toEqual(first);
    journal.markUncertain("request-1");
    expect(() => journal.prepare("request-1", "0xaaa")).toThrow(/reconcile/i);
    const transactionHash = `0x${"bb".repeat(32)}`;
    journal.reconcile("request-1", { status: "confirmed", transactionHash });
    expect(journal.get("request-1")).toMatchObject({ state: "confirmed", transactionHash });
  });
});
