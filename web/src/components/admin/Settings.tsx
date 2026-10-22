'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { parseFeature, type Feature } from '@/lib/features';
import { DEFAULT_TIERS, parseTiers, type MembershipTier } from '@/lib/rewards';
import { supabase } from '@/lib/supabase';
import type { PlatformSetting } from '@/lib/types';
import { AdminFeedback, AdminQueryState, useAdminAction } from './Shared';

// Only settings something actually reads. The automatic 3D-quote knobs
// (wall thickness, setup time, handling fee, minimum order fee) and the raw
// "other JSON" editor are gone: quoting is a staff conversation, and a free-form
// key/value editor invited values nothing consumes.
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
  rewards_pricing: [
    { key: 'rewards.points_per_dollar', min: 0, max: 1000, step: '0.01', defaultValue: 1 },
    { key: 'rewards.coupon_days_valid', min: 1, max: 3650, step: '1', integer: true, defaultValue: 90 },
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

type TierDraft = { name: string; min: string; multiplier: string };

function toDraft(tiers: MembershipTier[]): TierDraft[] {
  return tiers.map((tier) => ({
    name: tier.name,
    min: String(tier.min_lifetime_points),
    multiplier: String(tier.multiplier),
  }));
}

function TierSettings({ raw }: { raw: unknown }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [rows, setRows] = useState<TierDraft[]>(() => toDraft(parseTiers(raw)));
  useEffect(() => { setRows(toDraft(parseTiers(raw))); }, [raw]);

  const setRow = (index: number, patch: Partial<TierDraft>) =>
    setRows((previous) => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const tiers = rows.map((row, index) => ({
        name: row.name.trim(),
        min_lifetime_points: decimal(row.min, `${t('tier_threshold')} ${index + 1}`, 0, 100000000, true),
        multiplier: decimal(row.multiplier, `${t('tier_multiplier')} ${index + 1}`, 1, 100),
      }));
      if (!tiers.some((tier) => tier.min_lifetime_points === 0)) {
        throw new Error(t('tier_needs_start'));
      }
      const { error } = await supabase().from('platform_settings')
        .upsert({ key: 'rewards.tiers', value: tiers }, { onConflict: 'key' });
      if (error) throw error;
      await refreshSettings(queryClient);
    });
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-3 rounded border p-3 text-sm">
    <p className="max-w-2xl text-slate-600">{t('tiers_help')}</p>
    <div className="mt-3 space-y-2">
      {rows.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
        <label className="text-xs text-slate-600">{t('tier_name')}
          <input className="input mt-1" value={row.name} placeholder={t('tier_name_placeholder')}
            onChange={(event) => setRow(index, { name: event.target.value })} />
        </label>
        <label className="text-xs text-slate-600">{t('tier_threshold')}
          <input className="input mt-1" type="number" min={0} step={1} value={row.min}
            onChange={(event) => setRow(index, { min: event.target.value })} />
        </label>
        <label className="text-xs text-slate-600">{t('tier_multiplier')}
          <input className="input mt-1" type="number" min={1} step={0.5} value={row.multiplier}
            onChange={(event) => setRow(index, { multiplier: event.target.value })} />
        </label>
        <button type="button" className="self-end text-xs text-red-700 underline disabled:text-slate-400"
          disabled={rows.length <= 1}
          onClick={() => setRows((previous) => previous.filter((_, i) => i !== index))}>
          {t('remove_tier')}
        </button>
      </div>)}
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn-outline text-sm"
        onClick={() => setRows((previous) => [...previous, { name: '', min: '', multiplier: '2' }])}>
        {t('add_tier')}
      </button>
      <button type="button" className="btn-outline text-sm" onClick={() => setRows(toDraft(DEFAULT_TIERS))}>
        {t('reset_tiers')}
      </button>
      <button type="submit" className="btn text-sm" disabled={action.busy}>
        {action.busy ? t('common:loading') : t('save_setting')}
      </button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
  </form>;
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
      <section className="mt-7">
        <h3 className="mb-1 text-lg font-medium">{t('tiers_group')}</h3>
        <TierSettings raw={values['rewards.tiers']} />
      </section>
      {Object.entries(SETTING_GROUPS).map(([group, definitions]) => <section key={group} className="mt-7">
        <h3 className="mb-3 text-lg font-medium">{t(`setting_groups.${group}`)}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {definitions.map((definition) => <NumericSetting key={definition.key} definition={definition} value={values[definition.key]} />)}
        </div>
        {group === 'rewards_pricing' && <p className="mt-3 text-sm text-slate-600">{t('redeem_moved_hint')}</p>}
      </section>)}
    </>}
  </>;
}
