import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const safeTxTypes = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const };

describe("delayed and maintenance paths against Safe 1.5", () => {
  it("atomically replaces both guard slots only through the configured Delay module", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ModuleCaller");
    const oldGuard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const newGuard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const maintenance = await hre.viem.deployContract("GuardReplacementMaintenance", [safe.address, delay.address]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });

    const sign = async (to: Address, data: Hex) => recovery.signTypedData({
      domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx",
      message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() },
    });
    const ownerTx = async (to: Address, data: Hex) => safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(to, data)], { account: deployer.account });
    await ownerTx(oldGuard.address, encodeFunctionData({ abi: [{ name: "setMaintenance", type: "function", stateMutability: "nonpayable", inputs: [{ name: "replacementMaintenance", type: "address" }], outputs: [] }], functionName: "setMaintenance", args: [maintenance.address] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: [{ name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] }], functionName: "enableModule", args: [delay.address] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: [{ name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setModuleGuard", args: [oldGuard.address] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [oldGuard.address] }));
    const replacement = encodeFunctionData({ abi: [{ name: "replaceGuards", type: "function", stateMutability: "nonpayable", inputs: [{ name: "expectedGuard", type: "address" }, { name: "replacement", type: "address" }], outputs: [] }], functionName: "replaceGuards", args: [oldGuard.address, newGuard.address] });

    await expect(delay.write.execute([safe.address, safe.address, 0n, replacement, 1], { account: deployer.account })).to.be.rejected;
    await delay.write.execute([safe.address, maintenance.address, 0n, replacement, 1], { account: deployer.account });
    expect((await maintenance.read.safe()).toLowerCase()).to.equal(safe.address.toLowerCase());
    expect((await maintenance.read.delay()).toLowerCase()).to.equal(delay.address.toLowerCase());
    const repairSigner = encodeFunctionData({ abi: [{ name: "repairSigner", type: "function", stateMutability: "nonpayable", inputs: [{ name: "role", type: "uint8" }, { name: "replacement", type: "address" }], outputs: [] }], functionName: "repairSigner", args: [1, recipient.account.address] });
    await delay.write.execute([safe.address, newGuard.address, 0n, repairSigner, 0], { account: deployer.account });
    await expect(delay.write.execute([safe.address, oldGuard.address, 0n, repairSigner, 0], { account: deployer.account })).to.be.rejected;
    const arbitraryRepair = `0xdeadbeef${"00".repeat(64)}` as Hex;
    await expect(delay.write.execute([safe.address, oldGuard.address, 0n, arbitraryRepair, 0], { account: deployer.account })).to.be.rejected;
    await expect(delay.write.execute([safe.address, maintenance.address, 0n, encodeFunctionData({ abi: [{ name: "replaceGuards", type: "function", stateMutability: "nonpayable", inputs: [{ name: "expectedGuard", type: "address" }, { name: "replacement", type: "address" }], outputs: [] }], functionName: "replaceGuards", args: [oldGuard.address, newGuard.address] }), 0], { account: deployer.account })).to.be.rejected;
  });
});
