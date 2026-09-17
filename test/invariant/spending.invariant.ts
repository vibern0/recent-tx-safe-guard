import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const types = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const };

describe("spending stateful invariants", () => {
  it("keeps counters bounded and monotonic within a window across mixed attempts", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const token = await hre.viem.deployContract("ERC20Mock", [safe.address, 100_000n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    const transfer = (amount: bigint) => encodeFunctionData({ abi: [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [recipient.account.address, amount] });
    const sign = async (to: Address, data: Hex, signer = recovery) => signer.signTypedData({
      domain: { chainId: 31337, verifyingContract: safe.address }, types, primaryType: "SafeTx",
      message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() },
    });
    const policyData = encodeFunctionData({ abi: [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ], outputs: [] }], functionName: "setAssetPolicy", args: [token.address, 100n, 300n, 100n, 1_000n, [recipient.account.address]] });
    await safe.write.execTransaction([guard.address, 0n, policyData, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(guard.address, policyData)], { account: deployer.account });
    const setGuardData = encodeFunctionData({ abi: [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }], functionName: "setGuard", args: [guard.address] });
    await safe.write.execTransaction([safe.address, 0n, setGuardData, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(safe.address, setGuardData)], { account: deployer.account });
    const ownerSignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const stepUp = async (data: Hex) => {
      const burnerSignature = await sign(token.address, data, burner);
      return `${ownerSignature}${burnerSignature.slice(2)}${toHex((burnerSignature.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;
    };
    const attempts: [bigint, boolean][] = [[40n, false], [50n, false], [200n, true], [300n, true], [300n, true], [200n, true]];
    let previous = 0n;
    for (const [amount, elevated] of attempts) {
      const data = transfer(amount);
      const signature = elevated ? await stepUp(data) : ownerSignature;
      try {
        await safe.write.execTransaction([token.address, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
      } catch {
        // Rejected attempts are part of the state machine and must not consume spend.
      }
      const state = await guard.read.spendState([token.address]);
      expect(state[1] <= 100n).to.equal(true);
      expect(state[2] <= 1_000n).to.equal(true);
      expect(state[2] >= previous).to.equal(true);
      previous = state[2];
    }
    const before = await guard.read.spendState([token.address]);
    await time.increaseTo(Number(before[0] + 86400n));
    await safe.write.execTransaction([token.address, 0n, transfer(100n), 0, 0n, 0n, 0n, ZERO, ZERO, ownerSignature], { account: deployer.account });
    const after = await guard.read.spendState([token.address]);
    expect(after[0]).to.equal(before[0] + 86400n);
    expect(after[1]).to.equal(100n);
    expect(after[2]).to.equal(100n);
  });
});
