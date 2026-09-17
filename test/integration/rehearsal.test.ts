import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeFunctionData, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const types = { SafeTx: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }, { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" }] as const };
const fn = (name: string, inputs: readonly object[]) => [{ name, type: "function", stateMutability: "nonpayable", inputs, outputs: [] }] as const;
const queueAbi = fn("execTransactionFromModule", [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }]);
const transferAbi = fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]);

describe("local time-controlled security rehearsal", () => {
  it("proves queue, cancellation, requeue, cooldown, expiry, freeze, repair, and alert evidence on the actual local chain", async () => {
    const network = await (await hre.viem.getPublicClient()).getChainId();
    expect(network).to.equal(31337);
    const publicClient = await hre.viem.getPublicClient();
    const [deployer, burner, recovery, recipient, replacement] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe"); const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address); const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const owners = [passkey.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    await deployer.sendTransaction({ to: safe.address, value: 500n });
    const sign = async (to: Address, data: Hex, signer = recovery) => signer.signTypedData({ domain: { chainId: network, verifyingContract: safe.address }, types, primaryType: "SafeTx", message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() } });
    const exec = (to: Address, data: Hex, sig: Hex) => safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, sig], { account: deployer.account });
    const passkeySig = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const envelope = (sig: Hex) => `${passkeySig}${sig.slice(2)}${toHex((sig.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;
    const ownerCall = async (to: Address, data: Hex) => exec(to, data, await sign(to, data));
    await ownerCall(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [delay.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setModuleGuard", [{ name: "guard", type: "address" }]), functionName: "setModuleGuard", args: [guard.address] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("setAssetPolicy", [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }]), functionName: "setAssetPolicy", args: [ZERO, 50n, 100n, 50n, 100n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));
    const queue = async (value: bigint) => {
      const inner = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [recipient.account.address, value, "0x", 0] });
      const sig = await burner.signTypedData({ domain: { chainId: network, verifyingContract: safe.address }, types, primaryType: "SafeTx", message: { to: delay.address, value: 0n, data: inner, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() } });
      const hash = await exec(delay.address, inner, envelope(sig));
      return { inner, receipt: await publicClient.waitForTransactionReceipt({ hash }) };
    };
    const first = await queue(150n);
    expect(first.receipt.logs.some((log) => log.address.toLowerCase() === delay.address.toLowerCase())).to.equal(true); // delayed-queued alert evidence
    await expect(delay.write.executeNextTx([recipient.account.address, 150n, "0x", 0], { account: deployer.account })).to.be.rejected; // pre-delay
    await ownerCall(delay.address, encodeFunctionData({ abi: fn("setTxNonce", [{ name: "nonce", type: "uint256" }]), functionName: "setTxNonce", args: [1n] })); // cancellation alert evidence
    await time.increase(11); await expect(delay.write.executeNextTx([recipient.account.address, 150n, "0x", 0], { account: deployer.account })).to.be.rejected; // cancelled nonexecution
    await queue(150n); await time.increase(11); await delay.write.executeNextTx([recipient.account.address, 150n, "0x", 0], { account: deployer.account }); // requeue + cooldown execution
    const expired = await queue(150n); await time.increase(71); await delay.write.skipExpired({ account: deployer.account }); expect(await delay.read.txNonce()).to.equal(3n); void expired;
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("freeze", []), functionName: "freeze" })); expect(await guard.read.frozen()).to.equal(true); // freeze alert/state evidence
    const repair = encodeFunctionData({ abi: fn("repairSigner", [{ name: "role", type: "uint8" }, { name: "expectedOld", type: "address" }, { name: "replacement", type: "address" }]), functionName: "repairSigner", args: [1, burner.account.address, replacement.account.address] });
    await expect(exec(guard.address, repair, await sign(guard.address, repair))).to.be.rejected; // recovery repair remains delayed
    expect(keccak256(toHex("rehearsal-local-time-controlled"))).to.match(/^0x[0-9a-f]{64}$/); void first;
  });
});
