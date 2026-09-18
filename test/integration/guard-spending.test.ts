import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { ZERO, burnerEnvelope, passkeySignature, signSafeTransaction, transferAbi } from "../helpers/safe";


describe("TieredSpendingGuard spending against Safe 1.5", () => {
  it("rejects an ECDSA passkey owner on the transfer path", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 1_000n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, deployer.account.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [deployer.account.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });

    const sign = async (to: Address, data: Hex, signer = recovery) => signSafeTransaction(safe, signer, to, data);
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 200n, 100n, 200n, [recipient.account.address]] });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(guard.address, policyData)], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(safe.address, setGuardData)], { account: deployer.account });
    const transferData = encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [recipient.account.address, 1n] });
    await expect(safe.write.execTransaction([token.address, 0n, transferData, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(token.address, transferData, deployer)], { account: deployer.account })).to.be.rejected;
    expect((await guard.read.spendState([token.address]))[2]).to.equal(0n);
  });

  it("accounts base and step-up transfers under shared per-token X/Y limits", async () => {
    const [deployer, burner, recovery, recipient, other] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 10_000n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });

    const sign = async (to: Address, value: bigint, data: Hex, signer = recovery) => signSafeTransaction(safe, signer, to, data, { value });
    const execute = async (to: Address, value: bigint, data: Hex, signature: Hex) => {
      await safe.write.execTransaction([to, value, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    const passkeySig = passkeySignature(passkey.address);
    const envelope = (burnerSignature: Hex) => burnerEnvelope(passkey.address, burnerSignature);

    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address, other.account.address]] });
    await execute(guard.address, 0n, policyData, await sign(guard.address, 0n, policyData));
    const replacementPolicy = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    await execute(guard.address, 0n, replacementPolicy, await sign(guard.address, 0n, replacementPolicy));
    expect(await guard.read.allowedRecipient([token.address, recipient.account.address])).to.equal(true);
    expect(await guard.read.allowedRecipient([token.address, other.account.address])).to.equal(false);
    const addition = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address, other.account.address]] });
    await expect(execute(guard.address, 0n, addition, await sign(guard.address, 0n, addition))).to.be.rejected;
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await execute(safe.address, 0n, setGuardData, await sign(safe.address, 0n, setGuardData));
    const transfer = (to: Address, amount: bigint) => encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [to, amount] });
    await execute(token.address, 0n, transfer(recipient.account.address, 60n), passkeySig);
    let state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(60n);
    expect(state[2]).to.equal(60n);

    await expect(execute(token.address, 0n, transfer(recipient.account.address, 50n), passkeySig)).to.be.rejected;
    const burnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(burnerSignature));
    state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(60n);
    expect(state[2]).to.equal(360n);

    await execute(token.address, 0n, transfer(recipient.account.address, 40n), passkeySig);
    const secondBurnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(secondBurnerSignature));
    const thirdBurnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(thirdBurnerSignature));
    state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(100n);
    expect(state[2]).to.equal(1_000n);

    await expect(execute(token.address, 0n, transfer(recipient.account.address, 1n), passkeySig)).to.be.rejected;
    await expect(execute(token.address, 0n, transfer(other.account.address, 1n), passkeySig)).to.be.rejected;
    const tighten = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 50n, 200n, 50n, 900n, [recipient.account.address]] });
    await execute(guard.address, 0n, tighten, passkeySig);
    const tightened = await guard.read.assetPolicy([token.address]);
    expect(tightened[0]).to.equal(50n);
    expect(tightened[2]).to.equal(50n);
    expect(tightened[3]).to.equal(900n);
  });

  it("rejects forbidden calls and non-CALL operations", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 1_000n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    const nonce = await safe.read.nonce();
    const setupSignature = await signSafeTransaction(safe, recovery, guard.address, policyData, { nonce });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, setupSignature], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    const setGuardNonce = await safe.read.nonce();
    const setGuardSignature = await signSafeTransaction(safe, recovery, safe.address, setGuardData, { nonce: setGuardNonce });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, setGuardSignature], { account: deployer.account });
    const transfer = encodeFunctionData({ abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [recipient.account.address, 1n] });
    const n = await safe.read.nonce();
    const signature = await signSafeTransaction(safe, recovery, token.address, transfer, { nonce: n });
    await expect(safe.write.execTransaction([token.address, 0n, transfer, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account })).to.be.rejected;
    expect((await guard.read.spendState([token.address]))[2]).to.equal(0n);
  });

  it("reverts a false-returning ERC20 transfer and preserves counters and balances", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const token = await hre.viem.deployContract("ERC20FalseReturnMock", [safe.address, 1_000n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    const recoveryTx = async (to: Address, data: Hex) => signSafeTransaction(safe, recovery, to, data);
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, await recoveryTx(guard.address, policyData)], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, await recoveryTx(safe.address, setGuardData)], { account: deployer.account });
    const transferData = encodeFunctionData({ abi: transferAbi, functionName: "transfer", args: [recipient.account.address, 40n] });
    const ownerSignature = passkeySignature(passkey.address);
    await expect(safe.write.execTransaction([token.address, 0n, transferData, 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
    expect((await guard.read.spendState([token.address]))[2]).to.equal(0n);
    expect(await token.read.balanceOf([safe.address])).to.equal(1_000n);
    expect(await token.read.balanceOf([recipient.account.address])).to.equal(0n);
  });
});
