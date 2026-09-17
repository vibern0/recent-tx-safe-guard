import { isAddress, keccak256, type Address, type Hex } from "viem";

export const SUPPORTED_CHAIN_IDS = [11155111] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export type DependencyName =
  | "safeSingleton"
  | "safeProxyFactory"
  | "passkeySignerFactory"
  | "passkeySignerVerifier"
  | "multiSend"
  | "guard"
  | "delay";

export type DeploymentRecord = {
  name: string;
  version: string;
  address?: Address;
  runtimeCodeHash?: Hex;
  supportsModuleGuards?: boolean;
  evidence?: "verified" | "absent";
  source: string;
};

export type ChainDeploymentRegistry = Record<DependencyName, DeploymentRecord>;
export type DeploymentRegistry = Partial<Record<number, ChainDeploymentRegistry>>;

export type ReadOnlyDeploymentClient = {
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
};

export type VerifiedDependency = DeploymentRecord & {
  address: Address;
  runtimeCodeHash: Hex;
};

export type VerifiedDeployments = {
  chainId: number;
  dependencies: Record<DependencyName, VerifiedDependency>;
};

const officialResolverResults = new WeakSet<object>();

export function isOfficialVerifiedDeployments(value: unknown): value is VerifiedDeployments {
  return typeof value === "object" && value !== null && officialResolverResults.has(value);
}

/** Test fixture bridge; production callers cannot mint resolver evidence. */
export function registerVerifiedDeploymentsFixture(value: VerifiedDeployments): VerifiedDeployments {
  if (!Object.isFrozen(value) || !Object.isFrozen(value.dependencies)) throw new Error("fixture deployments must be frozen");
  officialResolverResults.add(value);
  return value;
}

const SAFE_DEPLOYMENTS = "https://github.com/safe-global/safe-deployments";
const SAFE_MODULES = "https://github.com/safe-global/safe-modules";
const ZODIAC = "https://github.com/gnosisguild/zodiac";

// This is deliberately an evidence ledger, not a claim that these contracts are
// deployed on Sepolia. The official registries do not publish canonical passkey
// or Delay runtime evidence for this prototype, so those absences are explicit.
const OFFICIAL_DEPLOYMENT_REGISTRY_DATA: DeploymentRegistry = {
  11155111: {
    safeSingleton: {
      name: "Safe singleton",
      version: "1.5.0",
      address: "0xFf51A5898e281Db6DfC7855790607438dF2ca44b" as Address,
      runtimeCodeHash: "0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2" as Hex,
      supportsModuleGuards: true,
      source: SAFE_DEPLOYMENTS,
    },
    safeProxyFactory: {
      name: "Safe proxy factory",
      version: "1.5.0",
      address: "0x14F2982D601c9458F93bd70B218933A6f8165e7b" as Address,
      runtimeCodeHash: "0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529" as Hex,
      source: SAFE_DEPLOYMENTS,
    },
    passkeySignerFactory: {
      name: "Safe passkey signer factory",
      version: "0.2.0",
      evidence: "absent",
      source: SAFE_MODULES,
    },
    passkeySignerVerifier: {
      name: "Safe passkey verifier",
      version: "0.2.0",
      evidence: "absent",
      source: SAFE_MODULES,
    },
    multiSend: {
      name: "Safe MultiSend",
      version: "1.5.0",
      address: "0x218543288004CD07832472D464648173c77D7eB7" as Address,
      runtimeCodeHash: "0xca1147a12963172a93910c5cb2bfa5ad0e941c7f03fc7eb017dd06a8ea4e5604" as Hex,
      source: SAFE_DEPLOYMENTS,
    },
    guard: {
      name: "Tiered spending guard",
      version: "task7-reviewed",
      evidence: "absent",
      source: "repository-reviewed-artifact",
    },
    delay: {
      name: "Zodiac Delay",
      version: "1.1.1",
      address: "0x824175b945838d127c1ca83cbce11d8e44f6df01",
      evidence: "absent",
      source: ZODIAC,
    },
  },
};

const freezeRegistry = (registry: DeploymentRegistry): Readonly<DeploymentRegistry> => {
  for (const chain of Object.values(registry)) {
    if (!chain) continue;
    for (const record of Object.values(chain)) Object.freeze(record);
    Object.freeze(chain);
  }
  return Object.freeze(registry);
};

