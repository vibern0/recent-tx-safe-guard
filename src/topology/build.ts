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
import { deriveComponentAddresses } from "./addressing";
import { type VerifiedComponent } from "./evidence";
import { type UnsignedSetupCall } from "./multisend";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const SAFE_ABI = [
  { name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owners", type: "address[]" }, { name: "threshold", type: "uint256" }, { name: "to", type: "address" }, { name: "data", type: "bytes" }, { name: "fallbackHandler", type: "address" }, { name: "paymentToken", type: "address" }, { name: "payment", type: "uint256" }, { name: "paymentReceiver", type: "address" }], outputs: [] },
  { name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] },
  { name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] },
] as const;
const FACTORY_ABI = [{ name: "createProxyWithNonce", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_singleton", type: "address" }, { name: "initializer", type: "bytes" }, { name: "saltNonce", type: "uint256" }], outputs: [{ name: "proxy", type: "address" }] }] as const;
const HELPER_ABI = [{ name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "params", type: "tuple", components: [{ name: "guard", type: "address" }, { name: "delay", type: "address" }, { name: "maintenance", type: "address" }, { name: "passkey", type: "address" }, { name: "burner", type: "address" }, { name: "periodSeconds", type: "uint64" }, { name: "periodAnchor", type: "uint64" }, { name: "assets", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }] }] }], outputs: [] }] as const;
const GUARD_ABI = [
  { name: "config", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "safe", type: "address" }, { name: "passkey", type: "address" }, { name: "burner", type: "address" }, { name: "delay", type: "address" }, { name: "periodSeconds", type: "uint64" }, { name: "periodAnchor", type: "uint64" }] },
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
  setupHelperCreationCode: Hex;
  guardCreationCode: Hex;
  delayCreationCode: Hex;
  maintenanceCreationCode: Hex;
  deployments: VerifiedDeploymentInfrastructure;
}>;

export type PlannedDeploymentTransaction = UnsignedSetupCall & Readonly<{
  nonce: bigint;
  description: string;
  expectedCreatedAddress: Address;
  creationCodeHash: Hex;
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
    owners: readonly [Address, Address];
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

export function policyHash(policy: VaultPolicy): Hex {
  const assets = policy.assets.map((asset) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }], [asset.token, asset.basePerTransaction, asset.stepUpPerTransaction, asset.baseDailyLimit, asset.instantDailyLimit, [...asset.recipients]])));
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32[]" }], [BigInt(policy.chainId), policy.safe, policy.passkey, policy.burner, policy.delay, BigInt(policy.periodSeconds), policy.periodAnchor, BigInt(policy.cooldownSeconds), BigInt(policy.expirationSeconds), assets]));
}

export function planHash(plan: VaultDeploymentPlan): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }],
    [
      BigInt(plan.chainId),
      plan.deployer,
      plan.startingNonce,
      plan.safeProxySaltNonce,
      plan.prerequisites.setupHelper.expectedCreatedAddress,
      plan.prerequisites.setupHelper.creationCodeHash,
      plan.prerequisites.guard.expectedCreatedAddress,
      plan.prerequisites.guard.creationCodeHash,
      plan.prerequisites.delay.expectedCreatedAddress,
      plan.prerequisites.delay.creationCodeHash,
      plan.prerequisites.maintenance.expectedCreatedAddress,
      plan.prerequisites.maintenance.creationCodeHash,
      plan.safeProxyDeployment.expectedCreatedAddress,
      keccak256(plan.safeInitializer),
      plan.review.policyHash,
    ],
  ));
}

function assertCreationCode(value: Hex, label: string): void {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error(`${label} creation code is required`);
}

function same(left: Address, right: Address): boolean {
  return isAddressEqual(left, right);
}

