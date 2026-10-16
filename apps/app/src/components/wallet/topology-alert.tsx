import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "./ui";
import { useVault } from "@/lib/vault-store";

export function TopologyAlert() {
  const { state, loading } = useVault();
  if (loading) return null;
  if (state.health.length === 0) return <p className="flex items-center gap-2 rounded-2xl bg-success-soft p-3 text-sm font-semibold text-success"><CheckCircle2 className="size-4" aria-hidden /> Guard, Delay, and EURC checks passed.</p>;
  return <div role="alert"><Card className="border border-danger/30 bg-danger-soft p-4 text-danger-ink"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden /><div className="space-y-1"><p className="font-semibold">Wallet writes are disabled</p>{state.health.map((failure) => <p key={`${failure.code}:${failure.message}`} className="text-sm">{failure.message}</p>)}<p className="pt-1 text-xs">This demo trusts chain verification, not local UI state.</p></div></div></Card></div>;
}
