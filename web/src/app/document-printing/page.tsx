'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { edgeErrorStatus } from '@/lib/edge-errors';
import { useCart } from '@/store/cart';
import { useLocale } from '@/store/locale';
import { formatMoney } from '@/lib/format';
import { DEFAULT_DOCUMENT_PRICES, useDocumentPrices } from '@/hooks/useDocumentPrices';
import {
  convertedPdfName,
  DOCUMENT_INPUT_ACCEPT,
  documentFormat,
  MAX_DOCUMENT_BYTES,
} from '@/lib/documents';

export default function DocumentPrintingPage() {
  const { t } = useTranslation('pages');
  const router = useRouter();
  const locale = useLocale((state) => state.locale);
  const pricesQuery = useDocumentPrices();
  // Show the same immediate estimate as the ink menu while live rates refresh.
  const prices = pricesQuery.data || DEFAULT_DOCUMENT_PRICES;
  const addItem = useCart((state) => state.addItem);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<'grayscale' | 'color'>('grayscale');
  const [duplex, setDuplex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);

  async function selectFile(selected: File | null) {
    const revision = ++selection.current;
    setFile(null); setPages(null); setError(null);
    if (!selected) return;
    const format = documentFormat(selected);
    if (!format || selected.size > MAX_DOCUMENT_BYTES) {
      setError(t('document.invalid_file'));
      return;
    }

    setReading(true);
    setConverting(format !== 'pdf');
    try {
      let printable = selected;
      if (format !== 'pdf') {
        const body = new FormData();
        body.append('file', selected, selected.name);
        const { data, error: conversionError } = await supabase().functions.invoke('convert-document', { body });
        if (conversionError) {
          // The converter is throttled per connection; say so instead of
          // blaming the file, which is the generic conversion error.
          throw new Error(edgeErrorStatus(conversionError) === 429
            ? 'conversion_rate_limited'
            : 'conversion_failed');
        }
        if (!(data instanceof Blob) || data.size === 0 || data.size > MAX_DOCUMENT_BYTES) {
          throw new Error('conversion_failed');
        }
        printable = new File([data], convertedPdfName(selected.name), { type: 'application/pdf' });
      }
      if (selection.current !== revision) return;

      // Parse the printable PDF, whether uploaded directly or converted above.
      const { PDFDocument } = await import('pdf-lib');
      const pdf = await PDFDocument.load(await printable.arrayBuffer());
      const count = pdf.getPageCount();
      if (count < 1 || count > 500) throw new Error('invalid_page_count');
      if (selection.current !== revision) return;
      setPages(count);
      setFile(printable);
    } catch (reason) {
      if (selection.current !== revision) return;
      const message = (reason as Error).message;
      setError(message === 'invalid_page_count'
        ? t('document.invalid_pages')
        : message === 'conversion_rate_limited'
          ? t('document.rate_limited')
          : message === 'conversion_failed'
            ? t('document.conversion_failed')
            : t('document.unreadable_pdf'));
    } finally {
      if (selection.current === revision) {
        setReading(false);
        setConverting(false);
      }
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null); setBusy(true);
    try {
      if (!file || file.type !== 'application/pdf' || file.size > MAX_DOCUMENT_BYTES) {
        setError(t('document.invalid_file'));
        return;
      }
      if (pages === null || !Number.isInteger(copies) || copies < 1 || copies > 99) {
        setError(t('document.invalid_copies'));
        return;
      }
      const { data: { user } } = await supabase().auth.getUser();
      // Signed-in uploads are owner-scoped. Guest paths contain two random
      // capabilities and have insert-only anonymous storage access, never read.
      const path = user
        ? `${user.id}/${crypto.randomUUID()}.pdf`
        : `guest/${crypto.randomUUID()}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase().storage.from('document-prints')
        .upload(path, file, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;
      addItem({ kind: 'document', file_path: path, pages, quantity: copies, color, duplex });
      router.push('/cart');
    } catch (reason) {
      setError((reason as Error).message);
    } finally { setBusy(false); }
  }

  return <div className="container-ma max-w-xl py-10">
    <h1 className="text-2xl font-semibold">{t('document.title')}</h1>
    <p className="mt-2 text-slate-600">
      {t('document.price_summary', {
        grayscale: formatMoney(prices.grayscale, locale),
        color: formatMoney(prices.color, locale),
      })}
    </p>

    <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy || reading}>
      <label className="label">{t('document.file_label')}
        <input className="input mt-1" type="file" accept={DOCUMENT_INPUT_ACCEPT} required
          onChange={(event) => void selectFile(event.target.files?.[0] || null)} />
      </label>
      <p className="text-xs text-slate-500">{t('document.formats_hint')}</p>
      <p aria-live="polite" className="text-sm text-slate-600">
        {reading
          ? t(converting ? 'document.converting' : 'document.reading')
          : pages === null
            ? t('document.select_hint')
            : t('document.page_count', { count: pages })}
      </p>
      <label className="label">{t('document.copies')}
        <input className="input mt-1" type="number" min="1" max="99" required value={copies}
          onChange={(event) => setCopies(Number(event.target.value))} />
      </label>
      <label className="label">{t('document.ink')}
        <select className="input mt-1" value={color}
          onChange={(event) => setColor(event.target.value as 'grayscale' | 'color')}>
          <option value="grayscale">{t('document.grayscale_price', { price: formatMoney(prices.grayscale, locale) })}</option>
          <option value="color">{t('document.color_price', { price: formatMoney(prices.color, locale) })}</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={duplex} onChange={(event) => setDuplex(event.target.checked)} />
        {t('document.duplex')}
      </label>
      <p className="font-semibold">
        {t('document.subtotal', { amount: formatMoney((pages ?? 0) * copies * prices[color], locale) })}
      </p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className="btn gap-2" disabled={busy || reading || pages === null} aria-busy={busy}>
        {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />}
        {busy ? t('document.uploading') : t('common:add_to_cart')}
      </button>
    </form>
  </div>;
}
