"use client";

type LoadingOrbitProps = {
  label: string;
  description?: string;
  className?: string;
};

export default function LoadingOrbit({ label, description, className = "" }: LoadingOrbitProps) {
  return (
    <div className={`flex items-center justify-center ${className}`.trim()}>
      <div className="text-center text-gray-400">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
        <p className="text-sm">{label}</p>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}
