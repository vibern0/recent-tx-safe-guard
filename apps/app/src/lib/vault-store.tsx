import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPublicClient, http, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { sepolia } from "viem/chains";
import { euro } from "./euro";
import { fingerprintOf, type ActivityItem, type Lane } from "./activity-model";
import { readVaultSnapshot, type HealthFailure, type VaultConfig, type VaultSnapshot } from "./vault-chain";
import { challengeForSafeDigest, createVaultPasskey, signSafeDigest, type PasskeyRegistration } from "./webauthn-passkey";

export type Recipient = { name: string; address: string };
export type Policy = { firstSignerDaily: bigint; instantDaily: bigint; perTxCap: bigint; delayHours: number; delaySeconds: bigint };
export type Onboarding = { firstSigner: boolean; secondSigner: boolean; limits: boolean; rehearsed: boolean };

export type VaultState = {
  chainId: number; network: string; safe: string; guard: string; delay: string; eurc: string;
  balance: bigint; nativeBalance: bigint; safeNonce: bigint | null; policy: Policy;
  spentFirstSigner: bigint; spentInstant: bigint; resetsAt: number; secondSignerName: string; frozen: boolean;
  writable: boolean; health: readonly HealthFailure[]; onboarding: Onboarding; recipients: Recipient[];
  activity: ActivityItem[]; notifications: { email: boolean; push: boolean }; deploymentHash: Hex; policyHash: Hex;
};

export type VaultProvisioningResult = Readonly<{
  chainId: 11155111; safe: Address; guard: Address; delay: Address; primaryPasskey: Address; secondaryPasskey: Address; eurc: Address;
  evidence: Readonly<{ setupTransactionHash: `0x${string}`; verificationReportHash: `0x${string}` }>;
}>;

export type BridgeRegistrationOptions = Readonly<{
  sessionId: string; challenge: string; rpId: string; origin: string; role: "primary" | "secondary";
  userVerification: "required"; authenticatorAttachment: "platform";
}>;

export type VaultBridge = Readonly<{
  registerPasskey: (role: "primary" | "secondary") => Promise<PasskeyRegistration>;
  provisionVault: (input: Readonly<{ primaryCredentialId: string; secondaryCredentialId: string; eurc: Address; chainId: 11155111 }>) => Promise<VaultProvisioningResult>;
  prepareTransfer: (input: PreparedTransferInput) => Promise<SafeExecutionRequest>;
  submitPrimary: (id: Hex, signature: Hex) => Promise<SubmissionStatus>;
  submitSecondary: (id: Hex, signature: Hex) => Promise<SubmissionStatus>;
}>;

export type PreparedTransferInput = Readonly<{
  chainId: 11155111; safe: Address; guard: Address; eurc: Address; configuredEurc: Address; recipient: Address; amount: bigint; nonce: bigint;
  deploymentHash: Hex; policyHash: Hex; idempotencyKey: Hex; expectedSpend: Readonly<{ window: bigint; baseSpent: bigint; instantSpent: bigint }>;
  allowedRecipients: readonly Address[];
}>;
export type SafeExecutionRequest = Readonly<{ idempotencyKey: Hex; safeTxHash: Hex; safe: Address; chainId: 11155111; transaction: Readonly<{ to: Address; value: bigint; data: Hex; operation: 0; nonce: bigint }>; requiredApprovals?: "primary" | "secondary" | "delayed" }>;
export type SubmissionStatus = Readonly<{ id: Hex; state: "awaiting_secondary" | "queued" | "confirmed" | "reverted"; requiredApprovals: "primary" | "secondary" | "delayed"; safeTxHash: Hex; transactionHash?: Hex }>;

export type VaultProviderProps = { children: ReactNode; client?: PublicClient; config?: VaultConfig; bridge?: VaultBridge };

const KEY = "eurc-vault-demo-v1";
const UI_KEY = "eurc-vault-ui-v1";
const DEFAULT_EURC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;
const nextReset = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const randAddr = () => "0x" + Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
const unprovisionedHealth: readonly HealthFailure[] = [{ code: "unprovisioned", message: "Provision a fresh guarded Safe before using this wallet", blocking: true }];

