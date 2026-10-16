import { useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shared modal surface for short app tasks. Policy and persistence belong to callers. */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-background shadow-lg"
          onOpenAutoFocus={(event) => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const field = body.current?.querySelector<HTMLElement>(
              "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
            );
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <header className="relative shrink-0 px-5 pb-4 pt-6 pr-14">
            <DialogTitle className="font-display text-xl font-bold">{title}</DialogTitle>
            <DialogDescription className="mt-2">{description}</DialogDescription>
            <DialogClose
              className="absolute right-4 top-5 rounded-full p-2 text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="size-5" aria-hidden />
            </DialogClose>
          </header>
          <div ref={body} className="min-h-0 overflow-y-auto px-5 pb-5">
            {children}
          </div>
          {footer && (
            <footer className="shrink-0 border-t border-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
