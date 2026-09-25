/// <reference lib="webworker" />
// Web Worker entry for mesh parsing + quote computation.
// Keeps the heavy mesh parsing off the main thread.
//
// Message protocol:
//   { type: 'parse', file: ArrayBuffer, filename: string } -> { type: 'parsed', metrics, sha256 }
//   { type: 'quote', metrics, material, filament, location, infill, quantity, constants } -> { type: 'quoted', quote }

import { meshMetrics, parseAsciiStl, parseBinaryStl, parseObj } from '@/lib/meshParser';
import { quoteHeuristic } from '@/lib/pricing';

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2,'0')).join('');
}

function parseBuffer(buf: ArrayBuffer, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const head = new Uint8Array(buf.slice(0, 512));
  if (ext === 'stl') {
    const looksAscii = Array.from(head).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))
      && new TextDecoder('ascii').decode(head).trim().toLowerCase().startsWith('solid');
    if (looksAscii) {
      try { return parseAsciiStl(new TextDecoder().decode(buf)); }
      catch { /* fall */ }
    }
    return parseBinaryStl(buf);
  }
  if (ext === 'obj') return parseObj(new TextDecoder().decode(buf));
  // 3MF in worker is not supported (zip decompression is large); pass to main thread for simplicity.
  throw new Error(`Unsupported in worker: ${ext}`);
}

self.onmessage = async (e: MessageEvent) => {
  try {
    const msg = e.data;
    if (msg.type === 'parse') {
      const mesh = parseBuffer(msg.file, msg.filename);
      const metrics = meshMetrics(mesh);
      const digest = await sha256(msg.file);
      self.postMessage({ type: 'parsed', metrics, sha256: digest });
    } else if (msg.type === 'quote') {
      const q = quoteHeuristic({
        volume_cm3: msg.metrics.volume_cm3,
        surface_cm2: msg.metrics.surface_cm2,
        material: msg.material,
        filament: msg.filament,
        location: msg.location,
        infill_percent: msg.infill,
        quantity: msg.quantity,
        constants: msg.constants,
      });
      self.postMessage({ type: 'quoted', quote: q });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message });
  }
};

export {};
