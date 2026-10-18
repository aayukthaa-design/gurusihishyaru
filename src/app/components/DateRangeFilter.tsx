interface DateRangeFilterProps {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
}

/** Start/End date pair used by Expenses, Income and the financial summaries. */
export function DateRangeFilter({ start, end, onChange }: DateRangeFilterProps) {
  const inputClass = 'rounded-xl border border-input bg-input-background px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <label className="flex items-center gap-2">
        Start Date
        <input type="date" value={start} max={end || undefined} onChange={(e) => onChange({ start: e.target.value, end })} className={inputClass} />
      </label>
      <label className="flex items-center gap-2">
        End Date
        <input type="date" value={end} min={start || undefined} onChange={(e) => onChange({ start, end: e.target.value })} className={inputClass} />
      </label>
      {(start || end) && (
        <button type="button" onClick={() => onChange({ start: '', end: '' })} className="rounded-xl border border-border px-3 py-1.5 text-foreground hover:bg-secondary">Clear</button>
      )}
    </div>
  );
}
