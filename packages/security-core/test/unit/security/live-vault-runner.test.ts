import { expect } from "chai";
import { keccak256, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  brandVaultDeploymentPlanForTestsOnly,
  brandVerifiedVaultPrerequisitesForTestsOnly,
  planHash,
  type VaultDeploymentPlan,
  type VerifiedVaultPrerequisites,
} from "../../../src/topology/build";
import { executeVaultDeployment } from "../../../scripts/live/vault-runner";
import type { LiveContext, LiveJournal } from "../../../scripts/live/submission";

process.env.NODE_ENV = "test";

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const code = "0x6000" as Hex;
const hash = keccak256(code);
const account = privateKeyToAccount(generatePrivateKey());

function plan(): VaultDeploymentPlan {
  const transaction = (nonce: bigint, created: Address) => ({ description: "test", nonce, to: address(0), value: 0n, operation: 0 as const, data: code, expectedCreatedAddress: created, creationCodeHash: hash, expectedRuntimeCodeHash: hash });
  const value = {
    unsigned: true as const, broadcast: false as const, chainId: 11155111, deployer: account.address, startingNonce: 0n, safeProxySaltNonce: 7n,
    prerequisites: { setupHelper: transaction(0n, address(1)), guard: transaction(1n, address(2)), delay: transaction(2n, address(3)), maintenance: transaction(3n, address(4)) },
    safeProxyDeployment: { ...transaction(4n, address(5)), to: address(6) },
    safeInitializer: "0x" as Hex, setupHelperCalldata: "0x" as Hex,
    review: { owners: [address(7)] as readonly [Address], threshold: 1 as const, fallbackHandler: address(0), paymentToken: address(0), payment: 0n, paymentReceiver: address(0), transactionGuard: address(2), moduleGuard: address(2), modules: [address(3)] as const, delay: { owner: address(5), avatar: address(5), target: address(5), upstreamModules: [address(5)] as const, cooldownSeconds: 120, expirationSeconds: 600 }, periodAnchor: 0n, policyHash: hash, creationCodeHashes: { setupHelper: hash, guard: hash, delay: hash, maintenance: hash }, runtimeCodeHashes: { setupHelper: hash, guard: hash, delay: hash, maintenance: hash } },
  } satisfies VaultDeploymentPlan;
  return brandVaultDeploymentPlanForTestsOnly(Object.freeze(value));
}

function evidence(value: VaultDeploymentPlan, stage: "before-setup" | "after-setup"): VerifiedVaultPrerequisites {
  return brandVerifiedVaultPrerequisitesForTestsOnly(Object.freeze({
    stage, planHash: planHash(value), safeProxyRuntimeCodeHash: hash,
    setupHelper: { name: "setupHelper" as const, address: address(1), runtimeCodeHash: hash, bindingHash: hash, source: "test" },
    guard: { name: "guard" as const, address: address(2), runtimeCodeHash: hash, bindingHash: hash, source: "test" },
    delay: { name: "delay" as const, address: address(3), runtimeCodeHash: hash, bindingHash: hash, source: "test" },
    maintenance: { name: "maintenance" as const, address: address(4), runtimeCodeHash: hash, bindingHash: hash, source: "test" },
  }));
}

describe("reviewed vault deployment runner", () => {
  it("requires a reviewed plan before signing", async () => {
    const value = plan();
    await expect(executeVaultDeployment({ ...value } as VaultDeploymentPlan, {} as never)).to.be.rejectedWith("reviewed planner");
  });

  it("reconciles each receipt, verifies pre-setup bindings, then verifies the completed topology", async () => {
    const value = plan();
    const journal: LiveJournal = { chainId: 11155111, funder: account.address, entries: [] };
    let nonce = 0;
    const receipts = new Map<Hex, boolean>();
    const signed = new Map<Hex, Hex>();
    const calls: string[] = [];
    const live: LiveContext = {
      funder: account.address,
      chainId: async () => 11155111,
      nonce: async () => nonce,
      balance: async () => 50_000_000_000_000_000n,
      verify: async () => { calls.push("preflight"); },
      sign: async (intent) => account.signTransaction({ chainId: 11155111, type: "eip1559", to: intent.to, data: intent.data, value: intent.value, nonce: intent.nonce, gas: intent.gas, maxFeePerGas: intent.maxFeePerGas, maxPriorityFeePerGas: intent.maxPriorityFeePerGas }),
      broadcast: async (raw) => { const txHash = keccak256(raw); signed.set(txHash, raw); nonce += 1; return txHash; },
      receipt: async (transactionHash) => receipts.get(transactionHash) ? { transactionHash, status: "success" as const, gasUsed: 21_000n, effectiveGasPrice: 1n, blockNumber: 1n, blockHash: hash } : undefined,
      persist: async () => undefined,
    };
    const result = await executeVaultDeployment(value, {
      live, journal,
      feeFor: async () => ({ gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n }),
      waitForReceipt: async (transactionHash) => { calls.push(`receipt:${transactionHash}`); receipts.set(transactionHash, true); },
      verifyPrerequisites: async (_plan, stage) => { calls.push(stage); return evidence(value, stage); },
      verifyTopology: async () => ({ ok: true, failures: [], checked: ["all"] }),
    });
    expect(result.topology.ok).to.equal(true);
    expect(journal.entries.map((entry) => entry.id)).to.deep.equal(["vault-setup-helper", "vault-guard", "vault-delay", "vault-maintenance", "vault-safe"]);
    expect(journal.entries.every((entry) => entry.status === "success")).to.equal(true);
    expect(calls).to.include.members(["before-setup", "after-setup"]);
    expect(signed.size).to.equal(5);
  });

  it("obtains each fee only when its nonce is ready to submit", async () => {
    const value = plan();
    const journal: LiveJournal = { chainId: 11155111, funder: account.address, entries: [] };
    let nonce = 0;
    const receipts = new Set<Hex>();
    const feeCalls: string[] = [];
    const live: LiveContext = {
      funder: account.address,
      chainId: async () => 11155111,
      nonce: async () => nonce,
      balance: async () => 50_000_000_000_000_000n,
      verify: async () => undefined,
      sign: async (intent) => account.signTransaction({ chainId: 11155111, type: "eip1559", to: intent.to, data: intent.data, value: intent.value, nonce: intent.nonce, gas: intent.gas, maxFeePerGas: intent.maxFeePerGas, maxPriorityFeePerGas: intent.maxPriorityFeePerGas }),
      broadcast: async (raw) => { const transactionHash = keccak256(raw); nonce += 1; return transactionHash; },
      receipt: async (transactionHash) => receipts.has(transactionHash) ? { transactionHash, status: "success" as const, gasUsed: 21_000n, effectiveGasPrice: 1n, blockNumber: 1n, blockHash: hash } : undefined,
      persist: async () => undefined,
    };
    await executeVaultDeployment(value, {
      live,
      journal,
      feeFor: async (transaction) => {
        expect(journal.entries).to.have.length(Number(transaction.nonce));
        feeCalls.push(transaction.description);
        return { gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n };
      },
      waitForReceipt: async (transactionHash) => { receipts.add(transactionHash); },
      verifyPrerequisites: async (_plan, stage) => evidence(value, stage),
      verifyTopology: async () => ({ ok: true, failures: [], checked: ["all"] }),
    });
    expect(feeCalls).to.deep.equal(["test", "test", "test", "test", "test"]);
  });
});
