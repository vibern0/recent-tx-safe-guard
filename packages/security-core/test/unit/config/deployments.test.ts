import { expect } from "chai";
import { OFFICIAL_DEPLOYMENT_REGISTRY, isVerifiedDeploymentInfrastructure } from "../../../src/config/deployments";

const CHAIN_ID = 11155111;

describe("deployment registry", () => {
  it("pins the Safe 1.5 Sepolia MultiSendCallOnly official deployment evidence", () => {
    const entry = OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.multiSendCallOnly;

    expect(entry.name).to.equal("Safe MultiSendCallOnly");
    expect(entry.version).to.equal("1.5.0");
    expect(entry.address).to.equal("0xA83c336B20401Af773B6219BA5027174338D1836");
    expect(entry.runtimeCodeHash).to.equal("0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663");
    expect(entry.source).to.contain("@safe-global/safe-deployments");
  });

  it("does not let config-shaped JSON construct the production infrastructure brand", () => {
    const cloned = {
      chainId: CHAIN_ID,
      deployer: "0x0000000000000000000000000000000000000001",
      observedDeployerNonce: 0n,
      safeSingleton: OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.safeSingleton,
      safeProxyFactory: OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.safeProxyFactory,
      passkeySignerFactory: OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.passkeySignerFactory,
      passkeySignerVerifier: OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.passkeySignerVerifier,
      multiSendCallOnly: OFFICIAL_DEPLOYMENT_REGISTRY[CHAIN_ID]!.multiSendCallOnly,
      passkeySigner: {
        name: "passkeySigner",
        address: "0x0000000000000000000000000000000000000002",
        runtimeCodeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        bindingHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        source: "test",
      },
    };

    expect(isVerifiedDeploymentInfrastructure(cloned)).to.equal(false);
  });
});
