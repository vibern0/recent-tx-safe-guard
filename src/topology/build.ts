import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { assertValidVaultPolicy, type VaultPolicy } from "../config/policy";
import {
  isOfficialVerifiedDeployments,
  type ReadOnlyDeploymentClient,
  type VerifiedDeploymentInfrastructure,
} from "../config/deployments";
import { deriveComponentAddresses, deriveSafeProxyAddress } from "./addressing";
import { type VerifiedComponent } from "./evidence";
import { type UnsignedSetupCall } from "./multisend";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SIGNER_ROLE = { primary: 0, secondary: 1 } as const;
const SIGNER_KIND = { "safe-contract": 0, "ecdsa-extension": 1 } as const;

const SAFE_ABI = [
  { name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owners", type: "address[]" }, { name: "threshold", type: "uint256" }, { name: "to", type: "address" }, { name: "data", type: "bytes" }, { name: "fallbackHandler", type: "address" }, { name: "paymentToken", type: "address" }, { name: "payment", type: "uint256" }, { name: "paymentReceiver", type: "address" }], outputs: [] },
  { name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] },
] as const;
const FACTORY_ABI = [{ name: "createProxyWithNonce", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_singleton", type: "address" }, { name: "initializer", type: "bytes" }, { name: "saltNonce", type: "uint256" }], outputs: [{ name: "proxy", type: "address" }] }] as const;
const HELPER_ABI = [{ name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "params", type: "tuple", components: [{ name: "guard", type: "address" }, { name: "delay", type: "address" }, { name: "maintenance", type: "address" }, { name: "passkey", type: "address" }, { name: "yubiKey", type: "address" }, { name: "burner", type: "address" }, { name: "periodSeconds", type: "uint64" }, { name: "periodAnchor", type: "uint64" }, { name: "assets", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }] }] }], outputs: [] }] as const;
const GUARD_ABI = [
  { name: "config", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "safe", type: "address" }, { name: "passkey", type: "address" }, { name: "burner", type: "address" }, { name: "delay", type: "address" }, { name: "periodSeconds", type: "uint64" }, { name: "periodAnchor", type: "uint64" }] },
  { name: "yubiKeySecondary", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "signer", type: "address" }, { name: "kind", type: "uint8" }, { name: "enabled", type: "bool" }] },
  { name: "burnerSecondary", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "signer", type: "address" }, { name: "kind", type: "uint8" }, { name: "enabled", type: "bool" }] },
  { name: "maintenance", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const DELAY_ABI = [
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "avatar", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "target", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "txCooldown", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "txExpiration", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const MAINTENANCE_ABI = [
  { name: "safe", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "delay", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export type VaultPlanInput = Readonly<{
  policy: VaultPolicy;
  deployer: Address;
  startingNonce: bigint;
  safeProxySaltNonce: bigint;
  safeProxyCreationCode: Hex;
  setupHelperCreationCode: Hex;
  guardCreationCode: Hex;
  delayCreationCode: Hex;
  maintenanceCreationCode: Hex;
  prerequisiteRuntimeCodeHashes: Readonly<{
    setupHelper: Hex;
    guard: Hex;
    delay: Hex;
    maintenance: Hex;
  }>;
  deployments: VerifiedDeploymentInfrastructure;
}>;

export type PlannedDeploymentTransaction = UnsignedSetupCall & Readonly<{
  nonce: bigint;
  description: string;
  expectedCreatedAddress: Address;
  creationCodeHash: Hex;
  expectedRuntimeCodeHash: Hex;
}>;

export type VaultDeploymentPlan = Readonly<{
  unsigned: true;
  broadcast: false;
  chainId: number;
  deployer: Address;
  startingNonce: bigint;
  safeProxySaltNonce: bigint;
  prerequisites: Readonly<{
    setupHelper: PlannedDeploymentTransaction;
    guard: PlannedDeploymentTransaction;
    delay: PlannedDeploymentTransaction;
    maintenance: PlannedDeploymentTransaction;
  }>;
  safeProxyDeployment: PlannedDeploymentTransaction;
  safeInitializer: Hex;
  setupHelperCalldata: Hex;
  review: Readonly<{
    owners: readonly [Address, Address, Address];
    threshold: 1;
    fallbackHandler: Address;
    paymentToken: Address;
    payment: 0n;
    paymentReceiver: Address;
    transactionGuard: Address;
    moduleGuard: Address;
    modules: readonly [Address];
    delay: Readonly<{ owner: Address; avatar: Address; target: Address; upstreamModules: readonly [Address]; cooldownSeconds: number; expirationSeconds: number }>;
    periodAnchor: bigint;
    policyHash: Hex;
    creationCodeHashes: Readonly<{ setupHelper: Hex; guard: Hex; delay: Hex; maintenance: Hex }>;
    runtimeCodeHashes: Readonly<{ setupHelper: Hex; guard: Hex; delay: Hex; maintenance: Hex }>;
  }>;
}>;

export type VerifiedVaultPrerequisites = Readonly<{
  planHash: Hex;
  setupHelper: VerifiedComponent;
  guard: VerifiedComponent;
  delay: VerifiedComponent;
  maintenance: VerifiedComponent;
}>;

const prerequisiteEvidence = new WeakSet<object>();

export function isVerifiedVaultPrerequisites(value: unknown): value is VerifiedVaultPrerequisites {
  return typeof value === "object" && value !== null && prerequisiteEvidence.has(value);
}

export function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  const secondaries = policy.secondaries ?? [{ address: policy.burner, role: "secondary" as const, kind: "ecdsa-extension" as const, enabled: true }];
  const yubiKeySecondary = secondaries.find((signer) => signer.kind === "safe-contract") ?? { address: ZERO, role: "secondary" as const, kind: "safe-contract" as const, enabled: false };
  const burnerSecondary = secondaries.find((signer) => signer.kind === "ecdsa-extension") ?? { address: policy.burner, role: "secondary" as const, kind: "ecdsa-extension" as const, enabled: true };
  return keccak256(encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "tuple", components: [{ type: "address" }, { type: "uint8" }, { type: "uint8" }, { type: "bool" }] },
      { type: "tuple", components: [{ type: "address" }, { type: "uint8" }, { type: "bool" }] },
      { type: "tuple", components: [{ type: "address" }, { type: "uint8" }, { type: "bool" }] },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32[]" },
    ],
    [
      BigInt(policy.chainId),
      policy.safe,
      [policy.primary ?? policy.passkey, SIGNER_ROLE.primary, SIGNER_KIND["safe-contract"], true],
      [yubiKeySecondary.address, SIGNER_KIND[yubiKeySecondary.kind], yubiKeySecondary.enabled],
      [burnerSecondary.address, SIGNER_KIND[burnerSecondary.kind], burnerSecondary.enabled],
      policy.delay,
      BigInt(policy.periodSeconds),
      policy.periodAnchor,
      BigInt(policy.cooldownSeconds),
      BigInt(policy.expirationSeconds),
      assets,
    ],
  ));
}