export function emptyState(): VaultState {
  return {
    chainId: 11155111, network: "Ethereum Sepolia (testnet)", safe: "", guard: "", delay: "", eurc: "", balance: 0n, nativeBalance: 0n, safeNonce: null,
    policy: { firstSignerDaily: euro(250), instantDaily: euro(1000), perTxCap: euro(2500), delayHours: 24, delaySeconds: 86_400n },
    spentFirstSigner: 0n, spentInstant: 0n, resetsAt: nextReset(), secondSignerName: "Second signer", frozen: false, writable: false,
    health: unprovisionedHealth, onboarding: { firstSigner: false, secondSigner: false, limits: false, rehearsed: false }, recipients: [], activity: [], notifications: { email: true, push: false }, deploymentHash: "0x", policyHash: "0x",
  };
}

/** Compatibility fixture retained for unit tests; production screens never load simulated balances. */
export function demoState(): VaultState {
  const s = emptyState(); const now = Date.now(); const address = randAddr();
  const item: ActivityItem = { id: crypto.randomUUID(), direction: "in", amount: euro(100), counterparty: "Test euros", address, lane: "base", status: "executed", createdAt: now, approvers: [], fingerprint: fingerprintOf([address, now]) };
  return { ...s, balance: euro(100), activity: [item] };
}

function readUiState(): { notifications: VaultState["notifications"]; rehearsed: boolean; primaryCredentialId?: string | undefined; secondaryCredentialId?: string | undefined; deploymentHash?: Hex | undefined; policyHash?: Hex | undefined } {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_KEY) ?? "null") as Partial<{ notifications: VaultState["notifications"]; rehearsed: boolean; primaryCredentialId: string; secondaryCredentialId: string; deploymentHash: Hex; policyHash: Hex }> | null;
    return { notifications: parsed?.notifications ?? { email: true, push: false }, rehearsed: parsed?.rehearsed === true, primaryCredentialId: parsed?.primaryCredentialId, secondaryCredentialId: parsed?.secondaryCredentialId, deploymentHash: parsed?.deploymentHash as Hex | undefined, policyHash: parsed?.policyHash as Hex | undefined };
  } catch { return { notifications: { email: true, push: false }, rehearsed: false }; }
}

function readConfig(): VaultConfig | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Record<keyof VaultConfig, string>> | null;
    if (!parsed || !parsed.safe || !parsed.guard || !parsed.delay || !parsed.eurc) return undefined;
    if (![parsed.safe, parsed.guard, parsed.delay, parsed.eurc].every((value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value))) return undefined;
    return { chainId: 11155111, safe: parsed.safe as Address, guard: parsed.guard as Address, delay: parsed.delay as Address, eurc: parsed.eurc as Address, eurcCandidates: [DEFAULT_EURC] };
  } catch { return undefined; }
}

function saveConfig(config: VaultConfig): void { localStorage.setItem(KEY, JSON.stringify({ chainId: config.chainId, safe: config.safe, guard: config.guard, delay: config.delay, eurc: config.eurc, eurcCandidates: config.eurcCandidates })); }

function defaultClient(): PublicClient | undefined {
  const rpcUrl = (import.meta.env["VITE_SEPOLIA_RPC_URL"] as string | undefined)?.trim();
  return rpcUrl ? createPublicClient({ chain: sepolia, transport: http(rpcUrl) }) : undefined;
}

