import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { deploySafeFixture, ZERO, burnerEnvelope, fn, passkeySignature, safeTxTypes, signSafeTransaction } from "../helpers/safe";

const setGuardAbi = fn("setGuard", [{ name: "guard", type: "address" }]);
const setModuleGuardAbi = fn("setModuleGuard", [{ name: "guard", type: "address" }]);
const enableModuleAbi = fn("enableModule", [{ name: "module", type: "address" }]);
const revertCallAbi = fn("revertCall", []);
const setAssetPolicyAbi = fn("setAssetPolicy", [
  { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" },
  { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" },
  { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
]);


describe("TieredSpendingGuard against Safe 1.5", () => {
  it("accepts the configured passkey contract signature and rejects failed execution", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address, recovery.account.address]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);

    const nonce = await safe.read.nonce();
    const setGuardData = encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] });
    const recoverySignature = await signSafeTransaction(safe, recovery, safe.address, setGuardData, { nonce });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, recoverySignature], { account: deployer.account });

    const ownerSignature = passkeySignature(passkey.address);
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
    expect(await safe.read.nonce()).to.equal(nonce + 1n);

    const revertData = encodeFunctionData({ abi: revertCallAbi, functionName: "revertCall" });
    await expect(safe.write.execTransaction([passkey.address, 0n, revertData, 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
  });

  it("accepts only a real Burner signature over the exact Safe hash and rejects mutations, wrong domains, and replay", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address, recovery.account.address]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);

    const safeTxTypes = {
      SafeTx: [
        { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
      ],
    } as const;
    const signSafeHash = async (nonce: bigint, domainSafe = safe.address, chainId = 31337) => burner.signTypedData({
      domain: { chainId, verifyingContract: domainSafe }, types: safeTxTypes, primaryType: "SafeTx",
      message: { to: recipient.account.address, value: 0n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
    });
    const ownerSignature = passkeySignature(passkey.address);
    const envelope = (burnerSignature: Hex) => burnerEnvelope(passkey.address, burnerSignature);

    await deployer.sendTransaction({ to: safe.address, value: 1n });
    const policyData = encodeFunctionData({ abi: setAssetPolicyAbi, functionName: "setAssetPolicy", args: [ZERO, 1n, 1n, 100n, 1_000n, [recipient.account.address]] });
    const policySignature = await signSafeTransaction(safe, recovery, guard.address, policyData);
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, policySignature], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] });
    const setupSignature = await signSafeTransaction(safe, recovery, safe.address, setGuardData);
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
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address, recovery.account.address]);
    const module = await hre.viem.deployContract("ModuleCaller");
    const otherModule = await hre.viem.deployContract("ModuleCaller");
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, module.address, 86400n, 0n]]);

    const ownerTx = async (to: Address, data: Hex) => {
      const signature = await signSafeTransaction(safe, recovery, to, data);
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
