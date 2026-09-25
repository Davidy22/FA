// verify-model Edge Function
// Reads a model file from Supabase Storage (private models bucket), parses STL (binary/ASCII),
// OBJ, or 3MF (zip-based), computes signed volume, surface area, bounding box, triangle count,
// and sha256. Writes metrics to uploaded_models and marks verified=true.
//
// MVP parser: STL (binary fully supported; ASCII best-effort), OBJ (triangulated faces), 3MF (best-effort unzip).
// For unsupported formats, returns an error.

import { serve } from 'https://deno.land/std@0.207.0/http/server.ts';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { supabaseServiceClient } from '../_shared/supabase.ts';
import { decode as decodeZip } from 'https://deno.land/x/zipjs@v2.7.34/index.js';

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0],a[1],a[2]); }
function addTri(mesh: {verts: Vec3[]; tris: [number,number,number][]}, a: Vec3, b: Vec3, c: Vec3) {
  const base = mesh.verts.length;
  mesh.verts.push(a,b,c);
  mesh.tris.push([base,base+1,base+2]);
}

function parseBinaryStl(buf: ArrayBuffer) {
  const view = new DataView(buf);
  if (buf.byteLength < 84) throw new Error('STL too short');
  const numTri = view.getUint32(80, true);
  const expected = 84 + numTri * 50;
  if (expected !== buf.byteLength) {
    throw new Error(`Binary STL size mismatch (expected ${expected}, got ${buf.byteLength})`);
  }
  const mesh = { verts: [] as Vec3[], tris: [] as [number,number,number][] };
  for (let i=0; i<numTri; i++) {
    const off = 84 + i*50 + 12; // skip normal
    const read = (o:number): Vec3 => [
      view.getFloat32(off+o, true),
      view.getFloat32(off+o+4, true),
      view.getFloat32(off+o+8, true),
    ];
    addTri(mesh, read(0), read(12), read(24));
  }
  return mesh;
}

function parseAsciiStl(text: string) {
  const mesh = { verts: [] as Vec3[], tris: [] as [number,number,number][] };
  const re = /vertex\s+([\deE.+\-]+)\s+([\deE.+\-]+)\s+([\deE.+\-]+)/g;
  const verts: Vec3[] = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  for (let i=0; i+2<verts.length; i+=3) {
    addTri(mesh, verts[i], verts[i+1], verts[i+2]);
  }
  return mesh;
}

function parseObj(text: string) {
  const mesh = { verts: [] as Vec3[], tris: [] as [number,number,number][] };
  const V: Vec3[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      V.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s.split('/')[0],10)-1);
      // fan triangulate
      for (let i=1; i+1<p.length; i++) {
        addTri(mesh, V[p[0]], V[p[i]], V[p[i+1]]);
      }
    }
  }
  return mesh;
}

async function parse3mf(buf: ArrayBuffer) {
  // Minimal 3MF: unzip and look for a model file, parse vertices and triangles.
  const mesh = { verts: [] as Vec3[], tris: [] as [number,number,number][] };
  // @ts-ignore zipjs types
  const reader = new (decodeZip as any).BlobReader(new Blob([buf]));
  const entries = await (decodeZip as any).getEntries(reader);
  let modelXml = '';
  for (const e of entries) {
    if (e.filename.toLowerCase().endsWith('.model')) {
      const w = new (decodeZip as any).TextWriter('utf-8');
      modelXml = await e.getData(w);
      break;
    }
  }
  if (!modelXml) throw new Error('No .model file inside 3mf');
  // crude XML parsing: pull out <vertex x="" y="" z="" /> and <triangle v1="" v2="" v3="" />
  const verts: Vec3[] = [];
  const vRe = /<vertex[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"[^>]*\/>/g;
  let m;
  while ((m = vRe.exec(modelXml)) !== null) {
    verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  const tRe = /<triangle[^>]*v1="([^"]+)"[^>]*v2="([^"]+)"[^>]*v3="([^"]+)"[^>]*\/>/g;
  while ((m = tRe.exec(modelXml)) !== null) {
    const a=verts[parseInt(m[1],10)], b=verts[parseInt(m[2],10)], c=verts[parseInt(m[3],10)];
    if (a&&b&&c) addTri(mesh,a,b,c);
  }
  return mesh;
}

function computeMetrics(mesh: {verts: Vec3[]; tris: [number,number,number][]}) {
  let volSigned = 0;
  let surface = 0;
  let minV: Vec3 = [Infinity,Infinity,Infinity];
  let maxV: Vec3 = [-Infinity,-Infinity,-Infinity];
  for (const v of mesh.verts) {
    for (let i=0;i<3;i++) { if (v[i]<minV[i]) minV[i]=v[i]; if (v[i]>maxV[i]) maxV[i]=v[i]; }
  }
  for (const [ai,bi,ci] of mesh.tris) {
    const a = mesh.verts[ai], b = mesh.verts[bi], c = mesh.verts[ci];
    volSigned += dot(a, cross(b, c)) / 6.0;
    const ab = sub(b,a), ac = sub(c,a);
    surface += len(cross(ab, ac)) / 2.0;
  }
  // Raw STL units are mm. Convert to cm for cm3/cm2.
  const volume_cm3 = Math.abs(volSigned) / 1000.0;
  const surface_cm2 = surface / 100.0;
  return {
    volume_cm3,
    surface_cm2,
    triangle_count: mesh.tris.length,
    bbox: { min: minV, max: maxV },
  };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}

serve(async (req) => {
  const c = handleCors(req); if (c) return c;
  try {
    const { uploaded_model_id } = await req.json();
    const sb = supabaseServiceClient();
    const { data: model, error: mErr } = await sb
      .from('uploaded_models').select('*').eq('id', uploaded_model_id).maybeSingle();
    if (mErr || !model) throw new Error('uploaded_model not found');
    const { data: fileData, error: dErr } = await sb.storage.from('models').download(model.file_path);
    if (dErr) throw new Error(`download: ${dErr.message}`);
    const ab = await fileData.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const ext = (model.original_filename || '').split('.').pop()?.toLowerCase() || '';
    let mesh;
    // Detect binary STL: starts with solid? Some binary STLs still start with 'solid'; use size heuristic.
    if (ext === 'stl' || ext === '') {
      const looksAscii = bytes.slice(0, 256).some(b => b === 0x76 /* v */) &&
        ab.byteLength < 20_000_000 &&
        new TextDecoder('ascii').decode(bytes.slice(0,300)).trim().toLowerCase().startsWith('solid');
      if (looksAscii) mesh = parseAsciiStl(new TextDecoder().decode(bytes));
      else mesh = parseBinaryStl(ab);
    } else if (ext === 'obj') {
      mesh = parseObj(new TextDecoder().decode(bytes));
    } else if (ext === '3mf') {
      mesh = await parse3mf(ab);
    } else {
      throw new Error(`Unsupported format: ${ext}`);
    }
    const metrics = computeMetrics(mesh);
    const sha = await sha256Hex(ab);
    await sb.from('uploaded_models').update({
      model_sha256: sha,
      volume_cm3: metrics.volume_cm3,
      surface_cm2: metrics.surface_cm2,
      triangle_count: metrics.triangle_count,
      bbox: metrics.bbox,
      verified: true,
    }).eq('id', uploaded_model_id);
    return new Response(JSON.stringify({ ok: true, metrics: { ...metrics, model_sha256: sha } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
