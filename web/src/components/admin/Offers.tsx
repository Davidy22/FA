'use client';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { decimal } from '@/lib/admin';
import { formatMoney, t_db } from '@/lib/format';
import { DEFAULT_REDEEM_OPTIONS, type RedeemOption } from '@/lib/rewards';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Coupon, OfferCode, PremadeProduct } from '@/lib/types';
import { ADMIN_PAGE_SIZE, AdminFeedback, AdminPagination, AdminQueryState, FormActions, useAdminAction, useFormPanel } from './Shared';

function localDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function isoDate(value: string): string | null { return value ? new Date(value).toISOString() : null; }

/** Conditions shared by offers, single coupons, and generated coupon batches. */
type Conditions = { minSpend: string; productId: string };

function useConditions(source?: { min_subtotal?: number | null; product_id?: string | null }) {
  return useState<Conditions>({
    minSpend: source?.min_subtotal ? String(source.min_subtotal) : '',
    productId: source?.product_id || '',
  });
}

function ConditionFields({ conditions, onChange, products }: {
  conditions: Conditions;
  onChange: (next: Conditions) => void;
  products: PremadeProduct[];
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  return <>
    <label className="text-sm">{t('admin:fields.min_subtotal')}
      <input className="input mt-1" type="number" min="0.01" step="0.01" value={conditions.minSpend}
        onChange={(event) => onChange({ ...conditions, minSpend: event.target.value })} />
    </label>
    <label className="text-sm">{t('admin:fields.applies_to_product')}
      <select className="input mt-1" value={conditions.productId}
        onChange={(event) => onChange({ ...conditions, productId: event.target.value })}>
        <option value="">{t('admin:any_product')}</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {t_db(product.name, locale)}{product.status === 'published' ? '' : ` (${t('admin:product_status.' + product.status)})`}
          </option>
        ))}
      </select>
    </label>
  </>;
}

/** Validates the two conditions and returns them as insert/update payload fields. */
function conditionPayload(conditions: Conditions, t: (key: string) => string, products: PremadeProduct[]) {
  const minSpend = conditions.minSpend.trim()
    ? decimal(conditions.minSpend, t('fields.min_subtotal'), 0.01, 99999999)
    : null;
  const productId = conditions.productId || null;
  if (productId && !products.some((product) => product.id === productId)) {
    throw new Error(t('product_not_found'));
  }
  return { min_subtotal: minSpend, product_id: productId };
}

