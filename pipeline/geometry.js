// drawing2pendant.py'nin 4. adımı: seçilen darbeler -> spline -> köprüler + askı halkası ->
// işaretli mesafe alanı -> marching cubes -> doğrulanmış mesh + üretilebilirlik ölçümleri.
// 2B ızgara Python'daki gibi [i, j] = (x, y) düzenindedir: düz indis = i * ny + j.
import * as I from "./img.js";
import { resample, npArgsort } from "./strokes.js";
import { MC_TRI } from "./mc-table.js";

/** Baskıya uygun tek parça model çıkmadığında fırlatılır (Python'daki AssertionError karşılığı). */
export class MeshError extends Error {}

// ------------------------------------------------------------------ eğriler
/** En küçük çevreleyen çember (Welzl). pts: [a0, b0, a1, b1, ...] -> {a, b, r} */
export function minEnclosingCircle(pts) {
  const n = pts.length >> 1, idx = Array.from({ length: n }, (_, i) => i);
  let s = 0x9e3779b9;
  for (let i = n - 1; i > 0; i--) {             // tekrarlanabilir karıştırma (mulberry32)
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const j = ((t ^ (t >>> 14)) >>> 0) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const X = (i) => pts[2 * idx[i]], Y = (i) => pts[2 * idx[i] + 1];
  let c = { a: 0, b: 0, r: -1 };
  const inC = (i) => Math.hypot(X(i) - c.a, Y(i) - c.b) <= c.r * (1 + 1e-12) + 1e-12;
  const two = (i, j) => ({ a: (X(i) + X(j)) / 2, b: (Y(i) + Y(j)) / 2, r: Math.hypot(X(i) - X(j), Y(i) - Y(j)) / 2 });
  const three = (i, j, k) => {
    const ax = X(i), ay = Y(i), bx = X(j) - ax, by = Y(j) - ay, cx = X(k) - ax, cy = Y(k) - ay;
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-12) return null;
    const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
    const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
    return { a: ax + ux, b: ay + uy, r: Math.hypot(ux, uy) };
  };
  for (let i = 0; i < n; i++) {
    if (c.r >= 0 && inC(i)) continue;
    c = { a: X(i), b: Y(i), r: 0 };
    for (let j = 0; j < i; j++) {
      if (inC(j)) continue;
      c = two(i, j);
      for (let k = 0; k < j; k++) if (!inC(k)) c = three(i, j, k) || c;
    }
  }
  return c;
}

// 5 bantlı simetrik pozitif tanımlı sistem: (diag(w2) + lam * D'D) z = w2 * y  (D: ikinci fark)
function smoothSolve(w2, lam, ys, n) {
  const a = new Float64Array(n), e = new Float64Array(n), dd = new Float64Array(n);
  const l1 = new Float64Array(n), l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = w2[i] + lam * (i === 0 || i === n - 1 ? 1 : i === 1 || i === n - 2 ? 5 : 6);
    if (i < n - 1) e[i] = lam * (i === 0 || i === n - 2 ? -2 : -4);
  }
  for (let i = 0; i < n; i++) {
    l2[i] = i >= 2 ? lam / dd[i - 2] : 0;
    l1[i] = i >= 1 ? (e[i - 1] - (i >= 2 ? l2[i] * dd[i - 2] * l1[i - 1] : 0)) / dd[i - 1] : 0;
    dd[i] = a[i] - (i >= 1 ? l1[i] * l1[i] * dd[i - 1] : 0) - (i >= 2 ? l2[i] * l2[i] * dd[i - 2] : 0);
  }
  return ys.map((y) => {
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = w2[i] * y[i] - (i >= 1 ? l1[i] * z[i - 1] : 0) - (i >= 2 ? l2[i] * z[i - 2] : 0);
    for (let i = 0; i < n; i++) z[i] /= dd[i];
    for (let i = n - 1; i >= 0; i--) z[i] -= (i + 1 < n ? l1[i + 1] * z[i + 1] : 0) + (i + 2 < n ? l2[i + 2] * z[i + 2] : 0);
    return z;
  });
}

