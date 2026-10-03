import { describe, expect, it } from "vitest";
import { formatEuro, parseEuro, euro } from "./euro";
import { classify, emptyState } from "./vault-store";

describe("euro", () => {
  it("parses without floats", () => {
    expect(parseEuro("0.1")).toBe(100000n);
    expect(parseEuro("1.234,56")).toBe(1234560000n);
    expect(parseEuro("abc")).toBeNull();
  });
  it("formats", () => {
    expect(formatEuro(euro(8600))).toBe("€8,600.00");
  });
});

describe("classify", () => {
  const s = { ...emptyState(), balance: euro(5000) };
  const to = s.recipients[0]?.address ?? "0x1111111111111111111111111111111111111111";
  it("assigns lanes", () => {
    expect(classify(s, to, euro(100)).lane).toBe("base");
    expect(classify(s, to, euro(500)).lane).toBe("step-up");
    expect(classify(s, to, euro(1500)).lane).toBe("delayed");
    expect(classify(s, "0x" + "9".repeat(40), euro(1)).lane).toBe("blocked");
    expect(classify({ ...s, frozen: true }, to, euro(1)).lane).toBe("blocked");
  });
});
