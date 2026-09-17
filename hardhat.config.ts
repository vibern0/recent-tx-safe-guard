import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// solidity-coverage cleans generated artifacts between test batches. Keep the
// pinned imported Safe artifacts available for viem's deployment helper.
for (const [name, source] of [
  ["Safe", "Safe.sol/Safe.json"],
  ["SafeProxy", "proxies/SafeProxy.sol/SafeProxy.json"],
] as const) {
  const target = join(__dirname, "artifacts/@safe-global/safe-smart-account/contracts", source);
  const dependency = join(__dirname, "node_modules/@safe-global/safe-smart-account/build/artifacts/contracts", source);
  if (!existsSync(target)) {
    if (!existsSync(dependency)) throw new Error(`missing pinned ${name} artifact: ${dependency}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(dependency, target);
  }
}

const config: HardhatUserConfig = {
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};

export default config;
