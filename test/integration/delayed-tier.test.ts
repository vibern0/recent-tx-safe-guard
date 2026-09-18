import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { queueFingerprint } from "../../src/queue/delay";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const safeTxTypes = { SafeTx: [
  { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
  { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" }, { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
] as const };
const fn = (name: string, inputs: readonly object[]) => [{ name, type: "function", stateMutability: "nonpayable", inputs, outputs: [] }] as const;
const transferAbi = fn("transfer", [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }]);
const queueAbi = fn("execTransactionFromModule", [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }]);
const setNonceAbi = fn("setTxNonce", [{ name: "nonce", type: "uint256" }]);
const freezeAbi = fn("freeze", []);
const replaceSignerAbi = fn("replaceSigner", [{ name: "guard", type: "address" }, { name: "role", type: "uint8" }, { name: "expectedOld", type: "address" }, { name: "replacement", type: "address" }, { name: "previousOwner", type: "address" }, { name: "threshold", type: "uint256" }]);
const replaceGuardsAbi = fn("replaceGuards", [{ name: "expectedGuard", type: "address" }, { name: "replacement", type: "address" }]);
const setCooldownAbi = fn("setTxCooldown", [{ name: "cooldown", type: "uint256" }]);
const setExpirationAbi = fn("setTxExpiration", [{ name: "expiration", type: "uint256" }]);
const repairPolicyAbi = fn("repairPolicy", [
  { name: "token", type: "address" }, { name: "basePerTx", type: "uint256" }, { name: "stepUpPerTx", type: "uint256" },
  { name: "baseDaily", type: "uint256" }, { name: "instantDaily", type: "uint256" }, { name: "recipients", type: "address[]" },
]);

