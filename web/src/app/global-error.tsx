'use client';
import { useEffect } from 'react';

/**
 * Last resort: an error in the root layout itself. Next requires this file to
 * render its own <html>/<body>, and it cannot use the i18n provider (that may be
 * what failed), so the copy is bilingual and dependency-free.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Root error', error); }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '4rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Something went wrong. · 出了點問題。 · 出了点问题。</h1>
        <p style={{ color: '#475569', fontSize: '0.875rem' }}>
          Please reload the page. If it keeps happening, contact us.
        </p>
        <button type="button" onClick={reset} style={{ marginTop: '1.5rem', padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid #94a3b8', background: '#fff' }}>
          Try again
        </button>
      </body>
    </html>
  );
}
