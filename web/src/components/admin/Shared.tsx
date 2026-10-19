'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Localized } from '@/lib/types';
import { adminError } from '@/lib/admin';

export function useAdminAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useTranslation('admin');

  async function run(task: () => Promise<void>, onSuccess?: () => void): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      onSuccess?.();
      setNotice(t('saved'));
      return true;
    } catch (e) {
      setError(await adminError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, notice, run };
}

export function AdminFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  return <>
    {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  </>;
}

export function AdminQueryState({ loading, error }: { loading: boolean; error: Error | null }) {
  const { t } = useTranslation(['common', 'admin']);
  if (loading) return <p className="mt-5 text-slate-600">{t('common:loading')}</p>;
  if (error) return <p role="alert" className="mt-5 text-sm text-red-700">{t('admin:load_error')}: {error.message}</p>;
  return null;
}

export const ADMIN_PAGE_SIZE = 50;

export function AdminPagination({ page, hasNext, onPageChange }: {
  page: number; hasNext: boolean; onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation('admin');
  return <nav aria-label={t('pagination_label')} className="mt-5 flex items-center gap-3 text-sm">
    <button type="button" className="btn-outline" disabled={page === 0}
      onClick={() => onPageChange(page - 1)}>{t('previous_page')}</button>
    <span aria-live="polite">{t('page_number', { number: page + 1 })}</span>
    <button type="button" className="btn-outline" disabled={!hasNext}
      onClick={() => onPageChange(page + 1)}>{t('next_page')}</button>
  </nav>;
}

export function LocalizedFields({ label, value, onChange, multiline = false, required = true }: {
  label: string;
  value: Localized;
  onChange: (value: Localized) => void;
  multiline?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation('admin');
  const [language, setLanguage] = useState<'en' | 'zh-Hant' | 'zh-Hans'>('en');
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{label}</legend>
      <div className="space-y-3">
        <label className="block text-xs text-slate-600">
          {t('language_picker')}
          <select className="input mt-1 max-w-xs text-sm" value={language}
            onChange={(event) => setLanguage(event.target.value as typeof language)}>
            {(['en', 'zh-Hans', 'zh-Hant'] as const).map((option) => (
              <option key={option} value={option}>{t(`language.${option}`)}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          {t(`language.${language}`)}{language === 'en' && required ? ' *' : ''}
          {multiline ? (
            <textarea className="input mt-1 min-h-20 text-sm" value={value[language] || ''}
              required={required && language === 'en'}
              onChange={(e) => onChange({ ...value, [language]: e.target.value })} />
          ) : (
            <input className="input mt-1 text-sm" value={value[language] || ''}
              required={required && language === 'en'}
              onChange={(e) => onChange({ ...value, [language]: e.target.value })} />
          )}
        </label>
      </div>
    </fieldset>
  );
}

export function FormActions({ busy, onCancel, submitLabel }: { busy: boolean; onCancel: () => void; submitLabel?: string }) {
  const { t } = useTranslation(['common', 'admin']);
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" className="btn" disabled={busy}>{busy ? t('common:loading') : (submitLabel || t('common:save'))}</button>
      <button type="button" className="btn-outline" disabled={busy} onClick={onCancel}>{t('common:cancel')}</button>
    </div>
  );
}
