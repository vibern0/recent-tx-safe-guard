import type { Address, Hex } from "viem";
import { isOfficialVerifiedDeployments, type VerifiedDeployments } from "../config/deployments";
import type { Eip1193Provider, SafeSigner, SafeSignerRequest } from "./types";
import { createPasskeySignerCore } from "./passkey-core";

export type PasskeySignerOptions = Readonly<{
  address: Address;
  provider: Eip1193Provider;
  sign(request: SafeSignerRequest): Promise<Hex>;
  deployments: VerifiedDeployments;
}>;


/** Safe-native passkey adapter. ERC-1271 is queried at the configured signer identity. */
export function createPasskeySigner(options: PasskeySignerOptions): SafeSigner {
  if (!isOfficialVerifiedDeployments(options.deployments)) throw new Error("passkey verifier requires official deployment evidence");
  const verifier = options.deployments.dependencies.passkeySignerVerifier;
  if (verifier.evidence !== "verified" || !verifier.runtimeCodeHash || !/^0x[0-9a-f]{64}$/i.test(verifier.runtimeCodeHash) || verifier.address.toLowerCase() !== options.address.toLowerCase()) throw new Error("verifier must be an officially verified configured passkey");
  return createPasskeySignerCore({ address: options.address, verifierAddress: verifier.address, chainId: options.deployments.chainId, provider: options.provider, sign: options.sign });
}
