export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  if (value <= 0) return null;
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-black/50 ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className="h-full rounded-full bg-amber" style={{ width: `${Math.max(3, value * 100)}%` }} />
    </div>
  );
}
