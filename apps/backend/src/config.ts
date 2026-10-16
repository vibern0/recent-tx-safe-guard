import { isAddress, type Address } from "viem";

export type BackendConfig = Readonly<{
  host: "127.0.0.1";
  port: number;
  chainId: 11155111;
  rpId: "localhost";
  origin: string;
  rpcUrl: string;
  relayPrivateKey: `0x${string}`;
  journalPath: string;
  reviewedArtifactsPath: string;
  provisionerModulePath: string;
}>;

export type BackendEnvironment = Readonly<Record<string, string | undefined>>;

export function loadBackendConfig(env: BackendEnvironment = process.env): BackendConfig {
  const relayPrivateKey = env["BACKEND_RELAY_PRIVATE_KEY"];
  if (!relayPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(relayPrivateKey)) throw new Error("BACKEND_RELAY_PRIVATE_KEY is required and must be a local secret");
  const rpcUrl = env["BACKEND_RPC_URL"];
  if (!rpcUrl || !/^https?:\/\//.test(rpcUrl)) throw new Error("BACKEND_RPC_URL is required");
  const port = Number(env["BACKEND_PORT"] ?? "8787");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("BACKEND_PORT is invalid");
  const origin = env["BACKEND_ORIGIN"] ?? "http://localhost:5173";
  if (!/^https?:\/\/localhost(?::\d+)?$/.test(origin)) throw new Error("backend origin must be localhost");
  const journalPath = env["BACKEND_JOURNAL_PATH"];
  if (!journalPath || !journalPath.startsWith("/")) throw new Error("BACKEND_JOURNAL_PATH must point outside the repository");
  const reviewedArtifactsPath = env["BACKEND_REVIEWED_ARTIFACTS"];
  if (!reviewedArtifactsPath || !reviewedArtifactsPath.startsWith("/")) throw new Error("BACKEND_REVIEWED_ARTIFACTS must point to reviewed artifacts outside the repository");
  const provisionerModulePath = env["BACKEND_PROVISIONER_MODULE"];
  if (!provisionerModulePath || !provisionerModulePath.startsWith("/")) throw new Error("BACKEND_PROVISIONER_MODULE must point to a reviewed adapter outside the repository");
  return Object.freeze({ host: "127.0.0.1", port, chainId: 11155111, rpId: "localhost", origin, rpcUrl, relayPrivateKey: relayPrivateKey as `0x${string}`, journalPath, reviewedArtifactsPath, provisionerModulePath });
}

export function assertConfiguredAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} is not an address`);
  return value;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}
