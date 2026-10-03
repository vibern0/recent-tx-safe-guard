import { createFileRoute, Link } from "@tanstack/react-router";
import { Switch } from "@/components/ui/switch";
import { Card, DRow, Details, PageHeader, SecondaryButton, TestPill } from "@/components/wallet/ui";
import { demoState, emptyState, useVault } from "@/lib/vault-store";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Euro Account" },
      { name: "description", content: "Test account details, notifications, rehearsals and recovery." },
      { property: "og:title", content: "Profile — Euro Account" },
      { property: "og:description", content: "Test account details, notifications, rehearsals and recovery." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { state, update, reset } = useVault();
  const n = state.notifications;
  return (
    <div className="space-y-4">
      <PageHeader title="Profile" right={<TestPill />} />
      <Card>
        <p className="font-semibold">Personal account</p>
        <p className="text-sm text-muted-foreground">This is a test account. Euros here have no real value.</p>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Notifications</h2>
        {(["email", "push"] as const).map((k) => (
          <label key={k} className="flex items-center justify-between text-sm">
            {k === "email" ? "Email alerts for scheduled withdrawals" : "Push alerts for approvals"}
            <Switch checked={n[k]} onCheckedChange={(v) => update((s) => ({ ...s, notifications: { ...s.notifications, [k]: v } }))} />
          </label>
        ))}
      </Card>
      <Card className="space-y-2">
        <h2 className="font-semibold">Safety exercises & recovery</h2>
        <p className="text-sm text-muted-foreground">
          {state.onboarding.rehearsed ? "All rehearsals completed." : "Rehearsals not finished yet."}
        </p>
        <Link to="/onboarding" className="text-sm font-semibold text-primary">Open setup checklist</Link>
      </Card>
      <Details>
        <DRow k="Account (Safe)" v={state.safe} />
        <DRow k="Network" v={`${state.network} · ${state.chainId}`} />
        <DRow k="EURC contract" v={state.eurc} />
        <DRow k="Guard" v="TieredSpendingGuard" />
        <DRow k="Delay module" v="Zodiac Delay" />
      </Details>
      <Card className="space-y-3">
        <h2 className="font-semibold">Prototype tools</h2>
        <SecondaryButton onClick={() => reset(demoState())}>Load funded demo account</SecondaryButton>
        <SecondaryButton onClick={() => reset(emptyState())}>Start over (empty account)</SecondaryButton>
      </Card>
    </div>
  );
}
