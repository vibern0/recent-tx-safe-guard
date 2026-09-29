import { expect } from "chai";
import { decodeFunctionData, getContractAddress, keccak256, type Address, type Hex } from "viem";
import {
  assertSafeCreationReady,
  buildVaultPlan,
  decodeSafeFactoryCall,
  verifyVaultPrerequisites,
  type VaultDeploymentPlan,
} from "../../../src/topology/build";
import {
  resolveDeploymentInfrastructureRegistry,
  type DeploymentInfrastructureRegistry,
  type ReadOnlyDeploymentClient,
  type VerifiedDeploymentInfrastructure,
} from "../../../src/config/deployments";
import { passkeySignerBindingHash } from "../../../src/topology/evidence";
import { type VaultPolicy } from "../../../src/config/policy";

const a = (n: number) => (`0x${n.toString(16).padStart(40, "0")}`) as Address;
const code = (n: number) => (`0x60${n.toString(16).padStart(2, "0")}`) as Hex;
const hash = (value: Hex) => keccak256(value);

const SAFE_SETUP_ABI = [{ name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "owners", type: "address[]" }, { name: "threshold", type: "uint256" }, { name: "to", type: "address" }, { name: "data", type: "bytes" }, { name: "fallbackHandler", type: "address" }, { name: "paymentToken", type: "address" }, { name: "payment", type: "uint256" }, { name: "paymentReceiver", type: "address" }], outputs: [] }] as const;
const HELPER_ABI = [{ name: "setup", type: "function", stateMutability: "nonpayable", inputs: [{ name: "params", type: "tuple", components: [{ name: "guard", type: "address" }, { name: "delay", type: "address" }, { name: "maintenance", type: "address" }, { name: "passkey", type: "address" }, { name: "burner", type: "address" }, { name: "periodSeconds", type: "uint64" }, { name: "periodAnchor", type: "uint64" }, { name: "assets", type: "tuple[]", components: [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }] }] }], outputs: [] }] as const;

const deployer = a(100);
const startingNonce = 11n;
const components = {
  setupHelper: getContractAddress({ from: deployer, nonce: startingNonce }),
  guard: getContractAddress({ from: deployer, nonce: startingNonce + 1n }),
  delay: getContractAddress({ from: deployer, nonce: startingNonce + 2n }),
  maintenance: getContractAddress({ from: deployer, nonce: startingNonce + 3n }),
};
const policy: VaultPolicy = {
  chainId: 11155111,
  safe: a(1),
  passkey: a(2),
  burner: a(3),
  delay: components.delay,
  periodSeconds: 86400,
  periodAnchor: 0n,
  cooldownSeconds: 3600,
  expirationSeconds: 86400,
  assets: [{ token: a(10), basePerTransaction: 10n, stepUpPerTransaction: 100n, baseDailyLimit: 100n, instantDailyLimit: 1000n, recipients: [a(20), a(21)] }],
};
const registry: DeploymentInfrastructureRegistry = {
  11155111: {
    safeSingleton: { name: "Safe singleton", version: "1.5.0", address: a(30), runtimeCodeHash: hash(code(30)), supportsModuleGuards: true, source: "test registry" },
    safeProxyFactory: { name: "Safe proxy factory", version: "1.5.0", address: a(31), runtimeCodeHash: hash(code(31)), source: "test registry" },
    passkeySignerFactory: { name: "Passkey factory", version: "0.2.0", address: a(32), runtimeCodeHash: hash(code(32)), source: "test registry" },
    passkeySignerVerifier: { name: "Passkey verifier", version: "0.2.0", address: a(33), runtimeCodeHash: hash(code(33)), source: "test registry" },
    multiSendCallOnly: { name: "MultiSendCallOnly", version: "1.5.0", address: a(34), runtimeCodeHash: hash(code(34)), source: "test registry" },
  },
};

