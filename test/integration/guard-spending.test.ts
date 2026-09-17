import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const safeTxTypes = {
  SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ],
} as const;

describe("TieredSpendingGuard spending against Safe 1.5", () => {
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

    const sign = async (to: Address, value: bigint, data: Hex, signer = recovery) => {
      const nonce = await safe.read.nonce();
      return signer.signTypedData({
        domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx",
        message: { to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce },
      });
    };
    const execute = async (to: Address, value: bigint, data: Hex, signature: Hex) => {
      await safe.write.execTransaction([to, value, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    const passkeySignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const envelope = (burnerSignature: Hex) => `${passkeySignature}${burnerSignature.slice(2)}${toHex((burnerSignature.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;

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

    const transfer = (to: Address, amount: bigint) => encodeFunctionData({ abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [to, amount] });
    await execute(token.address, 0n, transfer(recipient.account.address, 60n), passkeySignature);
    let state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(60n);
    expect(state[2]).to.equal(60n);

    await expect(execute(token.address, 0n, transfer(recipient.account.address, 50n), passkeySignature)).to.be.rejected;
    const burnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(burnerSignature));
    state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(60n);
    expect(state[2]).to.equal(360n);

    await execute(token.address, 0n, transfer(recipient.account.address, 40n), passkeySignature);
    const secondBurnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(secondBurnerSignature));
    const thirdBurnerSignature = await sign(token.address, 0n, transfer(recipient.account.address, 300n), burner);
    await execute(token.address, 0n, transfer(recipient.account.address, 300n), envelope(thirdBurnerSignature));
    state = await guard.read.spendState([token.address]);
    expect(state[1]).to.equal(100n);
    expect(state[2]).to.equal(1_000n);

    await expect(execute(token.address, 0n, transfer(recipient.account.address, 1n), passkeySignature)).to.be.rejected;
    await expect(execute(token.address, 0n, transfer(other.account.address, 1n), passkeySignature)).to.be.rejected;
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
    const passkeySignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    const nonce = await safe.read.nonce();
    const setupSignature = await recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: guard.address, value: 0n, data: policyData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, setupSignature], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    const setGuardNonce = await safe.read.nonce();
    const setGuardSignature = await recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: safe.address, value: 0n, data: setGuardData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: setGuardNonce } });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, setGuardSignature], { account: deployer.account });
    const transfer = encodeFunctionData({ abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [recipient.account.address, 1n] });
    const n = await safe.read.nonce();
    const signature = await recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: token.address, value: 0n, data: transfer, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: n } });
    await expect(safe.write.execTransaction([token.address, 0n, transfer, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account })).to.be.rejected;
    expect((await guard.read.spendState([token.address]))[2]).to.equal(0n);
    void passkeySignature;
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
    const safeTxTypes = { SafeTx: [
      { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
    ] as const };
    const recoveryTx = async (to: Address, data: Hex) => recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() } });
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, await recoveryTx(guard.address, policyData)], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, await recoveryTx(safe.address, setGuardData)], { account: deployer.account });
    const transferData = encodeFunctionData({ abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [recipient.account.address, 40n] });
    const ownerSignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    await expect(safe.write.execTransaction([token.address, 0n, transferData, 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account })).to.be.rejected;
    expect((await guard.read.spendState([token.address]))[2]).to.equal(0n);
    expect(await token.read.balanceOf([safe.address])).to.equal(1_000n);
    expect(await token.read.balanceOf([recipient.account.address])).to.equal(0n);
  });
});
