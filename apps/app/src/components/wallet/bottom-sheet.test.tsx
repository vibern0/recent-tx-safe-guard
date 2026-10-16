import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { BottomSheet } from "./bottom-sheet";

function Editor() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Edit</button>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="Edit limits"
        description="Review changes before approval."
      >
        <label>
          Daily limit
          <input defaultValue="250" />
        </label>
      </BottomSheet>
    </>
  );
}

describe("BottomSheet", () => {
  it("opens an accessible editor, closes with Escape, and restores focus", async () => {
    render(<Editor />);
    const trigger = screen.getByRole("button", { name: "Edit" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Edit limits" })).toHaveAccessibleDescription(
      "Review changes before approval.",
    );
    expect(screen.getByLabelText("Daily limit")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
