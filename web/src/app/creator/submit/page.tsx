'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { Material } from '@/lib/types';

// Simplified submission form — single locale input in MVP, backend still stores JSONB with en required.
export default function SubmitPage() {
  const { t } = useTranslation('creator');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(10);
  const [category, setCategory] = useState('other');
  const [license, setLicense] = useState('platform');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: materials } = useQuery<Material[]>({
    queryKey: ['materials_submit'],
    queryFn: async () => (await supabase().from('materials').select('*').eq('is_active',true)).data || [],
  });
  const [selectedMats, setSelectedMats] = useState<Record<string, number>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) throw new Error('Sign in required');
      if (!file) throw new Error('Model file required');
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const ab = await file.arrayBuffer();
      const { error: uErr } = await supabase().storage.from('submission-assets').upload(filePath, ab, {
        contentType: file.type || 'application/octet-stream',
      });
      if (uErr) throw uErr;
      const mats = Object.entries(selectedMats).map(([material_id, price_modifier]) => ({ material_id, price_modifier }));
      if (mats.length === 0) throw new Error('Select at least one material');
      const { data: sub, error: sErr } = await supabase().from('model_submissions').insert({
        submitter_id: user.id,
        status: 'pending_review',
        title: { en: title },
        description: { en: description },
        category,
        tags: [],
        license,
        ip_warranty: true,
        model_path: filePath,
        preview_urls: [],
        base_price: price,
        submitted_at: new Date().toISOString(),
      }).select().single();
      if (sErr) throw sErr;
      await supabase().from('model_submission_materials').insert(
        mats.map((m) => ({ submission_id: sub.id, ...m }))
      );
      router.push('/creator');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="container-fa py-10 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">{t('submit')}</h1>
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label">Title (EN)</label>
          <input required className="input" value={title} onChange={e=>setTitle(e.target.value)} /></div>
        <div><label className="label">Description (EN)</label>
          <textarea className="input min-h-[100px]" value={description} onChange={e=>setDescription(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Base price (USD)</label>
            <input required type="number" min={0} step={0.01} className="input" value={price} onChange={e=>setPrice(parseFloat(e.target.value))} /></div>
          <div><label className="label">Category</label>
            <select className="input" value={category} onChange={e=>setCategory(e.target.value)}>
              {['toy','tool','art','gadget','replacement_part','other'].map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
        </div>
        <div><label className="label">License</label>
          <select className="input" value={license} onChange={e=>setLicense(e.target.value)}>
            <option value="platform">Platform marketplace terms</option>
            <option value="CC0">CC0</option>
            <option value="CC-BY-4.0">CC-BY-4.0</option>
            <option value="CC-BY-NC-4.0">CC-BY-NC-4.0</option>
          </select></div>
        <div><label className="label">Allowed materials</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {materials?.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <input type="checkbox"
                  checked={m.id in selectedMats}
                  onChange={(e) => {
                    const next = { ...selectedMats };
                    if (e.target.checked) next[m.id] = 0; else delete next[m.id];
                    setSelectedMats(next);
                  }}
                />
                <span>{m.name.en}</span>
                {m.id in selectedMats && (
                  <input type="number" step="0.01" className="w-20 input ml-auto"
                    value={selectedMats[m.id]}
                    onChange={(e) => setSelectedMats({ ...selectedMats, [m.id]: parseFloat(e.target.value) || 0 })}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
        <div><label className="label">Model file (STL/OBJ/3MF, ≤50MB)</label>
          <input type="file" accept=".stl,.obj,.3mf" className="block"
            onChange={e => setFile(e.target.files?.[0] || null)} /></div>
        {error && <p className="text-red-700 text-sm">{error}</p>}
        <button type="submit" className="btn w-full" disabled={busy}>Submit for review</button>
      </form>
    </div>
  );
}
