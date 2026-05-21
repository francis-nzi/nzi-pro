import React from "react";

export function Badge({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${className}`}>
      {children}
    </span>
  );
}
