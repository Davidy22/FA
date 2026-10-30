// Convert Word, OpenDocument, and Apple Pages uploads to a printable PDF via
// a private Gotenberg/LibreOffice service. PDFs never need to use this function.
import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient } from '../_shared/supabase.ts';

const MAX_BYTES = 20 * 1024 * 1024;
// Anonymous visitors may convert guest order documents, so the endpoint needs a
// ceiling: each call runs LibreOffice over a file of up to 20 MB.
const CONVERT_LIMIT = 20;
const CONVERT_WINDOW_SECONDS = 3600;
const ALLOWED_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'pages']);
const respond = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/** Hash the caller's address so the throttle table never stores raw IPs. */
async function throttleKey(req: Request): Promise<string | null> {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || req.headers.get('cf-connecting-ip') || '';
  if (!ip) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function withinRateLimit(req: Request): Promise<boolean> {
  const key = await throttleKey(req);
  if (!key) return true; // no client address: never block the whole site
  const { data, error } = await supabaseServiceClient().rpc('consume_throttle', {
    p_bucket: 'document-convert',
    p_key: key,
    p_limit: CONVERT_LIMIT,
    p_window_seconds: CONVERT_WINDOW_SECONDS,
  });
  if (error) {
    // A throttling outage must not take document printing down with it.
    console.warn('Throttle check failed', error.message);
    return true;
  }
  return data !== false;
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  if (!(await withinRateLimit(req))) {
    return respond({ error: 'Too many conversions from this connection. Try again later.' }, 429);
  }

  try {
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return respond({ error: 'Choose a document to convert.' }, 400);
    const extension = upload.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(extension) || upload.size === 0 || upload.size > MAX_BYTES) {
      return respond({ error: 'Choose a DOC, DOCX, ODT, or Pages file no larger than 20 MB.' }, 400);
    }

    const baseUrl = Deno.env.get('GOTENBERG_URL')?.replace(/\/+$/, '');
    if (!baseUrl) {
      return respond({ error: 'Document conversion is not configured on this deployment.' }, 503);
    }

    const outgoing = new FormData();
    outgoing.append('files', upload, upload.name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let converted: Response;
    try {
      converted = await fetch(`${baseUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        body: outgoing,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!converted.ok) {
      console.error('Gotenberg conversion failed', converted.status, await converted.text());
      return respond({ error: 'The document could not be converted. Try exporting it as a PDF.' }, 422);
    }
    const bytes = await converted.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return respond({ error: 'The converted PDF is empty or larger than 20 MB.' }, 422);
    }

    // functions-js returns this response as a Blob in the browser.
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Document conversion error', error);
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Document conversion timed out. Try a smaller file.'
      : 'The document could not be converted.';
    return respond({ error: message }, 500);
  }
});
