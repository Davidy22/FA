'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export const DEFAULT_DOCUMENT_PRICES = { grayscale: 0.5, color: 1 } as const;

function validRate(value: unknown, fallback: number): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

/** Display estimate only: price_cart in Postgres remains authoritative. */
export function useDocumentPrices() {
  return useQuery({
    queryKey: ['document_prices'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [grayscale, color] = await Promise.all([
        supabase().rpc('get_setting', { p_key: 'document.grayscale_per_side' }),
        supabase().rpc('get_setting', { p_key: 'document.color_per_side' }),
      ]);
      if (grayscale.error) throw grayscale.error;
      if (color.error) throw color.error;
      return {
        grayscale: validRate(grayscale.data, DEFAULT_DOCUMENT_PRICES.grayscale),
        color: validRate(color.data, DEFAULT_DOCUMENT_PRICES.color),
      };
    },
  });
}
