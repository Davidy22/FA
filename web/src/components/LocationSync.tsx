'use client';
import { useEffect } from 'react';
import { useLocations } from '@/hooks/useLocations';
import { useLocation } from '@/store/location';

/**
 * Keeps the persisted location choice in sync with the data:
 * - exactly one location: select it automatically and hide all pickers
 * - none: clear a stale selection
 * - several: clear the selection if the saved location was deactivated
 */
export function LocationSync() {
  const { data: locations } = useLocations();
  const selectedLocationId = useLocation((s) => s.selectedLocationId);
  const setLocation = useLocation((s) => s.setLocation);

  useEffect(() => {
    if (!locations) return;
    if (locations.length === 1) {
      if (selectedLocationId !== locations[0].id) setLocation(locations[0].id);
      return;
    }
    if (locations.length === 0) {
      if (selectedLocationId !== null) setLocation(null);
      return;
    }
    if (selectedLocationId && !locations.some((location) => location.id === selectedLocationId)) {
      setLocation(null);
    }
  }, [locations, selectedLocationId, setLocation]);

  return null;
}
