import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const types = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] as const };
const fn = (name: string, inputs: readonly object[]) => [{ name, type: "function", stateMutability: "nonpayable", inputs, outputs: [] }] as const;
const queueAbi = fn("execTransactionFromModule", [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }]);
const setNonceAbi = fn("setTxNonce", [{ name: "nonce", type: "uint256" }]);
const replaceSignerAbi = fn("replaceSigner", [{ name: "guard", type: "address" }, { name: "role", type: "uint8" }, { name: "expectedOld", type: "address" }, { name: "replacement", type: "address" }, { name: "previousOwner", type: "address" }, { name: "threshold", type: "uint256" }]);

describe("local time-controlled security rehearsal", () => {
  it("proves real X/Y spending, delayed cancellation/expiry/execution, and delayed recovery repair", async () => {
    const publicClient = await hre.viem.getPublicClient();
    const network = await publicClient.getChainId();
    expect(network).to.equal(31337);
    const [deployer, burner, recovery, recipient, replacement] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const maintenance = await hre.viem.deployContract("GuardReplacementMaintenance", [safe.address, delay.address]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    await deployer.sendTransaction({ to: safe.address, value: 500n });

    const sign = async (to: Address, value: bigint, data: Hex, signer = recovery) => signer.signTypedData({ domain: { chainId: network, verifyingContract: safe.address }, types, primaryType: "SafeTx", message: { to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() } });
    const exec = (to: Address, value: bigint, data: Hex, signature: Hex, operation = 0 as const) => safe.write.execTransaction([to, value, data, operation, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    const ownerCall = async (to: Address, data: Hex, signer = recovery) => exec(to, 0n, data, await sign(to, 0n, data, signer));
    const passkeySignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const envelope = (signature: Hex) => `${passkeySignature}${signature.slice(2)}${toHex((signature.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;

    await ownerCall(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [delay.address] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("setMaintenance", [{ name: "replacementMaintenance", type: "address" }]), functionName: "setMaintenance", args: [maintenance.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setModuleGuard", [{ name: "guard", type: "address" }]), functionName: "setModuleGuard", args: [guard.address] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("setAssetPolicy", [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }]), functionName: "setAssetPolicy", args: [ZERO, 25n, 100n, 50n, 100n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));

    await exec(recipient.account.address, 25n, "0x", passkeySignature);
    await exec(recipient.account.address, 25n, "0x", passkeySignature);
    expect((await guard.read.spendState([ZERO]))[1]).to.equal(50n);
    expect((await guard.read.spendState([ZERO]))[2]).to.equal(50n);
    await expect(exec(recipient.account.address, 1n, "0x", passkeySignature)).to.be.rejected;

    const stepSignature = await sign(recipient.account.address, 50n, "0x", burner);
    await exec(recipient.account.address, 50n, "0x", envelope(stepSignature));
    expect((await guard.read.spendState([ZERO]))[2]).to.equal(100n);
    await expect(exec(recipient.account.address, 101n, "0x", passkeySignature)).to.be.rejected;
    await time.increase(86401);

    const queue = async (value: bigint, data: Hex = "0x", target: Address = recipient.account.address, operation = 0 as const, signer = burner, includeBurner = true) => {
      const inner = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [target, value, data, operation] });
      const signature = await sign(delay.address, 0n, inner, signer);
      await exec(delay.address, 0n, inner, includeBurner ? envelope(signature) : signature);
      return { inner, target, value, data, operation };
    };
    const beforeCancelSafe = await publicClient.getBalance({ address: safe.address });
    const beforeCancelRecipient = await publicClient.getBalance({ address: recipient.account.address });
    const first = await queue(150n);
    expect(await delay.read.queueNonce()).to.equal(1n);
    await expect(delay.write.executeNextTx([first.target, first.value, first.data, first.operation], { account: deployer.account })).to.be.rejected;
    await ownerCall(delay.address, encodeFunctionData({ abi: setNonceAbi, functionName: "setTxNonce", args: [1n] }));
    await time.increase(11);
    await expect(delay.write.executeNextTx([first.target, first.value, first.data, first.operation], { account: deployer.account })).to.be.rejected;
    expect(await publicClient.getBalance({ address: safe.address })).to.equal(beforeCancelSafe);
    expect(await publicClient.getBalance({ address: recipient.account.address })).to.equal(beforeCancelRecipient);

    const second = await queue(150n);
    await time.increase(11);
    await delay.write.executeNextTx([second.target, second.value, second.data, second.operation], { account: deployer.account });
    expect(await publicClient.getBalance({ address: recipient.account.address })).to.equal(beforeCancelRecipient + 150n);

    const expired = await queue(150n);
    const txNonceBeforeExpiry = await delay.read.txNonce();
    const cooldown = await delay.read.txCooldown();
    const expiration = await delay.read.txExpiration();
    await time.increase(cooldown + expiration + 1n);
    await delay.write.skipExpired({ account: deployer.account });
    expect(await delay.read.txNonce()).to.equal(txNonceBeforeExpiry + 1n);
    await expect(delay.write.executeNextTx([expired.target, expired.value, expired.data, expired.operation], { account: deployer.account })).to.be.rejected;
    expect(await publicClient.getBalance({ address: safe.address })).to.equal(beforeCancelSafe - 150n);
    expect(await publicClient.getBalance({ address: recipient.account.address })).to.equal(beforeCancelRecipient + 150n);

    await ownerCall(guard.address, encodeFunctionData({ abi: fn("freeze", []), functionName: "freeze", args: [] }));
    expect(await guard.read.frozen()).to.equal(true);
    const burnerIndex = owners.findIndex((owner) => owner.toLowerCase() === burner.account.address.toLowerCase());
    const previousOwner = (burnerIndex === 0 ? "0x0000000000000000000000000000000000000001" : owners[burnerIndex - 1]) as Address;
    const repair = encodeFunctionData({ abi: replaceSignerAbi, functionName: "replaceSigner", args: [guard.address, 1, burner.account.address, replacement.account.address, previousOwner, 1n] });
    const repairQueue = await queue(0n, repair, maintenance.address, 1, recovery, false);
    await expect(delay.write.executeNextTx([repairQueue.target, repairQueue.value, repairQueue.data, repairQueue.operation], { account: deployer.account })).to.be.rejected;
    await time.increase(11);
    await delay.write.executeNextTx([repairQueue.target, repairQueue.value, repairQueue.data, repairQueue.operation], { account: deployer.account });
    expect((await guard.read.config())[2].toLowerCase()).to.equal(replacement.account.address.toLowerCase());
    expect((await safe.read.getOwners()).map((owner) => owner.toLowerCase())).to.include(replacement.account.address.toLowerCase());
  });
});
