'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Location, Profile } from '@/lib/types';

const SUPPORT_EMAIL = 'hello@makeanyth.ing';

export default function ContactPage() {
  const { t } = useTranslation(['pages', 'common', 'errors']);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Contact opens a support ticket, so the sender must have an account; the
  // locations and the email address below keep the page useful otherwise.
  const { data: profile } = useQuery<Profile | null>({
    queryKey: ['me_contact'],
    queryFn: async () => {
      const { data: { user } } = await supabase().auth.getUser();
      if (!user) return null;
      return (await supabase().from('profiles').select('*').eq('id', user.id).single()).data as Profile;
    },
  });

  const { data: locations } = useQuery<Location[]>({
    queryKey: ['active_locations'],
    queryFn: async () => {
      const { data } = await supabase().from('locations').select('*')
        .eq('is_active', true).order('name');
      return (data || []) as Location[];
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true); setError(null); setSent(null);
    try {
      if (!subject.trim() || !message.trim()) throw new Error(t('pages:contact.required'));
      const { data: ticket, error: ticketError } = await supabase().from('tickets').insert({
        user_id: profile.id,
        customer_name: profile.display_name,
        customer_email: profile.email,
        location_id: locationId || profile.location_id || null,
        subject: subject.trim().slice(0, 140),
      }).select('id,subject').single();
      if (ticketError) throw ticketError;
      const { error: messageError } = await supabase().from('ticket_messages').insert({
        ticket_id: ticket.id,
        author_id: profile.id,
        author_name: profile.display_name,
        author_role: 'customer',
        body: message.trim(),
      });
      if (messageError) throw messageError;
      setSent(ticket.subject);
      setSubject('');
      setMessage('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-ma py-10 max-w-4xl">
      <h1 className="text-3xl font-semibold">{t('pages:contact.title')}</h1>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="contact-form-heading">
          {!profile ? (
            <div className="mt-3 rounded border border-slate-200 p-4 text-sm">
              <p className="text-slate-700">{t('pages:contact.sign_in_hint')}</p>
              <Link href="/login" className="btn mt-3 inline-block">{t('common:nav.login')}</Link>
            </div>
          ) : sent ? (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p>{t('pages:contact.sent', { subject: sent })}</p>
              <Link href="/tickets" className="mt-2 inline-block underline">{t('pages:contact.sent_cta')}</Link>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)} className="mt-3 space-y-3">
              <label className="block text-sm">{t('pages:contact.subject')} *
                <input className="input mt-1" required maxLength={140} value={subject}
                  onChange={(event) => setSubject(event.target.value)} />
              </label>
              <label className="block text-sm">{t('pages:contact.location')}
                <select className="input mt-1" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                  <option value="">—</option>
                  {(locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">{t('pages:contact.message')} *
                <textarea className="input mt-1 min-h-32" required maxLength={5000} value={message}
                  onChange={(event) => setMessage(event.target.value)} />
              </label>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <button type="submit" className="btn" disabled={busy}>
                {busy ? t('common:loading') : t('pages:contact.send')}
              </button>
            </form>
          )}
        </section>

        <aside className="space-y-5 text-sm">
          <div>
            <h2 className="text-lg font-medium">{t('pages:contact.email_title')}</h2>
            <p className="mt-1 text-slate-600">{t('pages:contact.email_hint')}</p>
            <a className="mt-1 inline-block text-brand-700 underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </div>
          <div>
          </div>
          <div>
            <h2 className="text-lg font-medium">{t('pages:contact.hours_title')}</h2>
            <Link href="/locations" className="mt-1 inline-block text-brand-700 underline">{t('common:location.view_map')}</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
