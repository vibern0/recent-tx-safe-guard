import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { resolveVerifiedDeployments } from "../src/config/deployments";

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) {
  throw new Error("SEPOLIA_RPC_URL is required; refusing to verify without an explicit read-only endpoint");
}

async function main(): Promise<void> {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const verified = await resolveVerifiedDeployments(client, sepolia.id);
  console.log(`verified ${Object.keys(verified.dependencies).length} dependencies on chain ${verified.chainId}`);
}

void main();
