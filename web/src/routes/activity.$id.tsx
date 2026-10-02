import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Card, DRow, Details, PrimaryButton, SecondaryButton, StatusBadge } from "@/components/wallet/ui";
import { LANE_COPY, effectiveStatus, formatCountdown, type ActivityItem } from "@/lib/activity-model";
import { formatEuro } from "@/lib/euro";
import { useApproval } from "@/lib/use-approval";
import { useNow, useVault } from "@/lib/vault-store";

export const Route = createFileRoute("/activity/$id")({
  head: () => ({
    meta: [
      { title: "Transfer details — Euro Account" },
      { name: "description", content: "Status, approvals and technical details for one transfer." },
      { property: "og:title", content: "Transfer details — Euro Account" },
      { property: "og:description", content: "Status, approvals and technical details for one transfer." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DetailPage,
});

const fmt = (t?: number) => (t ? new Date(t).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "—");

function DetailPage() {
  const { id } = Route.useParams();
  const { state, update } = useVault();
  const now = useNow(10_000);
  const nav = useNavigate();
  const { busy, approve } = useApproval();
  const item = state.activity.find((a) => a.id === id);

  if (!item)
    return (
      <div className="pt-16 text-center">
        <p className="font-semibold">Transfer not found</p>
        <Link to="/activity" className="mt-4 inline-block text-primary">Back to activity</Link>
      </div>
    );

  const status = effectiveStatus(item, now);
  const patch = (p: Partial<ActivityItem>) =>
    update((s) => ({ ...s, activity: s.activity.map((a) => (a.id === id ? { ...a, ...p } : a)) }));

  const executeNow = (extra: Partial<ActivityItem> = {}) =>
    update((s) => {
      const instant = item.lane !== "delayed";
      return {
        ...s,
        balance: s.balance - item.amount,
        spentFirstSigner: item.lane === "base" ? s.spentFirstSigner + item.amount : s.spentFirstSigner,
        spentInstant: instant ? s.spentInstant + item.amount : s.spentInstant,
        activity: s.activity.map((a) =>
          a.id === id ? { ...a, ...extra, status: "executed", txHash: "0x" + item.fingerprint.replace(/-/g, "").toLowerCase() } : a,
        ),
      };
    });

  const onFirstSigner = async () => {
    await approve("first");
    if (item.lane === "base") executeNow({ approvers: ["First signer"] });
    else patch({ status: "awaiting_second_signer", approvers: ["First signer"] });
  };
  const onSecondSigner = async () => {
    await approve("second");
    const approvers = [...item.approvers, state.secondSignerName];
    if (item.lane === "delayed")
      patch({
        status: "queued",
        approvers,
        earliestExecution: Date.now() + state.policy.delayHours * 3_600_000,
        expiresAt: Date.now() + (state.policy.delayHours + 7 * 24) * 3_600_000,
        queueNonce: state.activity.filter((a) => a.queueNonce !== undefined).length + 1,
      });
    else executeNow({ approvers });
  };
  const onCancel = async () => {
    await approve("first");
    patch({ status: "cancelled" });
  };

  return (
    <div className="space-y-4">
      <button onClick={() => nav({ to: "/activity" })} className="flex items-center gap-2 pt-6 text-sm font-semibold text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Activity
      </button>

      <Card className="text-center">
        <p className="text-sm text-muted-foreground">{item.direction === "in" ? "From" : "To"} {item.counterparty}</p>
        <p className="my-2 font-display text-4xl font-extrabold tabular-nums">
          {item.direction === "in" ? "+" : "−"}
          {formatEuro(item.amount)}
        </p>
        <StatusBadge status={status} />
        {status === "queued" && item.earliestExecution && (
          <p className="mt-3 text-sm text-danger-ink">
            Scheduled withdrawal. Runs in {formatCountdown(item.earliestExecution - now)} unless you cancel it.
          </p>
        )}
        {(status === "awaiting_first_signer" || status === "awaiting_second_signer") && (
          <p className="mt-3 text-sm text-approval-ink">Not yet approved — nothing will be sent until you approve.</p>
        )}
        {item.failureReason && <p className="mt-3 text-sm text-danger-ink">{item.failureReason}</p>}
      </Card>

      {item.direction === "out" && <p className="px-1 text-sm text-muted-foreground">{LANE_COPY[item.lane].title}</p>}

      <div className="space-y-3">
        {status === "awaiting_first_signer" && (
          <PrimaryButton onClick={onFirstSigner} disabled={!!busy}>{busy ? "Waiting for first signer…" : "Approve with first signer"}</PrimaryButton>
        )}
        {status === "awaiting_second_signer" && (
          <PrimaryButton onClick={onSecondSigner} disabled={!!busy}>{busy ? "Waiting for second signer…" : `Approve with ${state.secondSignerName}`}</PrimaryButton>
        )}
        {status === "ready" && (
          <PrimaryButton onClick={async () => { await approve("first"); executeNow(); }} disabled={!!busy}>
            {busy ? "Submitting…" : "Execute withdrawal"}
          </PrimaryButton>
        )}
        {(status === "queued" || status === "ready" || status === "awaiting_first_signer" || status === "awaiting_second_signer") && (
          <SecondaryButton onClick={onCancel} disabled={!!busy} className="bg-danger-soft text-danger-ink hover:bg-danger-soft/70">
            {status === "queued" || status === "ready" ? "Cancel withdrawal" : "Discard request"}
          </SecondaryButton>
        )}
      </div>

      <Card className="space-y-2 text-sm">
        <DRow k="Created" v={fmt(item.createdAt)} />
        {item.earliestExecution && <DRow k="Earliest execution" v={fmt(item.earliestExecution)} />}
        {item.expiresAt && <DRow k="Expires" v={fmt(item.expiresAt)} />}
        <DRow k="Approved by" v={item.approvers.join(", ") || "—"} />
      </Card>

      <Details>
        <DRow k="Account (Safe)" v={state.safe} />
        <DRow k="Network" v={`${state.network} · ${state.chainId}`} />
        <DRow k="Counterparty" v={item.address} />
        <DRow k="Transaction hash" v={item.txHash ?? "—"} />
        <DRow k="Queue nonce" v={item.queueNonce ?? "—"} />
        <DRow k="Call" v={`EURC.transfer(${item.address.slice(0, 10)}…, ${item.amount.toString()})`} />
        <DRow k="Fingerprint" v={item.fingerprint} />
      </Details>
    </div>
  );
}
