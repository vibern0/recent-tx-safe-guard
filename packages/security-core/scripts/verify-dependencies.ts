import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  OFFICIAL_DEPLOYMENT_REGISTRY,
  resolveVerifiedDeploymentInfrastructure,
} from "../src/config/deployments";

const chain = OFFICIAL_DEPLOYMENT_REGISTRY[sepolia.id];
const absent = chain ? Object.entries(chain).filter(([, record]) => record.evidence === "absent").map(([name]) => name) : [];

if (absent.length > 0) {
  console.log(`dependency evidence absent on Sepolia: ${absent.join(", ")}`);
  console.log("guard, Delay, and maintenance instance verification is deferred to Task 4.");
  process.exit(0);
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live dependency verification`);
  return value;
};

async function main(): Promise<void> {
  const rpcUrl = required("SEPOLIA_RPC_URL");
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const verified = await resolveVerifiedDeploymentInfrastructure(client, {
    chainId: sepolia.id,
    deployer: required("DEPLOYER_ADDRESS") as Address,
    expectedDeployerNonce: BigInt(required("DEPLOYER_EXPECTED_NONCE")),
    passkeySigner: {
      address: required("PASSKEY_SIGNER_ADDRESS") as Address,
      runtimeCodeHash: required("PASSKEY_SIGNER_RUNTIME_CODE_HASH") as Hex,
      bindingHash: required("PASSKEY_SIGNER_BINDING_HASH") as Hex,
      source: "operator-provided task-3 evidence",
      binding: {
        x: BigInt(required("PASSKEY_SIGNER_X")),
        y: BigInt(required("PASSKEY_SIGNER_Y")),
        verifiers: BigInt(required("PASSKEY_SIGNER_VERIFIERS")),
      },
    },
  });
  console.log(`verified deployment infrastructure on chain ${verified.chainId}`);
}

void main();
