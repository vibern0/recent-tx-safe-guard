import type { Address, Hex } from "viem";

export type ActivityKind = "step-up-executed" | "delayed-queued" | "delayed-cancelled" | "delayed-executed" | "delayed-expired" | "delayed-frozen" | "delayed-repair";

export type ActivityBase = Readonly<{
  kind: ActivityKind;
  chainId: number;
  safe: Address;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}>;

export type ActivityAlert = ActivityBase & Readonly<{
  guard?: Address;
  delay?: Address;
  token?: Address;
  recipient?: Address;
  amount?: bigint;
  baseSpent?: bigint;
  instantSpent?: bigint;
  window?: bigint;
  queueNonce?: bigint;
  queueFingerprint?: Hex;
  createdAt?: bigint;
  expiresAt?: bigint;
  cancelledThrough?: bigint;
  repairSelector?: Hex;
}>;

/** Notification is intentionally the only capability exposed by this port. */
export interface Notifier {
  notify(alert: ActivityAlert): Promise<void>;
}

export function createStdoutNotifier(write: (line: string) => void = console.log): Notifier {
  return { notify: async alert => write(JSON.stringify(alert, (_, value) => typeof value === "bigint" ? value.toString() : value)) };
}

export type WebhookFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number }>;

export function createWebhookNotifier(url: string, fetcher: WebhookFetch = async (target, init) => {
  const response = await fetch(target, init);
  return { ok: response.ok, status: response.status };
}): Notifier {
  return {
    notify: async alert => {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(alert, (_, value) => typeof value === "bigint" ? value.toString() : value),
      });
      if (!response.ok) throw new Error(`notification webhook returned HTTP ${response.status}`);
    },
  };
}