async function verifiedInfrastructure(): Promise<VerifiedDeploymentInfrastructure> {
  const client: ReadOnlyDeploymentClient = {
    async getBytecode({ address }) {
      const entry = Object.values(registry[11155111]!).find((candidate) => candidate.address?.toLowerCase() === address.toLowerCase());
      if (address.toLowerCase() === policy.passkey.toLowerCase()) return code(2);
      return entry ? code(Number.parseInt(address.slice(-2), 16)) : undefined;
    },
    async getTransactionCount() { return startingNonce; },
    async readContract({ functionName }) {
      if (functionName === "getSigner") return policy.passkey;
      throw new Error(`unexpected read ${functionName}`);
    },
  };
  return resolveDeploymentInfrastructureRegistry(client, {
    chainId: 11155111,
    deployer,
    expectedDeployerNonce: startingNonce,
    passkeySigner: {
      address: policy.passkey,
      runtimeCodeHash: hash(code(2)),
      bindingHash: passkeySignerBindingHash({ factory: registry[11155111]!.passkeySignerFactory.address!, x: 1n, y: 2n, verifiers: 32n }),
      source: "test passkey",
      binding: { x: 1n, y: 2n, verifiers: 32n },
    },
  }, registry, { brandVerifiedInfrastructure: true });
}

async function productionPlan(): Promise<VaultDeploymentPlan> {
  return buildVaultPlan({
    policy,
    deployer,
    startingNonce,
    safeProxySaltNonce: 7n,
    setupHelperCreationCode: code(40),
    guardCreationCode: code(41),
    delayCreationCode: code(42),
    maintenanceCreationCode: code(43),
    deployments: await verifiedInfrastructure(),
  });
}

