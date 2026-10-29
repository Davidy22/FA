import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminLocations } from '@/components/admin/Locations';
import { AdminMaterials } from '@/components/admin/Materials';
import { AdminOffers } from '@/components/admin/Offers';
import { supabase } from '@/lib/supabase';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: vi.fn() }));

/** Chainable PostgREST stub: every filter returns itself, awaiting yields rows. */
function query(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'order', 'eq', 'range', 'in', 'ilike', 'or', 'limit']) {
    builder[method] = () => builder;
  }
  builder.single = async () => ({ data: rows[0] ?? null, error: null });
  builder.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return builder;
}

const materials = [{
  id: 'material-1', slug: 'pla', name: { en: 'PLA' }, adjective: { en: 'Standard' },
  cost_per_gram: 0.2, notes: null, density_g_cm3: 1.24, default_flow_mm3_s: 7.5, is_active: true,
}];
const products = [{
  id: 'product-1', slug: 'keychain', name: { en: 'Keychain' }, description: null, base_price: 20,
  default_material_id: 'material-1', category: 'other', tags: [], image_urls: [], submitted_by: null, is_featured: false, status: 'published',
}];
const offerTables = {
  offer_codes: [], coupons: [], premade_products: products,
  platform_settings: [{
    key: 'rewards.redeem_options',
    value: [{ points: 100, discount_type: 'fixed', discount_value: 5 }],
  }],
};

function mount(node: React.ReactNode, tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rpcMock = vi.fn(async (name: string) => ({ data: rpc[name] ?? [], error: null }));
  vi.mocked(supabase).mockReturnValue({
    from: (table: string) => query(tables[table] ?? []),
    rpc: rpcMock,
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  } as unknown as ReturnType<typeof supabase>);
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ...view, rpcMock };
}

