'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { t_db } from '@/lib/format';
import { decimal } from '@/lib/admin';
import { supabase } from '@/lib/supabase';
import { useLocale } from '@/store/locale';
import type { Material, ModelSubmission } from '@/lib/types';
import { AdminFeedback, AdminQueryState, useAdminAction } from './Shared';

type Submission = ModelSubmission & {
  model_submission_materials: { material_id: string; price_modifier: number }[];
};

function SubmissionReview({ submission, materials }: { submission: Submission; materials: Material[] }) {
  const { t } = useTranslation(['admin', 'creator', 'common']);
  const locale = useLocale((state) => state.locale);
  const queryClient = useQueryClient();
  const action = useAdminAction();
  const [notes, setNotes] = useState(submission.review_notes || '');
  const [price, setPrice] = useState(String(submission.base_price));
  const [allowed, setAllowed] = useState<Record<string, string>>(() => Object.fromEntries(
    submission.model_submission_materials
      .filter((row) => materials.some((material) => material.id === row.material_id && material.is_active))
      .map((row) => [row.material_id, String(row.price_modifier)]),
  ));
  const [defaultMaterialId, setDefaultMaterialId] = useState(
    submission.model_submission_materials.find((row) => materials.some((m) => m.id === row.material_id && m.is_active))?.material_id || '',
  );
  const allowedIds = Object.keys(allowed);

  async function decide(decision: 'approve' | 'reject' | 'changes_requested') {
    await action.run(async () => {
      let edits: object = {};
      if (decision === 'approve') {
        if (!allowedIds.length || !defaultMaterialId || !allowedIds.includes(defaultMaterialId)) {
          throw new Error(t('admin:publish_requires_material'));
        }
        edits = {
          base_price: decimal(price, t('admin:fields.base_price'), 0, 99999999),
          materials: allowedIds.map((material_id) => ({
            material_id,
            price_modifier: decimal(allowed[material_id], t('admin:fields.price_modifier'), -99999999, 99999999),
          })),
          default_material_id: defaultMaterialId,
        };
      } else if (!notes.trim()) {
        throw new Error(t('admin:review_notes_required'));
      }
      const { data, error } = await supabase().functions.invoke('submissions-decide', {
        body: { submission_id: submission.id, action: decision, notes: notes.trim(), edits },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin_submissions'] }),
        queryClient.invalidateQueries({ queryKey: ['admin_products'] }),
        queryClient.invalidateQueries({ queryKey: ['products'] }),
      ]);
    });
  }

  return <article className="rounded-lg border border-slate-200 p-4">
    <h3 className="font-semibold">{t_db(submission.title, locale)}</h3>
    <p className="text-sm text-slate-600">{t(`creator:status.${submission.status}`)} · {t(`common:categories.${submission.category}`)}</p>
    {submission.review_notes && <p className="mt-1 text-sm">{submission.review_notes}</p>}
    <p className="mt-3 text-xs text-slate-600">{t('admin:review_adjust_hint')}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{t('admin:fields.base_price')}
        <input className="input mt-1" type="number" min="0" step="0.01"
          value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label className="text-sm">{t('admin:fields.default_material')}
        <select className="input mt-1" value={defaultMaterialId} onChange={(event) => setDefaultMaterialId(event.target.value)}>
          <option value="">—</option>
          {allowedIds.map((id) => <option key={id} value={id}>
            {t_db(materials.find((material) => material.id === id)?.name, locale) || id}
          </option>)}
        </select>
      </label>
    </div>
    <fieldset className="mt-3 rounded border p-3">
      <legend className="text-sm font-medium">{t('admin:allowed_materials')}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{materials.filter((material) => material.is_active).map((material) =>
        <div key={material.id} className="flex items-center gap-2 text-sm">
          <label className="flex flex-1 items-center gap-2">
            <input type="checkbox" checked={material.id in allowed} onChange={(event) => {
              setAllowed((previous) => {
                const next = { ...previous };
                if (event.target.checked) next[material.id] = '0'; else delete next[material.id];
                return next;
              });
              if (!event.target.checked && material.id === defaultMaterialId) setDefaultMaterialId('');
              if (event.target.checked && !defaultMaterialId) setDefaultMaterialId(material.id);
            }} />
            {t_db(material.name, locale)}
          </label>
          {material.id in allowed && <input type="number" step="0.01" className="input w-28"
            aria-label={`${t('admin:fields.price_modifier')}: ${t_db(material.name, locale)}`}
            value={allowed[material.id]}
            onChange={(event) => setAllowed((previous) => ({ ...previous, [material.id]: event.target.value }))} />}
        </div>)}
      </div>
    </fieldset>
    <label className="mt-3 block text-sm text-slate-700">{t('admin:review_notes')}
      <textarea className="input mt-1 min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} />
    </label>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn text-sm" disabled={action.busy} onClick={() => void decide('approve')}>
        {t('admin:approve')}
      </button>
      <button type="button" className="btn-outline text-sm" disabled={action.busy || !notes.trim()}
        onClick={() => void decide('changes_requested')}>{t('admin:request_changes')}</button>
      <button type="button" className="btn-outline text-sm text-red-700" disabled={action.busy || !notes.trim()}
        onClick={() => void decide('reject')}>{t('admin:reject')}</button>
    </div>
    <AdminFeedback error={action.error} notice={action.notice} />
  </article>;
}

export function AdminSubmissions() {
  const { t } = useTranslation('admin');
  const { data, isPending, error } = useQuery<Submission[]>({
    queryKey: ['admin_submissions'],
    queryFn: async () => {
      const { data, error } = await supabase().from('model_submissions')
        .select('*,model_submission_materials(material_id,price_modifier)')
        .in('status', ['pending_review', 'changes_requested']).order('submitted_at');
      if (error) throw error;
      return (data || []) as Submission[];
    },
  });
  const materialsQuery = useQuery<Material[]>({
    queryKey: ['admin_materials'],
    queryFn: async () => {
      const { data, error } = await supabase().from('materials').select('*').order('sort_order');
      if (error) throw error;
      return (data || []) as Material[];
    },
  });
  return <>
    <h2 className="text-xl font-medium">{t('submissions')}</h2>
    <AdminQueryState loading={isPending || materialsQuery.isPending} error={error || materialsQuery.error} />
    {data?.length === 0 && <p className="mt-4 text-slate-500">{t('empty_queue')}</p>}
    <div className="mt-4 space-y-3">{materialsQuery.data && data?.map((submission) =>
      <SubmissionReview key={submission.id} submission={submission} materials={materialsQuery.data} />)}
    </div>
  </>;
}
