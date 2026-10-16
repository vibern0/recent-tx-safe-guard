import { describe, expect, it } from "vitest";
import { describeProvisioningError } from "./provisioning-errors";

describe("describeProvisioningError", () => {
  it("turns the missing RPC failure into an actionable setup message", () => {
    expect(describeProvisioningError(new Error("Set VITE_SEPOLIA_RPC_URL before provisioning the demo vault"))).toContain("VITE_SEPOLIA_RPC_URL");
  });

  it("turns an unreachable bridge failure into an actionable setup message", () => {
    expect(describeProvisioningError(new TypeError("Failed to fetch"))).toContain("127.0.0.1:8787");
  });
});
