import React from "react";

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`px-6 pt-5 pb-0 ${className}`}>{children}</div>;
}

export function CardContent({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`px-6 pb-6 pt-4 ${className}`}>{children}</div>;
}

export function CardTitle({ className = "", style, children }: { className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return <h3 className={`font-semibold leading-tight ${className}`} style={style}>{children}</h3>;
}
