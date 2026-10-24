// Feature switches stored in platform_settings as `features.<key>`.
//
// Both switches are off by default, including when the row is missing, so a
// fresh deployment never exposes a feature that still needs staffing. The UI
// hides the relevant entry points; the database enforces the same switch in
// RLS (see migration 20250101002800).

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

const FEATURES = ['model_submissions', 'careers_page'] as const;
export type Feature = (typeof FEATURES)[number];

/** Interpret a platform_settings jsonb value the way public.feature_enabled does. */
export function parseFeature(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', 'on', '1', 'yes'].includes(value.toLowerCase());
  return false;
}

/**
 * Reads a feature switch through the public `feature_enabled` RPC.
 * `isPending` is true until the answer arrives; callers that must not flash a
 * hidden page should render the "off" state while pending.
 */
export function useFeature(feature: Feature) {
  const query = useQuery<boolean>({
    queryKey: ['feature', feature],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase().rpc('feature_enabled', { p_key: feature });
      if (error) return false;
      return parseFeature(data);
    },
  });
  return { enabled: query.data === true, isPending: query.isPending, error: query.error };
}
