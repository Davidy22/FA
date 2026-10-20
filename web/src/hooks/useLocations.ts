'use client';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useLocation as useLocationStore } from '@/store/location';
import type { Location } from '@/lib/types';

export const LOCATIONS_QUERY_KEY = ['locations_active'] as const;

/** Active pickup locations, shared by the header selector, prompt, and picker page. */
export function useLocations() {
  return useQuery<Location[]>({
    queryKey: LOCATIONS_QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase()
        .from('locations')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as Location[];
    },
  });
}

/** The pickup location the customer chose: its currency prices the storefront. */
export function useSelectedLocation(): Location | undefined {
  const { data: locations } = useLocations();
  const selectedId = useLocationStore((state) => state.selectedLocationId);
  return locations?.find((location) => location.id === selectedId);
}
