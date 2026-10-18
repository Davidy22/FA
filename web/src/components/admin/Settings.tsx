'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { DEFAULT_REDEEM_OPTIONS, type RedeemOption } from '@/lib/rewards';
import { supabase } from '@/lib/supabase';
import type { PlatformSetting } from '@/lib/types';
import { AdminFeedback, AdminQueryState, useAdminAction } from './Shared';

type SettingDefinition = { key: string; min: number; max: number; step: string; defaultValue: number; integer?: boolean };
const SETTING_GROUPS: Record<string, SettingDefinition[]> = {
  business: [
    { key: 'platform.commission_percent', min: 0, max: 100, step: '0.01', defaultValue: 15 },
    { key: 'payouts.min_amount', min: 0.01, max: 99999999, step: '0.01', defaultValue: 50 },
  ],
  quote_pricing: [
    { key: 'quote.wall_thickness_mm', min: 0.01, max: 100, step: '0.01', defaultValue: 0.84 },
    { key: 'quote.setup_minutes', min: 0, max: 120, step: '1', integer: true, defaultValue: 3 },
    { key: 'quote.handling_fee', min: 0, max: 99999999, step: '0.01', defaultValue: 1 },
    { key: 'quote.min_order_fee', min: 0, max: 99999999, step: '0.01', defaultValue: 3 },
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
const KNOWN_KEYS = new Set([...Object.values(SETTING_GROUPS).flat().map((row) => row.key), 'rewards.redeem_options']);

async function refreshSettings(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin_settings'] }),
    queryClient.invalidateQueries({ queryKey: ['rewards_settings'] }),
    queryClient.invalidateQueries({ queryKey: ['document_prices'] }),
    queryClient.invalidateQueries({ queryKey: ['quote_constants'] }),
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

type RedeemDraft = { points: string; discount_type: RedeemOption['discount_type']; discount_value: string };
function RedeemSettings({ value }: { value: unknown }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [options, setOptions] = useState<RedeemDraft[]>(() => (
    (Array.isArray(value) ? value as RedeemOption[] : DEFAULT_REDEEM_OPTIONS).map((option) => ({
      points: String(option.points), discount_type: option.discount_type, discount_value: String(option.discount_value),
    }))
  ));

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!options.length) throw new Error(t('redeem_required'));
      const parsed = options.map((option) => ({
        points: decimal(option.points, t('fields.points'), 1, 2147483647, true),
        discount_type: option.discount_type,
        discount_value: decimal(option.discount_value, t('fields.discount_value'), 0.01,
          option.discount_type === 'percent' ? 100 : 99999999),
      }));
      if (new Set(parsed.map((option) => option.points)).size !== parsed.length) throw new Error(t('duplicate_points'));
      parsed.sort((a, b) => a.points - b.points);
      const { error } = await supabase().from('platform_settings').upsert({ key: 'rewards.redeem_options', value: parsed }, { onConflict: 'key' });
      if (error) throw error;
      await refreshSettings(queryClient);
    });
  }
  return <form onSubmit={(event) => void submit(event)} className="mt-5 rounded-lg border p-4">
    <h4 className="font-medium">{t('redeem_options')}</h4>
    <p className="mb-3 text-sm text-slate-600">{t('redeem_help')}</p>
    <div className="space-y-3">{options.map((option, index) => <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="text-sm">{t('fields.points')}<input className="input mt-1" type="number" min="1" step="1" required value={option.points}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, points: event.target.value } : row))} /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={option.discount_type}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, discount_type: event.target.value as RedeemOption['discount_type'] } : row))}>
        <option value="fixed">{t('discount_type.fixed')}</option><option value="percent">{t('discount_type.percent')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" type="number" min="0.01" step="0.01" required value={option.discount_value}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, discount_value: event.target.value } : row))} /></label>
      <button type="button" className="btn-outline text-sm" onClick={() => setOptions((previous) => previous.filter((_, i) => i !== index))}>{t('remove')}</button>
    </div>)}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-outline text-sm" onClick={() => setOptions((previous) => [...previous, { points: '', discount_type: 'fixed', discount_value: '' }])}>{t('add_redeem_option')}</button>
      <button type="submit" className="btn text-sm" disabled={action.busy}>{t('save_setting')}</button></div>
    <AdminFeedback error={action.error} notice={action.notice} />
  </form>;
}

function OtherSetting({ row }: { row?: PlatformSetting }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [key, setKey] = useState(row?.key || '');
  const [value, setValue] = useState(row ? JSON.stringify(row.value, null, 2) : '');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!/^[a-z][a-z0-9_.-]*$/.test(key.trim())) throw new Error(t('invalid_setting_key'));
      let parsed: unknown;
      try { parsed = JSON.parse(value); }
      catch { throw new Error(t('invalid_json')); }
      const { error } = await supabase().from('platform_settings').upsert({ key: key.trim(), value: parsed }, { onConflict: 'key' });
      if (error) throw error;
      await refreshSettings(queryClient);
    });
  }
  return <form onSubmit={(event) => void submit(event)} className="rounded border p-3 text-sm">
    <label className="block">{t('fields.setting_key')}<input className="input mt-1 font-mono" required readOnly={!!row} value={key} onChange={(event) => setKey(event.target.value)} /></label>
    <label className="mt-2 block">{t('fields.json_value')}<textarea className="input mt-1 min-h-20 font-mono text-xs" required value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <button className="btn-outline mt-2 text-sm" type="submit" disabled={action.busy}>{t('save_setting')}</button>
    <AdminFeedback error={action.error} notice={action.notice} />
  </form>;
}

export function AdminSettings() {
  const { t } = useTranslation('admin');
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
      {Object.entries(SETTING_GROUPS).map(([group, definitions]) => <section key={group} className="mt-7">
        <h3 className="mb-3 text-lg font-medium">{t(`setting_groups.${group}`)}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {definitions.map((definition) => <NumericSetting key={definition.key} definition={definition} value={values[definition.key]} />)}
        </div>
      </section>)}
      <RedeemSettings value={values['rewards.redeem_options']} />
      <section className="mt-8"><h3 className="text-lg font-medium">{t('other_settings')}</h3>
        <p className="mb-3 text-sm text-amber-800">{t('other_settings_warning')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.filter((row) => !KNOWN_KEYS.has(row.key)).map((row) => <OtherSetting key={row.key} row={row} />)}
          <OtherSetting key="new-setting" />
        </div>
      </section>
    </>}
  </>;
}
