import { isAddress, type Address } from "viem";

export type BridgeConfig = Readonly<{
  host: "127.0.0.1";
  port: number;
  chainId: 11155111;
  rpId: "localhost";
  origin: string;
  rpcUrl: string;
  relayPrivateKey: `0x${string}`;
  journalPath: string;
}>;

export type BridgeEnvironment = Readonly<Record<string, string | undefined>>;

export function loadBridgeConfig(env: BridgeEnvironment = process.env): BridgeConfig {
  const relayPrivateKey = env["DEMO_BRIDGE_RELAY_PRIVATE_KEY"];
  if (!relayPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(relayPrivateKey)) throw new Error("DEMO_BRIDGE_RELAY_PRIVATE_KEY is required and must be a local secret");
  const rpcUrl = env["DEMO_BRIDGE_RPC_URL"];
  if (!rpcUrl || !/^https?:\/\//.test(rpcUrl)) throw new Error("DEMO_BRIDGE_RPC_URL is required");
  const port = Number(env["DEMO_BRIDGE_PORT"] ?? "8787");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("DEMO_BRIDGE_PORT is invalid");
  const origin = env["DEMO_BRIDGE_ORIGIN"] ?? "http://localhost:5173";
  if (!/^https?:\/\/localhost(?::\d+)?$/.test(origin)) throw new Error("demo bridge origin must be localhost");
  const journalPath = env["DEMO_BRIDGE_JOURNAL_PATH"];
  if (!journalPath || !journalPath.startsWith("/")) throw new Error("DEMO_BRIDGE_JOURNAL_PATH must point outside the repository");
  return Object.freeze({ host: "127.0.0.1", port, chainId: 11155111, rpId: "localhost", origin, rpcUrl, relayPrivateKey: relayPrivateKey as `0x${string}`, journalPath });
}

export function assertConfiguredAddress(value: string, label: string): Address {
  if (!isAddress(value)) throw new Error(`${label} is not an address`);
  return value;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}
