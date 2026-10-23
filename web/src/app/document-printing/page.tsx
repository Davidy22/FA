'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { formatMoney } from '@/lib/format';
import { DEFAULT_DOCUMENT_PRICES, useDocumentPrices } from '@/hooks/useDocumentPrices';

type PageError = { message: string; signIn?: boolean };

export default function DocumentPrintingPage() {
  const router = useRouter();
  const locale = useLocale((state) => state.locale);
  const pricesQuery = useDocumentPrices();
  const prices = pricesQuery.data || DEFAULT_DOCUMENT_PRICES;
  const addItem = useCart(s => s.addItem);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<'grayscale' | 'color'>('grayscale');
  const [duplex, setDuplex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Uploads go to a private, owner-scoped bucket, so this page needs an account.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: { user } } = await supabase().auth.getUser();
        if (!cancelled) setUserId(user?.id ?? null);
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function selectFile(selected: File | null) {
    setFile(null); setPages(null); setError(null);
    if (!selected) return;
    if (selected.type !== 'application/pdf' || selected.size > 20 * 1024 * 1024) {
      setError({ message: 'Choose a PDF smaller than 20 MB.' }); return;
    }
    setReading(true);
    try {
      // Loaded on demand: keeps pdf-lib out of the initial page bundle and gives
      // a friendly message if the dependency is missing from an outdated install.
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await selected.arrayBuffer());
      const count = pdf.getPageCount();
      if (count < 1 || count > 500) throw new Error('PDF must have between 1 and 500 pages.');
      setPages(count); setFile(selected);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError({
        message: message === 'PDF must have between 1 and 500 pages.'
          ? message
          : 'Could not read this PDF. Please choose a valid, unencrypted PDF. If the PDF reader failed to load, run "pnpm install" and restart the app.',
      });
    }
    finally { setReading(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const { data: { user } } = await supabase().auth.getUser();
      // Each failure sets its own message: only the sign-in one offers a link,
      // so a wrong file type no longer tells a signed-in customer to sign in.
      if (!user) { setUserId(null); setError({ message: 'Sign in before uploading your document.', signIn: true }); return; }
      if (!file || file.type !== 'application/pdf' || file.size > 20 * 1024 * 1024) { setError({ message: 'Choose a PDF smaller than 20 MB.' }); return; }
      if (pages === null || !Number.isInteger(copies) || copies < 1 || copies > 99) { setError({ message: 'Enter a valid number of sides and copies.' }); return; }
      const path = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase().storage.from('document-prints').upload(path, file, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;
      addItem({ kind: 'document', file_path: path, pages, quantity: copies, color, duplex });
      router.push('/cart');
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally { setBusy(false); }
  }
  return <div className="container-ma max-w-xl py-10">
    <h1 className="text-2xl font-semibold">A4 document printing</h1>
    <p className="mt-2 text-slate-600">{pricesQuery.isPending ? 'Loading prices…' :
      `${formatMoney(prices.grayscale, locale)} per grayscale side or ${formatMoney(prices.color, locale)} per color side.`}
      </p>

    {!checkingAuth && !userId && <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      Document printing needs an account so your PDF stays private. <Link className="underline" href="/login">Sign in</Link> to continue.
    </p>}
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="label">PDF (up to 20 MB)<input className="input mt-1" type="file" accept="application/pdf" required onChange={e => void selectFile(e.target.files?.[0] || null)} /></label>
      <p aria-live="polite" className="text-sm text-slate-600">{reading ? 'Reading PDF…' : pages === null ? 'Select a PDF to see its page count.' : `${pages} printed ${pages === 1 ? 'side' : 'sides'} per copy, read from your PDF.`}</p>
      <label className="label">Copies<input className="input mt-1" type="number" min="1" max="99" required value={copies} onChange={e => setCopies(Number(e.target.value))} /></label>
      <label className="label">Ink<select className="input mt-1" value={color} onChange={e => setColor(e.target.value as 'grayscale' | 'color')}><option value="grayscale">Grayscale · {formatMoney(prices.grayscale, locale)}/side</option><option value="color">Color · {formatMoney(prices.color, locale)}/side</option></select></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={duplex} onChange={e => setDuplex(e.target.checked)} /> Double-sided</label>
      <p className="font-semibold">Printing subtotal: {formatMoney((pages ?? 0) * copies * prices[color], locale)}</p>
      {error && <p role="alert" className="text-red-700">
        {error.message}
        {error.signIn && <> <Link className="underline" href="/login">Sign in</Link></>}
      </p>}
      <button className="btn" disabled={busy || reading || pages === null || (!checkingAuth && !userId)}>{busy ? 'Uploading…' : 'Add to cart'}</button>
    </form>
  </div>;
}