/** Noktalardan yumuşatılmış eğri (0,02 mm aralıkla örneklenmiş). scipy splprep(s=n·smooth²) ile
 *  aynı ölçüt: ağırlıklı artık kareler toplamı s'yi geçmeyen en düzgün eğri. xy: [x0, y0, ...] mm. */
export function fitSpline(xyIn, closed, P) {
  let x = [xyIn[0]], y = [xyIn[1]];
  for (let i = 2; i < xyIn.length; i += 2)
    if (Math.hypot(xyIn[i] - xyIn[i - 2], xyIn[i + 1] - xyIn[i - 1]) > 1e-9) { x.push(xyIn[i]); y.push(xyIn[i + 1]); }
  let m = x.length, length = 0;
  for (let i = 1; i < m; i++) length += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  const nOut = Math.max(Math.floor(length / 0.02), 8), out = new Float64Array(2 * nOut);
  if (m < 6) {
    for (let k = 0; k < nOut; k++) {
      const t = m > 1 ? (k / (nOut - 1)) * (m - 1) : 0, i = Math.min(Math.floor(t), Math.max(m - 2, 0)), f = t - i;
      out[2 * k] = m > 1 ? x[i] + f * (x[i + 1] - x[i]) : x[0];
      out[2 * k + 1] = m > 1 ? y[i] + f * (y[i + 1] - y[i]) : y[0];
    }
    return out;
  }
  if (closed && Math.hypot(x[0] - x[m - 1], y[0] - y[m - 1]) < 1e-6) { x.pop(); y.pop(); m--; }
  // 0,65: FITPACK düğümleri köşelere yığdığı için aynı bütçeyle köşeleri daha az yuvarlar; bu katsayıyla
  // eğriler Python'unkilere en yakın çıkıyor (ortalama sapma ~0,02 mm, ölçülerek ayarlandı)
  const s = (closed ? m + 1 : m) * (0.65 * P.smooth) ** 2;
  // kapalı eğride uçları sararak uzat; yumuşatmanın etkisi birkaç noktada söner
  const K = closed ? Math.min(m, 40) : 0, n = m + 2 * K;
  const ex = new Float64Array(n), ey = new Float64Array(n), w2 = new Float64Array(n).fill(1);
  for (let i = 0; i < n; i++) { const j = (((i - K) % m) + m) % m; ex[i] = x[j]; ey[i] = y[j]; }
  if (!closed) w2[0] = w2[n - 1] = 900;                         // uçlar yerinde kalsın (ağırlık 30)
  const resid = (zx, zy) => {
    let r = 0;
    for (let i = K; i < K + m; i++) r += w2[i] * ((zx[i] - ex[i]) ** 2 + (zy[i] - ey[i]) ** 2);
    return r;
  };
  let lo = -8, hi = 14, best = smoothSolve(w2, 10 ** hi, [ex, ey], n);
  if (resid(best[0], best[1]) > s)
    for (let it = 0; it < 44; it++) {
      const mid = (lo + hi) / 2, z = smoothSolve(w2, 10 ** mid, [ex, ey], n);
      if (resid(z[0], z[1]) > s) hi = mid; else { lo = mid; best = z; }
    }
  // parametre: özgün noktaların kiriş uzunluğu; düzgün aralıkla kübik Hermite ile örnekle
  const cnt = closed ? m + 1 : m, px = new Float64Array(cnt), py = new Float64Array(cnt), u = new Float64Array(cnt);
  for (let i = 0; i < cnt; i++) { px[i] = best[0][K + (i % m)]; py[i] = best[1][K + (i % m)]; }
  for (let i = 1; i < cnt; i++) u[i] = u[i - 1] + Math.hypot(x[i % m] - x[i - 1], y[i % m] - y[i - 1]);
  const tan = (p, i) => {
    if (closed) {
      const a = i === 0 ? cnt - 2 : i - 1, b = i === cnt - 1 ? 1 : i + 1;
      const du = (i === 0 ? u[1] + u[cnt - 1] - u[cnt - 2] : i === cnt - 1 ? u[cnt - 1] - u[cnt - 2] + u[1] : u[i + 1] - u[i - 1]);
      return (p[b] - p[a]) / du;
    }
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, cnt - 1);
    return (p[b] - p[a]) / (u[b] - u[a]);
  };
  let j = 0;
  for (let k = 0; k < nOut; k++) {
    const t = (k / (nOut - 1)) * u[cnt - 1];
    while (j < cnt - 2 && u[j + 1] <= t) j++;
    const h = u[j + 1] - u[j], q = Math.min(Math.max((t - u[j]) / h, 0), 1), q2 = q * q, q3 = q2 * q;
    const h00 = 2 * q3 - 3 * q2 + 1, h10 = q3 - 2 * q2 + q, h01 = -2 * q3 + 3 * q2, h11 = q3 - q2;
    out[2 * k] = h00 * px[j] + h10 * h * tan(px, j) + h01 * px[j + 1] + h11 * h * tan(px, j + 1);
    out[2 * k + 1] = h00 * py[j] + h10 * h * tan(py, j) + h01 * py[j + 1] + h11 * h * tan(py, j + 1);
  }
  return out;
}

