import { describe, expect, it } from "vitest";
import { loadBackendConfig } from "../src/config";

const valid = {
  BACKEND_RELAY_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  BACKEND_RPC_URL: "https://sepolia.example.invalid",
  BACKEND_JOURNAL_PATH: "/tmp/recent-tx-safe-guard/backend-journal.json",
  BACKEND_REVIEWED_ARTIFACTS: "/tmp/recent-tx-safe-guard/reviewed-artifacts.json",
  BACKEND_PROVISIONER_MODULE: "/tmp/recent-tx-safe-guard/provisioner.mjs",
};

describe("backend configuration", () => {
  it("requires every write-boundary input", () => {
    expect(loadBackendConfig(valid).reviewedArtifactsPath).toBe(valid.BACKEND_REVIEWED_ARTIFACTS);
    for (const key of Object.keys(valid)) {
      const env = { ...valid };
      delete env[key as keyof typeof env];
      expect(() => loadBackendConfig(env), key).toThrow(key);
    }
  });
});
