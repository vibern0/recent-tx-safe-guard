import { execFileSync } from "node:child_process";

const chainId = Number(process.env.REHEARSAL_CHAIN_ID ?? 31337);
if (chainId === 1) throw new Error("fail closed: rehearsal refuses Ethereum mainnet (chain 1)");
if (chainId !== 31337) throw new Error("fail closed: rehearsal only supports the local time-controlled test network");
for (const name of ["PRIVATE_KEY", "MNEMONIC", "SEPOLIA_RPC_URL", "VAULT_RPC_URL", "BROADCAST"]) {
  if (process.env[name]) throw new Error(`fail closed: rehearsal refuses secret or broadcast environment ${name}`);
}

execFileSync("npx", ["hardhat", "test", "test/integration/adversarial.test.ts", "test/integration/recovery.test.ts"], { stdio: "inherit", env: { ...process.env, REHEARSAL_LOCAL: "1" } });
console.log(JSON.stringify({ network: "hardhat-local", chainId, signed: false, broadcast: false, timeControlled: true, evidence: "testnet prototype only" }));
