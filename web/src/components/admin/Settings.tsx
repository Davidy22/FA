'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { parseFeature, type Feature } from '@/lib/features';
import { supabase } from '@/lib/supabase';
import type { PlatformSetting } from '@/lib/types';
import { AdminFeedback, AdminQueryState, useAdminAction } from './Shared';

// Only settings something actually reads. Redemption options and the base
// rewards earn rate live with the other coupon tools, not in a duplicate
// rewards section here.
type SettingDefinition = { key: string; min: number; max: number; step: string; defaultValue: number; integer?: boolean };
const SETTING_GROUPS: Record<string, SettingDefinition[]> = {
  business: [
    { key: 'platform.commission_percent', min: 0, max: 100, step: '0.01', defaultValue: 15 },
    { key: 'payouts.min_amount', min: 0.01, max: 99999999, step: '0.01', defaultValue: 50 },
  ],
  document_pricing: [
    { key: 'document.grayscale_per_side', min: 0.01, max: 99999999, step: '0.01', defaultValue: 0.5 },
    { key: 'document.color_per_side', min: 0.01, max: 99999999, step: '0.01', defaultValue: 1 },
  ],
};

// Storefront features that ship dark. Turning one on here also unhides its
// navigation entry; the model-submission switch is enforced in RLS too.
const FEATURE_TOGGLES: { feature: Feature; labelKey: string; hintKey: string }[] = [
  { feature: 'model_submissions', labelKey: 'feature_model_submissions', hintKey: 'feature_model_submissions_hint' },
  { feature: 'careers_page', labelKey: 'feature_careers_page', hintKey: 'feature_careers_page_hint' },
];

async function refreshSettings(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin_settings'] }),
    queryClient.invalidateQueries({ queryKey: ['admin_settings_redeem'] }),
    queryClient.invalidateQueries({ queryKey: ['rewards_settings'] }),
    queryClient.invalidateQueries({ queryKey: ['document_prices'] }),
    queryClient.invalidateQueries({ queryKey: ['feature'] }),
  ]);
}

function NumericSetting({ definition, value }: { definition: SettingDefinition; value: unknown }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [input, setInput] = useState(String(value ?? definition.defaultValue));
  const label = t(`setting_labels.${definition.key}`);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const number = decimal(input, label, definition.min, definition.max, definition.integer);
      const { error } = await supabase().from('platform_settings').upsert({ key: definition.key, value: number }, { onConflict: 'key' });
      if (error) throw error;
      await refreshSettings(queryClient);
    });
  }
  return <form onSubmit={(event) => void submit(event)} className="rounded border p-3 text-sm">
    <label className="block font-medium">{label}<input className="input mt-1" type="number" required min={definition.min} max={definition.max}
      step={definition.step} value={input} onChange={(event) => setInput(event.target.value)} /></label>
    <button type="submit" className="btn-outline mt-2 text-sm" disabled={action.busy}>{t('save_setting')}</button>
    <AdminFeedback error={action.error} notice={action.notice} />
  </form>;
}

function FeatureToggle({ feature, labelKey, hintKey, enabled }: {
  feature: Feature; labelKey: string; hintKey: string; enabled: boolean;
}) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  async function toggle(next: boolean) {
    await action.run(async () => {
      const { error } = await supabase().from('platform_settings')
        .upsert({ key: `features.${feature}`, value: next }, { onConflict: 'key' });
      if (error) throw error;
      await refreshSettings(queryClient);
    });
  }
  return <div className="rounded border p-3 text-sm">
    <label className="flex items-start gap-2 font-medium">
      <input type="checkbox" className="mt-0.5" checked={enabled} disabled={action.busy}
        onChange={(event) => void toggle(event.target.checked)} />
      <span>{t(labelKey)}</span>
    </label>
    <p className="mt-1 text-xs text-slate-600">{t(hintKey)}</p>
    <p className="mt-1 text-xs text-slate-500">{enabled ? t('feature_on') : t('feature_off')}</p>
    <AdminFeedback error={action.error} notice={action.notice} />
  </div>;
}

export function AdminSettings() {
  const { t } = useTranslation(['admin', 'common']);
  const { data, isPending, error } = useQuery<PlatformSetting[]>({
    queryKey: ['admin_settings'], queryFn: async () => {
      const { data, error } = await supabase().from('platform_settings').select('*').order('key');
      if (error) throw error;
      return (data || []) as PlatformSetting[];
    },
  });
  const values = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return <>
    <h2 className="text-xl font-medium">{t('settings')}</h2>
    <p className="mt-1 text-sm text-slate-600">{t('settings_help')}</p>
    <AdminQueryState loading={isPending} error={error} />
    {data && <>
      <section className="mt-7">
        <h3 className="mb-3 text-lg font-medium">{t('feature_group')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURE_TOGGLES.map((entry) => <FeatureToggle key={entry.feature} {...entry}
            enabled={parseFeature(values[`features.${entry.feature}`])} />)}
        </div>
      </section>
      {Object.entries(SETTING_GROUPS).map(([group, definitions]) => <section key={group} className="mt-7">
        <h3 className="mb-3 text-lg font-medium">{t(`setting_groups.${group}`)}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {definitions.map((definition) => <NumericSetting key={definition.key} definition={definition} value={values[definition.key]} />)}
        </div>
      </section>)}
    </>}
  </>;
}
