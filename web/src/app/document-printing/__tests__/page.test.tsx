import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PDFDocument } from 'pdf-lib';
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
let convertedPdf: Blob;
let convert: ReturnType<typeof vi.fn>;

function mockAuth() {
  vi.mocked(supabase).mockReturnValue({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: userId } : null }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    functions: { invoke: convert },
  } as unknown as ReturnType<typeof supabase>);
}

function chooseFile(file: File) {
  const input = screen.getByLabelText(/Document \(up to 20 MB\)/) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(async () => {
  signedIn = true;
  convert = vi.fn(async () => ({ data: convertedPdf, error: null }));
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = await pdf.save();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  convertedPdf = new Blob([buffer], { type: 'application/pdf' });
  mockAuth();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('document printing uploads', () => {
  it('rejects unsupported files without telling the customer to sign in', async () => {
    render(<DocumentPrintingPage />);
    chooseFile(new File(['not a document'], 'photo.png', { type: 'image/png' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Choose a PDF, DOC, DOCX, ODT, or Pages file');
    expect(alert.querySelector('a')).toBeNull();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('offers private document printing to guests without a sign-in wall', async () => {
    signedIn = false;
    render(<DocumentPrintingPage />);
    // A guest can upload and order without being sent to sign in first.
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
    // The button is waiting for a document, not for authentication.
    expect(await screen.findByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports an unreadable PDF without a sign-in prompt', async () => {
    render(<DocumentPrintingPage />);
    chooseFile(new File(['%PDF-1.4 broken'], 'broken.pdf', { type: 'application/pdf' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not read the printable PDF.');
    expect(alert.querySelector('a')).toBeNull();
  });

  it('converts a guest Word document to PDF and reads its page count', async () => {
    signedIn = false;
    render(<DocumentPrintingPage />);
    chooseFile(new File(['word data'], 'report.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    expect(await screen.findByText(/Printed sides per copy: 1/)).toBeInTheDocument();
    expect(convert).toHaveBeenCalledWith('convert-document', expect.objectContaining({ body: expect.any(FormData) }));
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });
});