export const OFFICIAL_DEPLOYMENT_REGISTRY = freezeRegistry(OFFICIAL_DEPLOYMENT_REGISTRY_DATA);

const EXPECTED_RELEASES: Record<DependencyName, readonly string[]> = {
  safeSingleton: ["1.5.0"],
  safeProxyFactory: ["1.5.0"],
  passkeySignerFactory: ["0.2.0"],
  passkeySignerVerifier: ["0.2.0"],
  multiSend: ["1.5.0"],
  guard: ["task7-reviewed"],
  delay: ["1.1.1"],
};

const VULNERABLE_DELAY_RELEASES = new Set(["1.1.0"]);
const DEPENDENCIES = Object.keys(EXPECTED_RELEASES) as DependencyName[];

const failClosed = (message: string): never => {
  throw new Error(`deployment verification failed closed: ${message}`);
};

const requireAddress = (dependency: DependencyName, record: DeploymentRecord): Address => {
  const address = record.address;
  if (!address) failClosed(`${dependency} has no official deployment address`);
  if (!isAddress(address as string)) failClosed(`${dependency} has invalid address`);
  const validatedAddress = address as Address;
  if (validatedAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    failClosed(`${dependency} has zero address`);
  }
  return validatedAddress;
};

async function resolveDeploymentRegistry(
  client: ReadOnlyDeploymentClient,
  chainId: number,
  registry: DeploymentRegistry | Readonly<DeploymentRegistry>,
): Promise<VerifiedDeployments> {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)) {
    failClosed(`unsupported chain ${chainId}`);
  }

  const chain = registry[chainId];
  if (!chain) failClosed(`no official registry entry for chain ${chainId}`);
  const selectedChain = chain as ChainDeploymentRegistry;

  // Validate the complete production evidence ledger before making any RPC
  // reads, so an incomplete official registry can never look partially usable.
  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    if (!record) failClosed(`missing registry entry for ${dependency}`);
    if (record.evidence === "absent") failClosed(`${dependency} has no official deployment evidence`);
  }

  const dependencies = {} as Record<DependencyName, VerifiedDependency>;
  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    if (!record) failClosed(`missing registry entry for ${dependency}`);
    if (dependency === "delay" && VULNERABLE_DELAY_RELEASES.has(record.version)) {
      failClosed(`known-vulnerable Delay release ${record.version}`);
    }
    if (!EXPECTED_RELEASES[dependency].includes(record.version)) {
      failClosed(`unknown release ${record.version} for ${dependency}`);
    }
    if (dependency === "safeSingleton" && record.supportsModuleGuards !== true) {
      failClosed(`Safe release ${record.version} lacks module guards`);
    }

    const address = requireAddress(dependency, record);
    const runtimeCode = await client.getBytecode({ address });
    if (!runtimeCode || runtimeCode === "0x") {
      failClosed(`${dependency} at ${address} has no runtime bytecode`);
    }
    const verifiedRuntimeCode = runtimeCode as Hex;
    if (!record.runtimeCodeHash) {
      failClosed(`${dependency} has no committed runtime code hash`);
    }
    const committedRuntimeCodeHash = record.runtimeCodeHash;
    if (!committedRuntimeCodeHash) {
      failClosed(`${dependency} has no committed runtime code hash`);
    }
    const expectedRuntimeCodeHash = committedRuntimeCodeHash as Hex;
    const runtimeCodeHash = keccak256(verifiedRuntimeCode);
    if (runtimeCodeHash.toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) {
      failClosed(`${dependency} runtime code hash mismatch`);
    }
    dependencies[dependency] = Object.freeze({ ...record, address, runtimeCodeHash, evidence: "verified" });
  }

  Object.freeze(dependencies);
  const result = Object.freeze({ chainId, dependencies }) satisfies VerifiedDeployments;
  officialResolverResults.add(result);
  return result;
}

export async function resolveVerifiedDeployments(
  client: ReadOnlyDeploymentClient,
  chainId: number,
): Promise<VerifiedDeployments> {
  return resolveDeploymentRegistry(client, chainId, OFFICIAL_DEPLOYMENT_REGISTRY);
}
