import { isAddress, keccak256, type Address, type Hex } from "viem";
import type {
  ChainDeploymentRegistry,
  DependencyName,
  DeploymentRecord,
  DeploymentRegistry,
  ReadOnlyDeploymentClient,
  VerifiedDependency,
  VerifiedDeployments,
  SupportedChainId,
} from "../../../src/config/deployments";

const EXPECTED_RELEASES: Record<DependencyName, readonly string[]> = {
  safeSingleton: ["1.5.0"], safeProxyFactory: ["1.5.0"], passkeySignerFactory: ["0.2.0"],
  passkeySignerVerifier: ["0.2.0"], multiSend: ["1.5.0"], delay: ["1.1.1"],
};
const VULNERABLE_DELAY_RELEASES = new Set(["1.1.0"]);
const DEPENDENCIES = Object.keys(EXPECTED_RELEASES) as DependencyName[];
const failClosed = (message: string): never => { throw new Error(`deployment verification failed closed: ${message}`); };

const requireAddress = (dependency: DependencyName, record: DeploymentRecord): Address => {
  if (!record.address) failClosed(`${dependency} has no official deployment address`);
  if (!isAddress(record.address)) failClosed(`${dependency} has invalid address`);
  if (record.address.toLowerCase() === "0x0000000000000000000000000000000000000000") failClosed(`${dependency} has zero address`);
  return record.address;
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
    if (dependency === "delay" && VULNERABLE_DELAY_RELEASES.has(record.version)) failClosed(`known-vulnerable Delay release ${record.version}`);
    if (!EXPECTED_RELEASES[dependency].includes(record.version)) failClosed(`unknown release ${record.version} for ${dependency}`);
    if (dependency === "safeSingleton" && record.supportsModuleGuards !== true) failClosed(`Safe release ${record.version} lacks module guards`);
    const address = requireAddress(dependency, record);
    const runtimeCode = await client.getBytecode({ address });
    if (!runtimeCode || runtimeCode === "0x") failClosed(`${dependency} at ${address} has no runtime bytecode`);
    if (!record.runtimeCodeHash) failClosed(`${dependency} has no committed runtime code hash`);
    const runtimeCodeHash = keccak256(runtimeCode as Hex);
    if (runtimeCodeHash.toLowerCase() !== record.runtimeCodeHash.toLowerCase()) failClosed(`${dependency} runtime code hash mismatch`);
    dependencies[dependency] = { ...record, address, runtimeCodeHash };
  }
  return { chainId, dependencies };
}
