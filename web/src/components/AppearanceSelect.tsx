'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Appearance,
  onAppearanceChange,
  readAppearance,
  saveAppearance,
} from '@/lib/theme';

export function AppearanceSelect() {
  const { t } = useTranslation('common');
  const [appearance, setAppearance] = useState<Appearance>('auto');

  // Reflect changes made in another tab or by the system preference.
  useEffect(() => {
    const sync = () => setAppearance(readAppearance());
    sync();
    return onAppearanceChange(sync);
  }, []);

  function change(value: Appearance) {
    setAppearance(value);
    saveAppearance(value);
  }

  return (
    <label className="flex items-center gap-1 text-xs text-slate-600">
      <span className="sr-only">{t('appearance.label')}</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1.5"
        aria-label={t('appearance.label')}
        value={appearance}
        onChange={(event) => change(event.target.value as Appearance)}
      >
        <option value="light">{t('appearance.light')}</option>
        <option value="dark">{t('appearance.dark')}</option>
        <option value="auto">{t('appearance.auto')}</option>
      </select>
    </label>
  );
}
