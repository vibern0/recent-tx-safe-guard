import type { DeploymentRegistry, ReadOnlyDeploymentClient, VerifiedDeployments } from "../../../src/config/deployments";
import { resolveDeploymentRegistry } from "../../../src/config/deployments";

/** Test-only fixture resolver. Production code intentionally exposes no registry injection. */
export async function resolveDeploymentFixture(
  client: ReadOnlyDeploymentClient,
  chainId: number,
  registry: DeploymentRegistry,
): Promise<VerifiedDeployments> {
  return resolveDeploymentRegistry(client, chainId, registry, { requireEvidence: false, markOfficial: false });
}
