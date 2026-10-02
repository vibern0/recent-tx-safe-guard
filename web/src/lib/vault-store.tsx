import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { euro } from "./euro";
import { fingerprintOf, type ActivityItem, type Lane } from "./activity-model";

/**
 * Simulated vault provider. Mirrors the VaultSnapshot shape from the issue so a
 * live chain-backed provider can replace it. Persists only non-secret prototype
 * state (no keys, PINs, signatures or credentials).
 */

export type Recipient = { name: string; address: string };
export type Policy = {
  firstSignerDaily: bigint; // X
  instantDaily: bigint; // Y
  perTxCap: bigint;
  delayHours: number; // Z
};
export type Onboarding = { firstSigner: boolean; secondSigner: boolean; limits: boolean; rehearsed: boolean };

export type VaultState = {
  chainId: number;
  network: string;
  safe: string;
  eurc: string;
  balance: bigint;
  policy: Policy;
  spentFirstSigner: bigint;
  spentInstant: bigint;
  resetsAt: number;
  secondSignerName: string;
  frozen: boolean;
  onboarding: Onboarding;
  recipients: Recipient[];
  activity: ActivityItem[];
  notifications: { email: boolean; push: boolean };
};

const KEY = "euro-wallet-prototype-v1";
const HOUR = 3_600_000;

const nextReset = () => {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
};

const randAddr = () =>
  "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

export function emptyState(): VaultState {
  return {
    chainId: 11155111,
    network: "Ethereum Sepolia (testnet)",
    safe: "0x5afe00000000000000000000000000000000c0de",
    eurc: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
    balance: 0n,
    policy: { firstSignerDaily: euro(250), instantDaily: euro(1000), perTxCap: euro(2500), delayHours: 24 },
    spentFirstSigner: 0n,
    spentInstant: 0n,
    resetsAt: nextReset(),
    secondSignerName: "Second signer",
    frozen: false,
    onboarding: { firstSigner: false, secondSigner: false, limits: false, rehearsed: false },
    recipients: [
      { name: "Ana Costa", address: "0x1111111111111111111111111111111111111111" },
      { name: "Lisbon Flat Rent", address: "0x2222222222222222222222222222222222222222" },
    ],
    activity: [],
    notifications: { email: true, push: false },
  };
}

export function demoState(): VaultState {
  const s = emptyState();
  const now = Date.now();
  const mk = (p: Partial<ActivityItem> & Pick<ActivityItem, "amount" | "counterparty" | "status" | "lane" | "direction">): ActivityItem => {
    const address = p.address ?? s.recipients[0]?.address ?? randAddr();
    return {
      id: crypto.randomUUID(),
      address,
      createdAt: now,
      approvers: [],
      fingerprint: fingerprintOf([address, p.amount, p.createdAt ?? now]),
      ...p,
    } as ActivityItem;
  };
  return {
    ...s,
    balance: euro(8600),
    spentFirstSigner: euro(80),
    spentInstant: euro(80),
    onboarding: { firstSigner: true, secondSigner: true, limits: true, rehearsed: true },
    activity: [
      mk({ direction: "out", amount: euro(600), counterparty: "Lisbon Flat Rent", address: s.recipients[1]?.address ?? randAddr(), lane: "step-up", status: "awaiting_second_signer", createdAt: now - 10 * 60_000, approvers: ["First signer"] }),
      mk({ direction: "out", amount: euro(3000), counterparty: "Ana Costa", lane: "delayed", status: "queued", createdAt: now - 3 * HOUR, earliestExecution: now + 21 * HOUR, expiresAt: now + 7 * 24 * HOUR, queueNonce: 4, approvers: ["First signer", "Second signer"], txHash: "0x9f3c…e1a2" }),
      mk({ direction: "out", amount: euro(80), counterparty: "Ana Costa", lane: "base", status: "executed", createdAt: now - 5 * HOUR, approvers: ["First signer"], txHash: "0x4b21…77d0" }),
      mk({ direction: "in", amount: euro(10000), counterparty: "Test euros", lane: "base", status: "executed", createdAt: now - 26 * HOUR, txHash: "0x0a7e…3c19" }),
      mk({ direction: "out", amount: euro(1200), counterparty: "Ana Costa", lane: "delayed", status: "cancelled", createdAt: now - 50 * HOUR, approvers: ["First signer", "Second signer"] }),
    ],
  };
}

