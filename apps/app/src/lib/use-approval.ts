import { useState } from "react";

/**
 * Prototype signer simulation. A real build calls the configured first- and second-signer adapters; nothing is stored here.
 */
export function useApproval() {
  const [busy, setBusy] = useState<null | "first" | "second">(null);
  const run = async (kind: "first" | "second") => {
    setBusy(kind);
    await new Promise((r) => setTimeout(r, 900));
    setBusy(null);
    return true;
  };
  return { busy, approve: run };
}
