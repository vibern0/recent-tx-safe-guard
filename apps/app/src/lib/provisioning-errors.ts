export function describeProvisioningError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown provisioning error";

  if (message.includes("VITE_SEPOLIA_RPC_URL")) {
    return "Set VITE_SEPOLIA_RPC_URL to a Sepolia RPC URL and restart the app before creating a passkey vault.";
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The local demo bridge is not reachable at http://127.0.0.1:8787. Start the bridge, then retry.";
  }

  if (/notallowederror|cancelled|canceled/i.test(message)) {
    return "Passkey creation was cancelled. Allow the browser passkey prompt and retry.";
  }

  return `Vault setup failed: ${message}`;
}
