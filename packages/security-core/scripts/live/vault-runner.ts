import type { Address } from "viem";
import {
  assertSafeCreationReady,
  isReviewedVaultDeploymentPlan,
  type VaultDeploymentPlan,
  type VerifiedVaultPrerequisites,
} from "../../src/topology/build";
import type { TopologyReport } from "../../src/topology/verify";
import {
  submitLiveIntent,
  type JournalEntry,
  type LiveContext,
  type LiveIntent,
  type LiveJournal,
} from "./submission";

type PlannedStep = Readonly<{
  id: string;
  transaction: VaultDeploymentPlan["prerequisites"]["setupHelper"];
}>;

export type VaultDeploymentExecution = Readonly<{
  journal: LiveJournal;
  prerequisiteEvidence: VerifiedVaultPrerequisites;
  topology: TopologyReport;
}>;

export type VaultDeploymentExecutionContext = Readonly<{
  live: LiveContext;
  journal: LiveJournal;
  feeFor(transaction: PlannedStep["transaction"]): Promise<Readonly<{ gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>>;
  waitForReceipt(transactionHash: JournalEntry["transactionHash"]): Promise<void>;
  verifyPrerequisites(plan: VaultDeploymentPlan, stage: "before-setup" | "after-setup"): Promise<VerifiedVaultPrerequisites>;
  verifyTopology(plan: VaultDeploymentPlan, prerequisites: VerifiedVaultPrerequisites): Promise<TopologyReport>;
}>;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

async function liveIntent(plan: VaultDeploymentPlan, step: PlannedStep, context: VaultDeploymentExecutionContext): Promise<LiveIntent> {
  const fees = await context.feeFor(step.transaction);
  return Object.freeze({
    id: step.id,
    to: step.transaction.to.toLowerCase() === ZERO ? undefined : step.transaction.to,
    data: step.transaction.data,
    value: step.transaction.value,
    nonce: Number(step.transaction.nonce),
    gas: fees.gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
}

async function reconcileStep(plan: VaultDeploymentPlan, step: PlannedStep, context: VaultDeploymentExecutionContext): Promise<JournalEntry> {
  if (step.transaction.nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("fail closed: deployment nonce exceeds safe integer range");
  const intent = await liveIntent(plan, step, context);
  let entry = await submitLiveIntent(intent, context.journal, context.live);
  if (entry.status === "pending") {
    await context.waitForReceipt(entry.transactionHash);
    entry = await submitLiveIntent(intent, context.journal, context.live);
  }
  if (entry.status === "pending") throw new Error(`deployment receipt pending for ${step.id}; reconcile before continuing`);
  if (entry.status !== "success") throw new Error(`deployment transaction reverted for ${step.id}`);
  return entry;
}

/** Executes exactly the reviewed plan, with durable receipt reconciliation between every nonce. */
export async function executeVaultDeployment(plan: VaultDeploymentPlan, context: VaultDeploymentExecutionContext): Promise<VaultDeploymentExecution> {
  if (!isReviewedVaultDeploymentPlan(plan)) throw new Error("fail closed: vault deployment plan was not produced by the reviewed planner");
  const prerequisites: readonly PlannedStep[] = [
    { id: "vault-setup-helper", transaction: plan.prerequisites.setupHelper },
    { id: "vault-guard", transaction: plan.prerequisites.guard },
    { id: "vault-delay", transaction: plan.prerequisites.delay },
    { id: "vault-maintenance", transaction: plan.prerequisites.maintenance },
  ];
  for (const step of prerequisites) await reconcileStep(plan, step, context);

  const beforeSetup = await context.verifyPrerequisites(plan, "before-setup");
  assertSafeCreationReady(plan, beforeSetup, BigInt(await context.live.nonce()));
  await reconcileStep(plan, { id: "vault-safe", transaction: plan.safeProxyDeployment }, context);

  const afterSetup = await context.verifyPrerequisites(plan, "after-setup");
  const topology = await context.verifyTopology(plan, afterSetup);
  if (!topology.ok) throw new Error(`fail closed: deployed topology verification failed: ${topology.failures.join(", ")}`);
  return Object.freeze({ journal: context.journal, prerequisiteEvidence: afterSetup, topology });
}
