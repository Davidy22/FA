'use client';
import { useId, useMemo, useState } from 'react';

type Option = { value: string; label: string };

function fuzzyScore(query: string, label: string): number | null {
  const q = query.toLocaleLowerCase().trim();
  const text = label.toLocaleLowerCase();
  if (!q) return 1;
  if (text.includes(q)) return 100 - text.indexOf(q);
  let cursor = 0;
  let score = 0;
  for (const char of q) {
    const found = text.indexOf(char, cursor);
    if (found < 0) return null;
    score += found === cursor ? 4 : 1 / (found - cursor);
    cursor = found + 1;
  }
  return score;
}

/** Searchable replacement for selects whose catalog may grow large. */
export function FuzzySelect({ options, value, onChange, emptyLabel, emptyValue = '', searchLabel = 'Search options', disabled = false }:{
  options: Option[]; value: string; onChange: (value: string) => void; emptyLabel: string; emptyValue?: string; searchLabel?: string; disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = value === emptyValue ? undefined : options.find((option) => option.value === value);
  const results = useMemo(() => options
    .map((option) => ({ option, score: fuzzyScore(query, option.label) }))
    .filter((entry): entry is { option: Option; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score).slice(0, 50), [options, query]);
  return <div className="relative">
    <div className="flex gap-1">
      <input className="input min-w-0" role="combobox" aria-expanded={open} aria-controls={id} aria-autocomplete="list" disabled={disabled}
        placeholder={selected?.label || emptyLabel} value={query} onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && results[0]) { event.preventDefault(); onChange(results[0].option.value); setQuery(''); setOpen(false); }
        }} aria-label={searchLabel} />
      {value && value !== emptyValue && <button className="btn-outline px-3" type="button" disabled={disabled} aria-label="Clear selection"
        onClick={() => { onChange(emptyValue); setQuery(''); }}>×</button>}
    </div>
    {open && <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-300 bg-white shadow-lg" role="listbox" id={id}>
      <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { onChange(emptyValue); setQuery(''); setOpen(false); }}>{emptyLabel}</button>
      {results.map(({ option }) => <button key={option.value} type="button" role="option" aria-selected={value === option.value}
        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { onChange(option.value); setQuery(''); setOpen(false); }}>{option.label}</button>)}
      {!results.length && <p className="px-3 py-2 text-sm text-slate-500">No matches</p>}
    </div>}
    {open && <button className="fixed inset-0 z-20 cursor-default" aria-label="Close search results" type="button" onClick={() => setOpen(false)} />}
  </div>;
}
