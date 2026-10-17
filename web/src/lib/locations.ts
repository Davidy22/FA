import type { Location } from './types';

export function hasCoordinates(location: Pick<Location, 'lat' | 'lng'>): boolean {
  if (location.lat === null || location.lng === null) return false;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Case-insensitive name/address/phone search used by the location picker. */
export function filterLocations(locations: Location[], query: string): Location[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return locations;
  return locations.filter((location) =>
    [location.name, location.address, location.phone]
      .filter((value): value is string => typeof value === 'string')
      .some((value) => value.toLowerCase().includes(needle))
  );
}

export function mappableLocations(locations: Location[]): Location[] {
  return locations.filter(hasCoordinates);
}

export function directionsUrl(location: Location): string | null {
  if (hasCoordinates(location)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${Number(location.lat)},${Number(location.lng)}`;
  }
  if (location.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.address)}`;
  }
  return null;
}
