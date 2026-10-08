import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Snowflake } from "lucide-react";
import { Card, PageHeader, SecondaryButton, TestPill } from "@/components/wallet/ui";
import { formatEuro } from "@/lib/euro";
import { shortAddr, useNow, useVault } from "@/lib/vault-store";
import { formatCountdown } from "@/lib/activity-model";

export const Route = createFileRoute("/limits")({
  head: () => ({
    meta: [
      { title: "Limits & security — Euro Account" },
      { name: "description", content: "Daily limits, waiting period, allowed recipients and approval devices." },
      { property: "og:title", content: "Limits & security — Euro Account" },
      { property: "og:description", content: "Daily limits, waiting period, allowed recipients and approval devices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LimitsPage,
});

function Usage({ label, used, limit, hint }: { label: string; used: bigint; limit: bigint; hint: string }) {
  const pct = limit > 0n ? Number((used * 100n) / limit) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums">{formatEuro(used)} of {formatEuro(limit)}</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.min(pct, 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function LimitsPage() {
  const { state, update } = useVault();
  const now = useNow();
  const p = state.policy;
  return (
    <div className="space-y-4">
      <PageHeader title="Limits & security" right={<TestPill />} />
      <Card className="space-y-5">
        <Usage label="First signer today" used={state.spentFirstSigner} limit={p.firstSignerDaily} hint="Above this, your second signer is also needed." />
        <Usage label="Instant today" used={state.spentInstant} limit={p.instantDaily} hint={`Above this, transfers wait ${p.delayHours} hours and can be cancelled.`} />
        <p className="text-sm text-muted-foreground">Resets in {formatCountdown(state.resetsAt - now)}</p>
      </Card>
      <Card className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">Maximum per transfer</span><span className="font-semibold">{formatEuro(p.perTxCap)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Waiting period</span><span className="font-semibold">{p.delayHours} hours</span></div>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Allowed recipients</h2>
        <ul className="space-y-2 text-sm">
          {state.recipients.map((r) => (
            <li key={r.address} className="flex justify-between"><span>{r.name}</span><span className="font-mono text-xs text-muted-foreground">{shortAddr(r.address)}</span></li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Approval devices</h2>
        {[["First signer", state.onboarding.firstSigner], [state.secondSignerName, state.onboarding.secondSigner]].map(([n, ok]) => (
          <div key={String(n)} className="flex items-center justify-between text-sm">
            <span>{n}</span>
            <span className={ok ? "flex items-center gap-1 font-semibold text-success" : "font-semibold text-approval-ink"}>
              {ok ? <><CheckCircle2 className="size-4" aria-hidden /> Active</> : "Not set up"}
            </span>
          </div>
        ))}
      </Card>
      <SecondaryButton
        onClick={() => update((s) => ({ ...s, frozen: !s.frozen }))}
        className={state.frozen ? "" : "bg-danger-soft text-danger-ink hover:bg-danger-soft/70"}
      >
        <Snowflake className="size-4" aria-hidden /> {state.frozen ? "Unfreeze account" : "Freeze account"}
      </SecondaryButton>
      {state.frozen && <p className="text-center text-sm text-danger-ink">Frozen — no transfers can be approved.</p>}
    </div>
  );
}
