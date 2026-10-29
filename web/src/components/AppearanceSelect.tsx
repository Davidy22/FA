'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Appearance = 'light' | 'dark' | 'auto';
const KEY = 'make-anything-appearance';

export function AppearanceSelect() {
  const { t } = useTranslation('common');
  const [appearance, setAppearance] = useState<Appearance>('auto');
  const current = useRef<Appearance>('auto');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (value: Appearance) => {
      document.documentElement.dataset.theme = value === 'auto' ? (media.matches ? 'dark' : 'light') : value;
    };
    const saved = window.localStorage.getItem(KEY);
    const initial: Appearance = saved === 'light' || saved === 'dark' ? saved : 'auto';
    current.current = initial;
    setAppearance(initial);
    apply(initial);
    const onSystemChange = () => { if (current.current === 'auto') apply('auto'); };
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);
  function change(value: Appearance) {
    current.current = value;
    setAppearance(value);
    window.localStorage.setItem(KEY, value);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = value === 'auto' ? (dark ? 'dark' : 'light') : value;
  }
  return <label className="flex items-center gap-1 text-xs text-slate-600">
    <span className="sr-only">{t('appearance.label')}</span>
    <select className="rounded border border-slate-300 bg-white px-2 py-1.5" aria-label={t('appearance.label')}
      value={appearance} onChange={(event) => change(event.target.value as Appearance)}>
      <option value="light">{t('appearance.light')}</option>
      <option value="dark">{t('appearance.dark')}</option>
      <option value="auto">{t('appearance.auto')}</option>
    </select>
  </label>;
}
