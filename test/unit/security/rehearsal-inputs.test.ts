import { expect } from "chai";
import { validateRehearsalInputs } from "../../../src/security/rehearsal-inputs";

describe("rehearsal input safety", () => {
  it("allows only the hardhat selector and a clean environment", () => {
    expect(() => validateRehearsalInputs({ HARDHAT_NETWORK: "hardhat" }, [])).not.to.throw();
  });

  for (const selector of ["sepolia", "mainnet", "31337"]) {
    it(`rejects non-hardhat network selector ${selector}`, () => {
      expect(() => validateRehearsalInputs({ HARDHAT_NETWORK: selector }, [])).to.throw(/hardhat/);
    });
  }

  for (const name of ["REHEARSAL_CHAIN_ID", "CHAIN_ID", "RPC_URL", "SEPOLIA_RPC_URL", "VAULT_RPC_URL", "PRIVATE_KEY", "MNEMONIC", "BROADCAST"]) {
    it(`rejects legacy security input ${name}`, () => {
      expect(() => validateRehearsalInputs({ [name]: "provided" }, [])).to.throw(/refuses/);
    });
  }

  it("rejects a --network argument even when the environment is clean", () => {
    expect(() => validateRehearsalInputs({}, ["--network", "sepolia"])).to.throw(/hardhat/);
  });
});