function mountMaterials() {
  return mount(<AdminMaterials />, { materials, filaments: [], locations: [], location_filaments: [] });
}
function mountOffers(rpc: Record<string, unknown> = {}) {
  return mount(<AdminOffers />, offerTables, rpc);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('admin add panels', () => {
  it('opens the material form above the existing materials', async () => {
    const { container } = mountMaterials();
    const card = await screen.findByText('PLA (pla)');
    fireEvent.click(screen.getByRole('button', { name: 'admin:add_material' }));
    const heading = await screen.findByRole('heading', { name: 'add_material' });
    const form = heading.closest('form')!;
    expect(container.contains(form)).toBe(true);
    // The panel precedes the list in document order instead of trailing it.
    expect(form.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('edits every localized field of a material through one language picker', async () => {
    mountMaterials();
    await screen.findByText('PLA (pla)');
    fireEvent.click(screen.getByRole('button', { name: 'admin:add_material' }));
    const form = (await screen.findByRole('heading', { name: 'add_material' })).closest('form')!;
    const pickers = within(form).getAllByRole('combobox', { name: 'language_picker' });
    expect(pickers).toHaveLength(1);

    const picker = pickers[0];
    fireEvent.change(picker, { target: { value: 'zh-Hant' } });
    // slug, localized name, localized adjective, notes (cost is a spinbutton)
    const boxes = within(form).getAllByRole('textbox');
    fireEvent.change(boxes[1], { target: { value: 'PLA 繁' } });
    fireEvent.change(boxes[2], { target: { value: '標準' } });
    fireEvent.change(picker, { target: { value: 'en' } });
    await waitFor(() => expect((within(form).getAllByRole('textbox')[1] as HTMLInputElement).value).toBe(''));
    fireEvent.change(picker, { target: { value: 'zh-Hant' } });
    await waitFor(() => expect((within(form).getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('PLA 繁'));
    await waitFor(() => expect((within(form).getAllByRole('textbox')[2] as HTMLInputElement).value).toBe('標準'));
  });
});

describe('admin locations', () => {
  const locationRows = [
    { id: 'loc-hk', name: 'HK Shop', address: '1 Causeway Bay', phone: null, photo_url: null,
      lat: null, lng: null, timezone: 'Asia/Hong_Kong', hourly_machine_rate: 10,
      country: 'HK', tax_rate: 0, currency: 'HKD', is_active: true },
    { id: 'loc-tw', name: 'Taipei Shop', address: '123 Main St', phone: null, photo_url: null,
      lat: null, lng: null, timezone: 'Asia/Taipei', hourly_machine_rate: 8,
      country: 'TW', tax_rate: 0.05, currency: 'USD', is_active: true },
  ];

  it('charges tax only where the location country has one', async () => {
    const { container } = mount(<AdminLocations />, { locations: locationRows });
    const hkCard = (await screen.findByText('HK Shop')).closest('article')!;
    const twCard = screen.getByText('Taipei Shop').closest('article')!;
    // A zero rate gets no line at all - not even a "no sales tax" note.
    expect(within(hkCard).queryByText(/fields\.tax_percent/)).not.toBeInTheDocument();
    expect(within(hkCard).queryByText(/no_sales_tax/)).not.toBeInTheDocument();
    expect(within(hkCard).queryByText(/0\.00%/)).not.toBeInTheDocument();
    expect(within(hkCard).getByText(/HKD/)).toBeInTheDocument();
    expect(within(twCard).getByText(/5\.00%/)).toBeInTheDocument();
    expect(within(twCard).getByText(/USD/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'admin:add_location' }));
    const form = (await screen.findByRole('heading', { name: 'admin:add_location' })).closest('form')!;
    // The panel opens above the location cards, not below them.
    expect(form.compareDocumentPosition(hkCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.contains(form)).toBe(true);

    // A new location starts in Hong Kong: HKD, Hong Kong time, and no sales tax,
    // so the rate is locked to 0.
    expect((within(form).getByLabelText(/fields\.country/) as HTMLSelectElement).value).toBe('HK');
    expect((within(form).getByLabelText(/fields\.currency/) as HTMLInputElement).value).toBe('HKD');
    expect((within(form).getByLabelText(/fields\.timezone/) as HTMLInputElement).value).toBe('Asia/Hong_Kong');
    const tax = within(form).getByLabelText(/fields\.tax_percent/) as HTMLInputElement;
    expect(tax.disabled).toBe(true);
    expect(tax.value).toBe('0');
    expect(within(form).getByText(/no_sales_tax_hint/)).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText(/fields\.country/), { target: { value: 'TW' } });
    await waitFor(() => {
      const editable = within(form).getByLabelText(/fields\.tax_percent/) as HTMLInputElement;
      expect(editable.disabled).toBe(false);
    });
    expect(within(form).getByText(/admin:tax_hint/)).toBeInTheDocument();
  });
});

describe('admin offers and coupons', () => {
  it('generates a batch of single-use codes without typing each one', async () => {
    const { rpcMock } = mountOffers({
      admin_generate_coupons: [{ coupon_code: 'SUMMERAB2345', coupon_id: 'coupon-1' }],
      search_product_choices: products,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'admin:bulk_coupons' }));
    const form = (await screen.findByRole('heading', { name: 'bulk_coupons' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText(/fields\.code_count/), { target: { value: '25' } });
    fireEvent.change(within(form).getByLabelText(/fields\.code_prefix/), { target: { value: 'summer' } });
    fireEvent.change(within(form).getByLabelText(/fields\.discount_value/), { target: { value: '15' } });
    const productPicker = within(form).getByLabelText(/fields\.applies_to_product/);
    fireEvent.focus(productPicker);
    fireEvent.change(productPicker, { target: { value: 'key' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Keychain' }));
    fireEvent.submit(form);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_generate_coupons', expect.objectContaining({
      p_count: 25, p_prefix: 'SUMMER', p_discount_type: 'fixed', p_discount_value: 15,
      p_product_id: 'product-1', p_min_subtotal: null, p_expires_at: null, p_user_id: null, p_grant_points: null,
    })));
    const issued = await screen.findByLabelText(/fields\.generated_codes/);
    expect((issued as HTMLTextAreaElement).value).toBe('SUMMERAB2345');
    expect(screen.getByRole('button', { name: 'copy_codes' })).toBeInTheDocument();
  });

  it('creates a points-only coupon without discount conditions', async () => {
    const { rpcMock } = mountOffers({
      admin_generate_coupons: [{ coupon_code: 'POINTS123456', coupon_id: 'coupon-points' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'admin:issue_coupon' }));
    const form = (await screen.findByRole('heading', { name: 'issue_coupon' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText(/fields\.discount_type/), { target: { value: 'points' } });
    expect(within(form).queryByLabelText(/fields\.discount_value/)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/fields\.min_subtotal/)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/fields\.applies_to_product/)).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/fields\.grant_points/), { target: { value: '500' } });
    fireEvent.submit(form);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_generate_coupons', expect.objectContaining({
      p_discount_type: 'fixed', p_discount_value: 0, p_grant_points: 500,
      p_min_subtotal: null, p_product_id: null,
    })));
  });

  it('mints a code when a single coupon is issued without one', async () => {
    const { rpcMock } = mountOffers({
      admin_generate_coupons: [{ coupon_code: 'MAAB2345CDEF', coupon_id: 'coupon-2' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'admin:issue_coupon' }));
    const form = (await screen.findByRole('heading', { name: 'issue_coupon' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText(/fields\.min_subtotal/), { target: { value: '50' } });
    fireEvent.submit(form);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('admin_generate_coupons', expect.objectContaining({
      p_count: 1, p_min_subtotal: 50, p_product_id: null, p_user_id: null,
    })));
    expect(await screen.findByText('coupon_issued')).toBeInTheDocument();
  });

  it('lists coupon conditions in the coupon list', async () => {
    mount(<AdminOffers />, {
      ...offerTables,
      coupons: [{
        id: 'coupon-3', code: 'MAKEYCHAIN', user_id: null, source: 'admin', discount_type: 'percent',
        discount_value: 50, min_subtotal: 30, product_id: 'product-1', status: 'active',
        expires_at: null, used_order_id: null, used_at: null, created_at: '2026-01-01T00:00:00Z',
      }],
    });
    const row = (await screen.findByText('MAKEYCHAIN')).closest('div')!;
    expect(within(row).getByText(/coupon_min_subtotal/)).toBeInTheDocument();
    expect(within(row).getByText(/coupon_product_scope/)).toBeInTheDocument();
  });

  it('keeps the points redemption options next to the coupon tools', async () => {
    mountOffers({ search_product_choices: products });
    const heading = await screen.findByRole('heading', { name: 'admin:redeem_options' });
    const section = heading.closest('section')!;
    expect(within(section).getByText('admin:redeem_section_help')).toBeInTheDocument();
    const productSearch = await within(section).findByLabelText(/fields\.redeem_product/);
    fireEvent.focus(productSearch);
    fireEvent.change(productSearch, { target: { value: 'key' } });
    expect(await screen.findByRole('option', { name: 'Keychain' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'admin:add_redeem_option' })).toBeInTheDocument();
  });
});
