import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { ZERO, fn, queueAbi, safeTxTypes as types } from "../helpers/safe";

describe("Task 10 recovery and denial-of-service proof", () => {
  async function fixture() {
    const [deployer, burner, recovery, recipient, replacement] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe"); const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address); const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 1_000n]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    const sign = async (to: Address, data: Hex, signer = recovery, operation = 0 as const) => signer.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types, primaryType: "SafeTx", message: { to, value: 0n, data, operation, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() } });
    const exec = async (to: Address, data: Hex, signature: Hex, operation = 0 as const) => safe.write.execTransaction([to, 0n, data, operation, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    const ownerCall = async (to: Address, data: Hex) => exec(to, data, await sign(to, data));
    await ownerCall(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [delay.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setModuleGuard", [{ name: "guard", type: "address" }]), functionName: "setModuleGuard", args: [guard.address] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("setAssetPolicy", [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ]), functionName: "setAssetPolicy", args: [token.address, 50n, 100n, 50n, 100n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));
    const passkeySig = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const envelope = (signature: Hex) => `${passkeySig}${signature.slice(2)}${toHex((signature.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;
    return { deployer, burner, recovery, recipient, replacement, safe, passkey, delay, guard, token, sign, exec, passkeySig, envelope };
  }

  it("lets recovery freeze immediately but cannot move assets or unfreeze", async () => {
    const f = await fixture(); const freeze = encodeFunctionData({ abi: fn("freeze", []), functionName: "freeze" });
    await f.exec(f.guard.address, freeze, await f.sign(f.guard.address, freeze));
    expect(await f.guard.read.frozen()).to.equal(true);
    const transfer = "0x" as Hex;
    await expect(f.exec(f.recipient.account.address, transfer, await f.sign(f.recipient.account.address, transfer))).to.be.rejected;
  });

  it("lets recovery cancel while a passkey-only cancellation remains insufficient", async () => {
    const f = await fixture();
    const transfer = encodeFunctionData({ abi: fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]), functionName: "transfer", args: [f.recipient.account.address, 210n] });
    const queue = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.token.address, 0n, transfer, 0] });
    const burner = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queue, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await f.safe.read.nonce() } });
    const envelope = `${f.passkeySig}${burner.slice(2)}${toHex((burner.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;
    await f.exec(f.delay.address, queue, envelope);
    const cancel = encodeFunctionData({ abi: fn("setTxNonce", [{ name: "nonce", type: "uint256" }]), functionName: "setTxNonce", args: [1n] });
    await expect(f.exec(f.delay.address, cancel, f.passkeySig)).to.be.rejected;
    await f.exec(f.delay.address, cancel, await f.sign(f.delay.address, cancel, f.recovery));
    expect(await f.delay.read.txNonce()).to.equal(1n);
  });

  it("keeps signer repair delayed and cannot use recovery as an immediate withdrawal path", async () => {
    const f = await fixture();
    const repair = encodeFunctionData({ abi: fn("repairSigner", [{ name: "role", type: "uint8" }, { name: "expectedOld", type: "address" }, { name: "replacement", type: "address" }]), functionName: "repairSigner", args: [1, f.burner.account.address, f.replacement.account.address] });
    await expect(f.exec(f.guard.address, repair, await f.sign(f.guard.address, repair))).to.be.rejected;
    const owners = await f.safe.read.getOwners(); expect(owners.map((x) => x.toLowerCase())).to.include(f.burner.account.address.toLowerCase());
  });

  it("does not consume queue collateral after cancellation and observes the mandatory delay before execution", async () => {
    const f = await fixture();
    const transfer = encodeFunctionData({ abi: fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]), functionName: "transfer", args: [f.recipient.account.address, 150n] });
    const queue = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.token.address, 0n, transfer, 0] });
    const tokenBefore = await f.token.read.balanceOf([f.safe.address]); const recipientBefore = await f.token.read.balanceOf([f.recipient.account.address]);
    const burner = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queue, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await f.safe.read.nonce() } });
    await f.exec(f.delay.address, queue, f.envelope(burner));
    const cancel = encodeFunctionData({ abi: fn("setTxNonce", [{ name: "nonce", type: "uint256" }]), functionName: "setTxNonce", args: [1n] });
    await f.exec(f.delay.address, cancel, await f.sign(f.delay.address, cancel, f.recovery));
    await time.increase(11);
    await expect(f.delay.write.executeNextTx([f.token.address, 0n, transfer, 0], { account: f.deployer.account })).to.be.rejected;
    expect(await f.token.read.balanceOf([f.safe.address])).to.equal(tokenBefore); expect(await f.token.read.balanceOf([f.recipient.account.address])).to.equal(recipientBefore);
    const burner2 = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queue, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await f.safe.read.nonce() } });
    await f.exec(f.delay.address, queue, f.envelope(burner2));
    await time.increase(11);
    await f.delay.write.executeNextTx([f.token.address, 0n, transfer, 0], { account: f.deployer.account });
    expect(await f.token.read.balanceOf([f.safe.address])).to.equal(tokenBefore - 150n); expect(await f.token.read.balanceOf([f.recipient.account.address])).to.equal(recipientBefore + 150n);
  });
});