function OfferForm({ offer, products, onDone }: {
  offer?: OfferCode; products: PremadeProduct[]; onDone: () => void;
}) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [code, setCode] = useState(offer?.code || '');
  const [description, setDescription] = useState(offer?.description || '');
  const [type, setType] = useState<'percent' | 'fixed'>(offer?.discount_type || 'percent');
  const [value, setValue] = useState(offer?.discount_value?.toString() || '10');
  const [conditions, setConditions] = useConditions(offer);
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
        ...conditionPayload(conditions, t, products),
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

  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h3 className="font-medium">{offer ? t('edit_offer') : t('add_offer')}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.code')} *<input className="input mt-1 uppercase" required maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="text-sm">{t('fields.description')}<input className="input mt-1" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={type} onChange={(event) => setType(event.target.value as 'percent' | 'fixed')}>
        <option value="percent">{t('discount_type.percent')}</option><option value="fixed">{t('discount_type.fixed')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" type="number" required min="0.01" max={type === 'percent' ? 100 : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <ConditionFields conditions={conditions} onChange={setConditions} products={products} />
      <label className="text-sm">{t('fields.max_claims')}<input className="input mt-1" type="number" min="1" step="1" value={maxClaims} onChange={(event) => setMaxClaims(event.target.value)} /></label>
      <label className="text-sm">{t('fields.coupon_valid_days')}<input className="input mt-1" type="number" required min="1" step="1" value={validDays} onChange={(event) => setValidDays(event.target.value)} /></label>
      <label className="text-sm">{t('fields.starts_at')}<input className="input mt-1" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
      <label className="text-sm">{t('fields.expires_at')}<input className="input mt-1" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
    </div>
    <p className="text-xs text-slate-600">{t('offer_conditions_hint')}</p>
    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

function CouponForm({ products, onDone }: { products: PremadeProduct[]; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('fixed');
  const [value, setValue] = useState('5');
  const [conditions, setConditions] = useConditions();
  const [expiresAt, setExpiresAt] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const normalizedCode = code.trim().toUpperCase();
      if (normalizedCode && !/^[A-Z0-9_-]{6,32}$/.test(normalizedCode)) throw new Error(t('invalid_coupon_code'));
      let userId: string | null = null;
      if (email.trim()) {
        const { data, error } = await supabase().from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error(t('user_not_found'));
        userId = data.id;
      }
      if (expiresAt && new Date(expiresAt) <= new Date()) throw new Error(t('expiry_in_future'));
      const shared = {
        discount_type: type,
        discount_value: decimal(value, t('fields.discount_value'), 0.01, type === 'percent' ? 100 : 99999999),
        ...conditionPayload(conditions, t, products),
        expires_at: isoDate(expiresAt),
      };
      if (normalizedCode) {
        const { error } = await supabase().from('coupons').insert({
          code: normalizedCode, user_id: userId, source: 'admin', ...shared,
        });
        if (error) throw error;
        setIssuedCode(normalizedCode);
      } else {
        // No typed code: let the database mint an unused single-use one.
        const { data, error } = await supabase().rpc('admin_generate_coupons', {
          p_count: 1, p_prefix: null, p_user_id: userId, ...rpcConditions(shared),
        });
        if (error) throw error;
        const rows = (data || []) as { coupon_code: string }[];
        if (!rows.length) throw new Error(t('generation_failed'));
        setIssuedCode(rows[0].coupon_code);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin_coupons'] });
    });
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h3 className="font-medium">{t('issue_coupon')}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.code')}<input className="input mt-1 uppercase" maxLength={32} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label className="text-sm">{t('fields.customer_email')}<input className="input mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={type} onChange={(event) => setType(event.target.value as 'percent' | 'fixed')}>
        <option value="fixed">{t('discount_type.fixed')}</option><option value="percent">{t('discount_type.percent')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" required type="number" min="0.01" max={type === 'percent' ? 100 : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <ConditionFields conditions={conditions} onChange={setConditions} products={products} />
      <label className="text-sm">{t('fields.expires_at')}<input className="input mt-1" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
    </div>
    <p className="text-xs text-slate-600">{t('coupon_hint')}</p>
    {issuedCode && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
      {t('coupon_issued', { code: issuedCode })}
    </p>}
    <AdminFeedback error={action.error} notice={action.notice} /><FormActions busy={action.busy} onCancel={onDone} />
  </form>;
}

/** Shared shape of the generated-coupon RPC arguments. */
function rpcConditions(shared: { discount_type: string; discount_value: number; min_subtotal: number | null; product_id: string | null; expires_at: string | null }) {
  return {
    p_discount_type: shared.discount_type,
    p_discount_value: shared.discount_value,
    p_min_subtotal: shared.min_subtotal,
    p_product_id: shared.product_id,
    p_expires_at: shared.expires_at,
  };
}

function BulkCouponForm({ products, onDone }: { products: PremadeProduct[]; onDone: () => void }) {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const panel = useFormPanel<HTMLFormElement>();
  const [count, setCount] = useState('25');
  const [prefix, setPrefix] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('fixed');
  const [value, setValue] = useState('5');
  const [conditions, setConditions] = useConditions();
  const [expiresAt, setExpiresAt] = useState('');
  const [generated, setGenerated] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const batch = decimal(count, t('fields.code_count'), 1, 500, true);
      const normalizedPrefix = prefix.trim().toUpperCase();
      if (normalizedPrefix && !/^[A-Z0-9_-]{1,12}$/.test(normalizedPrefix)) throw new Error(t('invalid_prefix'));
      if (expiresAt && new Date(expiresAt) <= new Date()) throw new Error(t('expiry_in_future'));
      const shared = {
        discount_type: type,
        discount_value: decimal(value, t('fields.discount_value'), 0.01, type === 'percent' ? 100 : 99999999),
        ...conditionPayload(conditions, t, products),
        expires_at: isoDate(expiresAt),
      };
      const { data, error } = await supabase().rpc('admin_generate_coupons', {
        p_count: batch, p_prefix: normalizedPrefix || null, p_user_id: null, ...rpcConditions(shared),
      });
      if (error) throw error;
      const rows = (data || []) as { coupon_code: string }[];
      if (!rows.length) throw new Error(t('generation_failed'));
      setGenerated(rows.map((row) => row.coupon_code));
      setCopied(false);
      await queryClient.invalidateQueries({ queryKey: ['admin_coupons'] });
    });
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(generated.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return <form ref={panel} onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-lg border border-brand-200 bg-brand-50/30 p-4">
    <h3 className="font-medium">{t('bulk_coupons')}</h3>
    <p className="text-sm text-slate-600">{t('bulk_help')}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('fields.code_count')} *<input className="input mt-1" type="number" required min="1" max="500" step="1" value={count} onChange={(event) => setCount(event.target.value)} /></label>
      <label className="text-sm">{t('fields.code_prefix')}<input className="input mt-1 uppercase" maxLength={12} value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="SUMMER" /></label>
      <label className="text-sm">{t('fields.discount_type')}<select className="input mt-1" value={type} onChange={(event) => setType(event.target.value as 'percent' | 'fixed')}>
        <option value="fixed">{t('discount_type.fixed')}</option><option value="percent">{t('discount_type.percent')}</option>
      </select></label>
      <label className="text-sm">{t('fields.discount_value')}<input className="input mt-1" required type="number" min="0.01" max={type === 'percent' ? 100 : undefined} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <ConditionFields conditions={conditions} onChange={setConditions} products={products} />
      <label className="text-sm">{t('fields.expires_at')}<input className="input mt-1" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
    </div>
    {generated.length > 0 && <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-emerald-900">{t('fields.generated_codes', { number: generated.length })}</p>
        <button type="button" className="btn-outline text-sm" onClick={() => void copyAll()}>{t('copy_codes')}</button>
      </div>
      <p className="mt-1 text-xs text-emerald-800">{copied ? t('codes_copied', { number: generated.length }) : t('codes_copy_hint')}</p>
      <textarea readOnly className="input mt-2 min-h-28 font-mono text-xs" value={generated.join('\n')}
        onFocus={(event) => event.target.select()} aria-label={t('fields.generated_codes', { number: generated.length })} />
    </div>}
    <AdminFeedback error={action.error} notice={action.notice} />
    <FormActions busy={action.busy} onCancel={onDone} submitLabel={t('generate_codes')} />
  </form>;
}

