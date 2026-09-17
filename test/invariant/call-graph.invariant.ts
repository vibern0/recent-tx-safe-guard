import { expect } from "chai";
import { readFileSync } from "node:fs";
import hre from "hardhat";

describe("call-graph security invariant", () => {
  const source = readFileSync("contracts/TieredSpendingGuard.sol", "utf8");
  const graph = readFileSync("docs/security/call-graph.md", "utf8");

  it("keeps the static inventory honest about its limitation", () => {
    for (const surface of ["checkTransaction", "checkAfterExecution", "checkModuleTransaction", "checkAfterModuleExecution", "setAssetPolicy", "repairSigner", "repairPolicy", "freeze"]) {
      expect(source, surface).to.contain(`function ${surface}`);
      expect(graph, surface).to.contain(surface);
    }
    for (const threat of ["Direct owner transfers", "unlisted modules", "fallback handler", "approved-hash", "batches", "delegatecalls", "Approvals", "Monitoring and relaying"]) {
      expect(graph.toLowerCase(), threat).to.contain(threat.toLowerCase());
    }
  });

  it("checks the deployed public/state surface and Safe-only entry points", async () => {
    const artifact = await hre.artifacts.readArtifact("TieredSpendingGuard");
    const functions = artifact.abi.filter((item): item is { type: "function"; name: string } => item.type === "function").map((item) => item.name);
    for (const name of ["checkTransaction", "checkAfterExecution", "checkModuleTransaction", "checkAfterModuleExecution", "setAssetPolicy", "repairSigner", "repairPolicy", "freeze", "config", "assetPolicy", "spendState", "frozen"]) expect(functions).to.include(name);
    expect(functions).not.to.include.members(["withdraw", "transfer", "execute", "send"]);
    const maintenance = await hre.artifacts.readArtifact("GuardReplacementMaintenance");
    expect(maintenance.abi.filter((item) => item.type === "function").map((item) => item.type === "function" ? item.name : "")).to.include.members(["replaceGuards", "replaceSigner", "safe", "delay"]);
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
