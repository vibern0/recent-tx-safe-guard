export function describeProvisioningError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown provisioning error";

  if (message.includes("VITE_SEPOLIA_RPC_URL")) {
    return "Set VITE_SEPOLIA_RPC_URL to a Sepolia RPC URL and restart the app before creating a passkey vault.";
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The local backend is not reachable at http://127.0.0.1:8787. Start the backend, then retry.";
  }

  if (/backend health check failed/i.test(message)) {
    return `The local backend is unhealthy. Fix its readiness error, then retry: ${message.replace(/^Backend health check failed:\s*/i, "")}`;
  }

  if (/notallowederror|cancelled|canceled/i.test(message)) {
    return "Passkey creation was cancelled. Allow the browser passkey prompt and retry.";
  }

  return `Vault setup failed: ${message}`;
}
