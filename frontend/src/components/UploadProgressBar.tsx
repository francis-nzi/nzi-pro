type UploadProgressBarProps = {
  value: number;
  label?: string;
  className?: string;
};

export default function UploadProgressBar({ value, label, className = "" }: UploadProgressBarProps) {
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;

  return (
    <div className={`space-y-1 ${className}`.trim()}>
      {label ? <div className="text-xs font-medium text-muted-foreground">{label}</div> : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-600 transition-all duration-150"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="text-right text-xs text-muted-foreground">{clamped.toFixed(0)}%</div>
    </div>
  );
}
