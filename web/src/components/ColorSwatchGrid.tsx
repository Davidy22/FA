'use client';

import { useTranslation } from 'react-i18next';
import { describeFilament, filamentSwatchStyle } from '@/lib/filaments';
import { t_db } from '@/lib/format';
import { useLocale } from '@/store/locale';
import type { Filament } from '@/lib/types';

/** Compact colour picker: only the selected colour's name takes up space. */
export function ColorSwatchGrid({
  colors,
  selectedId,
  onSelect,
  name,
}: {
  colors: Filament[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  name: string;
}) {
  const { t } = useTranslation('catalog');
  const locale = useLocale((state) => state.locale);
  const selected = colors.find((color) => color.id === selectedId);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-700" aria-live="polite">
        {selected ? t_db(selected.color, locale) : '—'}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('select_color')}>
        {colors.map((color) => {
          const colorName = t_db(color.color, locale);
          const finish = describeFilament(color, locale);
          const description = finish ? `${colorName} · ${finish}` : colorName;
          return (
            <label
              key={color.id}
              className={'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 transition ' +
                (selectedId === color.id
                  ? 'border-brand-600 ring-2 ring-brand-100'
                  : 'border-transparent hover:border-slate-300')}
              title={description}
            >
              <input
                type="radio"
                className="sr-only"
                name={name}
                checked={selectedId === color.id}
                onChange={() => onSelect(color.id)}
                aria-label={description}
              />
              <span
                aria-hidden="true"
                className="h-7 w-7 rounded-full border border-slate-300 shadow-sm"
                style={filamentSwatchStyle(color)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}