// --- serialization (bigint-safe) ---
const ser = (s: VaultState) => JSON.stringify(s, (_k, v) => (typeof v === "bigint" ? { $b: v.toString() } : v));
const de = (raw: string): VaultState => {
  const saved = JSON.parse(raw, (_k, v) => (v && typeof v === "object" && "$b" in v ? BigInt(v.$b) : v)) as VaultState & {
    spentPasskey?: bigint;
    burnerName?: string;
    policy: Policy & { passkeyDaily?: bigint };
    onboarding: Onboarding & { passkey?: boolean; burner?: boolean };
  };
  return {
    ...saved,
    policy: {
      ...saved.policy,
      firstSignerDaily: saved.policy.firstSignerDaily ?? saved.policy.passkeyDaily ?? euro(250),
    },
    spentFirstSigner: saved.spentFirstSigner ?? saved.spentPasskey ?? 0n,
    secondSignerName: saved.secondSignerName ?? "Second signer",
    onboarding: {
      firstSigner: saved.onboarding.firstSigner ?? saved.onboarding.passkey ?? false,
      secondSigner: saved.onboarding.secondSigner ?? saved.onboarding.burner ?? false,
      limits: saved.onboarding.limits,
      rehearsed: saved.onboarding.rehearsed,
    },
    activity: saved.activity.map((item) => ({
      ...item,
      status: item.status === ("awaiting_passkey" as ActivityItem["status"])
        ? "awaiting_first_signer"
        : item.status === ("awaiting_burner" as ActivityItem["status"])
          ? "awaiting_second_signer"
          : item.status,
      approvers: item.approvers.map((approver) =>
        approver === "Passkey" ? "First signer" : approver === "Burner card" ? "Second signer" : approver,
      ),
    })),
  };
};

export type Classification = { lane: Lane; reason?: string };

/** Advisory, consumer-facing classification. The onchain guard remains authoritative. */
export function classify(s: VaultState, to: string, amount: bigint): Classification {
  if (s.frozen) return { lane: "blocked", reason: "Your account is frozen. Unfreeze it in Limits & security first." };
  if (amount <= 0n) return { lane: "blocked", reason: "Enter an amount above €0.00." };
  if (amount > s.balance) return { lane: "blocked", reason: "This is more than your available balance." };
  if (!s.recipients.some((r) => r.address.toLowerCase() === to.toLowerCase()))
    return { lane: "blocked", reason: "This recipient is not on your allowed list." };
  if (amount > s.policy.perTxCap) return { lane: "blocked", reason: "This is above the maximum for a single transfer." };
  if (s.spentInstant + amount > s.policy.instantDaily) return { lane: "delayed" };
  if (s.spentFirstSigner + amount > s.policy.firstSignerDaily) return { lane: "step-up" };
  return { lane: "base" };
}

type Ctx = {
  state: VaultState;
  hydrated: boolean;
  update: (fn: (s: VaultState) => VaultState) => void;
  reset: (s: VaultState) => void;
};
const VaultCtx = createContext<Ctx | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState>(emptyState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = de(raw);
        if (Date.now() >= s.resetsAt) Object.assign(s, { spentFirstSigner: 0n, spentInstant: 0n, resetsAt: nextReset() });
        setState(s);
      }
    } catch {
      /* ignore corrupt state */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, ser(state));
  }, [state, hydrated]);

  const update = useCallback((fn: (s: VaultState) => VaultState) => setState((s) => fn(s)), []);
  const reset = useCallback((s: VaultState) => setState(s), []);
  const value = useMemo(() => ({ state, hydrated, update, reset }), [state, hydrated, update, reset]);
  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export function useVault() {
  const c = useContext(VaultCtx);
  if (!c) throw new Error("useVault outside VaultProvider");
  return c;
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const newId = () => crypto.randomUUID();
export { randAddr };
