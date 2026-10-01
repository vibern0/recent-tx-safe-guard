import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { deploySafeFixture, ZERO, burnerEnvelope, fn, passkeySignature, safeContractSignatures, safeTxTypes, signSafeTransaction, transferAbi } from "../helpers/safe";

const setGuardAbi = fn("setGuard", [{ name: "guard", type: "address" }]);
const setModuleGuardAbi = fn("setModuleGuard", [{ name: "guard", type: "address" }]);
const enableModuleAbi = fn("enableModule", [{ name: "module", type: "address" }]);
const revertCallAbi = fn("revertCall", []);
const setAssetPolicyAbi = fn("setAssetPolicy", [
  { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" },
  { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" },
  { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
]);
const configureYubiKeyAbi = fn("configureYubiKeySecondary", [
  { name: "signer", type: "address" },
  { name: "enabled", type: "bool" },
]);


describe("TieredSpendingGuard against Safe 1.5", () => {
  async function secondarySignerFixture(yubiEnabled = true) {
    const [deployer, burner, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const yubiKey = await hre.viem.deployContract("Mock1271Signer");
    const wrongYubiKey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, yubiKey.address, burner.account.address]);
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 10_000n]);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, delay.address, 86400n, 0n]]);
    const ownerCall = async (to: Address, data: Hex) => {
      const signature = await signSafeTransaction(safe, burner, to, data);
      await safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    await ownerCall(guard.address, encodeFunctionData({ abi: configureYubiKeyAbi, functionName: "configureYubiKeySecondary", args: [yubiKey.address, yubiEnabled] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: setAssetPolicyAbi, functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] }));
    const transfer = (amount: bigint) => encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [recipient.account.address, amount] });
    const exec = (data: Hex, signatures: Hex) => safe.write.execTransaction([token.address, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures], { account: deployer.account });
    const burnerStep = async (data: Hex) => burnerEnvelope(passkey.address, await signSafeTransaction(safe, burner, token.address, data));
    const yubiStep = (primaryPayload = "0x" as Hex, secondaryPayload = "0x" as Hex) => safeContractSignatures(passkey.address, yubiKey.address, primaryPayload, secondaryPayload);
    return { burner, recipient, passkey, yubiKey, wrongYubiKey, safe, token, guard, transfer, exec, burnerStep, yubiStep };
  }

  it("secondary signer matrix allows primary plus exactly one configured secondary", async () => {
    const f = await secondarySignerFixture();

    await f.exec(f.transfer(60n), passkeySignature(f.passkey.address));
    await expect(f.exec(f.transfer(50n), passkeySignature(f.passkey.address))).to.be.rejected;
    await expect(f.exec(f.transfer(1n), passkeySignature(f.yubiKey.address))).to.be.rejected;
    await expect(f.exec(f.transfer(1n), await signSafeTransaction(f.safe, f.burner, f.token.address, f.transfer(1n)))).to.be.rejected;
    await expect(f.exec(f.transfer(1n), burnerEnvelope(f.yubiKey.address, await signSafeTransaction(f.safe, f.burner, f.token.address, f.transfer(1n))))).to.be.rejected;

    await f.exec(f.transfer(300n), f.yubiStep());
    await f.exec(f.transfer(300n), await f.burnerStep(f.transfer(300n)));

    await expect(f.exec(f.transfer(300n), safeContractSignatures(f.passkey.address, f.wrongYubiKey.address))).to.be.rejected;
    const mixed = `${f.yubiStep()}${(await signSafeTransaction(f.safe, f.burner, f.token.address, f.transfer(300n))).slice(2)}` as Hex;
    await expect(f.exec(f.transfer(300n), mixed)).to.be.rejected;
  });

  it("secondary signer rejects disabled YubiKey contract signatures while keeping Burner available", async () => {
    const f = await secondarySignerFixture(false);

    await expect(f.exec(f.transfer(300n), f.yubiStep())).to.be.rejected;
    await f.exec(f.transfer(300n), await f.burnerStep(f.transfer(300n)));
  });

  it("secondary signer Safe contract signatures accept non-empty ERC-1271 payloads", async () => {
    const f = await secondarySignerFixture();

    await f.exec(f.transfer(300n), f.yubiStep("0x12345678", "0xabcdef"));
    expect((await f.guard.read.spendState([f.token.address]))[2]).to.equal(300n);
  });

  it("secondary signer Safe contract signatures accept Safe owner order when YubiKey sorts before primary", async () => {
    const [deployer, burner, recipient] = await hre.viem.getWalletClients();
    const firstSigner = await hre.viem.deployContract("Mock1271Signer");
    const secondSigner = await hre.viem.deployContract("Mock1271Signer");
    const [yubiKey, passkey] = firstSigner.address.toLowerCase() < secondSigner.address.toLowerCase()
      ? [firstSigner, secondSigner]
      : [secondSigner, firstSigner];
    expect(yubiKey.address.toLowerCase() < passkey.address.toLowerCase()).to.equal(true);
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, yubiKey.address, burner.account.address]);
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 10_000n]);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, delay.address, 86400n, 0n]]);
    const ownerCall = async (to: Address, data: Hex) => {
      const signature = await signSafeTransaction(safe, burner, to, data);
      await safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    await ownerCall(guard.address, encodeFunctionData({ abi: configureYubiKeyAbi, functionName: "configureYubiKeySecondary", args: [yubiKey.address, true] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: setAssetPolicyAbi, functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] }));

    const data = encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [recipient.account.address, 300n] });
    await safe.write.execTransaction([token.address, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, safeContractSignatures(yubiKey.address, passkey.address)], { account: deployer.account });

    expect((await guard.read.spendState([token.address]))[2]).to.equal(300n);
  });

  it("accepts the configured passkey contract signature and rejects failed execution", async () => {
    const [deployer, burner, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address]);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, delay.address, 86400n, 0n]]);

    const nonce = await safe.read.nonce();
    const setGuardData = encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] });
    const burnerSignature = await signSafeTransaction(safe, burner, safe.address, setGuardData, { nonce });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, burnerSignature], { account: deployer.account });

    const ownerSignature = passkeySignature(passkey.address);
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
    expect(await safe.read.nonce()).to.equal(nonce + 1n);

    const revertData = encodeFunctionData({ abi: revertCallAbi, functionName: "revertCall" });
    await expect(safe.write.execTransaction([passkey.address, 0n, revertData, 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
  });

  it("accepts only a real Burner signature over the exact Safe hash and rejects mutations, wrong domains, and replay", async () => {
    const [deployer, burner, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address]);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, delay.address, 86400n, 0n]]);

    const signSafeHash = async (nonce: bigint, domainSafe = safe.address, chainId = 31337) => burner.signTypedData({
      domain: { chainId, verifyingContract: domainSafe }, types: safeTxTypes, primaryType: "SafeTx",
      message: { to: recipient.account.address, value: 0n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
    });
    const ownerSignature = passkeySignature(passkey.address);
    const envelope = (burnerSignature: Hex) => burnerEnvelope(passkey.address, burnerSignature);

    await deployer.sendTransaction({ to: safe.address, value: 1n });
    const policyData = encodeFunctionData({ abi: setAssetPolicyAbi, functionName: "setAssetPolicy", args: [ZERO, 1n, 1n, 100n, 1_000n, [recipient.account.address]] });
    const policySignature = await signSafeTransaction(safe, burner, guard.address, policyData);
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, policySignature], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] });
    const setupSignature = await signSafeTransaction(safe, burner, safe.address, setGuardData);
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, setupSignature], { account: deployer.account });

    const nonce = await safe.read.nonce();
    const validBurner = await signSafeTransaction(safe, burner, recipient.account.address, "0x", { value: 1n, nonce });
    await safe.write.execTransaction([recipient.account.address, 1n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(validBurner)], { account: deployer.account });
    expect(await safe.read.nonce()).to.equal(nonce + 1n);

    const nextNonce = nonce + 1n;
    const nextValid = await signSafeHash(nextNonce);
    await expect(safe.write.execTransaction([guard.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(nextValid)], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 1n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(nextValid)], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(await signSafeHash(nextNonce, safe.address, 1))], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(await signSafeHash(nextNonce, guard.address))], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(await signSafeHash(nonce))], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope("0x")], { account: deployer.account })).to.be.rejected;
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, envelope(validBurner)], { account: deployer.account })).to.be.rejected;
  });

  it("constrains the configured module and rolls back failed module checks", async () => {
    const [deployer, burner, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address]);
    const module = await hre.viem.deployContract("ModuleCaller");
    const otherModule = await hre.viem.deployContract("ModuleCaller");
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, module.address, 86400n, 0n]]);

    const ownerTx = async (to: Address, data: Hex) => {
      const signature = await signSafeTransaction(safe, burner, to, data);
      await safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    const enableData = encodeFunctionData({ abi: enableModuleAbi, functionName: "enableModule", args: [module.address] });
    const setModuleGuardData = encodeFunctionData({ abi: setModuleGuardAbi, functionName: "setModuleGuard", args: [guard.address] });
    const setGuardData = encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] });
    await ownerTx(safe.address, enableData);
    await ownerTx(safe.address, setModuleGuardData);
    await ownerTx(safe.address, setGuardData);

    await expect(otherModule.write.execute([safe.address, recipient.account.address, 0n, "0x", 0], { account: deployer.account })).to.be.rejected;
    await expect(module.write.execute([safe.address, passkey.address, 0n, encodeFunctionData({ abi: revertCallAbi, functionName: "revertCall" }), 0], { account: deployer.account })).to.be.rejected;
    await expect(module.write.execute([safe.address, recipient.account.address, 0n, "0x", 0], { account: deployer.account })).to.be.rejected;
  });
});