export function planHash(plan: VaultDeploymentPlan): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [
      BigInt(plan.chainId),
      plan.deployer,
      plan.startingNonce,
      plan.safeProxySaltNonce,
      plan.prerequisites.setupHelper.expectedCreatedAddress,
      plan.prerequisites.setupHelper.creationCodeHash,
      plan.prerequisites.setupHelper.expectedRuntimeCodeHash,
      plan.prerequisites.guard.expectedCreatedAddress,
      plan.prerequisites.guard.creationCodeHash,
      plan.prerequisites.guard.expectedRuntimeCodeHash,
      plan.prerequisites.delay.expectedCreatedAddress,
      plan.prerequisites.delay.creationCodeHash,
      plan.prerequisites.delay.expectedRuntimeCodeHash,
      plan.prerequisites.maintenance.expectedCreatedAddress,
      plan.prerequisites.maintenance.creationCodeHash,
      plan.prerequisites.maintenance.expectedRuntimeCodeHash,
      plan.safeProxyDeployment.expectedCreatedAddress,
      keccak256(plan.safeInitializer),
      plan.review.policyHash,
    ],
  ));
}

function assertCreationCode(value: Hex, label: string): void {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error(`${label} creation code is required`);
}

function assertRuntimeHash(value: Hex, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} runtime code hash is required`);
}

function same(left: Address, right: Address): boolean {
  return isAddressEqual(left, right);
}

function sortedOwners(owners: readonly Address[]): readonly [Address, Address, Address] {
  const sorted = [...owners].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  if (sorted.length !== 3) throw new Error("fail closed: Option B requires exactly three Safe owners");
  return sorted as [Address, Address, Address];
}

function plannedSetupSigners(plan: VaultDeploymentPlan): { passkey: Address; yubiKey: Address; burner: Address } {
  const decoded = decodeFunctionData({ abi: HELPER_ABI, data: plan.setupHelperCalldata });
  if (decoded.functionName !== "setup") throw new Error("fail closed: setup helper calldata mismatch");
  const params = decoded.args[0];
  return { passkey: params.passkey, yubiKey: params.yubiKey, burner: params.burner };
}

function configuredOptionBSecondaries(policy: VaultPolicy): { yubiKey: Address; burner: Address } {
  const yubiKey = policy.secondaries?.find((signer) => signer.role === "secondary" && signer.kind === "safe-contract" && signer.enabled)?.address;
  const burner = policy.secondaries?.find((signer) => signer.role === "secondary" && signer.kind === "ecdsa-extension" && signer.enabled && same(signer.address, policy.burner))?.address;
  if (!yubiKey) throw new Error("fail closed: Option B requires an enabled Safe-contract secondary");
  if (!burner) throw new Error("fail closed: Option B requires the Burner ECDSA secondary");
  return { yubiKey, burner };
}

function deployTransaction(description: string, deployer: Address, nonce: bigint, creationCode: Hex, expectedRuntimeCodeHash: Hex, expectedCreatedAddress: Address): PlannedDeploymentTransaction {
  return {
    description,
    nonce,
    to: ZERO,
    value: 0n,
    operation: 0,
    data: creationCode,
    expectedCreatedAddress,
    creationCodeHash: keccak256(creationCode),
    expectedRuntimeCodeHash,
  };
}

export function buildVaultPlan(input: VaultPlanInput): VaultDeploymentPlan {
  assertValidVaultPolicy(input.policy);
  if (!isOfficialVerifiedDeployments(input.deployments)) throw new Error("fail closed: deployments must come from a verified resolver");
  if (!same(input.deployments.deployer, input.deployer)) throw new Error("fail closed: deployer does not match verified deployment infrastructure");
  if (input.deployments.observedDeployerNonce !== input.startingNonce) throw new Error("fail closed: deployer nonce changed before planning");
  if (input.deployments.chainId !== input.policy.chainId) throw new Error("fail closed: policy chain does not match verified deployment infrastructure");
  if (!same(input.deployments.passkeySigner.address, input.policy.passkey)) throw new Error("fail closed: policy passkey does not match verified passkey signer");
  if (!input.deployments.safeSingleton.supportsModuleGuards) throw new Error("fail closed: Safe singleton lacks module guards");
  for (const [label, code] of Object.entries({
    setupHelper: input.setupHelperCreationCode,
    guard: input.guardCreationCode,
    delay: input.delayCreationCode,
    maintenance: input.maintenanceCreationCode,
  })) assertCreationCode(code as Hex, label);
  assertCreationCode(input.safeProxyCreationCode, "Safe proxy");
  for (const [label, runtimeHash] of Object.entries(input.prerequisiteRuntimeCodeHashes)) assertRuntimeHash(runtimeHash as Hex, label);

  const components = deriveComponentAddresses({ deployer: input.deployer, startingNonce: input.startingNonce });
  if (!same(input.policy.delay, components.delay)) throw new Error("fail closed: policy Delay address does not match deterministic prerequisite address");
  const optionB = configuredOptionBSecondaries(input.policy);
  const owners = sortedOwners([input.policy.passkey, optionB.yubiKey, optionB.burner]);

  const setupHelperCalldata = encodeFunctionData({
    abi: HELPER_ABI,
    functionName: "setup",
    args: [{
      guard: components.guard,
      delay: components.delay,
      maintenance: components.maintenance,
      passkey: input.policy.passkey,
      yubiKey: optionB.yubiKey,
      burner: optionB.burner,
      periodSeconds: BigInt(input.policy.periodSeconds),
      periodAnchor: input.policy.periodAnchor,
      assets: input.policy.assets.map((asset) => ({ ...asset, recipients: [...asset.recipients] })),
    }],
  });
  const safeInitializer = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setup",
    args: [owners, 1n, components.setupHelper, setupHelperCalldata, ZERO, ZERO, 0n, ZERO],
  });
  const factoryCall = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createProxyWithNonce",
    args: [input.deployments.safeSingleton.address, safeInitializer, input.safeProxySaltNonce],
  });
  const derivedSafeProxy = deriveSafeProxyAddress({
    factory: input.deployments.safeProxyFactory.address,
    singleton: input.deployments.safeSingleton.address,
    proxyCreationCode: input.safeProxyCreationCode,
    initializer: safeInitializer,
    saltNonce: input.safeProxySaltNonce,
  });
  if (!same(input.policy.safe, derivedSafeProxy)) throw new Error("fail closed: policy Safe does not match derived Safe proxy address");

  return {
    unsigned: true,
    broadcast: false,
    chainId: input.policy.chainId,
    deployer: input.deployer,
    startingNonce: input.startingNonce,
    safeProxySaltNonce: input.safeProxySaltNonce,
    prerequisites: {
      setupHelper: deployTransaction("deploy SafeAtomicSetupHelper", input.deployer, input.startingNonce, input.setupHelperCreationCode, input.prerequisiteRuntimeCodeHashes.setupHelper, components.setupHelper),
      guard: deployTransaction("deploy TieredSpendingGuard", input.deployer, input.startingNonce + 1n, input.guardCreationCode, input.prerequisiteRuntimeCodeHashes.guard, components.guard),
      delay: deployTransaction("deploy Zodiac Delay", input.deployer, input.startingNonce + 2n, input.delayCreationCode, input.prerequisiteRuntimeCodeHashes.delay, components.delay),
      maintenance: deployTransaction("deploy GuardReplacementMaintenance", input.deployer, input.startingNonce + 3n, input.maintenanceCreationCode, input.prerequisiteRuntimeCodeHashes.maintenance, components.maintenance),
    },
    safeProxyDeployment: {
      description: "create Vault Safe proxy with atomic helper initializer",
      nonce: input.startingNonce + 4n,
      to: input.deployments.safeProxyFactory.address,
      value: 0n,
      operation: 0,
      data: factoryCall,
      expectedCreatedAddress: derivedSafeProxy,
      creationCodeHash: keccak256(factoryCall),
      expectedRuntimeCodeHash: keccak256(factoryCall),
    },
    safeInitializer,
    setupHelperCalldata,
    review: {
      owners,
      threshold: 1,
      fallbackHandler: ZERO,
      paymentToken: ZERO,
      payment: 0n,
      paymentReceiver: ZERO,
      transactionGuard: components.guard,
      moduleGuard: components.guard,
      modules: [components.delay],
      delay: { owner: input.policy.safe, avatar: input.policy.safe, target: input.policy.safe, upstreamModules: [input.policy.safe], cooldownSeconds: input.policy.cooldownSeconds, expirationSeconds: input.policy.expirationSeconds },
      periodAnchor: input.policy.periodAnchor,
      policyHash: policyHash(input.policy),
      creationCodeHashes: {
        setupHelper: keccak256(input.setupHelperCreationCode),
        guard: keccak256(input.guardCreationCode),
        delay: keccak256(input.delayCreationCode),
        maintenance: keccak256(input.maintenanceCreationCode),
      },
      runtimeCodeHashes: input.prerequisiteRuntimeCodeHashes,
    },
  };
}

async function verifyCode(client: ReadOnlyDeploymentClient, name: VerifiedComponent["name"], address: Address, creationCodeHash: Hex, expectedRuntimeCodeHash: Hex): Promise<VerifiedComponent> {
  const runtimeCode = await client.getBytecode({ address });
  if (!runtimeCode || runtimeCode === "0x") throw new Error(`fail closed: ${name} is not deployed at planned address`);
  const runtimeCodeHash = keccak256(runtimeCode);
  if (runtimeCodeHash.toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) throw new Error(`fail closed: ${name} runtime code hash mismatch`);
  return Object.freeze({
    name,
    address,
    runtimeCodeHash,
    bindingHash: creationCodeHash,
    source: "planned prerequisite",
  });
}

async function readAddress(client: ReadOnlyDeploymentClient, address: Address, abi: readonly unknown[], functionName: string): Promise<Address> {
  if (typeof client.readContract !== "function") throw new Error("fail closed: prerequisite binding reader is required");
  const result = await client.readContract({ address, abi, functionName });
  if (typeof result !== "string") throw new Error(`fail closed: ${functionName} did not return an address`);
  return result as Address;
}

async function readBigInt(client: ReadOnlyDeploymentClient, address: Address, abi: readonly unknown[], functionName: string): Promise<bigint> {
  if (typeof client.readContract !== "function") throw new Error("fail closed: prerequisite binding reader is required");
  const result = await client.readContract({ address, abi, functionName });
  if (typeof result !== "bigint") throw new Error(`fail closed: ${functionName} did not return a uint`);
  return result;
}

export async function verifyVaultPrerequisites(client: ReadOnlyDeploymentClient, plan: VaultDeploymentPlan): Promise<VerifiedVaultPrerequisites> {
  const setupHelper = await verifyCode(client, "setupHelper", plan.prerequisites.setupHelper.expectedCreatedAddress, plan.prerequisites.setupHelper.creationCodeHash, plan.prerequisites.setupHelper.expectedRuntimeCodeHash);
  const guard = await verifyCode(client, "guard", plan.prerequisites.guard.expectedCreatedAddress, plan.prerequisites.guard.creationCodeHash, plan.prerequisites.guard.expectedRuntimeCodeHash);
  const delay = await verifyCode(client, "delay", plan.prerequisites.delay.expectedCreatedAddress, plan.prerequisites.delay.creationCodeHash, plan.prerequisites.delay.expectedRuntimeCodeHash);
  const maintenance = await verifyCode(client, "maintenance", plan.prerequisites.maintenance.expectedCreatedAddress, plan.prerequisites.maintenance.creationCodeHash, plan.prerequisites.maintenance.expectedRuntimeCodeHash);

  if (typeof client.readContract !== "function") throw new Error("fail closed: prerequisite binding reader is required");
  const plannedSigners = plannedSetupSigners(plan);
  const guardConfig = await client.readContract({ address: guard.address, abi: GUARD_ABI, functionName: "config" });
  if (!Array.isArray(guardConfig) || guardConfig.length !== 6) throw new Error("fail closed: guard config evidence malformed");
  const [safe, passkey, burner, configuredDelay, periodSeconds, periodAnchor] = guardConfig as [Address, Address, Address, Address, bigint, bigint];
  if (!same(safe, plan.safeProxyDeployment.expectedCreatedAddress) || !same(passkey, plannedSigners.passkey) || !same(burner, plannedSigners.burner) || !same(configuredDelay, delay.address) || periodSeconds !== 86400n || periodAnchor !== plan.review.periodAnchor) {
    if (periodSeconds !== 86400n || periodAnchor !== plan.review.periodAnchor) throw new Error("fail closed: guard period binding mismatch");
    throw new Error("fail closed: guard binding mismatch");
  }
  const yubiKey = await client.readContract({ address: guard.address, abi: GUARD_ABI, functionName: "yubiKeySecondary" });
  const burnerSecondary = await client.readContract({ address: guard.address, abi: GUARD_ABI, functionName: "burnerSecondary" });
  if (!Array.isArray(yubiKey) || yubiKey.length !== 3 || !same(yubiKey[0] as Address, plannedSigners.yubiKey) || yubiKey[1] !== 0 || yubiKey[2] !== true) throw new Error("fail closed: YubiKey secondary binding mismatch");
  if (!Array.isArray(burnerSecondary) || burnerSecondary.length !== 3 || !same(burnerSecondary[0] as Address, burner) || burnerSecondary[1] !== 1 || burnerSecondary[2] !== true) throw new Error("fail closed: Burner secondary binding mismatch");
  if (!same(await readAddress(client, guard.address, GUARD_ABI, "maintenance"), maintenance.address)) throw new Error("fail closed: guard maintenance mismatch");
  if (!same(await readAddress(client, delay.address, DELAY_ABI, "owner"), plan.safeProxyDeployment.expectedCreatedAddress)) throw new Error("fail closed: Delay owner mismatch");
  if (!same(await readAddress(client, delay.address, DELAY_ABI, "avatar"), plan.safeProxyDeployment.expectedCreatedAddress)) throw new Error("fail closed: Delay avatar mismatch");
  if (!same(await readAddress(client, delay.address, DELAY_ABI, "target"), plan.safeProxyDeployment.expectedCreatedAddress)) throw new Error("fail closed: Delay target mismatch");
  if (await readBigInt(client, delay.address, DELAY_ABI, "txCooldown") !== BigInt(plan.review.delay.cooldownSeconds)) throw new Error("fail closed: Delay cooldown mismatch");
  if (await readBigInt(client, delay.address, DELAY_ABI, "txExpiration") !== BigInt(plan.review.delay.expirationSeconds)) throw new Error("fail closed: Delay expiration mismatch");
  if (!same(await readAddress(client, maintenance.address, MAINTENANCE_ABI, "safe"), plan.safeProxyDeployment.expectedCreatedAddress)) throw new Error("fail closed: maintenance Safe mismatch");
  if (!same(await readAddress(client, maintenance.address, MAINTENANCE_ABI, "delay"), delay.address)) throw new Error("fail closed: maintenance Delay mismatch");

  const result = Object.freeze({ planHash: planHash(plan), setupHelper, guard, delay, maintenance });
  prerequisiteEvidence.add(result);
  return result;
}

export function assertSafeCreationReady(plan: VaultDeploymentPlan, prerequisites: VerifiedVaultPrerequisites, observedDeployerNonce: bigint): void {
  if (!prerequisiteEvidence.has(prerequisites)) throw new Error("fail closed: prerequisite evidence was not produced by verifier");
  if (prerequisites.planHash !== planHash(plan)) throw new Error("fail closed: prerequisite evidence belongs to a different plan");
  const expected = plan.startingNonce + 4n;
  if (observedDeployerNonce !== expected) throw new Error(`fail closed: deployer nonce drift before Safe creation: expected ${expected}, observed ${observedDeployerNonce}`);
}

export function decodeSafeFactoryCall(plan: VaultDeploymentPlan): { singleton: Address; initializer: Hex; saltNonce: bigint } {
  const decoded = decodeFunctionData({ abi: FACTORY_ABI, data: plan.safeProxyDeployment.data });
  if (decoded.functionName !== "createProxyWithNonce") throw new Error("not a Safe factory call");
  return { singleton: decoded.args[0], initializer: decoded.args[1], saltNonce: decoded.args[2] };
}
