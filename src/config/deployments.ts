import { keccak256, type Address, type Hex } from "viem";
import Safe150 from "@safe-global/safe-deployments/src/assets/v1.5.0/safe.json";
import SafeProxyFactory150 from "@safe-global/safe-deployments/src/assets/v1.5.0/safe_proxy_factory.json";
import MultiSendCallOnly150 from "@safe-global/safe-deployments/src/assets/v1.5.0/multi_send_call_only.json";
import { DEPENDENCIES, deploymentAddressError, deploymentReleaseError, validatedDeploymentAddress } from "./deployment-validation";
import { verifyPasskeySignerComponent, type VerifiedComponent } from "../topology/evidence";

export const SUPPORTED_CHAIN_IDS = [11155111] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export type DependencyName =
  | "safeSingleton"
  | "safeProxyFactory"
  | "passkeySignerFactory"
  | "passkeySignerVerifier"
  | "multiSendCallOnly";

export type DeploymentRecord = {
  name: string;
  version: string;
  address?: Address;
  runtimeCodeHash?: Hex;
  supportsModuleGuards?: boolean;
  evidence?: "verified" | "absent";
  source: string;
};

export type ChainDeploymentInfrastructureRegistry = Record<DependencyName, DeploymentRecord>;
export type DeploymentInfrastructureRegistry = Partial<Record<number, ChainDeploymentInfrastructureRegistry>>;
export type ChainDeploymentRegistry = ChainDeploymentInfrastructureRegistry;
export type DeploymentRegistry = DeploymentInfrastructureRegistry;

export type ReadOnlyDeploymentClient = {
  getBytecode(args: { address: Address }): Promise<Hex | undefined>;
  getTransactionCount?(args: { address: Address }): Promise<number | bigint>;
  readContract?(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
};

export type VerifiedDependency = DeploymentRecord & {
  address: Address;
  runtimeCodeHash: Hex;
  evidence: "verified";
};

export type DeploymentInfrastructureInput = Readonly<{
  chainId: number;
  deployer: Address;
  expectedDeployerNonce: bigint;
  passkeySigner: Readonly<{
    address: Address;
    runtimeCodeHash: Hex;
    bindingHash: Hex;
    source: string;
    binding: Readonly<{ x: bigint; y: bigint; verifiers: bigint }>;
  }>;
}>;

type DependencyMap = Record<DependencyName, VerifiedDependency>;

export type DeploymentInfrastructure = Readonly<{
  chainId: number;
  deployer: Address;
  observedDeployerNonce: bigint;
  safeSingleton: VerifiedDependency;
  safeProxyFactory: VerifiedDependency;
  passkeySignerFactory: VerifiedDependency;
  passkeySignerVerifier: VerifiedDependency;
  multiSendCallOnly: VerifiedDependency;
  passkeySigner: VerifiedComponent;
  dependencies: DependencyMap;
}>;

export type VerifiedDeploymentInfrastructure = DeploymentInfrastructure;
export type VerifiedDeployments = VerifiedDeploymentInfrastructure;

const verifiedInfrastructure = new WeakSet<object>();

export function isVerifiedDeploymentInfrastructure(value: unknown): value is VerifiedDeploymentInfrastructure {
  return typeof value === "object" && value !== null && verifiedInfrastructure.has(value);
}

export const isOfficialVerifiedDeployments = isVerifiedDeploymentInfrastructure;

const SAFE_DEPLOYMENTS_PACKAGE = "@safe-global/safe-deployments@1.37.63";
const SAFE_MODULES = "https://github.com/safe-global/safe-modules";

type SafeDeploymentAsset = Readonly<{
  contractName: string;
  version: string;
  deployments: { canonical?: { address: string; codeHash: string } };
}>;

const fromSafeDeploymentAsset = (asset: SafeDeploymentAsset, name: string, supportsModuleGuards = false): DeploymentRecord => ({
  name,
  version: asset.version,
  address: asset.deployments.canonical?.address as Address | undefined,
  runtimeCodeHash: asset.deployments.canonical?.codeHash as Hex | undefined,
  ...(supportsModuleGuards ? { supportsModuleGuards: true } : {}),
  source: `${SAFE_DEPLOYMENTS_PACKAGE} ${asset.contractName}`,
});

const OFFICIAL_DEPLOYMENT_REGISTRY_DATA: DeploymentInfrastructureRegistry = {
  11155111: {
    safeSingleton: fromSafeDeploymentAsset(Safe150 as SafeDeploymentAsset, "Safe singleton", true),
    safeProxyFactory: fromSafeDeploymentAsset(SafeProxyFactory150 as SafeDeploymentAsset, "Safe proxy factory"),
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
    multiSendCallOnly: fromSafeDeploymentAsset(MultiSendCallOnly150 as SafeDeploymentAsset, "Safe MultiSendCallOnly"),
  },
};

const freezeRegistry = (registry: DeploymentInfrastructureRegistry): Readonly<DeploymentInfrastructureRegistry> => {
  for (const chain of Object.values(registry)) {
    if (!chain) continue;
    for (const record of Object.values(chain)) Object.freeze(record);
    Object.freeze(chain);
  }
  return Object.freeze(registry);
};

export const OFFICIAL_DEPLOYMENT_REGISTRY = freezeRegistry(OFFICIAL_DEPLOYMENT_REGISTRY_DATA);

const failClosed = (message: string): never => {
  throw new Error(`deployment verification failed closed: ${message}`);
};

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const requireAddress = (dependency: DependencyName, record: DeploymentRecord): Address => {
  const error = deploymentAddressError(dependency, record);
  if (error) failClosed(error);
  return validatedDeploymentAddress(dependency, record);
};

async function resolveInfrastructureDependencies(
  client: ReadOnlyDeploymentClient,
  chainId: number,
  registry: DeploymentInfrastructureRegistry | Readonly<DeploymentInfrastructureRegistry>,
  options: Readonly<{ requireEvidence?: boolean }> = {},
): Promise<DependencyMap> {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)) {
    failClosed(`unsupported chain ${chainId}`);
  }

  const selectedChain = registry[chainId];
  if (!selectedChain) failClosed(`no official registry entry for chain ${chainId}`);

  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    if (!record) failClosed(`missing registry entry for ${dependency}`);
    if (options.requireEvidence !== false && record.evidence === "absent") {
      failClosed(`${dependency} has no official deployment evidence`);
    }
    const addressError = deploymentAddressError(dependency, record);
    if (options.requireEvidence !== false && addressError) failClosed(addressError);
  }

  const dependencies = {} as DependencyMap;
  for (const dependency of DEPENDENCIES) {
    const record = selectedChain[dependency];
    if (!record) failClosed(`missing registry entry for ${dependency}`);
    const releaseError = deploymentReleaseError(dependency, record);
    if (releaseError) failClosed(releaseError);

    const address = requireAddress(dependency, record);
    const runtimeCode = await client.getBytecode({ address });
    if (!runtimeCode || runtimeCode === "0x") {
      failClosed(`${dependency} at ${address} has no runtime bytecode`);
    }
    if (!record.runtimeCodeHash) failClosed(`${dependency} has no committed runtime code hash`);
    const runtimeCodeHash = keccak256(runtimeCode);
    if (!same(runtimeCodeHash, record.runtimeCodeHash)) failClosed(`${dependency} runtime code hash mismatch`);
    dependencies[dependency] = Object.freeze({ ...record, address, runtimeCodeHash: record.runtimeCodeHash, evidence: "verified" });
  }

  return Object.freeze(dependencies);
}

