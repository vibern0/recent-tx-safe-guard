import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

describe("TieredSpendingGuard against Safe 1.5", () => {
  it("accepts the configured passkey contract signature and rejects failed execution", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, ZERO, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });

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

    const passkeySignature = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    await safe.write.execTransaction([recipient.account.address, 0n, "0x", 0, 0n, 0n, 0n, ZERO, ZERO, passkeySignature], { account: deployer.account });
    expect(await safe.read.nonce()).to.equal(nonce + 2n);

    const revertData = encodeFunctionData({ abi: [{ name: "revertCall", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }], functionName: "revertCall" });
    await expect(safe.write.execTransaction([passkey.address, 0n, revertData, 0, 0n, 0n, 0n, ZERO, ZERO, passkeySignature], { account: deployer.account })).to.be.rejected;
  });
});
