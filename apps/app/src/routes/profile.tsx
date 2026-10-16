import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve existing bookmarks without retaining the removed Profile screen.
export const Route = createFileRoute("/profile")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
