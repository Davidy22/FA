import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Providers } from '@/components/Providers';
import { LocationPrompt } from '@/components/LocationPrompt';
import { LocationSync } from '@/components/LocationSync';
import { AppShell } from '@/components/AppShell';
import { ThemeSync } from '@/components/ThemeSync';
import { withBasePath } from '@/lib/paths';

const DESCRIPTION =
  'Upload a model or pick from the catalog, choose a filament and a branch, and collect your 3D print. Quotes, document printing and creator payouts included.';

export const metadata: Metadata = {
  title: {
    default: 'Make Anyth.ing — 3D prints on demand',
    template: '%s · Make Anyth.ing',
  },
  description: DESCRIPTION,
  applicationName: 'Make Anyth.ing',
  openGraph: {
    type: 'website',
    siteName: 'Make Anyth.ing',
    title: 'Make Anyth.ing — 3D prints on demand',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary', title: 'Make Anyth.ing', description: DESCRIPTION },
  robots: { index: true, follow: true },
  icons: { icon: [{ url: withBasePath('/favicon.svg'), type: 'image/svg+xml' }] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the page background so mobile browser chrome does not flash white.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply the saved appearance before first paint so no page flashes light. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var v=localStorage.getItem('make-anything-appearance');" +
              "var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;" +
              "document.documentElement.dataset.theme=(v==='light'||v==='dark')?v:(dark?'dark':'light');" +
              "}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <AppShell>
            <ThemeSync />
            <LocationSync />
            <Header />
            <LocationPrompt />
            <main className="flex-1">{children}</main>
            <Footer />
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
