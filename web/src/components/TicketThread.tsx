'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/store/locale';
import { supabase } from '@/lib/supabase';
import type { TicketAttachment, TicketMessage } from '@/lib/types';

/** 5-minute signed download URL for a ticket attachment (owner or staff). */
async function downloadTicketAttachment(
  attachment: TicketAttachment,
  ticketId: string,
): Promise<void> {
  const { data, error } = await supabase().functions.invoke('sign-file', {
    body: { bucket: 'ticket-uploads', path: attachment.file_path, ticket_id: ticketId },
  });
  if (error) throw error;
  if (data?.signedUrl) window.open(data.signedUrl, '_blank');
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only conversation timeline + attachment list, shared by the
 * customer and employee ticket views. */
export function TicketThread({
  messages,
  attachments,
  ticketId,
}: {
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  ticketId: string;
}) {
  const { t } = useTranslation(['tickets', 'common']);
  const locale = useLocale((s) => s.locale);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(a: TicketAttachment) {
    setDownloading(a.id); setError(null);
    try {
      await downloadTicketAttachment(a, ticketId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-4">
      {attachments.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3">
          <h3 className="text-sm font-medium">{t('tickets:attachments')}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="truncate">📎 {a.original_filename}
                  {a.file_size ? <span className="text-slate-400"> ({formatSize(a.file_size)})</span> : null}
                </span>
                <button
                  className="text-brand-700 underline disabled:text-slate-400"
                  disabled={downloading === a.id}
                  onClick={() => void download(a)}
                >
                  {downloading === a.id ? t('common:loading') : t('tickets:download')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-3">
        {messages.map((m) => {
          const isStaff = m.author_role !== 'customer';
          return (
            <li
              key={m.id}
              className={
                'max-w-[85%] rounded-lg border px-4 py-3 ' +
                (isStaff ? 'ml-auto border-brand-200 bg-brand-50' : 'border-slate-200 bg-white')
              }
            >
              <p className="text-xs text-slate-500">
                <strong>{m.author_name || t('tickets:anonymous')}</strong>
                {isStaff && <span className="ml-2 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">{t('tickets:staff_badge')}</span>}
                {' · '}
                {new Date(m.created_at).toLocaleString(locale)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          );
        })}
      </ol>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
