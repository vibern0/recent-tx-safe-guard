import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ActivityRow, Card, PageHeader } from "@/components/wallet/ui";
import { effectiveStatus, needsAttention } from "@/lib/activity-model";
import { useNow, useVault } from "@/lib/vault-store";
import { cn } from "@/lib/utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "done", label: "Completed" },
  { id: "closed", label: "Cancelled & failed" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export const Route = createFileRoute("/activity/")({
  validateSearch: z.object({ filter: z.enum(["all", "attention", "done", "closed"]).optional() }),
  head: () => ({
    meta: [
      { title: "Activity — Euro Account" },
      { name: "description", content: "Every transfer, approval and scheduled withdrawal in one timeline." },
      { property: "og:title", content: "Activity — Euro Account" },
      { property: "og:description", content: "Every transfer, approval and scheduled withdrawal in one timeline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { filter = "all" } = Route.useSearch();
  const { state } = useVault();
  const now = useNow();
  const match = (f: FilterId, s: ReturnType<typeof effectiveStatus>) =>
    f === "all" ||
    (f === "attention" && needsAttention(s)) ||
    (f === "done" && s === "executed") ||
    (f === "closed" && (s === "cancelled" || s === "failed" || s === "expired"));
  const items = [...state.activity]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((i) => match(filter, effectiveStatus(i, now)));

  return (
    <div>
      <PageHeader title="Activity" />
      <div className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5" role="tablist" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            to="/activity"
            search={{ filter: f.id }}
            role="tab"
            aria-selected={filter === f.id}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm font-semibold",
              filter === f.id ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <Card className="p-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nothing here</p>
        ) : (
          items.map((i) => <ActivityRow key={i.id} item={i} now={now} />)
        )}
      </Card>
    </div>
  );
}
