"use client";

import { useEffect } from "react";

export function useUnsavedChangesGuard(dirty: boolean, message = "You have unsaved changes. Leave this page without saving?") {
  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, message]);
}
