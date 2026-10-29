'use client';
import { supabase } from '@/lib/supabase';
import type { Filament } from '@/lib/types';

/** Colour spools of a material that are in stock at a location. */
export async function fetchAvailableFilaments(locationId: string, materialId: string): Promise<Filament[]> {
  const { data, error } = await supabase().rpc('available_filaments', {
    p_location_id: locationId, p_material_id: materialId,
  });
  if (error) throw error;
  // The RPC calls the primary key filament_id, unlike the filaments table.
  return (data || []).map((row: { filament_id: string }) => ({ ...row, id: row.filament_id })) as Filament[];
}
