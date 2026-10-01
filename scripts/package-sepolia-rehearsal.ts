import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDeploymentPlan, sha256, type PublicDeploymentConfig } from "./plan-deployment";

const FORBIDDEN_KEY = /(?:signature|signatures|privateKey|private_key|secret|seed|mnemonic|rpcUrl|rpc_url|pin|recovery)/i;
const FORBIDDEN_VALUE = /(?:https?:\/\/|wss?:\/\/|PRIVATE KEY|MNEMONIC|BURNER PIN|broadcast this|cast send|safe-cli|recovery owner)/i;

type PackageResult = Readonly<{
  outputDir: string;
  files: readonly string[];
  packageHash: `0x${string}`;
}>;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function assertPublicArtifact(value: unknown, path = "artifact"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicArtifact(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) throw new Error(`${path} contains forbidden private or broadcast material`);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}.${key} is forbidden in public rehearsal packages`);
    if (key === "broadcast" && child !== false) throw new Error(`${path}.broadcast must be false`);
    assertPublicArtifact(child, `${path}.${key}`);
  }
}

function writeArtifact(outputDir: string, name: string, value: unknown): string {
  assertPublicArtifact(value, name);
  const path = join(outputDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function prepareEmptyOutputDirectory(outputDir: string): void {
  if (existsSync(outputDir) && readdirSync(outputDir).length !== 0) {
    throw new Error("output directory must be empty before creating a public rehearsal package");
  }
  mkdirSync(outputDir, { recursive: true });
}

export function buildSepoliaRehearsalPackage(configPath: string, outputDir: string): PackageResult {
  const config = readJson(configPath) as PublicDeploymentConfig;
  const plan = buildDeploymentPlan(config);
  prepareEmptyOutputDirectory(outputDir);

  const decodedReview = {
    formatVersion: 1,
    network: plan.network,
    chainId: plan.chainId,
    safe: plan.deployments.safe,
    safeOwners: [plan.deployments.passkey, plan.deployments.yubiKey, plan.deployments.burner].sort(),
    threshold: 1,
    fallbackHandler: `0x${"0".repeat(40)}`,
    guards: { transactionGuard: plan.deployments.guard, moduleGuard: plan.deployments.guard },
    onlySafeModule: plan.deployments.delay,
    delay: plan.deployments.delay,
    setupCallReview: plan.setupCalls.map((call, index) => ({
      index,
      description: call.description,
      to: call.to,
      value: call.value,
      dataHash: sha256(call.data),
    })),
    requiredHumanGates: ["review unsigned plan", "collect live Sepolia evidence", "run read-only verifier before funding"],
    liveSepoliaRehearsal: "outstanding",
  };

  const publicManifest = {
    formatVersion: 1,
    status: "EXAMPLE_NOT_DEPLOYED",
    network: plan.network,
    chainId: plan.chainId,
    deployments: plan.deployments,
    dependencies: plan.dependencies,
    policyHash: plan.policyHash,
    expectedCounters: plan.expectedCounters,
    setupTransactionHashes: plan.setupTransactionHashes,
    queueFingerprints: plan.queueFingerprints,
    sourceConfigHash: sha256(config),
    unsignedPlanHash: sha256(plan),
    decodedReviewHash: sha256(decodedReview),
    packageScope: "public unsigned Sepolia rehearsal artifacts only",
    liveSepoliaRehearsal: "outstanding until separately executed with low-value test assets",
  };

  const expectedEvidenceHashes = {
    formatVersion: 1,
    policyHash: plan.policyHash,
    setupTransactionHashes: plan.setupTransactionHashes,
    queueFingerprints: plan.queueFingerprints,
    expectedCountersHash: sha256(plan.expectedCounters),
    unsignedPlanHash: sha256(plan),
    decodedReviewHash: sha256(decodedReview),
    publicManifestHash: sha256(publicManifest),
  };

  const files = [
    writeArtifact(outputDir, "unsigned-plan.json", plan),
    writeArtifact(outputDir, "decoded-review.json", decodedReview),
    writeArtifact(outputDir, "public-manifest.json", publicManifest),
    writeArtifact(outputDir, "expected-evidence-hashes.json", expectedEvidenceHashes),
  ];

  return { outputDir, files, packageHash: sha256(files.map((file) => readFileSync(file, "utf8"))) };
}

function main(): void {
  const configPath = process.argv[2];
  const outputDir = process.argv[3];
  if (!configPath || !outputDir) throw new Error("usage: npm run package:sepolia-rehearsal -- <public-config> <output-dir>");
  const result = buildSepoliaRehearsalPackage(configPath, outputDir);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();
