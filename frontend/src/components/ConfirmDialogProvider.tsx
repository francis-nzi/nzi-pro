"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  confirmationPlaceholder?: string;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

type PendingRequest = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const pendingRef = useRef<PendingRequest | null>(null);

  const closeDialog = useCallback((result: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setTypedConfirmation("");
    current?.resolve(result);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const request = { ...options, resolve };
      pendingRef.current = request;
      setTypedConfirmation("");
      setPending(request);
    });
  }, []);

  const canConfirm = useMemo(() => {
    if (!pending?.confirmationText) return true;
    return typedConfirmation.trim() === pending.confirmationText;
  }, [pending?.confirmationText, typedConfirmation]);

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) closeDialog(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.title || "Please confirm"}</DialogTitle>
            {pending?.description ? (
              <DialogDescription className="whitespace-pre-line">
                {pending.description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {pending?.confirmationText ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {pending.confirmationLabel || `Type "${pending.confirmationText}" to confirm`}
              </label>
              <Input
                autoFocus
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                placeholder={pending.confirmationPlaceholder || pending.confirmationText}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => closeDialog(false)}>
              {pending?.cancelLabel || "Cancel"}
            </Button>
            <Button
              onClick={() => closeDialog(true)}
              disabled={!canConfirm}
              style={pending?.destructive ? { backgroundColor: "#dc2626" } : undefined}
            >
              {pending?.confirmLabel || "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog(): ConfirmFn {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error("useConfirmDialog must be used within ConfirmDialogProvider");
  }
  return context;
}