export async function resolveDeploymentInfrastructureRegistry(
  client: ReadOnlyDeploymentClient,
  input: DeploymentInfrastructureInput,
  registry: DeploymentInfrastructureRegistry | Readonly<DeploymentInfrastructureRegistry>,
  options: Readonly<{ requireEvidence?: boolean }> = {},
): Promise<DeploymentInfrastructure> {
  if (typeof client.getTransactionCount !== "function") failClosed("deployer nonce reader is required");
  if (typeof client.readContract !== "function") failClosed("passkey binding reader is required");

  const dependencies = await resolveInfrastructureDependencies(client, input.chainId, registry, options);
  const observedNonceRaw = await client.getTransactionCount({ address: input.deployer });
  const observedDeployerNonce = typeof observedNonceRaw === "bigint" ? observedNonceRaw : BigInt(observedNonceRaw);
  if (observedDeployerNonce !== input.expectedDeployerNonce) {
    failClosed(`deployer nonce changed: expected ${input.expectedDeployerNonce}, observed ${observedDeployerNonce}`);
  }

  const passkeySigner = await verifyPasskeySignerComponent(
    { getBytecode: client.getBytecode, readContract: client.readContract },
    {
      ...input.passkeySigner,
      factory: dependencies.passkeySignerFactory.address,
    },
  );

  const result = Object.freeze({
    chainId: input.chainId,
    deployer: input.deployer,
    observedDeployerNonce,
    safeSingleton: dependencies.safeSingleton,
    safeProxyFactory: dependencies.safeProxyFactory,
    passkeySignerFactory: dependencies.passkeySignerFactory,
    passkeySignerVerifier: dependencies.passkeySignerVerifier,
    multiSendCallOnly: dependencies.multiSendCallOnly,
    passkeySigner,
    dependencies,
  }) satisfies DeploymentInfrastructure;

  return result;
}

export async function resolveVerifiedDeploymentInfrastructure(
  client: ReadOnlyDeploymentClient,
  input: DeploymentInfrastructureInput,
): Promise<VerifiedDeploymentInfrastructure> {
  const result = await resolveDeploymentInfrastructureRegistry(client, input, OFFICIAL_DEPLOYMENT_REGISTRY, {
    requireEvidence: true,
  });
  verifiedInfrastructure.add(result);
  return result;
}

export async function resolveVerifiedDeployments(
  client: ReadOnlyDeploymentClient,
  chainId: number,
): Promise<VerifiedDeploymentInfrastructure> {
  return resolveVerifiedDeploymentInfrastructure(client, {
    chainId,
    deployer: "0x0000000000000000000000000000000000000000",
    expectedDeployerNonce: 0n,
    passkeySigner: {
      address: "0x0000000000000000000000000000000000000000",
      runtimeCodeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      bindingHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      source: "legacy resolver placeholder",
      binding: { x: 0n, y: 0n, verifiers: 0n },
    },
  });
}
