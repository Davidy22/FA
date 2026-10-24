import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminNamespaceGate } from '@/components/admin/AdminNamespaceGate';
import { useLocale } from '@/store/locale';

const { addResourceBundle } = vi.hoisted(() => ({ addResourceBundle: vi.fn() }));

vi.mock('@/lib/i18n', () => ({
  default: {
    hasResourceBundle: vi.fn(() => false),
    addResourceBundle,
    changeLanguage: vi.fn(),
  },
  SUPPORTED_LOCALES: ['en', 'zh-Hant', 'zh-Hans'],
  detectLocaleFrom: () => 'en',
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <AdminNamespaceGate><div>Admin content</div></AdminNamespaceGate>
  </QueryClientProvider>);
}

beforeEach(() => { useLocale.setState({ locale: 'en' }); });
afterEach(() => { cleanup(); addResourceBundle.mockClear(); });

describe('admin translation loading', () => {
  it('loads only the active locale on demand and follows locale changes', async () => {
    mount();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('Admin content')).toBeInTheDocument();
    expect(addResourceBundle).toHaveBeenCalledTimes(1);
    expect(addResourceBundle).toHaveBeenLastCalledWith(
      'en', 'admin', expect.objectContaining({ title: expect.any(String) }), true, true,
    );

    act(() => { useLocale.setState({ locale: 'zh-Hant' }); });
    await waitFor(() => expect(addResourceBundle).toHaveBeenCalledTimes(2));
    expect(addResourceBundle).toHaveBeenLastCalledWith(
      'zh-Hant', 'admin', expect.objectContaining({ title: expect.any(String) }), true, true,
    );
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
