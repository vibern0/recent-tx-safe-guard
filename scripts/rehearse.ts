import { execFileSync } from "node:child_process";

const forbidden = /(?:PRIVATE|SECRET|MNEMONIC|SEED|WALLET|PROVIDER|RPC|BROADCAST|DEPLOY|SIGNING|RELAYER|FORK)/i;
const present = Object.keys(process.env).filter((name) => forbidden.test(name));
if (present.length) throw new Error(`fail closed: rehearsal refuses credential/provider/broadcast environment variables: ${present.join(", ")}`);

// The test itself reads hardhat's actual network identity and controlled-clock APIs.
// No caller-supplied chain id is trusted, and no environment is forwarded.
const safeEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_PATH: process.env.NODE_PATH,
  FORCE_COLOR: process.env.FORCE_COLOR,
  REHEARSAL_LOCAL: "1",
};
execFileSync("npx", ["hardhat", "test", "test/integration/rehearsal.test.ts"], { stdio: "inherit", env: safeEnv });
console.log(JSON.stringify({ network: "hardhat-local", chainId: 31337, signed: false, broadcast: false, timeControlled: true, evidence: "testnet prototype only" }));