function seg(ax, ay, bx, by) {
  const n = Math.max(Math.floor(Math.hypot(bx - ax, by - ay) / 0.02), 2), out = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { const t = i / (n - 1); out[2 * i] = ax + (bx - ax) * t; out[2 * i + 1] = ay + (by - ay) * t; }
  return out;
}
const smin = (a, b, k) => {
  const h = Math.min(Math.max(0.5 + 0.5 * (b - a) / k, 0), 1);
  return b + (a - b) * h - k * h * (1 - h);
};

// ---------------------------------------------------------- marching cubes
const EV = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const VX = [0, 1, 1, 0, 0, 1, 1, 0], VY = [0, 0, 1, 1, 0, 0, 1, 1], VZ = [0, 0, 0, 0, 1, 1, 1, 1];

/** f(i, j, k) alanının iso yüzeyi. Köşeler ızgara indisi biriminde, paylaşımlı (her kenarda tek köşe). */
export function marchingCubes(f, nx, ny, nz, iso) {
  let verts = new Float32Array(3 << 16), nv = 0, faces = new Uint32Array(3 << 16), nf = 0;
  const plane = ny * nz;
  const ex = new Int32Array(plane);
  let ey0 = new Int32Array(plane).fill(-1), ey1 = new Int32Array(plane).fill(-1);
  let ez0 = new Int32Array(plane).fill(-1), ez1 = new Int32Array(plane).fill(-1);
  const val = new Float64Array(8), loc = new Int32Array(12);
  for (let i = 0; i < nx - 1; i++) {
    ex.fill(-1); ey1.fill(-1); ez1.fill(-1);
    for (let j = 0; j < ny - 1; j++) {
      const o = (i * ny + j) * nz;
      for (let k = 0; k < nz - 1; k++) {
        let index = 0;
        for (let c = 0; c < 8; c++) {
          val[c] = f[o + VX[c] * plane + VY[c] * nz + VZ[c] + k] - iso;
          if (val[c] > 0) index |= 1 << c;
        }
        if (index === 0 || index === 255) continue;
        loc.fill(-2);
        for (let t = index * 16; MC_TRI[t] >= 0; t++) {
          const e = MC_TRI[t];
          if (loc[e] === -2) {
            const a = EV[e][0], b = EV[e][1];
            const bi = Math.min(VX[a], VX[b]), bj = Math.min(VY[a], VY[b]), bk = Math.min(VZ[a], VZ[b]);
            const p = (j + bj) * nz + k + bk;
            const cache = VX[a] !== VX[b] ? ex : VY[a] !== VY[b] ? (bi ? ey1 : ey0) : (bi ? ez1 : ez0);
            if (cache[p] < 0) {
              const lo = VX[a] + VY[a] + VZ[a] < VX[b] + VY[b] + VZ[b] ? a : b, hi = lo === a ? b : a;
              let t2 = val[lo] / (val[lo] - val[hi]);
              t2 = t2 < 0.02 ? 0.02 : t2 > 0.98 ? 0.98 : t2;       // köşeler ızgara noktasına yapışıp çakışmasın
              if (3 * nv + 3 > verts.length) { const g = new Float32Array(verts.length * 2); g.set(verts); verts = g; }
              verts[3 * nv] = i + bi + (VX[a] !== VX[b] ? t2 : 0);
              verts[3 * nv + 1] = j + bj + (VY[a] !== VY[b] ? t2 : 0);
              verts[3 * nv + 2] = k + bk + (VZ[a] !== VZ[b] ? t2 : 0);
              cache[p] = nv++;
            }
            loc[e] = cache[p];
          }
          if (nf === faces.length) { const g = new Uint32Array(faces.length * 2); g.set(faces); faces = g; }
          faces[nf++] = loc[e];
        }
      }
    }
    [ey0, ey1] = [ey1, ey0]; [ez0, ez1] = [ez1, ez0];
  }
  return { verts: verts.subarray(0, 3 * nv), faces: faces.subarray(0, nf) };
}

