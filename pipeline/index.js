// Çizim fotoğrafı (RGBA pikseller) -> kolye ucu. drawing2pendant.py'nin main() işlevinin karşılığı.
// Tarayıcıda Web Worker içinde, testlerde Node'da çalışır; DOM kullanmaz.
import { inkMask } from "./ink.js";
import { traceStrokes, selectStrokes } from "./strokes.js";
import { buildPendant, minEnclosingCircle, toStl, MeshError } from "./geometry.js";

export { MeshError, toStl };

/** Varsayılan parametreler: drawing2pendant.py'deki P sözlüğüyle aynı tutulmalı. */
export const DEFAULTS = {
  frame: 0, size: 45.0, thick: 1.2, outer_d: 36.0, ring_d: 1.6, line_d: 0.7, gap: 0.35,
  bail_hole: 2.2, bail_d: 1.1, min_feature: 0.8, min_spur: 1.5, diverge: 1.0, snap: 1, hole: 0.4,
  detail_len: 6.0, min_piece: 2.0, conflict_max: 0.9, faint: 0.1, anchor_reach: 2.5, smooth: 0.05,
  fillet: 0.15, voxel: 0.08, density: 4.43, paper_min: 0.02, paper_edge: 0.7, paper_margin: 0.02,
};

/** Fotoğrafta çizim bulunamadığında fırlatılır. */
export class NoInkError extends Error {}

/**
 * @param {Uint8ClampedArray} rgba  canvas ImageData.data
 * @param {object} params           DEFAULTS üzerine yazılacak değerler
 * @param {(stage: string) => void} progress
 */
export function run(rgba, w, h, params = {}, progress = () => {}) {
  const P = { ...DEFAULTS, ...params };
  progress("murekkep");
  const { mask, dark, cropped } = inkMask(rgba, w, h, P);
  const framed = !!P.frame, W = P.line_d;
  const Rfit = (P.outer_d - P.ring_d) / 2 - P.ring_d / 2 + W / 2;

  // ilk ölçek: mürekkebin kapladığı alan
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const rim = [];
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (a < 0) a = x; b = x; }
    if (a < 0) continue;
    x0 = Math.min(x0, a); x1 = Math.max(x1, b); y0 = Math.min(y0, y); y1 = y;
    rim.push(a, y, b, y);
  }
  if (!rim.length || Math.max(x1 - x0, y1 - y0) < 1) throw new NoInkError("çizgi bulunamadı");
  const mm0 = framed ? Rfit / minEnclosingCircle(Float64Array.from(rim)).r : P.size / Math.max(x1 - x0, y1 - y0);

  progress("darbe");
  const { strokes, nodePos } = traceStrokes(mask, dark, w, h);
  if (!strokes.length) throw new NoInkError("çizgi bulunamadı");
  progress("secim");
  const { kept, why } = selectStrokes(strokes, nodePos, W / mm0, P.gap / mm0, mm0, P);
  if (!kept.length) throw new NoInkError("çizgi bulunamadı");

  progress("geometri");
  const g = buildPendant(kept, P, progress);
  return {
    verts: g.verts, faces: g.faces, render: g.render,
    strokes: strokes.map((s) => ({ rc: s.rc, why: s.why || null })),
    kept: kept.map((s) => ({ rc: s.rc, closed: s.closed })),
    metrics: { ...g.metrics, darbe_toplam: strokes.length, darbe_secilen: kept.length, elenen: why, kagit_kirpma: cropped },
  };
}