function defaultBridge(): VaultBridge {
  const origin = ((import.meta.env["VITE_DEMO_BRIDGE_ORIGIN"] as string | undefined)?.trim() || "http://127.0.0.1:8787").replace(/\/$/, "");
  const json = async (url: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(`${origin}${url}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const payload = JSON.parse(await response.text(), (key, value) => ["amount", "nonce", "window", "baseSpent", "instantSpent", "safeTxGas", "baseGas", "gasPrice"].includes(key) && typeof value === "string" && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value) as { error?: string; request?: SafeExecutionRequest };
    if (!response.ok) throw new Error(payload.error ?? `Bridge request failed (${response.status})`);
    return payload;
  };
  return {
    async registerPasskey(role) {
      const options = await json(`/v1/registrations/${role}/options`, { method: "POST", body: "{}" }) as BridgeRegistrationOptions;
      const registrationOptions = {
        challenge: options.challenge, rp: { id: options.rpId, name: "EURC Vault Demo" },
        user: { id: `${role}-${options.sessionId}`, name: `${role}@localhost`, displayName: role === "primary" ? "First signer" : "Second signer" },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" }, timeout: 60_000, attestation: "none",
      };
      const registration = await createVaultPasskey({ role, challenge: options.challenge, rpId: options.rpId, origin: options.origin, options: registrationOptions });
      await json(`/v1/registrations/${role}/verify`, { method: "POST", body: JSON.stringify({ sessionId: options.sessionId, registration: registration.response }) });
      return registration;
    },
    async provisionVault(input) { return json("/v1/vaults", { method: "POST", body: JSON.stringify(input) }) as Promise<VaultProvisioningResult>; },
    async prepareTransfer(input) {
      const payload = await json("/v1/submissions/prepare", { method: "POST", body: JSON.stringify(input, (_key, value) => typeof value === "bigint" ? `${value}n` : value) }) as { request?: SafeExecutionRequest } | SafeExecutionRequest;
      return ("request" in payload && payload.request ? payload.request : payload) as SafeExecutionRequest;
    },
    async submitPrimary(id, signature) { return json(`/v1/submissions/${id}/submit`, { method: "POST", body: JSON.stringify({ role: "primary", signature }) }) as Promise<SubmissionStatus>; },
    async submitSecondary(id, signature) { return json(`/v1/submissions/${id}/submit`, { method: "POST", body: JSON.stringify({ role: "secondary", signature }) }) as Promise<SubmissionStatus>; },
  };
}

function project(snapshot: VaultSnapshot, ui: { notifications: VaultState["notifications"]; rehearsed: boolean }): VaultState {
  const configured = snapshot.policy; const delaySeconds = snapshot.topology?.delay.cooldownSeconds ?? 86_400n; const delayHours = Math.max(1, Math.ceil(Number(delaySeconds) / 3_600));
  const recipients = configured?.recipients.map((address) => ({ name: address, address })) ?? [];
  const onboarding = { firstSigner: Boolean(snapshot.safe && snapshot.writable), secondSigner: Boolean(snapshot.safe && snapshot.topology?.delay && snapshot.writable), limits: Boolean(configured && configured.baseDailyLimit > 0n && configured.baseDailyLimit < configured.instantDailyLimit), rehearsed: ui.rehearsed };
  const periodAnchor = snapshot.spendState?.window;
  const activity: ActivityItem[] = snapshot.queueItems.map((item) => {
    const createdAt = Number(item.createdAt) * 1000;
    const earliestExecution = createdAt + Number(delaySeconds) * 1000;
    const expiresAt = earliestExecution + Number(snapshot.topology?.delay.expirationSeconds ?? 0n) * 1000;
    const status = expiresAt > createdAt && Date.now() >= expiresAt ? "expired" : Date.now() >= earliestExecution ? "ready" : "queued";
    return { id: `${item.txHash}:${item.queueNonce.toString()}`, direction: "out", amount: 0n, counterparty: "Delayed EURC operation", address: snapshot.safe, lane: "delayed", status, createdAt, earliestExecution, expiresAt, txHash: item.txHash, queueNonce: Number(item.queueNonce), approvers: ["First signer", "Second signer"], fingerprint: fingerprintOf([snapshot.safe, item.txHash, item.queueNonce]) } satisfies ActivityItem;
  });
  return {
    chainId: snapshot.chainId, network: "Ethereum Sepolia (testnet)", safe: snapshot.safe, guard: snapshot.topology?.guard ?? "", delay: snapshot.topology?.delay.address ?? "", eurc: snapshot.eurc?.address ?? "",
    balance: snapshot.eurcBalance ?? 0n, nativeBalance: snapshot.nativeBalance ?? 0n, safeNonce: snapshot.safeNonce ?? null,
    policy: { firstSignerDaily: configured?.baseDailyLimit ?? 0n, instantDaily: configured?.instantDailyLimit ?? 0n, perTxCap: configured?.stepUpPerTransaction ?? 0n, delayHours, delaySeconds },
    spentFirstSigner: snapshot.spendState?.baseSpent ?? 0n, spentInstant: snapshot.spendState?.instantSpent ?? 0n, resetsAt: periodAnchor && periodAnchor > 0n ? Number(periodAnchor) * 1000 : nextReset(),
    secondSignerName: "Second signer", frozen: snapshot.topology?.frozen ?? false, writable: snapshot.writable, health: snapshot.health, onboarding, recipients, activity, notifications: ui.notifications, deploymentHash: "0x", policyHash: "0x",
  };
}

export type Classification = { lane: Lane; reason?: string };
/** Advisory only; the onchain guard remains authoritative. */
export function classify(s: VaultState, to: string, amount: bigint): Classification {
  if (!s.writable || s.frozen) return { lane: "blocked", reason: s.frozen ? "Your account is frozen. Unfreeze it in Limits & security first." : "The vault is not healthy or provisioned yet." };
  if (amount <= 0n) return { lane: "blocked", reason: "Enter an amount above €0.00." };
  if (amount > s.balance) return { lane: "blocked", reason: "This is more than your available balance." };
  if (!s.recipients.some((r) => r.address.toLowerCase() === to.toLowerCase())) return { lane: "blocked", reason: "This recipient is not on your allowed list." };
  if (amount > s.policy.perTxCap) return { lane: "blocked", reason: "This is above the maximum for a single transfer." };
  if (s.spentInstant + amount > s.policy.instantDaily) return { lane: "delayed" };
  if (s.spentFirstSigner + amount > s.policy.firstSignerDaily) return { lane: "step-up" };
  return { lane: "base" };
}

type Ctx = { state: VaultState; hydrated: boolean; loading: boolean; canWrite: boolean; refresh: () => Promise<void>; provision: () => Promise<void>; sendEurc: (input: Readonly<{ recipient: Address; amount: bigint }>) => Promise<SubmissionStatus> };
const VaultCtx = createContext<Ctx | null>(null);

export function VaultProvider({ children, client: providedClient, config: providedConfig, bridge: providedBridge }: VaultProviderProps) {
  const [state, setState] = useState<VaultState>(emptyState); const [hydrated, setHydrated] = useState(false); const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<VaultConfig | undefined>(providedConfig); const client = providedClient ?? defaultClient(); const bridge = providedBridge ?? defaultBridge(); const ui = useMemo(readUiState, []);
  const refresh = useCallback(async () => {
    if (!config || !client) { const blank = emptyState(); setState({ ...blank, notifications: ui.notifications, onboarding: { ...blank.onboarding, rehearsed: ui.rehearsed } }); setLoading(false); return; }
    setLoading(true);
    try { setState(project(await readVaultSnapshot(client, config), ui)); }
    catch (error) { const blank = emptyState(); setState({ ...blank, notifications: ui.notifications, health: [{ code: "rpc-inconsistent", message: error instanceof Error ? error.message : "Vault read failed", blocking: true }] }); }
    finally { setLoading(false); setHydrated(true); }
  }, [client, config, ui]);
  useEffect(() => { const stored = providedConfig ?? readConfig(); setConfig(stored); setHydrated(true); }, [providedConfig]);
  useEffect(() => { if (hydrated) void refresh(); }, [config, hydrated, refresh]);
  useEffect(() => { if (hydrated) localStorage.setItem(UI_KEY, JSON.stringify({ ...ui, notifications: state.notifications, rehearsed: state.onboarding.rehearsed })); }, [hydrated, state.notifications, state.onboarding.rehearsed, ui]);
  const provision = useCallback(async () => {
    if (!client) throw new Error("Set VITE_SEPOLIA_RPC_URL before provisioning the demo vault");
    const primary = await bridge.registerPasskey("primary"); const secondary = await bridge.registerPasskey("secondary");
    if (primary.credentialId === secondary.credentialId) throw new Error("Primary and secondary passkeys must be distinct");
    const result = await bridge.provisionVault({ chainId: 11155111, eurc: providedConfig?.eurc ?? DEFAULT_EURC, primaryCredentialId: primary.credentialId, secondaryCredentialId: secondary.credentialId });
    const next: VaultConfig = { chainId: 11155111, safe: result.safe, guard: result.guard, delay: result.delay, eurc: result.eurc, eurcCandidates: [DEFAULT_EURC] }; saveConfig(next); localStorage.setItem(UI_KEY, JSON.stringify({ ...ui, primaryCredentialId: primary.credentialId, secondaryCredentialId: secondary.credentialId, deploymentHash: result.evidence.setupTransactionHash, policyHash: result.evidence.verificationReportHash })); setConfig(next);
  }, [bridge, client, providedConfig, ui]);
  const sendEurc = useCallback(async ({ recipient, amount }: Readonly<{ recipient: Address; amount: bigint }>) => {
    if (!state.writable || state.health.length > 0) throw new Error("vault health checks are blocking writes");
    if (!ui.primaryCredentialId || !ui.deploymentHash || !ui.policyHash) throw new Error("passkey session and reviewed deployment evidence are required");
    const idempotencyKey = keccak256(toHex(`${state.safe}:${recipient}:${amount.toString()}:${state.safeNonce?.toString() ?? ""}:${Date.now()}`));
    const prepared = await bridge.prepareTransfer({ chainId: 11155111, safe: state.safe as Address, guard: state.guard as Address, eurc: state.eurc as Address, configuredEurc: state.eurc as Address, recipient, amount, nonce: state.safeNonce ?? 0n, deploymentHash: ui.deploymentHash, policyHash: ui.policyHash, idempotencyKey, expectedSpend: { window: BigInt(Math.max(0, Math.floor(state.resetsAt / 1000) - 86_400)), baseSpent: state.spentFirstSigner, instantSpent: state.spentInstant }, allowedRecipients: state.recipients.map((entry) => entry.address as Address) });
    const origin = typeof window === "undefined" ? "http://localhost:5173" : window.location.origin;
    const assertion = (role: "primary" | "secondary", credentialId: string) => signSafeDigest({ role, safe: state.safe as Address, chainId: 11155111, safeTxHash: prepared.safeTxHash, challenge: challengeForSafeDigest(prepared.safeTxHash), challengeBinding: { safe: state.safe as Address, chainId: 11155111, safeTxHash: prepared.safeTxHash }, rpId: "localhost", origin, credentialId });
    const primary = await bridge.submitPrimary(prepared.idempotencyKey, await assertion("primary", ui.primaryCredentialId));
    if (primary.state !== "awaiting_secondary") { await refresh(); return primary; }
    if (!ui.secondaryCredentialId) throw new Error("secondary passkey session is required for this tier");
    const secondary = await bridge.submitSecondary(prepared.idempotencyKey, await assertion("secondary", ui.secondaryCredentialId));
    await refresh(); return secondary;
  }, [bridge, refresh, state, ui]);
  const value = useMemo(() => ({ state, hydrated, loading, canWrite: state.writable && state.health.length === 0, refresh, provision, sendEurc }), [state, hydrated, loading, refresh, provision, sendEurc]);
  return <VaultCtx.Provider value={value}>{children}</VaultCtx.Provider>;
}

export function useVault(): Ctx { const c = useContext(VaultCtx); if (!c) throw new Error("useVault outside VaultProvider"); return c; }
export function useNow(intervalMs = 30_000) { const [now, setNow] = useState(() => Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]); return now; }
export const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const newId = () => crypto.randomUUID();
export { randAddr };