/** En büyük parçayı tut, yönü düzelt, kapalı ve tek parça olduğunu doğrula. */
export function cleanMesh(verts, faces) {
  const nv = verts.length / 3, nt = faces.length / 3;
  if (!nt) throw new MeshError("mesh boş");
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let t = 0; t < nt; t++) {
    const a = find(faces[3 * t]), b = find(faces[3 * t + 1]), c = find(faces[3 * t + 2]);
    if (b !== a) parent[b] = a;
    if (c !== a) parent[find(c)] = a;
  }
  const cnt = new Int32Array(nv);
  let best = 0;
  for (let t = 0; t < nt; t++) { const r = find(faces[3 * t]); if (++cnt[r] > cnt[best]) best = r; }
  if (nt - cnt[best] >= 200) throw new MeshError("mesh tek parça değil");
  const remap = new Int32Array(nv).fill(-1);
  const outF = new Uint32Array(3 * cnt[best]);
  let n2 = 0, o = 0;
  for (let t = 0; t < nt; t++) {
    if (find(faces[3 * t]) !== best) continue;
    for (let q = 0; q < 3; q++) { const v = faces[3 * t + q]; if (remap[v] < 0) remap[v] = n2++; outF[o++] = remap[v]; }
  }
  const outV = new Float32Array(3 * n2);
  for (let v = 0; v < nv; v++) if (remap[v] >= 0) outV.set(verts.subarray(3 * v, 3 * v + 3), 3 * remap[v]);
  let vol = 0;
  for (let t = 0; t < outF.length; t += 3) {
    const a = 3 * outF[t], b = 3 * outF[t + 1], c = 3 * outF[t + 2];
    vol += outV[a] * (outV[b + 1] * outV[c + 2] - outV[b + 2] * outV[c + 1])
         - outV[a + 1] * (outV[b] * outV[c + 2] - outV[b + 2] * outV[c])
         + outV[a + 2] * (outV[b] * outV[c + 1] - outV[b + 1] * outV[c]);
  }
  vol /= 6;
  if (vol < 0) { for (let t = 0; t < outF.length; t += 3) { const x = outF[t + 1]; outF[t + 1] = outF[t + 2]; outF[t + 2] = x; } vol = -vol; }
  if (!isWatertight(outV, outF)) throw new MeshError("mesh kapalı değil");
  return { verts: outV, faces: outF, volume: vol };
}

/** Her kenar tam iki üçgende ve zıt yönlerde mi; yozlaşmış (çakışık köşeli) üçgen var mı. */
export function isWatertight(verts, faces) {
  let cap = 1;
  while (cap < faces.length * 2) cap <<= 1;
  const ka = new Int32Array(cap).fill(-1), kb = new Int32Array(cap), num = new Int8Array(cap), sum = new Int8Array(cap);
  const same = (a, b) => verts[3 * a] === verts[3 * b] && verts[3 * a + 1] === verts[3 * b + 1] && verts[3 * a + 2] === verts[3 * b + 2];
  for (let t = 0; t < faces.length; t += 3) {
    for (let q = 0; q < 3; q++) {
      const a = faces[t + q], b = faces[t + (q + 1) % 3];
      if (a === b || same(a, b)) return false;
      const lo = a < b ? a : b, hi = a < b ? b : a;
      let h = (Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca6b)) & (cap - 1);
      while (ka[h] !== -1 && (ka[h] !== lo || kb[h] !== hi)) h = (h + 1) & (cap - 1);
      ka[h] = lo; kb[h] = hi;
      if (++num[h] > 2) return false;
      sum[h] += a < b ? 1 : -1;
    }
  }
  for (let h = 0; h < cap; h++) if (ka[h] !== -1 && (num[h] !== 2 || sum[h] !== 0)) return false;
  return true;
}

