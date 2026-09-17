import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, hashTypedData, toFunctionSelector, type Address, type Hex } from "viem";
import { createBurnerSigner, createRecoverySigner } from "../../src/signers/eip1193";
import { createPasskeySigner } from "../../src/signers/passkey";
import { type Eip1193Provider, type SafeSignerRequest, SAFE_TX_TYPES } from "../../src/signers/types";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const guardPolicyAbi = [{ name: "setAssetPolicy", type: "function", stateMutability: "nonpayable", inputs: [
  { name: "token", type: "address" }, { name: "basePerTransaction", type: "uint256" }, { name: "stepUpPerTransaction", type: "uint256" },
  { name: "baseDailyLimit", type: "uint256" }, { name: "instantDailyLimit", type: "uint256" }, { name: "recipients", type: "address[]" },
], outputs: [] }] as const;
const transferAbi = [{ name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
const queueAbi = [{ name: "execTransactionFromModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" }], outputs: [] }] as const;
const enableAbi = [{ name: "enableModule", type: "function", stateMutability: "nonpayable", inputs: [{ name: "module", type: "address" }], outputs: [] }] as const;
const setGuardAbi = [{ name: "setGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }] as const;
const setModuleGuardAbi = [{ name: "setModuleGuard", type: "function", stateMutability: "nonpayable", inputs: [{ name: "guard", type: "address" }], outputs: [] }] as const;

function walletProvider(wallet: any, publicClient: any): Eip1193Provider {
  return { request: async ({ method, params }) => {
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_accounts") return [wallet.account.address];
    if (method === "eth_signTypedData_v4") return wallet.signTypedData(JSON.parse(String((params as unknown[])[1])));
    if (method === "eth_call") return publicClient.request({ method, params });
    throw new Error(`unsupported method ${method}`);
  }};
}

describe("provider-neutral signer flow against Safe 1.5 and TieredSpendingGuard", () => {
  it("accepts passkey base, requires Burner for step-up, queues delayed action, and restricts recovery", async () => {
    const [deployer, burnerWallet, recoveryWallet, recipient] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const singleton = await hre.viem.deployContract("Safe");
    const proxy = await hre.viem.deployContract("SafeProxy", [singleton.address]);
    const safe = await hre.viem.getContractAt("Safe", proxy.address);
    const passkey = await hre.viem.deployContract("Mock1271Signer");
    const delay = await hre.viem.deployContract("ZodiacDelayV1_1_1", [safe.address, safe.address, safe.address, 10n, 60n]);
    const guard = await hre.viem.deployContract("TieredSpendingGuard", [[safe.address, passkey.address, burnerWallet.account.address, recoveryWallet.account.address, delay.address, 86400n, 0n]]);
    await safe.write.setup([[passkey.address, burnerWallet.account.address, recoveryWallet.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())), 1n, ZERO, "0x", ZERO, ZERO, 0n, ZERO], { account: deployer.account });
    await deployer.sendTransaction({ to: safe.address, value: 500n });
    const provider = (wallet: typeof recoveryWallet) => walletProvider(wallet as never, publicClient);
    const recovery = createRecoverySigner({ provider: provider(recoveryWallet), account: recoveryWallet.account.address });
    const passkeySigner = createPasskeySigner({ address: passkey.address, verifier: passkey.address, provider: provider(deployer), sign: async () => "0x" });
    const burner = createBurnerSigner({ provider: provider(burnerWallet), account: burnerWallet.account.address });
    const buildRequest = async (to: Address, value: bigint, data: Hex, providedNonce?: bigint): Promise<SafeSignerRequest> => {
      const nonce = providedNonce ?? await safe.read.nonce();
      const typedData = { domain: { chainId: 31337, verifyingContract: safe.address }, types: { SafeTx: SAFE_TX_TYPES }, primaryType: "SafeTx" as const, message: { to, value, data, operation: 0 as const, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce } };
      return { chainId: 31337, safe: safe.address, safeTxHash: await safe.read.getTransactionHash([to, value, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce]), typedData };
    };
    const execute = async (to: Address, value: bigint, data: Hex, signatures: Hex) => safe.write.execTransaction([to, value, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures], { account: deployer.account });
    const ownerCall = async (to: Address, data: Hex) => { const req = await buildRequest(to, 0n, data); await execute(to, 0n, data, await recovery.sign(req)); };

    await ownerCall(guard.address, encodeFunctionData({ abi: guardPolicyAbi, functionName: "setAssetPolicy", args: [ZERO, 50n, 100n, 50n, 150n, [recipient.account.address]] }));
    await ownerCall(delay.address, encodeFunctionData({ abi: enableAbi, functionName: "enableModule", args: [safe.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: enableAbi, functionName: "enableModule", args: [delay.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: setModuleGuardAbi, functionName: "setModuleGuard", args: [guard.address] }));
    await ownerCall(safe.address, encodeFunctionData({ abi: setGuardAbi, functionName: "setGuard", args: [guard.address] }));

    const baseData = "0x" as Hex;
    const baseRequest = await buildRequest(recipient.account.address, 40n, baseData);
    const baseSignature = await passkeySigner.sign(baseRequest);
    await execute(recipient.account.address, 40n, baseData, baseSignature);
    expect((await guard.read.spendState([ZERO]))[2]).to.equal(40n);

    const stepData = "0x" as Hex;
    const stepRequest = await buildRequest(recipient.account.address, 80n, stepData);
    await expect(execute(recipient.account.address, 80n, stepData, await passkeySigner.sign(stepRequest))).to.be.rejected;
    const stepSignature = `${await passkeySigner.sign(stepRequest)}${(await burner.sign(stepRequest)).slice(2)}` as Hex;
    await execute(recipient.account.address, 80n, stepData, stepSignature);
    expect((await guard.read.spendState([ZERO]))[2]).to.equal(120n);

    const delayedData = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [recipient.account.address, 160n, "0x", 0] });
    const delayedRequest = await buildRequest(delay.address, 0n, delayedData);
    await execute(delay.address, 0n, delayedData, `${await passkeySigner.sign(delayedRequest)}${(await burner.sign(delayedRequest)).slice(2)}` as Hex);
    expect(await delay.read.queueNonce()).to.equal(1n);

    await expect(delay.write.executeNextTx([recipient.account.address, 160n, "0x", 0], { account: deployer.account })).to.be.rejectedWith("cooldown");
    await hre.network.provider.send("evm_increaseTime", [10]);
    await hre.network.provider.send("evm_mine");
    await delay.write.executeNextTx([recipient.account.address, 160n, "0x", 0], { account: deployer.account });
    expect(await delay.read.txNonce()).to.equal(1n);

    const secondDelayedData = encodeFunctionData({ abi: queueAbi, functionName: "execTransactionFromModule", args: [recipient.account.address, 170n, "0x", 0] });
    const secondDelayedRequest = await buildRequest(delay.address, 0n, secondDelayedData);
    await execute(delay.address, 0n, secondDelayedData, `${await passkeySigner.sign(secondDelayedRequest)}${(await burner.sign(secondDelayedRequest)).slice(2)}` as Hex);
    const invalidateRequest = await buildRequest(delay.address, 0n, encodeFunctionData({ abi: [{ name: "setTxNonce", type: "function", stateMutability: "nonpayable", inputs: [{ name: "nonce", type: "uint256" }], outputs: [] }] as const, functionName: "setTxNonce", args: [2n] }));
    await execute(delay.address, 0n, invalidateRequest.typedData.message.data, await recovery.sign(invalidateRequest));
    expect(await delay.read.txNonce()).to.equal(2n);
    await expect(delay.write.executeNextTx([recipient.account.address, 170n, "0x", 0])).to.be.rejectedWith("empty");

    const repairData = encodeFunctionData({ abi: guardPolicyAbi, functionName: "setAssetPolicy", args: [ZERO, 40n, 90n, 40n, 140n, [recipient.account.address]] });
    const repairRequest = await buildRequest(guard.address, 0n, repairData);
    await expect(execute(guard.address, 0n, repairData, await passkeySigner.sign(repairRequest))).to.be.rejected;
    await execute(guard.address, 0n, repairData, await recovery.sign(repairRequest));
    expect((await guard.read.assetPolicy([ZERO]))[3]).to.equal(140n);

    const recoveryTransfer = await buildRequest(recipient.account.address, 1n, "0x");
    await expect(execute(recipient.account.address, 1n, "0x", await recovery.sign(recoveryTransfer))).to.be.rejected;

    const freezeData = toFunctionSelector("freeze()") as Hex;
    const freezeRequest = await buildRequest(guard.address, 0n, freezeData);
    await execute(guard.address, 0n, freezeData, await recovery.sign(freezeRequest));
    expect(await guard.read.frozen()).to.equal(true);
  });
});
