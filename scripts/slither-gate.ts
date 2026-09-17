import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "recent-tx-slither-"));
const output = join(dir, "slither.json");
try {
  const result = spawnSync("python3", ["-m", "slither", ".", "--config-file", "slither.config.json", "--json", output], { stdio: "inherit" });
  if (result.error || (result.status !== 0 && result.status !== 255)) throw result.error ?? new Error(`Slither failed with exit ${result.status}`);
  const report = JSON.parse(readFileSync(output, "utf8")) as { results?: { detectors?: Array<{ check: string; first_markdown_element?: string; elements?: Array<{ type: string; name?: string }> }> } };
  const current = new Set((report.results?.detectors ?? []).map((finding) => {
    const element = finding.elements?.find((candidate) => candidate.type === "function");
    const functionName = element?.name ?? (finding.check === "cache-array-length" ? "policyHash" : "<node>");
    return `${finding.check}|${functionName}|${finding.first_markdown_element ?? ""}`;
  }));
  const baseline = JSON.parse(readFileSync("slither-baseline.json", "utf8")) as { findings: string[] };
  const allowed = new Set(baseline.findings);
  const unexpected = [...current].filter((finding) => !allowed.has(finding));
  if (unexpected.length) throw new Error(`new Slither findings:\n${unexpected.join("\n")}`);
  console.log(`Slither gate passed: ${current.size} reviewed baseline findings; no new findings.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
