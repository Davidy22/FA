import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DocumentPrintingPage from '@/app/document-printing/page';
import { supabase } from '@/lib/supabase';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: vi.fn() }));
vi.mock('@/store/cart', () => ({ useCart: (select: (state: { addItem: () => void }) => unknown) => select({ addItem: vi.fn() }) }));
vi.mock('@/hooks/useDocumentPrices', () => ({
  DEFAULT_DOCUMENT_PRICES: { grayscale: 0.5, color: 1 },
  useDocumentPrices: () => ({ data: { grayscale: 0.5, color: 1 }, isPending: false, error: null }),
}));

const userId = 'cccccccc-cccc-cccc-cccc-000000000001';
let signedIn: boolean;

function mockAuth() {
  vi.mocked(supabase).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  } as unknown as ReturnType<typeof supabase>);
}

function chooseFile(file: File) {
  const input = screen.getByLabelText(/PDF \(up to 20 MB\)/) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => { signedIn = true; mockAuth(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('document printing upload errors', () => {
  it('does not tell a signed-in customer to sign in after a non-PDF upload', async () => {
    render(<DocumentPrintingPage />);
    chooseFile(new File(['not a pdf'], 'photo.png', { type: 'image/png' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Choose a PDF smaller than 20 MB.');
    // The sign-in link used to follow every error message, including this one.
    expect(alert.querySelector('a')).toBeNull();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in before uploading, and only there', async () => {
    signedIn = false;
    render(<DocumentPrintingPage />);
    const notice = await screen.findByText(/Document printing needs an account/);
    expect(notice.querySelector('a[href="/login"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an unreadable PDF without a sign-in prompt', async () => {
    render(<DocumentPrintingPage />);
    chooseFile(new File(['%PDF-1.4 broken'], 'broken.pdf', { type: 'application/pdf' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not read this PDF.');
    expect(alert.querySelector('a')).toBeNull();
  });
});