type RedeemDraft = { points: string; discount_type: RedeemOption['discount_type']; discount_value: string; product_id: string };

function optionToDraft(option: RedeemOption): RedeemDraft {
  return {
    points: String(option.points), discount_type: option.discount_type,
    discount_value: String(option.discount_value), product_id: option.product_id || '',
  };
}

/** Points redemption lives with the other coupon tools: it issues coupons too. */
function RedeemSettings({ value, products }: { value: unknown; products: PremadeProduct[] }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [options, setOptions] = useState<RedeemDraft[]>(() =>
    (Array.isArray(value) ? value as RedeemOption[] : DEFAULT_REDEEM_OPTIONS).map(optionToDraft));
  const published = products.filter((product) => product.status === 'published');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      if (!options.length) throw new Error(t('admin:redeem_required'));
      const parsed = options.map((option) => ({
        points: decimal(option.points, t('admin:fields.points'), 1, 2147483647, true),
        discount_type: option.discount_type,
        discount_value: decimal(option.discount_value, t('admin:fields.discount_value'), 0.01,
          option.discount_type === 'percent' ? 100 : 99999999),
        product_id: option.product_id || null,
      }));
      if (new Set(parsed.map((option) => option.points)).size !== parsed.length) throw new Error(t('admin:duplicate_points'));
      if (parsed.some((option) => option.product_id && !published.some((product) => product.id === option.product_id))) {
        throw new Error(t('admin:redeem_product_published'));
      }
      parsed.sort((a, b) => a.points - b.points);
      const { error } = await supabase().from('platform_settings')
        .upsert({ key: 'rewards.redeem_options', value: parsed }, { onConflict: 'key' });
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_settings'] }),
        queryClient.invalidateQueries({ queryKey: ['rewards_settings'] }),
      ]);
    });
  }

  return <form onSubmit={(event) => void submit(event)} className="mt-4 rounded-lg border border-slate-200 p-4">
    <p className="mb-3 text-sm text-slate-600">{t('admin:redeem_help')}</p>
    <div className="space-y-3">{options.map((option, index) => <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-[1fr_1fr_1fr_1.5fr_auto] sm:items-end">
      <label className="text-sm">{t('admin:fields.points')}<input className="input mt-1" type="number" min="1" step="1" required value={option.points}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, points: event.target.value } : row))} /></label>
      <label className="text-sm">{t('admin:fields.discount_type')}<select className="input mt-1" value={option.discount_type}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, discount_type: event.target.value as RedeemOption['discount_type'] } : row))}>
        <option value="fixed">{t('admin:discount_type.fixed')}</option><option value="percent">{t('admin:discount_type.percent')}</option>
      </select></label>
      <label className="text-sm">{t('admin:fields.discount_value')}<input className="input mt-1" type="number" min="0.01" step="0.01" required value={option.discount_value}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, discount_value: event.target.value } : row))} /></label>
      <label className="text-sm">{t('admin:fields.redeem_product')}<select className="input mt-1" value={option.product_id}
        onChange={(event) => setOptions((previous) => previous.map((row, i) => i === index ? { ...row, product_id: event.target.value } : row))}>
        <option value="">{t('admin:any_product')}</option>
        {published.map((product) => <option key={product.id} value={product.id}>{t_db(product.name, locale)}</option>)}
      </select></label>
      <button type="button" className="btn-outline text-sm" onClick={() => setOptions((previous) => previous.filter((_, i) => i !== index))}>{t('admin:remove')}</button>
    </div>)}</div>
    <p className="mt-3 text-xs text-slate-600">{t('admin:redeem_product_hint')}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn-outline text-sm" onClick={() => setOptions((previous) => [...previous, { points: '', discount_type: 'fixed', discount_value: '', product_id: '' }])}>{t('admin:add_redeem_option')}</button>
      <button type="submit" className="btn text-sm" disabled={action.busy}>{t('admin:save_setting')}</button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
  </form>;
}

