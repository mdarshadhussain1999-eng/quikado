"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function LoginDialog({
  open,
  onOpenChange,
  onGoogle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onGoogle: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Log in to Quikado</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Button className="w-full rounded-xl" onClick={onGoogle}>
            Continue with Google
          </Button>

          <p className="text-xs text-muted-foreground">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}