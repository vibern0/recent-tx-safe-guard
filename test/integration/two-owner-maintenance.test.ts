import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { deploySafeFixture, ZERO, burnerEnvelope, fn, passkeySignature, queueAbi, signSafeTransaction } from "../helpers/safe";

const freezeAbi = fn("freeze", []);
const repairSignerAbi = fn("repairSigner", [
  { name: "role", type: "uint8" },
  { name: "expectedOld", type: "address" },
  { name: "replacement", type: "address" },
]);
const setNonceAbi = fn("setTxNonce", [{ name: "nonce", type: "uint256" }]);
const repairPolicyAbi = fn("repairPolicy", [
  { name: "token", type: "address" },
  { name: "basePerTx", type: "uint256" },
  { name: "stepUpPerTx", type: "uint256" },
  { name: "baseDaily", type: "uint256" },
  { name: "instantDaily", type: "uint256" },
  { name: "recipients", type: "address[]" },
]);

describe("two-owner guard maintenance", () => {
  async function fixture() {
    const [deployer, burner, arbitrary, recipient, replacement] = await hre.viem.getWalletClients();
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const { safe, owners } = await deploySafeFixture(hre, deployer, [passkey.address, burner.account.address]);
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burner.account.address, delay.address, 86400n, 0n]]);
    const passkeySig = passkeySignature(passkey.address);
    const sign = async (to: Address, data: Hex, signer = burner) => signSafeTransaction(safe, signer, to, data);
    const envelope = (signature: Hex) => burnerEnvelope(passkey.address, signature);
    const execute = (to: Address, data: Hex, signatures: Hex) => safe.write.execTransaction([to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures], { account: deployer.account });
    const passkeyAndBurner = async (to: Address, data: Hex) => execute(to, data, envelope(await sign(to, data, burner)));
    const bootstrap = async (to: Address, data: Hex) => execute(to, data, await sign(to, data, burner));
    await bootstrap(delay.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [safe.address] }));
    await bootstrap(safe.address, encodeFunctionData({ abi: fn("enableModule", [{ name: "module", type: "address" }]), functionName: "enableModule", args: [delay.address] }));
    await bootstrap(safe.address, encodeFunctionData({ abi: fn("setModuleGuard", [{ name: "guard", type: "address" }]), functionName: "setModuleGuard", args: [guard.address] }));
    await bootstrap(safe.address, encodeFunctionData({ abi: fn("setGuard", [{ name: "guard", type: "address" }]), functionName: "setGuard", args: [guard.address] }));
    return { deployer, burner, arbitrary, recipient, replacement, safe, passkey, delay, guard, owners, passkeySig, sign, envelope, execute, passkeyAndBurner };
  }

  it("sets up the Safe with exactly passkey and Burner owners at threshold one", async () => {
    const f = await fixture();
    expect(await f.safe.read.getThreshold()).to.equal(1n);
    expect((await f.safe.read.getOwners()).map((owner) => owner.toLowerCase())).to.deep.equal(f.owners.map((owner) => owner.toLowerCase()));
    expect(f.owners.map((owner) => owner.toLowerCase())).to.deep.equal([f.passkey.address, f.burner.account.address].map((owner) => owner.toLowerCase()).sort());
  });

  it("rejects direct queued signer repair even when passkey plus Burner approve the queue", async () => {
    const f = await fixture();
    const directRepair = encodeFunctionData({ abi: repairSignerAbi, functionName: "repairSigner", args: [1, f.burner.account.address, f.replacement.account.address] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.guard.address, 0n, directRepair, 0] });
    await expect(f.passkeyAndBurner(f.delay.address, queued)).to.be.rejected;
  });

  it("rejects role 2 signer repair even when passkey plus Burner approve the queue", async () => {
    const f = await fixture();
    const repairRoleTwo = encodeFunctionData({ abi: repairSignerAbi, functionName: "repairSigner", args: [2, f.arbitrary.account.address, f.replacement.account.address] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.guard.address, 0n, repairRoleTwo, 0] });
    await expect(f.passkeyAndBurner(f.delay.address, queued)).to.be.rejected;
  });

  it("requires passkey plus Burner for freeze, cancellation, and repair", async () => {
    const f = await fixture();
    const freeze = encodeFunctionData({ abi: freezeAbi, functionName: "freeze" });
    await expect(f.execute(f.guard.address, freeze, f.passkeySig)).to.be.rejected;
    await f.passkeyAndBurner(f.guard.address, freeze);
    expect(await f.guard.read.frozen()).to.equal(true);

    const queuedRepair = encodeFunctionData({ abi: repairPolicyAbi, functionName: "repairPolicy", args: [ZERO, 1n, 2n, 1n, 2n, [f.recipient.account.address]] });
    const queued = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [f.guard.address, 0n, queuedRepair, 0] });
    await f.passkeyAndBurner(f.delay.address, queued);
    expect(await f.delay.read.queueNonce()).to.equal(1n);

    const cancel = encodeFunctionData({ abi: setNonceAbi, functionName: "setTxNonce", args: [1n] });
    await expect(f.execute(f.delay.address, cancel, f.passkeySig)).to.be.rejected;
    await f.passkeyAndBurner(f.delay.address, cancel);
    expect(await f.delay.read.txNonce()).to.equal(1n);

    const repair = encodeFunctionData({ abi: repairSignerAbi, functionName: "repairSigner", args: [1, f.burner.account.address, f.replacement.account.address] });
    await expect(f.execute(f.guard.address, repair, f.passkeySig)).to.be.rejected;
  });

  it("does not allow Burner-only or arbitrary EOA-only transactions through the guard", async () => {
    const f = await fixture();
    const freeze = encodeFunctionData({ abi: freezeAbi, functionName: "freeze" });
    await expect(f.execute(f.guard.address, freeze, await f.sign(f.guard.address, freeze, f.burner))).to.be.rejected;
    await expect(f.execute(f.recipient.account.address, "0x", await f.sign(f.recipient.account.address, "0x", f.arbitrary))).to.be.rejected;
  });
});
