'use client';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useLocation } from '@/store/location';
import { useLocale } from '@/store/locale';
import { t_db } from '@/lib/format';
import type { Location, Profile, Ticket, TicketAttachment } from '@/lib/types';

const MAX_FILES = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB each
const ALLOWED_EXT = ['stl', 'obj', '3mf', 'step', 'stp', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function QuotePage() {
  const { t } = useTranslation(['common', 'quote', 'tickets', 'errors']);
  const locale = useLocale((s) => s.locale);
  const locationId = useLocation((s) => s.selectedLocationId);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['locations_all'],
    queryFn: async () => {
      const { data } = await supabase().from('locations').select('*').eq('is_active', true);
      return (data || []) as Location[];
    },
  });

  useEffect(() => {
    void (async () => {
      const { data: { user: u } } = await supabase().auth.getUser();
      if (!u) return;
      setUser({ id: u.id, email: u.email ?? null });
      const { data: p } = await supabase()
        .from('profiles').select('display_name, email').eq('id', u.id).single();
      if (p) setProfile(p as Profile);
    })();
  }, []);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const room = MAX_FILES - files.length;
    const next = Array.from(incoming).slice(0, room);
    setFiles((prev) => [...prev, ...next]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    const subjectTrim = subject.trim();
    const messageTrim = message.trim();
    if (!subjectTrim) { setError(t('tickets:error_subject_required')); return; }
    if (messageTrim.length < 10) { setError(t('tickets:error_message_short')); return; }
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) { setError(t('tickets:error_attachment_too_large')); return; }
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXT.includes(ext)) { setError(t('tickets:error_attachment_type')); return; }
    }

    setBusy(true);
    try {
      // 1. Open the ticket
      const { data: ticket, error: tErr } = await supabase().from('tickets').insert({
        user_id: user.id,
        customer_name: profile?.display_name || null,
        customer_email: user.email || null,
        location_id: locationId || null,
        subject: subjectTrim,
      }).select().single();
      if (tErr) throw tErr;

      // 2. First message = the customer's request
      const { error: mErr } = await supabase().from('ticket_messages').insert({
        ticket_id: ticket.id,
        author_id: user.id,
        body: messageTrim,
      });
      if (mErr) throw mErr;

      // 3. Attachments into the private ticket-uploads bucket
      const attachmentRows: TicketAttachment[] = [];
      for (const f of files) {
        const path = `${user.id}/${ticket.id}/${Date.now()}-${f.name}`;
        const { error: upErr } = await supabase().storage.from('ticket-uploads').upload(path, f, {
          contentType: f.type || 'application/octet-stream',
        });
        if (upErr) throw upErr;
        attachmentRows.push({
          id: '',
          ticket_id: ticket.id,
          file_path: path,
          original_filename: f.name,
          file_size: f.size,
          uploaded_by: user.id,
          created_at: new Date().toISOString(),
        });
      }
      if (attachmentRows.length > 0) {
        const { error: aErr } = await supabase()
          .from('ticket_attachments')
          .insert(attachmentRows.map(({ id, created_at, ...rest }) => rest));
        if (aErr) throw aErr;
      }

      router.push(`/tickets?id=${ticket.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="container-ma py-10 max-w-xl">
        <h1 className="text-3xl font-bold">{t('quote:title')}</h1>
        <p className="mt-2 text-slate-600">{t('quote:subtitle')}</p>
        <div className="mt-6 rounded-lg border border-brand-200 bg-brand-50 p-6 text-center">
          <p className="font-medium">{t('quote:signin_needed')}</p>
          <p className="mt-1 text-sm text-slate-600">{t('quote:signin_hint')}</p>
          <Link href="/login" className="btn mt-4 inline-block">{t('common:nav.login')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-ma py-10 max-w-2xl">
      <h1 className="text-3xl font-bold">{t('quote:title')}</h1>
      <p className="mt-2 text-slate-600">{t('quote:subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label className="label" htmlFor="ticket-subject">{t('tickets:subject')}</label>
          <input
            id="ticket-subject"
            className="input mt-1"
            value={subject}
            maxLength={140}
            placeholder={t('tickets:subject_placeholder')}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="ticket-message">{t('tickets:message')}</label>
          <textarea
            id="ticket-message"
            className="input mt-1 min-h-32"
            value={message}
            placeholder={t('tickets:message_placeholder')}
            onChange={(e) => setMessage(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-slate-500">
            {t('tickets:message_hint', { count: message.trim().length })}
          </p>
        </div>

        <div>
          <label className="label">{t('tickets:attachments')}</label>
          <div
            className={
              'mt-1 rounded-xl border-2 border-dashed p-8 text-center transition-colors ' +
              (dragOver ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-slate-50')
            }
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            role="button" tabIndex={0}
            aria-label={t('tickets:dropzone')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          >
            <p className="text-sm">{t('tickets:dropzone')}</p>
            <p className="mt-1 text-xs text-slate-500">
              {t('tickets:attachment_limits', { count: MAX_FILES, size: '25 MB' })}
            </p>
            <input
              ref={inputRef} type="file" multiple
              accept=".stl,.obj,.3mf,.step,.stp,.pdf,.png,.jpg,.jpeg,.gif,.svg"
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5">
                  <span className="truncate">{f.name} <span className="text-slate-400">({formatBytes(f.size)})</span></span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    aria-label={t('common:delete')}
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <span className="font-medium">{t('tickets:location')}: </span>
          {locationId
            ? (t_db(locations?.find((l) => l.id === locationId)?.name, locale) || locationId)
            : t('errors:select_location_first')}
        </div>

        <p className="text-sm text-slate-600">
          <span className="font-medium">{t('tickets:contact')}: </span>
          {profile?.display_name || user.email}
        </p>

        {error && <p role="alert" className="text-red-700">{error}</p>}

        <button className="btn w-full" disabled={busy}>
          {busy ? t('common:loading') : t('quote:submit')}
        </button>
        <p className="text-xs text-slate-500">{t('quote:response_hint')}</p>
      </form>
    </div>
  );
}
