// Client-side mesh parser for STL (binary/ASCII), OBJ, and 3MF (unzip via jszip).
// Uses the same signed volume approach as the server-side verify-model Edge Function.

import JSZip from 'jszip';

export type Vec3 = [number, number, number];
export interface Mesh {
  verts: Vec3[];
  tris: [number, number, number][];
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0],a[1],a[2]); }

function pushTri(mesh: Mesh, a: Vec3, b: Vec3, c: Vec3) {
  const i = mesh.verts.length;
  mesh.verts.push(a, b, c);
  mesh.tris.push([i, i+1, i+2]);
}

export function parseBinaryStl(buf: ArrayBuffer): Mesh {
  const view = new DataView(buf);
  if (buf.byteLength < 84) throw new Error('STL too short');
  const n = view.getUint32(80, true);
  if (84 + n*50 !== buf.byteLength) {
    throw new Error(`Binary STL size mismatch (triangles=${n}, bytes=${buf.byteLength})`);
  }
  const mesh: Mesh = { verts: [], tris: [] };
  for (let i=0; i<n; i++) {
    const o = 84 + i*50 + 12;
    const v = (off: number): Vec3 => [
      view.getFloat32(o+off, true),
      view.getFloat32(o+off+4, true),
      view.getFloat32(o+off+8, true),
    ];
    pushTri(mesh, v(0), v(12), v(24));
  }
  return mesh;
}

export function parseAsciiStl(text: string): Mesh {
  const mesh: Mesh = { verts: [], tris: [] };
  const re = /vertex\s+([\deE.+\-]+)\s+([\deE.+\-]+)\s+([\deE.+\-]+)/g;
  const vs: Vec3[] = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    vs.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }
  for (let i=0; i+2<vs.length; i+=3) pushTri(mesh, vs[i], vs[i+1], vs[i+2]);
  if (mesh.tris.length === 0) throw new Error('ASCII STL: no triangles found');
  return mesh;
}

export function parseObj(text: string): Mesh {
  const mesh: Mesh = { verts: [], tris: [] };
  const V: Vec3[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      V.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    } else if (line.startsWith('f ')) {
      const idx = line.trim().split(/\s+/).slice(1).map((s) => parseInt(s.split('/')[0],10)-1);
      for (let i=1; i+1<idx.length; i++) {
        const a=V[idx[0]], b=V[idx[i]], c=V[idx[i+1]];
        if (a&&b&&c) pushTri(mesh,a,b,c);
      }
    }
  }
  return mesh;
}

export async function parse3mf(buf: ArrayBuffer): Promise<Mesh> {
  const zip = await JSZip.loadAsync(buf);
  let modelFile: JSZip.JSZipObject | undefined;
  zip.forEach((_, f) => { if (!modelFile && f.name.toLowerCase().endsWith('.model')) modelFile = f; });
  if (!modelFile) throw new Error('No .model inside 3mf');
  const xml = await (modelFile as JSZip.JSZipObject).async('string');
  const mesh: Mesh = { verts: [], tris: [] };
  const vs: Vec3[] = [];
  const vRe = /<vertex[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"[^>]*\/>/g;
  let m;
  while ((m = vRe.exec(xml)) !== null) vs.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  const tRe = /<triangle[^>]*v1="([^"]+)"[^>]*v2="([^"]+)"[^>]*v3="([^"]+)"[^>]*\/>/g;
  while ((m = tRe.exec(xml)) !== null) {
    const a=vs[parseInt(m[1],10)], b=vs[parseInt(m[2],10)], c=vs[parseInt(m[3],10)];
    if (a&&b&&c) pushTri(mesh,a,b,c);
  }
  if (mesh.tris.length === 0) throw new Error('3MF: no triangles parsed');
  return mesh;
}

export async function parseFile(file: File): Promise<Mesh> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const ab = await file.arrayBuffer();
  const head = new Uint8Array(ab.slice(0, 512));
  if (ext === 'stl' || ext === '') {
    const looksAscii = Array.from(head).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))
      && new TextDecoder('ascii').decode(head).trim().toLowerCase().startsWith('solid');
    if (looksAscii) {
      try { return parseAsciiStl(new TextDecoder().decode(ab)); }
      catch { /* fall through */ }
    }
    return parseBinaryStl(ab);
  }
  if (ext === 'obj') return parseObj(new TextDecoder().decode(ab));
  if (ext === '3mf') return parse3mf(ab);
  throw new Error(`Unsupported format: ${ext}`);
}

export interface MeshMetrics {
  volume_cm3: number;
  surface_cm2: number;
  triangle_count: number;
  bbox: { min: Vec3; max: Vec3 };
}

export function meshMetrics(mesh: Mesh): MeshMetrics {
  let vol = 0;
  let surface = 0;
  const minV: Vec3 = [Infinity,Infinity,Infinity];
  const maxV: Vec3 = [-Infinity,-Infinity,-Infinity];
  for (const v of mesh.verts) {
    for (let i=0;i<3;i++) { if (v[i]<minV[i]) minV[i]=v[i]; if (v[i]>maxV[i]) maxV[i]=v[i]; }
  }
  for (const [ai,bi,ci] of mesh.tris) {
    const a = mesh.verts[ai], b = mesh.verts[bi], c = mesh.verts[ci];
    vol += dot(a, cross(b,c)) / 6;
    surface += len(cross(sub(b,a), sub(c,a))) / 2;
  }
  return {
    volume_cm3: Math.abs(vol) / 1000,   // mm3 -> cm3
    surface_cm2: surface / 100,         // mm2 -> cm2
    triangle_count: mesh.tris.length,
    bbox: { min: minV, max: maxV },
  };
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
}
