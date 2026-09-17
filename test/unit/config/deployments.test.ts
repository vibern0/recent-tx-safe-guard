import { expect } from "chai";
import { keccak256, type Address, type Hex } from "viem";
import {
  resolveVerifiedDeployments,
  resolveVerifiedDeploymentsForTest,
  OFFICIAL_DEPLOYMENT_REGISTRY,
  type DeploymentRegistry,
  type ReadOnlyDeploymentClient,
} from "../../../src/config/deployments";

const CHAIN_ID = 11155111;
const OTHER_CHAIN_ID = 1;
const CODE = "0x6001600055" as Hex;
const CODE_HASH = keccak256(CODE);
const ZERO_CODE = "0x" as Hex;

const addresses = {
  safeSingleton: "0x0000000000000000000000000000000000000001" as Address,
  safeProxyFactory: "0x0000000000000000000000000000000000000002" as Address,
  passkeySignerFactory: "0x0000000000000000000000000000000000000003" as Address,
  passkeySignerVerifier: "0x0000000000000000000000000000000000000004" as Address,
  multiSend: "0x0000000000000000000000000000000000000005" as Address,
  delay: "0x0000000000000000000000000000000000000006" as Address,
};

const fixtureRegistry = (): DeploymentRegistry => ({
  [CHAIN_ID]: {
    safeSingleton: {
      name: "Safe singleton",
      version: "1.5.0",
      address: addresses.safeSingleton,
      runtimeCodeHash: CODE_HASH,
      supportsModuleGuards: true,
      source: "https://github.com/safe-global/safe-deployments",
    },
    safeProxyFactory: {
      name: "Safe proxy factory",
      version: "1.5.0",
      address: addresses.safeProxyFactory,
      runtimeCodeHash: CODE_HASH,
      source: "https://github.com/safe-global/safe-deployments",
    },
    passkeySignerFactory: {
      name: "Safe passkey signer factory",
      version: "0.2.0",
      address: addresses.passkeySignerFactory,
      runtimeCodeHash: CODE_HASH,
      source: "https://github.com/safe-global/safe-modules",
    },
    passkeySignerVerifier: {
      name: "Safe passkey verifier",
      version: "0.2.0",
      address: addresses.passkeySignerVerifier,
      runtimeCodeHash: CODE_HASH,
      source: "https://github.com/safe-global/safe-modules",
    },
    multiSend: {
      name: "Safe MultiSend",
      version: "1.5.0",
      address: addresses.multiSend,
      runtimeCodeHash: CODE_HASH,
      source: "https://github.com/safe-global/safe-deployments",
    },
    delay: {
      name: "Zodiac Delay",
      version: "1.1.1",
      address: addresses.delay,
      runtimeCodeHash: CODE_HASH,
      source: "https://github.com/gnosisguild/zodiac",
    },
  },
});

const clientFor = (
  codeByAddress: Partial<Record<Address, Hex | undefined>> = {},
): ReadOnlyDeploymentClient => ({
  getBytecode: async ({ address }) => codeByAddress[address] ?? CODE,
});

describe("resolveVerifiedDeployments", () => {
  it("rejects an unsupported chain before reading bytecode", async () => {
    await expect(resolveVerifiedDeploymentsForTest(clientFor(), OTHER_CHAIN_ID, fixtureRegistry())).to.be.rejectedWith(
      "unsupported chain",
    );
  });

  it("rejects an address with no runtime bytecode", async () => {
    const registry = fixtureRegistry();
    await expect(
      resolveVerifiedDeploymentsForTest(clientFor({ [addresses.delay]: ZERO_CODE }), CHAIN_ID, registry),
    ).to.be.rejectedWith("no runtime bytecode");
  });

  it("rejects runtime bytecode whose hash is not allowlisted", async () => {
    const registry = fixtureRegistry();
    await expect(
      resolveVerifiedDeploymentsForTest(clientFor({ [addresses.multiSend]: "0x6002" }), CHAIN_ID, registry),
    ).to.be.rejectedWith("runtime code hash mismatch");
  });

  it("rejects an unknown release", async () => {
    const registry = fixtureRegistry();
    registry[CHAIN_ID]!.delay.version = "9.9.9";
    await expect(resolveVerifiedDeploymentsForTest(clientFor(), CHAIN_ID, registry)).to.be.rejectedWith(
      "unknown release",
    );
  });

  it("rejects known-vulnerable Zodiac Delay releases", async () => {
    const registry = fixtureRegistry();
    registry[CHAIN_ID]!.delay.version = "1.1.0";
    await expect(resolveVerifiedDeploymentsForTest(clientFor(), CHAIN_ID, registry)).to.be.rejectedWith(
      "known-vulnerable Delay release",
    );
  });

  it("rejects Safe releases without module-guard support", async () => {
    const registry = fixtureRegistry();
    registry[CHAIN_ID]!.safeSingleton.supportsModuleGuards = false;
    await expect(resolveVerifiedDeploymentsForTest(clientFor(), CHAIN_ID, registry)).to.be.rejectedWith(
      "module guards",
    );
  });

  it("returns every verified dependency only after all reads pass", async () => {
    const result = await resolveVerifiedDeploymentsForTest(clientFor(), CHAIN_ID, fixtureRegistry());
    expect(result.chainId).to.equal(CHAIN_ID);
    expect(Object.keys(result.dependencies)).to.have.length(6);
    expect(result.dependencies.delay.version).to.equal("1.1.1");
    expect(result.dependencies.safeSingleton.runtimeCodeHash).to.equal(CODE_HASH);
  });

  it("rejects malformed and zero addresses before any RPC read", async () => {
    const registry = fixtureRegistry();
    registry[CHAIN_ID]!.delay.address = "not-an-address" as Address;
    let reads = 0;
    const client: ReadOnlyDeploymentClient = {
      getBytecode: async () => {
        reads += 1;
        return CODE;
      },
    };
    await expect(resolveVerifiedDeploymentsForTest(client, CHAIN_ID, registry)).to.be.rejectedWith(
      "invalid address",
    );
    expect(reads).to.equal(5);

    const zeroRegistry = fixtureRegistry();
    zeroRegistry[CHAIN_ID]!.delay.address = "0x0000000000000000000000000000000000000000" as Address;
    await expect(resolveVerifiedDeploymentsForTest(clientFor(), CHAIN_ID, zeroRegistry)).to.be.rejectedWith(
      "zero address",
    );
  });

  it("does not allow caller metadata to replace the production official registry", async () => {
    expect(OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.passkeySignerFactory.address).to.equal(undefined);
    expect(resolveVerifiedDeployments.length).to.equal(2);
    await expect(
      (resolveVerifiedDeployments as unknown as (...args: unknown[]) => Promise<unknown>)
        (clientFor(), CHAIN_ID, fixtureRegistry()),
    ).to.be.rejectedWith("safeSingleton runtime code hash mismatch");
  });
});
