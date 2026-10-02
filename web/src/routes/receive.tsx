import { createFileRoute, Link } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Check, Copy, ExternalLink, Gift, Wallet } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Card, DRow, Details, PrimaryButton, SecondaryButton } from "@/components/wallet/ui";
import { euro } from "@/lib/euro";
import { fingerprintOf } from "@/lib/activity-model";
import { newId, useVault } from "@/lib/vault-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/receive")({
  validateSearch: z.object({ mode: z.enum(["topup", "receive"]).optional() }),
  head: () => ({
    meta: [
      { title: "Add euros — Euro Account" },
      { name: "description", content: "Get free test euros or receive from another account." },
      { property: "og:title", content: "Add euros — Euro Account" },
      { property: "og:description", content: "Get free test euros or receive from another account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReceivePage,
});

const FAUCET = "https://faucet.circle.com/";

function ReceivePage() {
  const { mode } = Route.useSearch();
  const [tab, setTab] = useState<"topup" | "receive">(mode ?? "topup");
  return (
    <div className="space-y-5">
      <Link to="/" className="flex items-center gap-2 pt-6 text-sm font-semibold text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Home
      </Link>
      <h1 className="font-display text-2xl font-bold">Add euros</h1>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1" role="tablist">
        {([
          ["topup", "Get test euros", Gift],
          ["receive", "From another account", Wallet],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold", tab === id ? "bg-card shadow-card" : "text-muted-foreground")}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      {tab === "topup" ? <TopUp /> : <ReceiveFrom />}
    </div>
  );
}

function CopyAddress() {
  const { state } = useVault();
  const [copied, setCopied] = useState(false);
  return (
    <SecondaryButton
      onClick={async () => {
        await navigator.clipboard.writeText(state.safe);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Address copied" : "Copy account address"}
    </SecondaryButton>
  );
}

function TopUp() {
  const { update } = useVault();
  const [phase, setPhase] = useState<"idle" | "waiting" | "arrived">("idle");
  return (
    <Card className="space-y-4">
      <p>Test euros have no real value. Use them to try sending, limits and approvals safely.</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Copy your account address.</li>
        <li>Open the official test-euro faucet, paste it and request funds.</li>
        <li>Come back — we show the funds once they arrive.</li>
      </ol>
      <CopyAddress />
      <PrimaryButton
        onClick={() => {
          window.open(FAUCET, "_blank", "noopener");
          setPhase("waiting");
        }}
      >
        Open test-euro faucet <ExternalLink className="size-4" aria-hidden />
      </PrimaryButton>
      {phase === "waiting" && (
        <div className="space-y-3 rounded-2xl bg-approval-soft p-4 text-sm text-approval-ink">
          <p className="font-semibold">Waiting for funds to arrive</p>
          <p>We haven't seen a transfer yet. If the faucet says you've hit its limit, try again later.</p>
          <button
            className="font-semibold underline"
            onClick={() => {
              const amount = euro(100);
              update((s) => ({
                ...s,
                balance: s.balance + amount,
                activity: [
                  { id: newId(), direction: "in", amount, counterparty: "Test euros", address: "0xfaucet", lane: "base", status: "executed", createdAt: Date.now(), approvers: [], fingerprint: fingerprintOf([Date.now(), amount]) },
                  ...s.activity,
                ],
              }));
              setPhase("arrived");
            }}
          >
            Prototype: simulate €100.00 arriving
          </button>
        </div>
      )}
      {phase === "arrived" && (
        <p className="rounded-2xl bg-success-soft p-4 text-sm font-semibold text-success">€100.00 test euros arrived.</p>
      )}
      <Details>
        <TechRows />
      </Details>
    </Card>
  );
}

function TechRows() {
  const { state } = useVault();
  return (
    <>
      <DRow k="Account (Safe)" v={state.safe} />
      <DRow k="Network" v={state.network} />
      <DRow k="Asset" v="EURC only" />
      <DRow k="EURC contract" v={state.eurc} />
    </>
  );
}

function ReceiveFrom() {
  const { state } = useVault();
  return (
    <Card className="space-y-4">
      <div className="mx-auto w-fit rounded-2xl bg-card p-3 shadow-card">
        <QRCodeSVG value={state.safe} size={180} aria-label="QR code of your account address" />
      </div>
      <p className="break-all text-center font-mono text-sm">{state.safe}</p>
      <CopyAddress />
      <p className="rounded-2xl bg-danger-soft p-3 text-sm text-danger-ink">
        Only send test euros on the test network. Other currencies or networks may be lost in this prototype.
      </p>
      <Details>
        <TechRows />
      </Details>
    </Card>
  );
}
