'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { LOCATION_COUNTRIES, countryName, hasSalesTax } from '@/lib/countries';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Location } from '@/lib/types';
import { LOCATIONS_QUERY_KEY } from '@/hooks/useLocations';
import { AdminFeedback, AdminQueryState, FormActions, useAdminAction, useFormPanel } from './Shared';

type LocationDraft = {
  name: string; address: string; phone: string; photo_url: string;
  lat: string; lng: string; timezone: string; hourly_machine_rate: string;
  country: string; tax_percent: string; currency: string; is_active: boolean;
};

function draft(location?: Location): LocationDraft {
  return {
    name: location?.name || '', address: location?.address || '', phone: location?.phone || '',
    photo_url: location?.photo_url || '', lat: location?.lat?.toString() || '',
    lng: location?.lng?.toString() || '', timezone: location?.timezone || 'Asia/Hong_Kong',
    hourly_machine_rate: location?.hourly_machine_rate?.toString() || '5',
    country: location?.country || 'HK',
    tax_percent: location ? (Number(location.tax_rate) * 100).toString() : '0',
    currency: location?.currency || 'USD', is_active: location?.is_active ?? true,
  };
}

function LocationForm({ location, onDone }: { location?: Location; onDone: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [form, setForm] = useState<LocationDraft>(() => draft(location));
  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  // Sales tax is a property of the country: Hong Kong and the other no-sales-tax
  // jurisdictions always check out tax-free, so the rate is not editable there.
  const taxable = hasSalesTax(form.country);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!form.name.trim()) throw new Error(t('admin:required_name'));
      const bothCoordinates = form.lat.trim() !== '' && form.lng.trim() !== '';
      if ((form.lat.trim() !== '' || form.lng.trim() !== '') && !bothCoordinates) {
        throw new Error(t('admin:coordinates_pair'));
      }
      try { new Intl.DateTimeFormat('en', { timeZone: form.timezone.trim() }); }
      catch { throw new Error(t('admin:invalid_timezone')); }
      if (!/^[A-Z]{3}$/.test(form.currency.trim().toUpperCase())) throw new Error(t('admin:invalid_currency'));
      const country = form.country.trim().toUpperCase();
      if (country && !/^[A-Z]{2}$/.test(country)) throw new Error(t('admin:invalid_country'));
      const payload = {
        name: form.name.trim(), address: form.address.trim() || null, phone: form.phone.trim() || null,
        photo_url: form.photo_url.trim() || null,
        lat: bothCoordinates ? decimal(form.lat, t('admin:fields.latitude'), -90, 90) : null,
        lng: bothCoordinates ? decimal(form.lng, t('admin:fields.longitude'), -180, 180) : null,
        timezone: form.timezone.trim(),
        hourly_machine_rate: decimal(form.hourly_machine_rate, t('admin:fields.machine_rate'), 0, 99999999),
        country: country || null,
        tax_rate: taxable ? decimal(form.tax_percent, t('admin:fields.tax_percent'), 0, 100) / 100 : 0,
        currency: form.currency.trim().toUpperCase(), is_active: form.is_active,
      };
      const result = location
        ? await supabase().from('locations').update(payload).eq('id', location.id).select().single()
        : await supabase().from('locations').insert(payload).select().single();
      if (result.error) throw result.error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_locations'] }),
        queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['locations_all'] }),
        queryClient.invalidateQueries({ queryKey: ['location'] }),
      ]);
    }, onDone);
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-5 space-y-4 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h3 className="font-medium">{location ? t('admin:edit_location') : t('admin:add_location')}</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">{t('admin:fields.name')} *<input className="input mt-1" required value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.address')}<input className="input mt-1" value={form.address} onChange={(e) => set('address', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.phone')}<input className="input mt-1" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.photo_url')}<input className="input mt-1" type="url" value={form.photo_url} onChange={(e) => set('photo_url', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.country')}
        <select className="input mt-1" value={form.country} onChange={(e) => set('country', e.target.value)}>
          <option value="">{t('admin:country_unknown')}</option>
          {LOCATION_COUNTRIES.map((code) => (
            <option key={code} value={code}>{countryName(code, locale)} ({code})</option>
          ))}
        </select>
      </label>
      <label className="text-sm">{t('admin:fields.latitude')}<input className="input mt-1" type="number" step="any" min="-90" max="90" value={form.lat} onChange={(e) => set('lat', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.longitude')}<input className="input mt-1" type="number" step="any" min="-180" max="180" value={form.lng} onChange={(e) => set('lng', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.timezone')}<input className="input mt-1" required value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Hong_Kong" /></label>
      <label className="text-sm">{t('admin:fields.machine_rate')}<input className="input mt-1" required type="number" min="0" step="0.01" value={form.hourly_machine_rate} onChange={(e) => set('hourly_machine_rate', e.target.value)} /></label>
      <label className="text-sm">{t('admin:fields.tax_percent')}
        <input className="input mt-1" required type="number" min="0" max="100" step="0.01" disabled={!taxable}
          value={taxable ? form.tax_percent : '0'} onChange={(e) => set('tax_percent', e.target.value)} />
      </label>
      <label className="text-sm">{t('admin:fields.currency')}<input className="input mt-1 uppercase" required maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value)} /></label>
    </div>
    <p className="text-xs text-slate-600">
      {taxable ? t('admin:tax_hint') : t('admin:no_sales_tax_hint', { country: countryName(form.country, locale) || form.country })}
    </p>
    <p className="text-xs text-slate-600">{t('admin:currency_hint')}</p>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />{t('admin:active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} />
    <FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminLocations() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const { data, isPending, error } = useQuery<Location[]>({
    queryKey: ['admin_locations'],
    queryFn: async () => {
      const { data, error } = await supabase().from('locations').select('*').order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });

  async function toggle(location: Location) {
    if (location.is_active && !window.confirm(t('admin:deactivate_location_confirm'))) return;
    await action.run(async () => {
      const { error } = await supabase().from('locations').update({ is_active: !location.is_active })
        .eq('id', location.id).select().single();
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_locations'] }),
        queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['locations_all'] }),
        queryClient.invalidateQueries({ queryKey: ['location'] })
      ]);
    });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-medium">{t('admin:locations')}</h2>
        <p className="text-sm text-slate-600">{t('admin:locations_help')}</p></div>
      <div className="flex gap-2">
        <Link href="/locations" className="btn-outline text-sm">{t('admin:view_picker')}</Link>
        <button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('admin:add_location')}</button>
      </div>
    </div>
    {editing && <LocationForm key={editing} location={data?.find((location) => location.id === editing)} onDone={() => setEditing(null)} />}
    <AdminFeedback error={action.error} notice={action.notice} />
    <AdminQueryState loading={isPending} error={error} />
    {data?.length === 0 && <p className="mt-4 text-slate-500">{t('admin:no_locations')}</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {data?.map((location) => <article key={location.id} className="rounded-lg border border-slate-200 p-4">
        <h3 className="font-semibold">{location.name} <span className="badge ml-1">{location.is_active ? t('admin:active') : t('admin:inactive')}</span></h3>
        <p className="mt-1 text-sm text-slate-600">{location.address || '—'}</p>
        <p className="mt-1 text-xs text-slate-500">
          {countryName(location.country, locale) || t('admin:country_unknown')} · {location.timezone} · {location.currency}
        </p>
        {/* No tax line at all where nothing is charged (Hong Kong and friends). */}
        {hasSalesTax(location.country) && Number(location.tax_rate) > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            {`${t('admin:fields.tax_percent')}: ${(Number(location.tax_rate) * 100).toFixed(2)}%`}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-outline text-sm" onClick={() => setEditing(location.id)}>{t('common:edit')}</button>
          <button type="button" className="btn-outline text-sm" disabled={action.busy} onClick={() => void toggle(location)}>
            {location.is_active ? t('admin:deactivate') : t('admin:activate')}
          </button>
        </div>
      </article>)}
    </div>
  </>;
}