describe("buildVaultPlan", () => {
  it("produces byte-identical unsigned production output with fixed owners, initializer, nonces, and addresses", async () => {
    const first = await productionPlan();
    const second = await productionPlan();
    const json = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);

    expect(json(first)).to.equal(json(second));
    expect(first.unsigned).to.equal(true);
    expect(first.broadcast).to.equal(false);
    expect(json(first)).not.to.match(/signature|privateKey|secret|broadcast":true/i);
    expect(first.review.owners).to.deep.equal([policy.passkey, policy.burner]);
    expect(first.review.threshold).to.equal(1);
    expect(first.review.fallbackHandler).to.equal(a(0));
    expect(first.review.paymentToken).to.equal(a(0));
    expect(first.review.payment).to.equal(0n);
    expect(first.review.transactionGuard).to.equal(components.guard);
    expect(first.review.moduleGuard).to.equal(components.guard);
    expect(first.review.modules).to.deep.equal([components.delay]);
    expect(first.review.delay).to.deep.equal({ owner: policy.safe, avatar: policy.safe, target: policy.safe, upstreamModules: [policy.safe], cooldownSeconds: 3600, expirationSeconds: 86400 });

    expect(Object.values(first.prerequisites).map((tx) => [tx.nonce, tx.to, tx.value, tx.operation, tx.expectedCreatedAddress])).to.deep.equal([
      [startingNonce, a(0), 0n, 0, components.setupHelper],
      [startingNonce + 1n, a(0), 0n, 0, components.guard],
      [startingNonce + 2n, a(0), 0n, 0, components.delay],
      [startingNonce + 3n, a(0), 0n, 0, components.maintenance],
    ]);
    expect(first.safeProxyDeployment.nonce).to.equal(startingNonce + 4n);
    expect(first.safeProxyDeployment.to).to.equal(registry[11155111]!.safeProxyFactory.address);
    expect(first.safeProxyDeployment.expectedCreatedAddress).to.equal(policy.safe);

    const factoryCall = decodeSafeFactoryCall(first);
    expect(factoryCall.singleton).to.equal(registry[11155111]!.safeSingleton.address);
    expect(factoryCall.saltNonce).to.equal(7n);
    const safeSetup = decodeFunctionData({ abi: SAFE_SETUP_ABI, data: factoryCall.initializer });
    expect(safeSetup.args[0]).to.deep.equal([policy.passkey, policy.burner]);
    expect(safeSetup.args[1]).to.equal(1n);
    expect(safeSetup.args[2]).to.equal(components.setupHelper);
    expect(safeSetup.args[4]).to.equal(a(0));
    expect(safeSetup.args[5]).to.equal(a(0));
    expect(safeSetup.args[6]).to.equal(0n);
    expect(safeSetup.args[7]).to.equal(a(0));
    const helperSetup = decodeFunctionData({ abi: HELPER_ABI, data: safeSetup.args[3] });
    expect(helperSetup.args[0]).to.include({ guard: components.guard, delay: components.delay, maintenance: components.maintenance, passkey: policy.passkey, burner: policy.burner, periodSeconds: 86400n, periodAnchor: policy.periodAnchor });
  });

  it("fails closed on fabricated infrastructure, deployer nonce drift, and wrong deterministic Delay address", async () => {
    const deployments = await verifiedInfrastructure();
    expect(() => buildVaultPlan({ policy, deployer, startingNonce, safeProxySaltNonce: 7n, setupHelperCreationCode: code(40), guardCreationCode: code(41), delayCreationCode: code(42), maintenanceCreationCode: code(43), deployments: { ...deployments } as never })).to.throw("verified resolver");
    expect(() => buildVaultPlan({ policy, deployer, startingNonce: startingNonce + 1n, safeProxySaltNonce: 7n, setupHelperCreationCode: code(40), guardCreationCode: code(41), delayCreationCode: code(42), maintenanceCreationCode: code(43), deployments })).to.throw("nonce changed");
    expect(() => buildVaultPlan({ policy: { ...policy, delay: a(9) }, deployer, startingNonce, safeProxySaltNonce: 7n, setupHelperCreationCode: code(40), guardCreationCode: code(41), delayCreationCode: code(42), maintenanceCreationCode: code(43), deployments })).to.throw("Delay address");
  });

  it("brands prerequisite evidence only after all four planned deployments and bindings match", async () => {
    const plan = await productionPlan();
    const deployed = new Map<Address, Hex>([
      [plan.prerequisites.setupHelper.expectedCreatedAddress, code(80)],
      [plan.prerequisites.guard.expectedCreatedAddress, code(81)],
      [plan.prerequisites.delay.expectedCreatedAddress, code(82)],
      [plan.prerequisites.maintenance.expectedCreatedAddress, code(83)],
    ]);
    const client: ReadOnlyDeploymentClient = {
      async getBytecode({ address }) { return deployed.get(address); },
      async readContract({ address, functionName }) {
        if (address === plan.prerequisites.guard.expectedCreatedAddress && functionName === "config") return [policy.safe, policy.passkey, policy.burner, components.delay, 86400n, policy.periodAnchor];
        if (address === plan.prerequisites.guard.expectedCreatedAddress && functionName === "maintenance") return components.maintenance;
        if (address === plan.prerequisites.delay.expectedCreatedAddress && ["owner", "avatar", "target"].includes(functionName)) return policy.safe;
        if (address === plan.prerequisites.delay.expectedCreatedAddress && functionName === "txCooldown") return BigInt(policy.cooldownSeconds);
        if (address === plan.prerequisites.delay.expectedCreatedAddress && functionName === "txExpiration") return BigInt(policy.expirationSeconds);
        if (address === plan.prerequisites.maintenance.expectedCreatedAddress && functionName === "safe") return policy.safe;
        if (address === plan.prerequisites.maintenance.expectedCreatedAddress && functionName === "delay") return components.delay;
        throw new Error(`unexpected read ${functionName}`);
      },
    };

    const missing = new Map(deployed);
    missing.delete(plan.prerequisites.delay.expectedCreatedAddress);
    await expect(verifyVaultPrerequisites({ ...client, async getBytecode({ address }) { return missing.get(address); } }, plan)).to.be.rejectedWith("delay is not deployed");

    const evidence = await verifyVaultPrerequisites(client, plan);
    expect(() => assertSafeCreationReady(plan, evidence, startingNonce)).to.throw("nonce drift");
    expect(() => assertSafeCreationReady(plan, evidence, startingNonce + 3n)).to.throw("nonce drift");
    expect(() => assertSafeCreationReady({ ...plan, safeProxySaltNonce: 8n } as VaultDeploymentPlan, evidence, startingNonce + 4n)).to.throw("different plan");
    expect(() => assertSafeCreationReady(plan, { ...evidence } as never, startingNonce + 4n)).to.throw("not produced by verifier");
    expect(() => assertSafeCreationReady(plan, evidence, startingNonce + 4n)).not.to.throw();
  });
});