export function AdminOffers() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [couponMode, setCouponMode] = useState<'single' | 'bulk' | null>(null);
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
  const productsQuery = useQuery<PremadeProduct[]>({
    queryKey: ['admin_products'], queryFn: async () => {
      const { data, error } = await supabase().from('premade_products').select('*').order('name->>en');
      if (error) throw error;
      return (data || []) as PremadeProduct[];
    },
  });
  const settingsQuery = useQuery<{ key: string; value: unknown }>({
    queryKey: ['admin_settings_redeem'], queryFn: async () => {
      const { data, error } = await supabase().from('platform_settings').select('*').eq('key', 'rewards.redeem_options').maybeSingle();
      if (error) throw error;
      return data || { key: 'rewards.redeem_options', value: null };
    },
  });
  const products = productsQuery.data || [];
  const productName = (id: string | null) =>
    id ? (t_db(products.find((product) => product.id === id)?.name, locale) || id) : null;
  /** "Min spend US$50 · Only Desk Cable Holder" for the lists below. */
  const conditionLabel = (row: { min_subtotal: number | null; product_id: string | null }) => {
    const parts: string[] = [];
    if (row.min_subtotal) parts.push(t('admin:coupon_min_subtotal', { amount: formatMoney(Number(row.min_subtotal), locale) }));
    const product = productName(row.product_id);
    if (product) parts.push(t('admin:coupon_product_scope', { product }));
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  };

  async function expire(coupon: Coupon) {
    if (!window.confirm(t('admin:expire_coupon_confirm'))) return;
    await action.run(async () => {
      const { error } = await supabase().from('coupons').update({ expires_at: new Date().toISOString() }).eq('id', coupon.id).eq('status', 'active');
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['admin_coupons'] });
    });
  }

  return <div className="space-y-8">
    <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">{t('admin:offers')}</h2>
      <p className="text-sm text-slate-600">{t('admin:offers_help')}</p></div>
      <button type="button" className="btn text-sm" onClick={() => setEditing('new')}>{t('admin:add_offer')}</button></div>
      {editing && <OfferForm key={editing} offer={offersQuery.data?.find((offer) => offer.id === editing)} products={products} onDone={() => setEditing(null)} />}
      <AdminQueryState loading={offersQuery.isPending} error={offersQuery.error} />
      {offersQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('admin:no_offers')}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">{offersQuery.data?.map((offer) => <div key={offer.id} className="rounded border p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><strong className="font-mono">{offer.code}</strong>
          <button className="text-brand-700 underline" onClick={() => setEditing(offer.id)}>{t('admin:edit_offer')}</button></div>
        <p className="text-slate-600">{offer.description || '—'} · {offer.discount_value}{offer.discount_type === 'percent' ? '%' : ` ${t('common:currency_code')}`}
          {conditionLabel(offer)}
          {' · '}{offer.claims_count}/{offer.max_claims ?? '∞'} · {offer.is_active ? t('admin:active') : t('admin:inactive')}</p>
      </div>)}</div>
      <AdminPagination page={offerPage} hasNext={offersQuery.data?.length === ADMIN_PAGE_SIZE}
        onPageChange={(next) => { setOfferPage(next); setEditing(null); }} />
    </section>

    <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">{t('admin:manual_coupons')}</h2>
      <p className="text-sm text-slate-600">{t('admin:coupons_help')}</p></div>
      <div className="flex gap-2">
        <button type="button" className="btn-outline text-sm" onClick={() => setCouponMode((mode) => mode === 'bulk' ? null : 'bulk')}>{t('admin:bulk_coupons')}</button>
        <button type="button" className="btn text-sm" onClick={() => setCouponMode((mode) => mode === 'single' ? null : 'single')}>{t('admin:issue_coupon')}</button>
      </div></div>
      {couponMode === 'single' && <CouponForm key="single" products={products} onDone={() => setCouponMode(null)} />}
      {couponMode === 'bulk' && <BulkCouponForm key="bulk" products={products} onDone={() => setCouponMode(null)} />}
      <AdminFeedback error={action.error} notice={action.notice} />
      <AdminQueryState loading={couponsQuery.isPending} error={couponsQuery.error} />
      {couponsQuery.data?.length === 0 && <p className="mt-4 text-slate-500">{t('admin:no_coupons')}</p>}
      <div className="mt-3 space-y-2">{couponsQuery.data?.map((coupon) => {
        const expired = coupon.expires_at !== null && new Date(coupon.expires_at) <= new Date();
        return <div key={coupon.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
          <span><strong className="font-mono">{coupon.code}</strong> · {coupon.discount_value}{coupon.discount_type === 'percent' ? '%' : ` ${t('common:currency_code')}`}
            {conditionLabel(coupon)}
            {' · '}{coupon.user_id ? t('admin:assigned_coupon') : t('admin:public_coupon')} · {coupon.status === 'used' ? t('admin:used') : expired ? t('admin:expired') : t('admin:active')}
            {coupon.expires_at && ` · ${new Date(coupon.expires_at).toLocaleDateString(locale)}`}</span>
          {coupon.status === 'active' && !expired && <button type="button" className="text-red-700 underline" disabled={action.busy} onClick={() => void expire(coupon)}>{t('admin:expire_coupon')}</button>}
        </div>;
      })}</div>
      <AdminPagination page={couponPage} hasNext={couponsQuery.data?.length === ADMIN_PAGE_SIZE}
        onPageChange={setCouponPage} />
    </section>

    <section>
      <div><h2 className="text-xl font-medium">{t('admin:redeem_options')}</h2>
        <p className="text-sm text-slate-600">{t('admin:redeem_section_help')}</p></div>
      <AdminQueryState loading={settingsQuery.isPending} error={settingsQuery.error} />
      {!settingsQuery.isPending && <RedeemSettings key={JSON.stringify(settingsQuery.data?.value ?? null)}
        value={settingsQuery.data?.value} products={products} />}
    </section>
  </div>;
}
