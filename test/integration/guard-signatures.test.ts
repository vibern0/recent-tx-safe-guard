import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { deploySafeFixture, ZERO, burnerEnvelope, passkeySignature, safeTxTypes } from "../helpers/safe";


describe("TieredSpendingGuard against Safe 1.5", () => {
  it("accepts the configured passkey contract signature and rejects failed execution", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address, recovery.account.address]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);

    const nonce = await safe.read.nonce();
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    const setGuardHash = await safe.read.getTransactionHash([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, nonce]);
    const recoverySignature = await recovery.signTypedData({
      domain: { chainId: 31337, verifyingContract: safe.address },
      types: {
        SafeTx: [
          { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
          { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
          { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" },
          { name: "nonce", type: "uint256" },
        ],
      },
      primaryType: "SafeTx",
      message: { to: safe.address, value: 0n, data: setGuardData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
    });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, recoverySignature], { account: deployer.account });

    const ownerSignature = passkeySignature(passkey.address);
    await expect(safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
    expect(await safe.read.nonce()).to.equal(nonce + 1n);

    const revertData = encodeFunctionData({ abi: [{ name: "revertCall", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "revertCall" });
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
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [ZERO, 1n, 1n, 100n, 1_000n, [recipient.account.address]] });
    const policyNonce = await safe.read.nonce();
    const policySignature = await recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: guard.address, value: 0n, data: policyData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: policyNonce } });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, policySignature], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    const setupNonce = await safe.read.nonce();
    const setupSignature = await recovery.signTypedData({
      domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx",
      message: { to: safe.address, value: 0n, data: setGuardData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: setupNonce },
    });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, setupSignature], { account: deployer.account });

    const nonce = await safe.read.nonce();
    const validBurner = await burner.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: recipient.account.address, value: 1n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
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

    const safeTxTypes = { SafeTx: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
    ] as const };
    const ownerTx = async (to: Address, data: Hex) => {
      const nonce = await safe.read.nonce();
      const signature = await recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
      await safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    const enableData = encodeFunctionData({ abi: [{ name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] }], functionName: "enableModule", args: [module.address] });
    const setModuleGuardData = encodeFunctionData({ abi: [{ name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setModuleGuard", args: [guard.address] });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await ownerTx(safe.address, enableData);
    await ownerTx(safe.address, setModuleGuardData);
    await ownerTx(safe.address, setGuardData);

    await expect(otherModule.write.execute([safe.address, recipient.account.address, 0n, "0x", 0], { account: deployer.account })).to.be.rejected;
    await expect(module.write.execute([safe.address, passkey.address, 0n, encodeFunctionData({ abi: [{ name: "revertCall", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "revertCall" }), 0], { account: deployer.account })).to.be.rejected;
    await expect(module.write.execute([safe.address, recipient.account.address, 0n, "0x", 0], { account: deployer.account })).to.be.rejected;
  });
});
