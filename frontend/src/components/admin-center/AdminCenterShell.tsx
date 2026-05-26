"use client";

type AdminCenterShellProps = {
  children: React.ReactNode;
};

export function AdminCenterShell({ children }: AdminCenterShellProps) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f3f6f8_0%,_#ffffff_18%)]">
      <div className="mx-auto w-full max-w-[1680px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        {children}
      </div>
    </div>
  );
}