function deployTransaction(description: string, deployer: Address, nonce: bigint, creationCode: Hex, expectedCreatedAddress: Address): PlannedDeploymentTransaction {
  return {
    description,
    nonce,
    to: ZERO,
    value: 0n,
    operation: 0,
    data: creationCode,
    expectedCreatedAddress,
    creationCodeHash: keccak256(creationCode),
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

  const components = deriveComponentAddresses({ deployer: input.deployer, startingNonce: input.startingNonce });
  if (!same(input.policy.delay, components.delay)) throw new Error("fail closed: policy Delay address does not match deterministic prerequisite address");

  const setupHelperCalldata = encodeFunctionData({
    abi: HELPER_ABI,
    functionName: "setup",
    args: [{
      guard: components.guard,
      delay: components.delay,
      maintenance: components.maintenance,
      passkey: input.policy.passkey,
      burner: input.policy.burner,
      periodSeconds: BigInt(input.policy.periodSeconds),
      periodAnchor: input.policy.periodAnchor,
      assets: input.policy.assets.map((asset) => ({ ...asset, recipients: [...asset.recipients] })),
    }],
  });
  const safeInitializer = encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setup",
    args: [[input.policy.passkey, input.policy.burner], 1n, components.setupHelper, setupHelperCalldata, ZERO, ZERO, 0n, ZERO],
  });
  const factoryCall = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createProxyWithNonce",
    args: [input.deployments.safeSingleton.address, safeInitializer, input.safeProxySaltNonce],
  });

  return {
    unsigned: true,
    broadcast: false,
    chainId: input.policy.chainId,
    deployer: input.deployer,
    startingNonce: input.startingNonce,
    safeProxySaltNonce: input.safeProxySaltNonce,
    prerequisites: {
      setupHelper: deployTransaction("deploy SafeAtomicSetupHelper", input.deployer, input.startingNonce, input.setupHelperCreationCode, components.setupHelper),
      guard: deployTransaction("deploy TieredSpendingGuard", input.deployer, input.startingNonce + 1n, input.guardCreationCode, components.guard),
      delay: deployTransaction("deploy Zodiac Delay", input.deployer, input.startingNonce + 2n, input.delayCreationCode, components.delay),
      maintenance: deployTransaction("deploy GuardReplacementMaintenance", input.deployer, input.startingNonce + 3n, input.maintenanceCreationCode, components.maintenance),
    },
    safeProxyDeployment: {
      description: "create Vault Safe proxy with atomic helper initializer",
      nonce: input.startingNonce + 4n,
      to: input.deployments.safeProxyFactory.address,
      value: 0n,
      operation: 0,
      data: factoryCall,
      expectedCreatedAddress: input.policy.safe,
      creationCodeHash: keccak256(factoryCall),
    },
    safeInitializer,
    setupHelperCalldata,
    review: {
      owners: [input.policy.passkey, input.policy.burner],
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
    },
  };
}

async function verifyCode(client: ReadOnlyDeploymentClient, name: VerifiedComponent["name"], address: Address, creationCodeHash: Hex): Promise<VerifiedComponent> {
  const runtimeCode = await client.getBytecode({ address });
  if (!runtimeCode || runtimeCode === "0x") throw new Error(`fail closed: ${name} is not deployed at planned address`);
  return Object.freeze({
    name,
    address,
    runtimeCodeHash: keccak256(runtimeCode),
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
  const setupHelper = await verifyCode(client, "setupHelper", plan.prerequisites.setupHelper.expectedCreatedAddress, plan.prerequisites.setupHelper.creationCodeHash);
  const guard = await verifyCode(client, "guard", plan.prerequisites.guard.expectedCreatedAddress, plan.prerequisites.guard.creationCodeHash);
  const delay = await verifyCode(client, "delay", plan.prerequisites.delay.expectedCreatedAddress, plan.prerequisites.delay.creationCodeHash);
  const maintenance = await verifyCode(client, "maintenance", plan.prerequisites.maintenance.expectedCreatedAddress, plan.prerequisites.maintenance.creationCodeHash);

  if (typeof client.readContract !== "function") throw new Error("fail closed: prerequisite binding reader is required");
  const guardConfig = await client.readContract({ address: guard.address, abi: GUARD_ABI, functionName: "config" });
  if (!Array.isArray(guardConfig) || guardConfig.length !== 6) throw new Error("fail closed: guard config evidence malformed");
  const [safe, passkey, burner, configuredDelay, periodSeconds, periodAnchor] = guardConfig as [Address, Address, Address, Address, bigint, bigint];
  if (!same(safe, plan.safeProxyDeployment.expectedCreatedAddress) || !same(passkey, plan.review.owners[0]) || !same(burner, plan.review.owners[1]) || !same(configuredDelay, delay.address) || periodSeconds !== 86400n || periodAnchor !== plan.review.periodAnchor) {
    if (periodSeconds !== 86400n || periodAnchor !== plan.review.periodAnchor) throw new Error("fail closed: guard period binding mismatch");
    throw new Error("fail closed: guard binding mismatch");
  }
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
