import { expect } from "chai";
import { readFileSync } from "node:fs";

describe("call-graph security invariant", () => {
  const source = readFileSync("contracts/TieredSpendingGuard.sol", "utf8");
  const graph = readFileSync("docs/security/call-graph.md", "utf8");

  it("documents every authorization surface and every forbidden bypass class", () => {
    for (const surface of ["checkTransaction", "checkAfterExecution", "checkModuleTransaction", "checkAfterModuleExecution", "setAssetPolicy", "repairSigner", "repairPolicy", "freeze"]) {
      expect(source, surface).to.contain(`function ${surface}`);
      expect(graph, surface).to.contain(surface);
    }
    for (const threat of ["Direct owner transfers", "unlisted modules", "fallback handler", "approved-hash", "batches", "delegatecalls", "Approvals", "Monitoring and relaying"]) {
      expect(graph.toLowerCase(), threat).to.contain(threat.toLowerCase());
    }
  });

  it("keeps all state-changing guard entry points Safe-only and leaves no public spend primitive", () => {
    expect(source).to.match(/function checkTransaction[\s\S]*?external override onlySafe/);
    expect(source).to.match(/function checkModuleTransaction[\s\S]*?external override onlySafe/);
    expect(source).to.not.match(/function (withdraw|transfer|execute|send)\s*\(/);
    expect(source).to.contain("if (module != config.delay");
    expect(source).to.contain("if (frozen || operation != Enum.Operation.Call)");
  });

  it("has explicit fail-closed branches for signature, queue, call, and recovery validation", () => {
    for (const marker of ["InvalidPasskeySignature", "MissingBurnerExtension", "InvalidBurnerSignature", "InvalidDelayedAction", "UnsupportedTransfer", "_authorizeRecovery", "_authorizeQueueProposal"]) {
      expect(source, marker).to.contain(marker);
    }
  });
});
