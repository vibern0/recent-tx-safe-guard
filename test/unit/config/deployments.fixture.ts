import { keccak256, type Address, type Hex } from "viem";
import type {
  ChainDeploymentRegistry,
  DependencyName,
  DeploymentRecord,
  DeploymentRegistry,
  ReadOnlyDeploymentClient,
  VerifiedDependency,
  VerifiedDeployments,
} from "../../../src/config/deployments";
import { DEPENDENCIES, deploymentAddressError, deploymentReleaseError, validatedDeploymentAddress } from "../../../src/config/deployment-validation";
const failClosed = (message: string): never => { throw new Error(`deployment verification failed closed: ${message}`); };

const requireAddress = (dependency: DependencyName, record: DeploymentRecord): Address => {
  const error = deploymentAddressError(dependency, record);
  if (error) failClosed(error);
  return validatedDeploymentAddress(dependency, record);
};

/** Test-only fixture resolver. Production code intentionally exposes no registry injection. */
export async function resolveDeploymentFixture(
  client: ReadOnlyDeploymentClient,
  chainId: number,
  registry: DeploymentRegistry,
): Promise<VerifiedDeployments> {
  if (chainId !== 11155111) failClosed(`unsupported chain ${chainId}`);
  const selectedChain = registry[chainId] as ChainDeploymentRegistry | undefined;
  if (!selectedChain) failClosed(`no official registry entry for chain ${chainId}`);
  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    if (!record) failClosed(`missing registry entry for ${dependency}`);
  }
  const dependencies = {} as Record<DependencyName, VerifiedDependency>;
  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    const releaseError = deploymentReleaseError(dependency, record);
    if (releaseError) failClosed(releaseError);
    const address = requireAddress(dependency, record);
    const runtimeCode = await client.getBytecode({ address });
    if (!runtimeCode || runtimeCode === "0x") failClosed(`${dependency} at ${address} has no runtime bytecode`);
    if (!record.runtimeCodeHash) failClosed(`${dependency} has no committed runtime code hash`);
    const runtimeCodeHash = keccak256(runtimeCode as Hex);
    if (runtimeCodeHash.toLowerCase() !== record.runtimeCodeHash.toLowerCase()) failClosed(`${dependency} runtime code hash mismatch`);
    dependencies[dependency] = { ...record, address, runtimeCodeHash };
  }
  return Object.freeze({ chainId, dependencies: Object.freeze(dependencies) });
}
