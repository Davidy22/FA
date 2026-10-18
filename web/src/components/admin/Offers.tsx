'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Coupon, OfferCode } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminFeedback, AdminPagination, AdminQueryState, FormActions, useAdminAction } from './Shared';

function localDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function isoDate(value: string): string | null { return value ? new Date(value).toISOString() : null; }

function OfferForm({ offer, onDone }: { offer?: OfferCode; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [code, setCode] = useState(offer?.code || '');
  const [description, setDescription] = useState(offer?.description || '');
  const [type, setType] = useState<'percent' | 'fixed'>(offer?.discount_type || 'percent');
  const [value, setValue] = useState(offer?.discount_value?.toString() || '10');
  const [maxClaims, setMaxClaims] = useState(offer?.max_claims?.toString() || '');
  const [validDays, setValidDays] = useState(offer?.coupon_valid_days?.toString() || '90');
  const [startsAt, setStartsAt] = useState(localDate(offer?.starts_at || null));
  const [expiresAt, setExpiresAt] = useState(localDate(offer?.expires_at || null));
  const [active, setActive] = useState(offer?.is_active ?? true);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const normalizedCode = code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{4,32}$/.test(normalizedCode)) throw new Error(t('invalid_offer_code'));
      const limit = maxClaims.trim() ? decimal(maxClaims, t('fields.max_claims'), 1, 2147483647, true) : null;
      if (limit !== null && limit < (offer?.claims_count || 0)) throw new Error(t('claims_below_used'));
      if (startsAt && expiresAt && new Date(startsAt) >= new Date(expiresAt)) throw new Error(t('invalid_date_range'));
      const payload = {
        code: normalizedCode, description: description.trim() || null, discount_type: type,
        discount_value: decimal(value, t('fields.discount_value'), 0.01, type === 'percent' ? 100 : 99999999),
        max_claims: limit, coupon_valid_days: decimal(validDays, t('fields.coupon_valid_days'), 1, 3650, true),
        starts_at: isoDate(startsAt), expires_at: isoDate(expiresAt), is_active: active,
      };
      const result = offer
        ? await supabase().from('offer_codes').update(payload).eq('id', offer.id).select().single()
        : await supabase().from('offer_codes').insert(payload).select().single();
      if (result.error) throw result.error;
      await queryClient.invalidateQueries({ queryKey: ['admin_offers'] });
    }, onDone);
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 p-4">
    <h3 className="font-medium">{offer ? t('edit_offer') : t('add_offer')}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.code')} *<input className="input mt-1 uppercase" required maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="text-sm">{t('fields.description')}<input className="input mt-1" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={type} onChange={(event) => setType(event.target.value as 'percent' | 'fixed')}>
        <option value="percent">{t('discount_type.percent')}</option><option value="fixed">{t('discount_type.fixed')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" type="number" required min="0.01" max={type === 'percent' ? 100 : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label className="text-sm">{t('fields.max_claims')}<input className="input mt-1" type="number" min="1" step="1" value={maxClaims} onChange={(event) => setMaxClaims(event.target.value)} /></label>
      <label className="text-sm">{t('fields.coupon_valid_days')}<input className="input mt-1" type="number" required min="1" step="1" value={validDays} onChange={(event) => setValidDays(event.target.value)} /></label>
      <label className="text-sm">{t('fields.starts_at')}<input className="input mt-1" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label className="text-sm">{t('fields.expires_at')}<input className="input mt-1" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
    </div>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function CouponForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('fixed');
  const [value, setValue] = useState('5');
  const [expiresAt, setExpiresAt] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const normalizedCode = code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{6,32}$/.test(normalizedCode)) throw new Error(t('invalid_coupon_code'));
      let userId: string | null = null;
      if (email.trim()) {
        const { data, error } = await supabase().from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error(t('user_not_found'));
        userId = data.id;
      }
      if (expiresAt && new Date(expiresAt) <= new Date()) throw new Error(t('expiry_in_future'));
      const { error } = await supabase().from('coupons').insert({
        code: normalizedCode, user_id: userId, source: 'admin',
        discount_type: type,
        discount_value: decimal(value, t('fields.discount_value'), 0.01, type === 'percent' ? 100 : 99999999),
        expires_at: isoDate(expiresAt),
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['admin_coupons'] });
    }, onDone);
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 p-4">
    <h3 className="font-medium">{t('issue_coupon')}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.code')} *<input className="input mt-1 uppercase" required maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="text-sm">{t('fields.customer_email')}<input className="input mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={type} onChange={(event) => setType(event.target.value as 'percent' | 'fixed')}>
        <option value="fixed">{t('discount_type.fixed')}</option><option value="percent">{t('discount_type.percent')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" required type="number" min="0.01" max={type === 'percent' ? 100 : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <label className="text-sm">{t('fields.expires_at')}<input className="input mt-1" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
    </div>
    <p className="text-xs text-slate-600">{t('coupon_hint')}</p>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

export function AdminOffers() {
  const { t } = useTranslation('admin');
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [showCoupon, setShowCoupon] = useState(false);
  const [offerPage, setOfferPage] = useState(0);
  const [couponPage, setCouponPage] = useState(0);
  const offersQuery = useQuery<OfferCode[]>({
    queryKey: ['admin_offers', offerPage], queryFn: async () => {
      const { data, error } = await supabase().from('offer_codes').select('*')
        .order('created_at', { ascending: false })
        .range(offerPage * ADMIN_PAGE_SIZE, (offerPage + 1) * ADMIN_PAGE_SIZE - 1);
      if (error) throw error;
      return (data || []) as OfferCode[];
    },
  });
  const couponsQuery = useQuery<Coupon[]>({
    queryKey: ['admin_coupons', couponPage], queryFn: async () => {
      const { data, error } = await supabase().from('coupons').select('*')
        .order('created_at', { ascending: false })
        .range(couponPage * ADMIN_PAGE_SIZE, (couponPage + 1) * ADMIN_PAGE_SIZE - 1);
      if (error) throw error;
      return (data || []) as Coupon[];
    },
  });

  async function expire(coupon: Coupon) {
    if (!window.confirm(t('expire_coupon_confirm'))) return;
    await action.run(async () => {
      const { error } = await supabase().from('coupons').update({ expires_at: new Date().toISOString() }).eq('id', coupon.id).eq('status', 'active');
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['admin_coupons'] });
    });
  }

  return <div className="space-y-8">
    <section><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-medium">{t('offers')}</h2>
      <p className="text-sm text-slate-600">{t('offers_help')}</p></div>
      <button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('add_offer')}</button></div>
      <AdminQueryState loading={offersQuery.isPending} error={offersQuery.error} />
      {offersQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('no_offers')}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{offersQuery.data?.map((offer) => <div key={offer.id} className="rounded border p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><strong className="font-mono">{offer.code}</strong>
          <button className="text-brand-700 underline" onClick={() => setEditing(offer.id)}>{t('edit_offer')}</button></div>
        <p className="text-slate-600">{offer.description || '—'} · {offer.discount_value}{offer.discount_type === 'percent' ? '%' : ' USD'}
          {' · '}{offer.claims_count}/{offer.max_claims ?? '∞'} · {offer.is_active ? t('active') : t('inactive')}</p>
      </div>)}</div>
      <AdminPagination page={offerPage} hasNext={offersQuery.data?.length === ADMIN_PAGE_SIZE}
        onPageChange={(next) => { setOfferPage(next); setEditing(null); }} />
      {editing && <OfferForm key={editing} offer={offersQuery.data?.find((offer) => offer.id === editing)} onDone={() => setEditing(null)} />}
    </section>
    <section><div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-medium">{t('manual_coupons')}</h2>
      <p className="text-sm text-slate-600">{t('coupons_help')}</p></div>
      <button type="button" className="btn text-sm" onClick={() => setShowCoupon((value) => !value)}>{t('issue_coupon')}</button></div>
      {showCoupon && <CouponForm onDone={() => setShowCoupon(false)} />}
      <AdminFeedback error={action.error} notice={action.notice} />
      <AdminQueryState loading={couponsQuery.isPending} error={couponsQuery.error} />
      {couponsQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('no_coupons')}</p>}
      <div className="mt-3 space-y-2">{couponsQuery.data?.map((coupon) => {
        const expired = coupon.expires_at !== null && new Date(coupon.expires_at) <= new Date();
        return <div key={coupon.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
          <span><strong className="font-mono">{coupon.code}</strong> · {coupon.discount_value}{coupon.discount_type === 'percent' ? '%' : ' USD'}
            {' · '}{coupon.user_id ? t('assigned_coupon') : t('public_coupon')} · {coupon.status === 'used' ? t('used') : expired ? t('expired') : t('active')}
            {coupon.expires_at && ` · ${new Date(coupon.expires_at).toLocaleDateString(locale)}`}</span>
          {coupon.status === 'active' && !expired && <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => void expire(coupon)}>{t('expire_coupon')}</button>}
        </div>;
      })}</div>
      <AdminPagination page={couponPage} hasNext={couponsQuery.data?.length === ADMIN_PAGE_SIZE}
        onPageChange={setCouponPage} />
    </section>
  </div>;
}
