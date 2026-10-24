'use client';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import type { Location } from '@/lib/types';
import { mappableLocations } from '@/lib/locations';

type LocationsMapProps = {
  locations: Location[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function pinIcon(selected: boolean) {
  return L.divIcon({
    className: 'ma-map-marker',
    html: `<span class="ma-map-pin${selected ? ' ma-map-pin--selected' : ''}" aria-hidden="true"></span>`,
    iconSize: [30, 38],
    iconAnchor: [15, 36],
  });
}

/**
 * Plain Leaflet map (loaded with next/dynamic + ssr:false) so the static export
 * never evaluates Leaflet during pre-rendering. Pins are CSS-only divIcons to
 * avoid bundling Leaflet's default marker image assets.
 */
export function LocationsMap({ locations, selectedId, onSelect }: LocationsMapProps) {
  const { t } = useTranslation('common');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, { marker: L.Marker; location: Location }>());
  const selectedIdRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      scrollWheelZoom: false,
      worldCopyJump: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    pinsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      pinsRef.current = null;
    };
  }, []);

  // Build pins only when the visible result set changes, so selecting a pin does
  // not close its popup.
  useEffect(() => {
    const pins = pinsRef.current;
    if (!pins) return;
    pins.clearLayers();
    markersRef.current.clear();

    for (const location of mappableLocations(locations)) {
      const selected = location.id === selectedIdRef.current;
      const marker = L.marker([Number(location.lat), Number(location.lng)], {
        icon: pinIcon(selected),
        title: location.name,
        alt: location.name,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0,
      });

      const popup = document.createElement('div');
      popup.className = 'min-w-40';
      const name = document.createElement('p');
      name.className = 'font-semibold text-slate-900';
      name.textContent = location.name;
      popup.appendChild(name);
      if (location.address) {
        const address = document.createElement('p');
        address.className = 'mt-1 text-xs text-slate-600';
        address.textContent = location.address;
        popup.appendChild(address);
      }
      marker.bindPopup(popup);
      marker.on('click', () => onSelectRef.current(location.id));
      marker.addTo(pins);
      markersRef.current.set(location.id, { marker, location });
    }
  }, [locations]);

  // Reflect card/pin selection without rebuilding the markers (and closing popups).
  useEffect(() => {
    selectedIdRef.current = selectedId;
    for (const { marker, location } of markersRef.current.values()) {
      const selected = location.id === selectedId;
      marker.setIcon(pinIcon(selected));
      marker.setZIndexOffset(selected ? 1000 : 0);
    }
  }, [selectedId]);

  // Only re-fit when the set of locations changes, not when a pin is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points = mappableLocations(locations).map((location) => (
      [Number(location.lat), Number(location.lng)] as L.LatLngTuple
    ));
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 13);
    else map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 14 });
  }, [locations]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      role="region"
      aria-label={t('location.map_label')}
      data-testid="locations-map"
    />
  );
}
