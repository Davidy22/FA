import { describe, expect, it } from 'vitest';
import {
  directionsUrl,
  filterLocations,
  hasCoordinates,
  mappableLocations,
} from '@/lib/locations';
import type { Location } from '@/lib/types';

function location(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc-1',
    name: 'Make Anyth.ing Taipei',
    address: '123 Main St, Taipei',
    phone: '+886-2-1234-5678',
    photo_url: null,
    lat: 25.033,
    lng: 121.5654,
    timezone: 'Asia/Taipei',
    hourly_machine_rate: 8,
    country: 'TW',
    tax_rate: 0.05,
    currency: 'USD',
    is_active: true,
    ...overrides,
  };
}

describe('filterLocations', () => {
  const locations = [
    location(),
    location({ id: 'loc-2', name: 'Make Anyth.ing SF', address: '456 Howard St, San Francisco', phone: '+1-415-555-0123' }),
  ];

  it('returns all locations for a blank query', () => {
    expect(filterLocations(locations, '   ')).toHaveLength(2);
  });

  it('matches name, address, and phone case-insensitively', () => {
    expect(filterLocations(locations, 'taipei').map((l) => l.id)).toEqual(['loc-1']);
    expect(filterLocations(locations, 'howard').map((l) => l.id)).toEqual(['loc-2']);
    expect(filterLocations(locations, '415-555').map((l) => l.id)).toEqual(['loc-2']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterLocations(locations, 'Berlin')).toEqual([]);
  });
});

describe('coordinates', () => {
  it('accepts finite coordinates within range', () => {
    expect(hasCoordinates(location())).toBe(true);
    expect(hasCoordinates(location({ lat: null, lng: 121 }))).toBe(false);
    expect(hasCoordinates(location({ lat: 91 }))).toBe(false);
    expect(hasCoordinates(location({ lng: -181 }))).toBe(false);
  });

  it('filters locations that can be pinned', () => {
    const result = mappableLocations([location(), location({ id: 'loc-2', lat: null })]);
    expect(result.map((l) => l.id)).toEqual(['loc-1']);
  });
});

describe('directionsUrl', () => {
  it('prefers coordinates', () => {
    expect(directionsUrl(location())).toBe('https://www.google.com/maps/dir/?api=1&destination=25.033,121.5654');
  });

  it('falls back to the address', () => {
    expect(directionsUrl(location({ lat: null, lng: null, address: 'Somewhere 1' })))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=Somewhere%201');
  });

  it('returns null without coordinates or an address', () => {
    expect(directionsUrl(location({ lat: null, lng: null, address: null }))).toBeNull();
  });
});
