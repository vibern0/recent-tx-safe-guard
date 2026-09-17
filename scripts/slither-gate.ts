import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateSlitherReport, type SlitherReport } from "../src/security/slither-gate";

const dir = mkdtempSync(join(tmpdir(), "recent-tx-slither-"));
const output = join(dir, "slither.json");
try {
  const result = spawnSync("python3", ["-m", "slither", ".", "--config-file", "slither.config.json", "--json", output], { stdio: "inherit" });
  if (result.error) throw result.error;
  // Slither uses 255 when findings are present; the JSON report remains the
  // source of truth, while any other exit status is a tool failure.
  if (result.status !== 0 && result.status !== 255) throw new Error(`Slither failed with exit ${result.status}`);
  const report = JSON.parse(readFileSync(output, "utf8")) as SlitherReport;
  const baseline = JSON.parse(readFileSync("slither-baseline.json", "utf8")) as { findings?: unknown };
  if (!Array.isArray(baseline.findings) || baseline.findings.some((finding) => typeof finding !== "string")) throw new Error("malformed Slither baseline");
  const current = validateSlitherReport(report, baseline.findings);
  console.log(`Slither gate passed: ${current.length} reviewed baseline findings; no new findings.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