describe("pinned Zodiac Delay v1.1.1 integration", () => {
  async function fixture() {
    const [deployer, burner, recovery, recipient, replacement, replacement2] = await hre.viem.getWalletClients();
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
    const ownerTx = async (to: Address, data: Hex, signer = recovery) => {
      const nonce = await safe.read.nonce();
      const signature = await signer.signTypedData({ domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
      await safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signature], { account: deployer.account });
    };
    await ownerTx(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [delay.address] }));
    await ownerTx(guard.address, encodeFunctionData({ abi: fn("setMaintenance", [{ name: "replacementMaintenance", type: "address" }]), functionName: "setMaintenance", args: [maintenance.address] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: fn("setModuleGuard", [{ name: "guard", type: "address" }]), functionName: "setModuleGuard", args: [guard.address] }));
    await ownerTx(guard.address, encodeFunctionData({ abi: fn("setAssetPolicy", [{ name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" }, { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" }]), functionName: "setAssetPolicy", args: [ZERO, 50n, 100n, 50n, 100n, [recipient.account.address]] }));
    await ownerTx(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));
    const passkeySig = `0x${passkey.address.slice(2).padStart(64, "0")}${toHex(65n, { size: 32 }).slice(2)}00${toHex(0n, { size: 32 }).slice(2)}` as Hex;
    const envelope = (signature: Hex) => `${passkeySig}${signature.slice(2)}${toHex((signature.length - 2) / 2, { size: 32 }).slice(2)}b730773ff261bde7bdf630037533d4522df4bf5695e820c5373a22210670f2f9` as Hex;
    const execute = async (to: Address, data: Hex, signatures: Hex) => safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures], { account: deployer.account });
    return { deployer, burner, recovery, recipient, replacement, replacement2, safe, passkey, delay, guard, maintenance, owners, ownerTx, passkeySig, envelope, execute };
  }

  it("rejects an ECDSA passkey owner on the delayed queue path", async () => {
    const [deployer, burner, recovery, recipient] = await hre.viem.getWalletClients();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, deployer.account.address, burner.account.address, recovery.account.address, delay.address, 86400n, 0n]]);
    const owners = [deployer.account.address, burner.account.address, recovery.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await safe.write.setup([owners, 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    const sign = async (to: Address, data: Hex, signer = recovery) => signer.signTypedData({
      domain: { chainId: 31337, verifyingContract: safe.address }, types: safeTxTypes, primaryType: "SafeTx",
      message: { to, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: await safe.read.nonce() },
    });
    const ownerCall = async (to: Address, data: Hex) => safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, await sign(to, data)], { account: deployer.account });
    await ownerCall(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await ownerCall(guard.address, encodeFunctionData({ abi: fn("setAssetPolicy", [
      { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
      { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
    ]), functionName: "setAssetPolicy", args: [ZERO, 1n, 2n, 1n, 2n, [recipient.account.address]] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [recipient.account.address, 2n, "0x", 0] });
    await expect(ownerCall(delay.address, queued)).to.be.rejected;
  });

  it("exercises real Delay cooldown, FIFO execution, cancellation, and requeue", async () => {
    const f = await fixture();
    expect(await (await hre.viem.getPublicClient()).getBalance({ address: f.safe.address })).to.equal(500n);
    expect((await f.delay.read.owner()).toLowerCase()).to.equal(f.safe.address.toLowerCase());
    expect((await f.delay.read.avatar()).toLowerCase()).to.equal(f.safe.address.toLowerCase());
    expect((await f.delay.read.target()).toLowerCase()).to.equal(f.safe.address.toLowerCase());
    expect(await f.delay.read.isModuleEnabled([f.safe.address])).to.equal(true);
    expect((await f.guard.read.assetPolicy([ZERO]))[3]).to.equal(100n);
    expect(await f.guard.read.allowedRecipient([ZERO, f.recipient.account.address])).to.equal(true);
    const queue = async (amount: bigint) => {
      const data = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.recipient.account.address, amount, "0x", 0] });
      const nonce = await f.safe.read.nonce();
      const burnerSig = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
      await f.execute(f.delay.address, data, f.envelope(burnerSig));
      return data;
    };
    await queue(110n);
    const second = await queue(110n);
    expect(await f.delay.read.queueNonce()).to.equal(2n);
    await expect(f.delay.write.executeNextTx([f.recipient.account.address, 110n, "0x", 0], { account: f.deployer.account })).to.be.rejected;
    await time.increase(10);
    await f.delay.write.executeNextTx([f.recipient.account.address, 110n, "0x", 0], { account: f.deployer.account });
    await f.delay.write.executeNextTx([f.recipient.account.address, 110n, "0x", 0], { account: f.deployer.account });
    expect(await (await hre.viem.getPublicClient()).getBalance({ address: f.recipient.account.address })).not.to.equal(0n);
    const third = await queue(110n);
    const cancel = encodeFunctionData({ abi: setNonceAbi, functionName: "setTxNonce", args: [3n] });
    const cancelNonce = await f.safe.read.nonce();
    const recoverySig = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: cancel, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: cancelNonce } });
    await f.execute(f.delay.address, cancel, recoverySig);
    expect(await f.delay.read.txNonce()).to.equal(3n);
    await queue(110n);
    await queue(110n);
    await time.increase(70);
    await f.delay.write.skipExpired({ account: f.deployer.account });
    await queue(110n);
    await time.increase(10);
    await f.delay.write.executeNextTx([f.recipient.account.address, 110n, "0x", 0], { account: f.deployer.account });
    void second;
    void third;
  });

  it("requires recovery or passkey plus Burner for emergency freeze and cancellation", async () => {
    const f = await fixture();
    const freeze = encodeFunctionData({ abi: freezeAbi, functionName: "freeze" });
    await expect(f.execute(f.guard.address, freeze, f.passkeySig)).to.be.rejected;
    const nonce = await f.safe.read.nonce();
    const burnerSig = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.guard.address, value: 0n, data: freeze, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
    await f.execute(f.guard.address, freeze, f.envelope(burnerSig));
    expect(await f.guard.read.frozen()).to.equal(true);
    const item = { safe: f.safe.address, delay: f.delay.address, to: f.recipient.account.address, value: 0n, data: "0x" as Hex, operation: 0 as const, queueNonce: 0n };
    expect(queueFingerprint(item)).to.equal(await f.delay.read.getTransactionHash([item.to, item.value, item.data, item.operation]));
  });

  it("rotates a delayed signer atomically in the Safe and keeps maintenance usable", async () => {
    const f = await fixture();
    const previous = f.owners[f.owners.indexOf(f.burner.account.address) - 1] as Address;
    const repair = encodeFunctionData({ abi: replaceSignerAbi, functionName: "replaceSigner", args: [f.guard.address, 1, f.burner.account.address, f.replacement.account.address, previous, 1n] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.maintenance.address, 0n, repair, 1] });
    const nonce = await f.safe.read.nonce();
    const signature = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queued, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
    await f.execute(f.delay.address, queued, signature);
    await time.increase(10);
    await f.delay.write.executeNextTx([f.maintenance.address, 0n, repair, 1], { account: f.deployer.account });
    expect((await f.safe.read.getOwners()).map((x) => x.toLowerCase())).to.include(f.replacement.account.address.toLowerCase());
    expect((await f.safe.read.getOwners()).map((x) => x.toLowerCase())).not.to.include(f.burner.account.address.toLowerCase());
    expect((await f.guard.read.maintenance()).toLowerCase()).to.equal(f.maintenance.address.toLowerCase());
    const ownersAfterFirst = await f.safe.read.getOwners();
    const replacementIndex = ownersAfterFirst.findIndex((x) => x.toLowerCase() === f.replacement.account.address.toLowerCase());
    const previousAfterFirst = (replacementIndex === 0 ? "0x0000000000000000000000000000000000000001" : ownersAfterFirst[replacementIndex - 1]) as Address;
    const repair2 = encodeFunctionData({ abi: replaceSignerAbi, functionName: "replaceSigner", args: [f.guard.address, 1, f.replacement.account.address, f.replacement2.account.address, previousAfterFirst, 1n] });
    const queued2 = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.maintenance.address, 0n, repair2, 1] });
    const nonce2 = await f.safe.read.nonce();
    const signature2 = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queued2, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: nonce2 } });
    await f.execute(f.delay.address, queued2, signature2);
    await time.increase(10);
    await f.delay.write.executeNextTx([f.maintenance.address, 0n, repair2, 1], { account: f.deployer.account });
    expect((await f.safe.read.getOwners()).map((x) => x.toLowerCase())).to.include(f.replacement2.account.address.toLowerCase());
    expect((await f.guard.read.config())[2].toLowerCase()).to.equal(f.replacement2.account.address.toLowerCase());
  });

  it("keeps policy repair delayed, including deliberate weakening", async () => {
    const f = await fixture();
    const queueRepair = async (base: bigint, stepUp: bigint, daily: bigint, instant: bigint) => {
      const repair = encodeFunctionData({ abi: repairPolicyAbi, functionName: "repairPolicy", args: [ZERO, base, stepUp, daily, instant, [f.recipient.account.address]] });
      const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.guard.address, 0n, repair, 0] });
      const nonce = await f.safe.read.nonce();
      const signature = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queued, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
      await f.execute(f.delay.address, queued, signature);
      return repair;
    };

    const tightening = await queueRepair(40n, 90n, 40n, 90n);
    expect(await f.delay.read.queueNonce()).to.equal(1n);
    await expect(f.delay.write.executeNextTx([f.guard.address, 0n, tightening, 0], { account: f.deployer.account })).to.be.rejected;
    await time.increase(10);
    await f.delay.write.executeNextTx([f.guard.address, 0n, tightening, 0], { account: f.deployer.account });
    expect((await f.guard.read.assetPolicy([ZERO]))[0]).to.equal(40n);
    expect((await f.guard.read.assetPolicy([ZERO]))[3]).to.equal(90n);

    const weakening = await queueRepair(50n, 100n, 50n, 100n);
    expect(await f.delay.read.queueNonce()).to.equal(2n);
    await time.increase(10);
    await f.delay.write.executeNextTx([f.guard.address, 0n, weakening, 0], { account: f.deployer.account });
    const weakened = await f.guard.read.assetPolicy([ZERO]);
    expect(weakened[0]).to.equal(50n);
    expect(weakened[1]).to.equal(100n);
    expect(weakened[2]).to.equal(50n);
    expect(weakened[3]).to.equal(100n);
  });

  it("rejects a contract that imitates the guard interfaces during replacement", async () => {
    const f = await fixture();
    const fake = await hre.viem.deployContract("FakeReplacementGuard", [f.safe.address, f.passkey.address, f.burner.account.address, f.recovery.account.address, f.delay.address]);
    const repair = encodeFunctionData({ abi: replaceGuardsAbi, functionName: "replaceGuards", args: [f.guard.address, fake.address] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.maintenance.address, 0n, repair, 1] });
    const nonce = await f.safe.read.nonce();
    const signature = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queued, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
    await f.execute(f.delay.address, queued, signature);
    await time.increase(10);
    await expect(f.delay.write.executeNextTx([f.maintenance.address, 0n, repair, 1], { account: f.deployer.account })).to.be.rejected;
  });

  it("rejects an EOA replacement for the passkey role while retaining delayed signer rotation", async () => {
    const f = await fixture();
    const passkeyIndex = f.owners.indexOf(f.passkey.address);
    const previous = (passkeyIndex === 0 ? "0x0000000000000000000000000000000000000001" : f.owners[passkeyIndex - 1]) as Address;
    const repair = encodeFunctionData({ abi: replaceSignerAbi, functionName: "replaceSigner", args: [f.guard.address, 0, f.passkey.address, f.replacement.account.address, previous, 1n] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.maintenance.address, 0n, repair, 1] });
    const nonce = await f.safe.read.nonce();
    const signature = await f.recovery.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data: queued, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
    await f.execute(f.delay.address, queued, signature);
    await time.increase(10);
    await expect(f.delay.write.executeNextTx([f.maintenance.address, 0n, repair, 1], { account: f.deployer.account })).to.be.rejected;
    expect((await f.guard.read.config())[1].toLowerCase()).to.equal(f.passkey.address.toLowerCase());
  });

  it("permits only monotonic Delay tightening on the immediate owner path", async () => {
    const f = await fixture();
    const increaseCooldown = encodeFunctionData({ abi: setCooldownAbi, functionName: "setTxCooldown", args: [20n] });
    await f.execute(f.delay.address, increaseCooldown, f.passkeySig);
    await expect(f.execute(f.delay.address, encodeFunctionData({ abi: setCooldownAbi, functionName: "setTxCooldown", args: [5n] }), f.passkeySig)).to.be.rejected;
    await f.execute(f.delay.address, encodeFunctionData({ abi: setExpirationAbi, functionName: "setTxExpiration", args: [60n] }), f.passkeySig);
    await expect(f.execute(f.delay.address, encodeFunctionData({ abi: setExpirationAbi, functionName: "setTxExpiration", args: [70n] }), f.passkeySig)).to.be.rejected;
  });

  it("rejects malformed, trailing, mutated, delegatecall, and batch queue payloads", async () => {
    const f = await fixture();
    const valid = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.recipient.account.address, 110n, "0x", 0] });
    const signedQueue = async (data: Hex) => {
      const nonce = await f.safe.read.nonce();
      const signature = await f.burner.signTypedData({ domain: { chainId: 31337, verifyingContract: f.safe.address }, types: safeTxTypes, primaryType: "SafeTx", message: { to: f.delay.address, value: 0n, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } });
      return f.envelope(signature);
    };
    await expect(f.execute(f.delay.address, valid.slice(0, -2) as Hex, await signedQueue(valid.slice(0, -2) as Hex))).to.be.rejected;
    const trailing = `${valid}00` as Hex;
    await expect(f.execute(f.delay.address, trailing, await signedQueue(trailing))).to.be.rejected;
    await f.execute(f.delay.address, valid, await signedQueue(valid));
    await time.increase(10);
    await expect(f.delay.write.executeNextTx([f.recipient.account.address, 111n, "0x", 0], { account: f.deployer.account })).to.be.rejected;
    await f.delay.write.executeNextTx([f.recipient.account.address, 110n, "0x", 0], { account: f.deployer.account });
    const delegate = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.recipient.account.address, 0n, "0x", 1] });
    await expect(f.execute(f.delay.address, delegate, await signedQueue(delegate))).to.be.rejected;
    const batch = encodeFunctionData({ abi: fn("multiSend", [{ name: "transactions", type: "bytes" }]), functionName: "multiSend", args: ["0x"] });
    const batchQueue = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.recipient.account.address, 0n, batch, 0] });
    await expect(f.execute(f.delay.address, batchQueue, await signedQueue(batchQueue))).to.be.rejected;
  });
});