/** İkili STL (float32). */
export function toStl(verts, faces) {
  const nt = faces.length / 3, buf = new ArrayBuffer(84 + 50 * nt), dv = new DataView(buf);
  dv.setUint32(80, nt, true);
  for (let t = 0, o = 84; t < nt; t++, o += 50) {
    const a = 3 * faces[3 * t], b = 3 * faces[3 * t + 1], c = 3 * faces[3 * t + 2];
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (const [p, q] of [[a, 12], [b, 24], [c, 36]])
      for (let d = 0; d < 3; d++) dv.setFloat32(o + q + 4 * d, verts[p + d], true);
  }
  return buf;
}

// ------------------------------------------------------------------ ana adım
/** kept: seçilen darbeler (piksel, [satır, sütun]); mask: mürekkep maskesi (çemberli modda ölçek için).
 *  Döner: {verts, faces, metrics, render, splines} */
export function buildPendant(kept, P, progress = () => {}) {
  const framed = !!P.frame, W = P.line_d, Tk = framed ? P.line_d : P.thick;
  const Rc = (P.outer_d - P.ring_d) / 2, Rfit = Rc - P.ring_d / 2 + W / 2;
  let total = 0;
  for (const s of kept) total += s.rc.length;
  const allp = new Float64Array(total);
  let o = 0;
  for (const s of kept) { allp.set(s.rc, o); o += s.rc.length; }
  let cy, cx, mm;
  if (framed) {
    const c = minEnclosingCircle(allp);
    cy = c.a; cx = c.b; mm = Rfit / c.r;
  } else {
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (let i = 0; i < total; i += 2) {
      r0 = Math.min(r0, allp[i]); r1 = Math.max(r1, allp[i]); c0 = Math.min(c0, allp[i + 1]); c1 = Math.max(c1, allp[i + 1]);
    }
    cy = (r0 + r1) / 2; cx = (c0 + c1) / 2; mm = (P.size - W) / Math.max(r1 - r0, c1 - c0);
  }
  const toMm = (rc) => {
    const out = new Float64Array(rc.length);
    for (let i = 0; i < rc.length; i += 2) { out[i] = (rc[i + 1] - cx) * mm; out[i + 1] = -(rc[i] - cy) * mm; }
    return out;
  };
  const splines = [], ends = [];
  for (const s of kept) {
    const xy = fitSpline(toMm(resample(s.rc, 3)), s.closed, P);
    splines.push(xy);
    if (s.free[0]) ends.push([xy[0], xy[1]]);
    if (s.free[1]) ends.push([xy[xy.length - 2], xy[xy.length - 1]]);
  }
  const struts = [];
  if (framed)
    for (const [x, y] of ends) {
      const rho = Math.hypot(x, y);
      if (Rfit - rho < P.anchor_reach) struts.push(seg(x, y, x / rho * Rfit, y / rho * Rfit));
    }
  const anchored = struts.length;

  // --- 2B ızgara ---
  const v = P.voxel, Rb = (P.bail_hole + P.bail_d) / 2;
  let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
  for (const sp of splines) for (let i = 0; i < sp.length; i += 2) {
    sx0 = Math.min(sx0, sp[i]); sx1 = Math.max(sx1, sp[i]); sy0 = Math.min(sy0, sp[i + 1]); sy1 = Math.max(sy1, sp[i + 1]);
  }
  const lo = framed ? [-P.outer_d / 2 - 1, -P.outer_d / 2 - 1] : [sx0 - W - 1, sy0 - W - 1];
  const hi = framed ? [P.outer_d / 2 + 1, Rc + 2 * Rb + P.bail_d + 1] : [sx1 + W + 1, sy1 + 2 * Rb + P.bail_d + 1.5];
  const nx = Math.ceil((hi[0] - lo[0]) / v - 1e-9), ny = Math.ceil((hi[1] - lo[1]) / v - 1e-9), n2 = nx * ny;
  const gx = Float64Array.from({ length: nx }, (_, i) => lo[0] + i * v);
  const gy = Float64Array.from({ length: ny }, (_, j) => lo[1] + j * v);
  const ring2d = new Float32Array(n2).fill(1e3);
  if (framed) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) ring2d[i * ny + j] = Math.abs(Math.hypot(gx[i], gy[j]) - Rc);

  // en yakın eğri noktasına uzaklık; CAP'ten ötesi yüzeyi etkilemediği için CAP'te kesilir
  const CAP = Math.max(W, Tk, P.ring_d) / 2 + 1.0, capN = Math.ceil(CAP / v);
  const d2 = new Float32Array(n2).fill(CAP * CAP);
  const splat = (pts) => {
    for (let p = 0; p < pts.length; p += 2) {
      const fx = (pts[p] - lo[0]) / v, fy = (pts[p + 1] - lo[1]) / v;
      const i0 = Math.max(Math.ceil(fx - capN), 0), i1 = Math.min(Math.floor(fx + capN), nx - 1);
      const j0 = Math.max(Math.ceil(fy - capN), 0), j1 = Math.min(Math.floor(fy + capN), ny - 1);
      for (let i = i0; i <= i1; i++) {
        const dx = (i - fx) * v, dx2 = dx * dx, row = i * ny;
        for (let j = j0; j <= j1; j++) { const dy = (j - fy) * v, q = dx2 + dy * dy; if (q < d2[row + j]) d2[row + j] = q; }
      }
    }
  };
  splines.forEach(splat); struts.forEach(splat);
  progress("kopru");

  // --- havada kalan parçaları ana gövdeye köprüle ---
  let bridges = 0;
  const solid = new Uint8Array(n2), notMain = new Uint8Array(n2);
  const thr = (W / 2 - v) ** 2;
  let iTop = 0, jTop = 0;
  for (let i = 1; i < nx; i++) if (Math.abs(gx[i]) < Math.abs(gx[iTop])) iTop = i;
  for (let j = 1; j < ny; j++) if (Math.abs(gy[j] - Rc) < Math.abs(gy[jTop] - Rc)) jTop = j;
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < n2; i++) solid[i] = d2[i] < thr || ring2d[i] < P.ring_d / 2 - v ? 1 : 0;
    const { lab, n, areas } = I.label(solid, ny, nx, 8);
    if (n <= 1) break;
    let mainId = 1;
    if (framed) mainId = lab[iTop * ny + jTop];
    else for (let k = 2; k <= n; k++) if (areas[k] > areas[mainId]) mainId = k;
    const order = npArgsort(Float64Array.from({ length: n }, (_, k) => -areas[k + 1]));
    let other = -1;
    for (const k of order) if (k + 1 !== mainId) { other = k + 1; break; }           // en büyük adadan başla
    for (let i = 0; i < n2; i++) notMain[i] = lab[i] !== mainId ? 1 : 0;
    const { d2: dm, idx } = I.edtSq(notMain, ny, nx, true);
    let bi = -1, bd = Infinity;
    for (let i = 0; i < n2; i++) if (lab[i] === other && dm[i] < bd) { bd = dm[i]; bi = i; }
    const ax = gx[Math.floor(bi / ny)], ay = gy[bi % ny], bx = gx[Math.floor(idx[bi] / ny)], by = gy[idx[bi] % ny];
    const len = Math.max(Math.hypot(bx - ax, by - ay), 1e-9), ux = (bx - ax) / len, uy = (by - ay) / len;
    const st = seg(ax - ux * 0.3, ay - uy * 0.3, bx + ux * 0.3, by + uy * 0.3);
    struts.push(st); splat(st); bridges++;
  }

  // --- basılınca zaten kapanacak minik delikleri baştan dolu yap ---
  const w2 = (W / 2) ** 2;
  for (let i = 0; i < n2; i++) solid[i] = d2[i] < w2 || ring2d[i] < P.ring_d / 2 ? 1 : 0;
  let filledCount = 0;
  {
    const fh = I.fillHoles(solid, ny, nx), holes = new Uint8Array(n2);
    for (let i = 0; i < n2; i++) holes[i] = fh[i] && !solid[i] ? 1 : 0;
    const { lab, n } = I.label(holes, ny, nx, 4);
    if (n) {
      const de = I.edtSq(holes, ny, nx).d2, inr = new Float64Array(n + 1);
      for (let i = 0; i < n2; i++) if (lab[i] && de[i] > inr[lab[i]]) inr[lab[i]] = de[i];
      const tiny = new Uint8Array(n2);
      const isTiny = new Uint8Array(n + 1);
      for (let k = 1; k <= n; k++) if (Math.sqrt(inr[k]) * v < P.gap / 2) { isTiny[k] = 1; filledCount++; }
      if (filledCount) {
        for (let i = 0; i < n2; i++) tiny[i] = isTiny[lab[i]];
        const dil = I.dilate(tiny, ny, nx, 3);
        for (let i = 0; i < n2; i++) if (dil[i]) d2[i] = 0;
      }
    }
  }

  // --- askı halkası: çemberli modda tepede; çerçevesizde ağırlık merkezinin üstünde ---
  let bcx = 0, bcy = Rc + Rb, tilt = 0;
  if (!framed) {
    let mx = 0, my = 0, cnt = 0;
    const top = new Float64Array(nx).fill(-Infinity);
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) if (d2[i * ny + j] < w2) { mx += gx[i]; my += gy[j]; cnt++; top[i] = gy[j]; }
    mx /= cnt; my /= cnt;
    let k = -1;
    for (let i = 0; i < nx; i++)
      if (Math.abs(gx[i] - mx) <= 0.06 * (sx1 - sx0) && (k < 0 || top[i] > top[k])) k = i;
    bcx = gx[k]; bcy = top[k] + Rb - 0.15;
    tilt = Math.atan2(bcx - mx, bcy - my) * 180 / Math.PI;
  }
  progress("mesh");

  // --- 3B işaretli mesafe alanı -> mesh ---
  const zmax = Math.max(framed ? P.ring_d : 0, P.bail_d, Tk) / 2 + 3 * v;
  const nz = Math.ceil((2 * zmax + v / 2) / v - 1e-9);
  const gz = Float64Array.from({ length: nz }, (_, k) => -zmax + k * v);
  const f = new Float32Array(n2 * nz);
  const r = 0.45 * Math.min(W, Tk), hw = W / 2 - r, ht = Tk / 2 - r;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p = i * ny + j, d = Math.sqrt(d2[p]), qx = d - hw, rg = ring2d[p];
      const bl = Math.abs(Math.hypot(gx[i] - bcx, gy[j] - bcy) - Rb);
      for (let k = 0; k < nz; k++) {
        const z = gz[k], qz = Math.abs(z) - ht;
        let val = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;   // yuvarlatılmış dikdörtgen kesit
        if (framed) val = smin(val, Math.hypot(rg, z) - P.ring_d / 2, P.fillet);
        val = smin(val, Math.hypot(bl, z) - P.bail_d / 2, P.fillet);
        f[p * nz + k] = val;
      }
    }
  I.gaussian3d(f, nx, ny, nz, 0.6);
  const raw = marchingCubes(f, nx, ny, nz, 1e-4);
  for (let i = 0; i < raw.verts.length; i += 3) {
    raw.verts[i] = raw.verts[i] * v + gx[0]; raw.verts[i + 1] = raw.verts[i + 1] * v + gy[0]; raw.verts[i + 2] = raw.verts[i + 2] * v + gz[0];
  }
  const mesh = cleanMesh(raw.verts, raw.faces);
  progress("olcum");

  // --- üretilebilirlik ölçümleri (2B kesitte) ---
  const mid = nz >> 1, inside = new Uint8Array(n2);
  for (let p = 0; p < n2; p++) inside[p] = f[p * nz + mid] < 0 ? 1 : 0;
  const wall = I.edt(inside, ny, nx), sk = I.skeletonize(inside, ny, nx), ws = [];
  for (let p = 0; p < n2; p++) if (sk[p]) ws.push(2 * wall[p] * v);
  ws.sort((a, b) => a - b);
  const pos = 0.01 * (ws.length - 1), pl = Math.floor(pos);
  const minWall = ws.length ? ws[pl] + (pos - pl) * ((ws[Math.min(pl + 1, ws.length - 1)]) - ws[pl]) : NaN;
  let minHole = NaN;
  {
    const fh = I.fillHoles(inside, ny, nx), holes = new Uint8Array(n2);
    for (let i = 0; i < n2; i++) holes[i] = fh[i] && !inside[i] ? 1 : 0;
    const { lab, n } = I.label(holes, ny, nx, 4);
    if (n) {
      const de = I.edtSq(holes, ny, nx).d2, inr = new Float64Array(n + 1);
      for (let i = 0; i < n2; i++) if (lab[i] && de[i] > inr[lab[i]]) inr[lab[i]] = de[i];
      minHole = Infinity;
      for (let k = 1; k <= n; k++) minHole = Math.min(minHole, 2 * v * Math.sqrt(inr[k]));
    }
  }
  const ext = [0, 1, 2].map((d) => {
    let a = Infinity, b = -Infinity;
    for (let i = d; i < mesh.verts.length; i += 3) { a = Math.min(a, mesh.verts[i]); b = Math.max(b, mesh.verts[i]); }
    return b - a;
  });

  // --- önizleme görüntüsü: üstten yükseklik haritası, basit ışıklandırma ---
  const hz = new Float32Array(n2), has = new Uint8Array(n2);
  for (let p = 0; p < n2; p++) {
    let top = -1;
    for (let k = nz - 1; k >= 0; k--) if (f[p * nz + k] < 0) { top = k; break; }
    has[p] = top >= 0 ? 1 : 0; hz[p] = top >= 0 ? gz[top] : -zmax;
  }
  const hs = I.gaussianBlur(hz, ny, nx, 1.0, 9);
  const Lv = [-0.45, 0.55, 0.7], ln = Math.hypot(...Lv), L = Lv.map((q) => q / ln);
  const Hv = [L[0], L[1], L[2] + 1], hn = Math.hypot(...Hv), Hh = Hv.map((q) => q / hn);
  const render = new Uint8ClampedArray(nx * ny * 4);            // np.rot90: genişlik nx, yükseklik ny
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p = i * ny + j, q = ((ny - 1 - j) * nx + i) * 4;
      if (!has[p]) { render[q] = render[q + 1] = render[q + 2] = 255; render[q + 3] = 0; continue; }
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nx - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, ny - 1);
      const dx = (hs[i1 * ny + j] - hs[i0 * ny + j]) / ((i1 - i0) * v), dy = (hs[i * ny + j1] - hs[i * ny + j0]) / ((j1 - j0) * v);
      const nl = Math.hypot(dx, dy, 1), n0 = -dx / nl, n1 = -dy / nl, n2z = 1 / nl;
      const sh = 0.18 + 0.62 * Math.max(n0 * L[0] + n1 * L[1] + n2z * L[2], 0)
        + 0.55 * Math.max(n0 * Hh[0] + n1 * Hh[1] + n2z * Hh[2], 0) ** 40;
      render[q] = 255 * sh * 0.80; render[q + 1] = 255 * sh * 0.82; render[q + 2] = 255 * sh * 0.86; render[q + 3] = 255;
    }

  return {
    verts: mesh.verts, faces: mesh.faces, splines, struts, mm, center: [cy, cx],
    render: { width: nx, height: ny, data: render },
    metrics: {
      en: ext[0], boy: ext[1], kalinlik: ext[2], gram: mesh.volume / 1000 * P.density,
      en_ince_duvar: minWall, en_kucuk_delik: minHole, tel: `${W} × ${Tk} mm`,
      kopru: bridges, uzatilan_uc: anchored, doldurulan_delik: filledCount, aski_egimi: tilt, ucgen: mesh.faces.length / 3,
    },
  };
}
