'use client';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocation } from '@/store/location';
import { useLocale } from '@/store/locale';
import { useCart } from '@/store/cart';
import { t_db, formatMaterial, formatMoney, formatGrams, formatMinutes } from '@/lib/format';
import { quoteHeuristic, type QuoteBreakdown } from '@/lib/pricing';
import type { Filament, Location, Material } from '@/lib/types';
import { meshMetrics, parseFile, sha256, type MeshMetrics } from '@/lib/meshParser';

type ParsedInfo = { metrics: MeshMetrics; sha256: string };

const DEFAULT_CONSTANTS = {
  wall_thickness_mm: 0.84, setup_minutes: 3, handling_fee: 1.0, min_order_fee: 3.0,
};

export default function QuotePage() {
  const { t } = useTranslation(['common','quote','errors']);
  const locale = useLocale((s) => s.locale);
  const locationId = useLocation((s) => s.selectedLocationId);
  const addItem = useCart((s) => s.addItem);
  const setCartLocation = useCart((s) => s.setLocation);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materialId, setMaterialId] = useState<string>('');
  const [filamentId, setFilamentId] = useState<string>('');
  const [infill, setInfill] = useState(20);
  const [layerHeight, setLayerHeight] = useState(0.2);
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<QuoteBreakdown | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: materials } = useQuery<Material[]>({
    queryKey: ['materials'],
    queryFn: async () => {
      const { data } = await supabase().from('materials').select('*').eq('is_active',true).order('sort_order');
      return data || [];
    },
  });

  const { data: location } = useQuery<Location>({
    queryKey: ['location', locationId],
    enabled: !!locationId,
    queryFn: async () => (await supabase().from('locations').select('*').eq('id', locationId).single()).data as Location,
  });

  const { data: filaments } = useQuery<Filament[]>({
    queryKey: ['available_filaments', locationId, materialId],
    enabled: !!locationId && !!materialId,
    queryFn: async () => {
      const { data } = await supabase().rpc('available_filaments', {
        p_location_id: locationId, p_material_id: materialId,
      });
      return (data || []) as unknown as Filament[];
    },
  });

  const material = useMemo(() => materials?.find((m) => m.id === materialId), [materials, materialId]);
  const filament = useMemo(() => filaments?.find((f) => f.id === filamentId), [filaments, filamentId]);

  useEffect(() => {
    if (!parsed || !material || !filament || !location) return;
    const q = quoteHeuristic({
      volume_cm3: parsed.metrics.volume_cm3,
      surface_cm2: parsed.metrics.surface_cm2,
      material: { density_g_cm3: material.density_g_cm3, default_flow_mm3_s: material.default_flow_mm3_s },
      filament: { cost_per_gram: filament.cost_per_gram },
      location: { hourly_machine_rate: location.hourly_machine_rate, tax_rate: location.tax_rate },
      infill_percent: infill,
      quantity,
      constants: DEFAULT_CONSTANTS,
    });
    setQuote(q);
  }, [parsed, material, filament, location, infill, quantity]);

  async function handleFile(f: File) {
    setError(null); setQuote(null); setParsed(null); setBusy(true);
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error(t('errors:file_too_large'));
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (!['stl','obj','3mf'].includes(ext || '')) throw new Error(t('errors:invalid_file'));
      let mesh;
      try {
        mesh = await parseFile(f);
      } catch (e) {
        throw new Error(t('quote:error_parse'));
      }
      const metrics = meshMetrics(mesh);
      const ab = await f.arrayBuffer();
      const digest = await sha256(ab);
      setFile(f);
      setParsed({ metrics, sha256: digest });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCart() {
    if (!parsed || !quote || !material || !filament || !location) return;
    // Upload model to storage
    const userResp = await supabase().auth.getUser();
    const uid = userResp.data.user?.id || 'anon';
    const filePath = `${uid}/${Date.now()}-${file?.name || 'model'}`;
    const ab = await file!.arrayBuffer();
    const { error: upErr } = await supabase().storage.from('models').upload(filePath, ab, {
      contentType: file!.type || 'application/octet-stream',
    });
    if (upErr) { setError(upErr.message); return; }

    const { data: uploaded, error: insErr } = await supabase().from('uploaded_models').insert({
      user_id: userResp.data.user?.id || null,
      file_path: filePath,
      original_filename: file!.name,
      model_sha256: parsed.sha256,
      volume_cm3: parsed.metrics.volume_cm3,
      surface_cm2: parsed.metrics.surface_cm2,
      bbox: parsed.metrics.bbox,
      triangle_count: parsed.metrics.triangle_count,
    }).select().single();
    if (insErr) { setError(insErr.message); return; }

    // Call verify-model edge function (server-side re-parse, anti-tamper).
    const { data: verify, error: vErr } = await supabase().functions.invoke('verify-model', {
      body: { uploaded_model_id: uploaded.id },
    });
    if (vErr) { setError(vErr.message); return; }

    const { data: qr, error: qErr } = await supabase().from('quote_requests').insert({
      user_id: userResp.data.user?.id || null,
      uploaded_model_id: uploaded.id,
      material_id: material.id,
      filament_id: filament.id,
      infill_percent: infill,
      layer_height: layerHeight,
      quantity,
      engine: 'heuristic',
      status: 'complete',
      estimated_price: quote.unit_price * quantity,
      price_breakdown: {
        material_cost: quote.material_cost,
        machine_cost: quote.machine_cost,
        handling_fee: quote.handling_fee,
        grams: quote.grams,
        print_time_min: quote.print_time_minutes,
      },
      material_usage_grams: quote.grams,
      print_time_minutes: quote.print_time_minutes,
    }).select().single();
    if (qErr) { setError(qErr.message); return; }

    setCartLocation(locationId);
    addItem({
      kind: 'custom',
      quote_request_id: qr.id,
      material_id: material.id,
      color_filament_id: filament.id,
      quantity,
      options: { infill, layer_height: layerHeight, filename: file!.name },
    });
    window.location.href = '/cart';
  }

  useEffect(() => { if (typeof window !== 'undefined' && !workerRef.current) {
    // Lazy: we use main thread parsing for MVP to keep worker deps simple; worker is wired for future.
  }}, []);

  return (
    <div className="container-fa py-10 max-w-3xl">
      <h1 className="text-3xl font-bold">{t('quote:title')}</h1>
      <p className="mt-2 text-slate-600">{t('quote:supported_formats')}</p>

      {!locationId && (
        <p className="mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded text-sm">
          {t('errors:select_location_first')}
        </p>
      )}

      <div
        className={
          'mt-6 rounded-xl border-2 border-dashed p-10 text-center transition-colors ' +
          (dragOver ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50')
        }
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        aria-label={t('quote:dropzone')}
      >
        <p className="text-lg">{busy ? t('quote:calculating') : t('quote:dropzone')}</p>
        <p className="text-sm text-slate-500 mt-1">{t('quote:supported_formats')}</p>
        <input
          ref={inputRef} type="file" accept=".stl,.obj,.3mf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>

      {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}

      {file && parsed && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-600">{file.name} — {parsed.metrics.triangle_count.toLocaleString(locale)} triangles</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">{t('quote:material')}</label>
              <select className="input" value={materialId} onChange={(e) => { setMaterialId(e.target.value); setFilamentId(''); }}>
                <option value="">—</option>
                {materials?.map((m) => (
                  <option key={m.id} value={m.id}>{formatMaterial(m, locale)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('quote:color')}</label>
              <select className="input" value={filamentId} onChange={(e) => setFilamentId(e.target.value)} disabled={!materialId}>
                <option value="">—</option>
                {filaments?.map((f) => (
                  <option key={f.id} value={f.id}>{t_db(f.color, locale)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t('quote:infill')} — {infill}%</label>
              <input type="range" min={10} max={100} step={10} value={infill}
                onChange={(e) => setInfill(parseInt(e.target.value,10))} className="w-full" />
            </div>
            <div>
              <label className="label">{t('quote:layer_height')}</label>
              <input type="number" step={0.05} min={0.1} max={0.4} value={layerHeight}
                onChange={(e) => setLayerHeight(parseFloat(e.target.value))} className="input" />
            </div>
            <div>
              <label className="label">{t('common:quantity')}</label>
              <input type="number" min={1} max={10} value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value,10))} className="input" />
            </div>
          </div>

          {quote && (
            <div className="rounded-lg border border-slate-200 p-4">
              <h3 className="font-semibold">{t('quote:breakdown.title')}</h3>
              <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                <dt>{t('quote:breakdown.material')}</dt>
                <dd className="text-right">{formatMoney(quote.material_cost, locale)} ({formatGrams(quote.grams, locale)})</dd>
                <dt>{t('quote:breakdown.machine_time')}</dt>
                <dd className="text-right">{formatMoney(quote.machine_cost, locale)} ({formatMinutes(quote.print_time_minutes, locale)})</dd>
                <dt>{t('quote:breakdown.handling')}</dt>
                <dd className="text-right">{formatMoney(quote.handling_fee, locale)}</dd>
                {quote.unit_price_floored && (
                  <>
                    <dt>{t('quote:breakdown.minimum_fee')}</dt><dd className="text-right">{formatMoney(DEFAULT_CONSTANTS.min_order_fee, locale)}</dd>
                  </>
                )}
                <dt className="font-semibold pt-2">{t('common:total')}</dt>
                <dd className="text-right font-semibold pt-2">{formatMoney(quote.total, locale)}</dd>
              </dl>
              <p className="mt-3 text-xs text-slate-500">{t('quote:estimate_disclaimer')}</p>
              <button className="btn mt-4 w-full" onClick={addToCart} disabled={!filament}>
                {t('common:add_to_cart')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
