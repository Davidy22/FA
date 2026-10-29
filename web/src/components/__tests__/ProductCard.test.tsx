import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProductCard } from '@/components/ProductCard';
import type { ProductWithMaterials } from '@/lib/types';
import '@/lib/i18n';

vi.mock('@/hooks/useLocations', () => ({ useSelectedLocation: () => undefined }));

const product: ProductWithMaterials = {
  id: 'product-1',
  slug: 'desk-tool',
  name: { en: 'Desk tool' },
  description: null,
  base_price: 12,
  default_material_id: 'pla',
  category: 'tool',
  tags: [],
  image_urls: [],
  submitted_by: null,
  is_featured: false,
  status: 'published',
  sale_price: null,
  sale_starts_at: null,
  sale_ends_at: null,
  product_materials: [{
    product_id: 'product-1',
    material_id: 'pla',
    price_modifier: 0,
    material: {
      id: 'pla', slug: 'pla', name: { en: 'PLA' }, adjective: null,
      cost_per_gram: 0.2, notes: null, density_g_cm3: 1.24,
      default_flow_mm3_s: 7.5, is_active: true,
    },
  }],
};

afterEach(cleanup);

describe('ProductCard', () => {
  it('shows only the product name and price without a per-card query provider', () => {
    render(<ProductCard product={product} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/product?slug=desk-tool');
    expect(screen.getByText('Desk tool')).toBeInTheDocument();
    expect(screen.queryByText('PLA')).not.toBeInTheDocument();
    expect(screen.getByText('HK$12.00')).toBeInTheDocument();
  });
});
