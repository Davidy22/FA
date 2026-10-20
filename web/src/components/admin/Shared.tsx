'use client';
import { useEffect, useRef, useState } from 'react';
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

export const ADMIN_LANGUAGES = ['en', 'zh-Hans', 'zh-Hant'] as const;
export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number];

/** The one language every localized field of a form is being edited in. */
export function useAdminLanguage() {
  return useState<AdminLanguage>('en');
}

export type LocalizedFieldSpec = {
  label: string;
  value: Localized;
  onChange: (value: Localized) => void;
  multiline?: boolean;
  required?: boolean;
};

/**
 * Every localized text box of one item, edited in the language chosen by a
 * single picker: a material's name and adjective (or a product's name and
 * description) share one selector instead of one per field.
 */
export function LocalizedFields({ fields, language, onLanguageChange, legend }: {
  fields: LocalizedFieldSpec[];
  language: AdminLanguage;
  onLanguageChange: (language: AdminLanguage) => void;
  legend?: string;
}) {
  const { t } = useTranslation('admin');
  const isFilled = (option: AdminLanguage) =>
    fields.some((field) => (field.value[option] || '').trim() !== '');
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{legend || t('translations')}</legend>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="block text-xs text-slate-600">
          {t('language_picker')}
          <select className="input mt-1 max-w-xs text-sm" value={language} aria-label={t('language_picker')}
            onChange={(event) => onLanguageChange(event.target.value as AdminLanguage)}>
            {ADMIN_LANGUAGES.map((option) => (
              <option key={option} value={option}>
                {t(`language.${option}`)}
                {option !== 'en' && !isFilled(option) ? ` · ${t('language_empty')}` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="max-w-md text-xs text-slate-500">{t('language_help')}</p>
      </div>
      <div className="mt-3 space-y-3">
        {fields.map((field) => (
          <label key={field.label} className="block text-xs text-slate-600">
            {field.label}{field.required !== false && language === 'en' ? ' *' : ''}
            {field.multiline ? (
              <textarea className="input mt-1 min-h-20 text-sm" value={field.value[language] || ''}
                required={field.required !== false && language === 'en'}
                onChange={(e) => field.onChange({ ...field.value, [language]: e.target.value })} />
            ) : (
              <input className="input mt-1 text-sm" value={field.value[language] || ''}
                required={field.required !== false && language === 'en'}
                onChange={(e) => field.onChange({ ...field.value, [language]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Add/edit panels open above their list, so an "Edit" click further down the
 * page still shows the form: scroll it into view as soon as it mounts.
 */
export function useFormPanel<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, []);
  return ref;
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
