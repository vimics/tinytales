// Görüntü temel işlemleri: drawing2pendant.py'nin kullandığı cv2 / scipy.ndimage / skimage
// çağrılarının tarayıcıda çalışan karşılıkları. Görüntüler satır-öncelikli düz dizilerdir
// (indis = y * w + x); maskeler Uint8Array (0/1).

// ---------------------------------------------------------------- eşik
/** cv2.threshold(..., THRESH_OTSU) ile aynı eşik değeri. hist: 256'lık sayım dizisi. */
export function otsu(hist, total) {
  const scale = 1 / total;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * hist[i];
  mu *= scale;
  let mu1 = 0, q1 = 0, maxSigma = 0, maxVal = 0;
  const EPS = 1.1920929e-7;
  for (let i = 0; i < 256; i++) {
    const p = hist[i] * scale;
    mu1 *= q1;
    q1 += p;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < EPS || Math.max(q1, q2) > 1 - EPS) continue;
    mu1 = (mu1 + i * p) / q1;
    const mu2 = (mu - q1 * mu1) / q2;
    const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
    if (sigma > maxSigma) { maxSigma = sigma; maxVal = i; }
  }
  return maxVal;
}

// ------------------------------------------------------------- süzgeçler
/** cv2.medianBlur(src, 5): 5×5 ortanca, kenarlar tekrarlanır. */
export function medianBlur5(src, w, h) {
  const dst = new Uint8Array(w * h);
  const hist = new Int32Array(256);
  const rows = new Int32Array(5);
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < 5; k++) rows[k] = Math.min(Math.max(y + k - 2, 0), h - 1) * w;
    hist.fill(0);
    for (let k = 0; k < 5; k++)
      for (let dx = -2; dx <= 2; dx++) hist[src[rows[k] + Math.min(Math.max(dx, 0), w - 1)]]++;
    let med = 0, lt = 0;                       // lt: med'den küçüklerin sayısı
    while (lt + hist[med] <= 12) { lt += hist[med]; med++; }
    dst[y * w] = med;
    for (let x = 1; x < w; x++) {
      const xo = Math.max(x - 3, 0), xi = Math.min(x + 2, w - 1);
      for (let k = 0; k < 5; k++) {
        const a = src[rows[k] + xo], b = src[rows[k] + xi];
        hist[a]--; if (a < med) lt--;
        hist[b]++; if (b < med) lt++;
      }
      while (lt > 12) { med--; lt -= hist[med]; }
      while (lt + hist[med] <= 12) { lt += hist[med]; med++; }
      dst[y * w + x] = med;
    }
  }
  return dst;
}

// [i-r, i+r] penceresinde kayan en büyük/en küçük (pencere görüntü dışına taşmaz)
function slideExt(a, out, n, r, isMax, dq) {
  let head = 0, tail = 0;
  for (let j = 0; j < n + r; j++) {
    if (j < n) {
      const v = a[j];
      if (isMax) while (tail > head && a[dq[tail - 1]] <= v) tail--;
      else while (tail > head && a[dq[tail - 1]] >= v) tail--;
      dq[tail++] = j;
    }
    const i = j - r;
    if (i >= 0) {
      while (dq[head] < i - r) head++;
      out[i] = a[dq[head]];
    }
  }
}

function morphRect(src, w, h, k, isMax) {
  const r = k >> 1, n = Math.max(w, h);
  const dq = new Int32Array(n), buf = new Uint8Array(n), res = new Uint8Array(n);
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    slideExt(src.subarray(y * w, y * w + w), res, w, r, isMax, dq);
    tmp.set(res.subarray(0, w), y * w);
  }
  const dst = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) buf[y] = tmp[y * w + x];
    slideExt(buf, res, h, r, isMax, dq);
    for (let y = 0; y < h; y++) dst[y * w + x] = res[y];
  }
  return dst;
}

/** cv2.morphologyEx(src, MORPH_CLOSE, ones(k, k)) */
export function closeRect(src, w, h, k) {
  return morphRect(morphRect(src, w, h, k, true), w, h, k, false);
}

function gaussKernel(sigma, ksize) {
  const k = new Float64Array(ksize), c = (ksize - 1) / 2;
  let s = 0;
  for (let i = 0; i < ksize; i++) { k[i] = Math.exp(-((i - c) * (i - c)) / (2 * sigma * sigma)); s += k[i]; }
  for (let i = 0; i < ksize; i++) k[i] /= s;
  return k;
}
const reflect101 = (i, n) => {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i;
  return i;
};

/** Ayrılabilir Gauss süzgeci (kenar: BORDER_REFLECT_101). src herhangi bir sayısal dizi olabilir. */
export function gaussianBlur(src, w, h, sigma, ksize) {
  const k = gaussKernel(sigma, ksize), r = ksize >> 1;
  const tmp = new Float64Array(w * h), out = new Float64Array(w * h);
  const buf = new Float64Array(w + 2 * r);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let i = -r; i < w + r; i++) buf[i + r] = src[o + reflect101(i, w)];
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < ksize; j++) s += k[j] * buf[x + j];
      tmp[o + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let j = 0; j < ksize; j++) {
      const so = reflect101(y + j - r, h) * w, kj = k[j];
      for (let x = 0; x < w; x++) out[o + x] += kj * tmp[so + x];
    }
  }
  return out;
}
/** Büyük sigma için hızlı Gauss: f kat küçült, sigma/f ile süz, çift doğrusal büyüt. Sonuç tam
 *  süzgeçle gri düzeyin küçük bir kesri kadar ayrışır; kağıt zemini gibi yumuşak alanlar içindir. */
export function gaussianBlurCoarse(src, w, h, sigma, ksize) {
  const f = Math.floor(sigma / 6);
  if (f < 2) return gaussianBlur(src, w, h, sigma, ksize);
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f), small = new Float64Array(sw * sh), cnt = new Float64Array(sw * sh);
  for (let y = 0; y < h; y++) {
    const o = y * w, so = Math.floor(y / f) * sw;
    for (let x = 0; x < w; x++) { const q = so + Math.floor(x / f); small[q] += src[o + x]; cnt[q]++; }
  }
  for (let i = 0; i < small.length; i++) small[i] /= cnt[i];
  const b = gaussianBlur(small, sw, sh, sigma / f, (Math.round((ksize - 1) / (2 * f)) * 2 + 1) | 1);
  const out = new Float64Array(w * h), x0 = new Int32Array(w), fx = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let t = (x + 0.5) / f - 0.5, i = Math.floor(t);
    if (i < 0) { i = 0; t = 0; } else if (i >= sw - 1) { i = Math.max(sw - 2, 0); t = sw > 1 ? 1 : 0; } else t -= i;
    x0[x] = i; fx[x] = t;
  }
  for (let y = 0; y < h; y++) {
    let t = (y + 0.5) / f - 0.5, i = Math.floor(t);
    if (i < 0) { i = 0; t = 0; } else if (i >= sh - 1) { i = Math.max(sh - 2, 0); t = sh > 1 ? 1 : 0; } else t -= i;
    const r0 = i * sw, r1 = Math.min(i + 1, sh - 1) * sw, o = y * w;
    for (let x = 0; x < w; x++) {
      const a = x0[x], c = Math.min(a + 1, sw - 1), g = fx[x];
      out[o + x] = (1 - t) * ((1 - g) * b[r0 + a] + g * b[r0 + c]) + t * ((1 - g) * b[r1 + a] + g * b[r1 + c]);
    }
  }
  return out;
}
/** cv2.GaussianBlur'un sigma'dan çekirdek boyutu seçimi (8 bit: 6σ+1, diğerleri: 8σ+1; tek sayı). */
export const gaussKsize = (sigma, is8bit) => Math.round(sigma * (is8bit ? 3 : 4) * 2 + 1) | 1;

/** scipy.ndimage.gaussian_filter (mode='reflect', truncate=4) — 3B dizide eksen eksen. */
export function gaussian3d(f, nx, ny, nz, sigma) {
  const r = Math.floor(4 * sigma + 0.5), ks = 2 * r + 1, k = gaussKernel(sigma, ks);
  const refl = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - 1 - i; return i; };
  const sy = nz, sx = ny * nz;
  // z ekseni (en içteki, bitişik)
  let buf = new Float32Array(nz + 2 * r);
  for (let o = 0; o < nx * ny * nz; o += nz) {
    for (let i = -r; i < nz + r; i++) buf[i + r] = f[o + refl(i, nz)];
    for (let z = 0; z < nz; z++) { let s = 0; for (let j = 0; j < ks; j++) s += k[j] * buf[z + j]; f[o + z] = s; }
  }
  // y ve x eksenleri: satır satır biriktir
  for (const [n, stride, outer] of [[ny, sy, nx], [nx, sx, 1]]) {
    const slab = stride, block = n * stride;
    const tmp = new Float32Array(block);
    for (let b = 0; b < outer; b++) {
      const base = b * block;
      tmp.fill(0);
      for (let i = 0; i < n; i++) {
        const to = i * slab;
        for (let j = 0; j < ks; j++) {
          const so = base + refl(i + j - r, n) * slab, kj = k[j];
          for (let t = 0; t < slab; t++) tmp[to + t] += kj * f[so + t];
        }
      }
      f.set(tmp, base);
    }
  }
  return f;
}

// --------------------------------------------------------- yeniden boyutlama
function areaTab(ssize, dsize) {
  const scale = ssize / dsize, tab = [];
  for (let d = 0; d < dsize; d++) {
    const f1 = d * scale, f2 = f1 + scale, cell = Math.min(scale, ssize - f1);
    let s1 = Math.ceil(f1), s2 = Math.floor(f2);
    s2 = Math.min(s2, ssize - 1); s1 = Math.min(s1, s2);
    const e = [];
    if (s1 - f1 > 1e-3) e.push([s1 - 1, (s1 - f1) / cell]);
    for (let s = s1; s < s2; s++) e.push([s, 1 / cell]);
    if (f2 - s2 > 1e-3) e.push([s2, Math.min(Math.min(f2 - s2, 1), cell) / cell]);
    tab.push(e);
  }
  return tab;
}
/** cv2.resize(src, INTER_AREA) — küçültme; alan ağırlıklı ortalama. */
export function resizeArea(src, w, h, dw, dh) {
  const tx = areaTab(w, dw), ty = areaTab(h, dh);
  const tmp = new Float64Array(dw * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (const [sx, a] of tx[x]) s += a * src[y * w + sx];
      tmp[y * dw + x] = s;
    }
  const dst = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (const [sy, a] of ty[y]) s += a * tmp[sy * dw + x];
      dst[y * dw + x] = Math.min(255, Math.max(0, Math.round(s)));
    }
  return dst;
}
/** cv2.resize(0/1 maske, INTER_LINEAR) > 0: çift doğrusal değer 0,5'i geçen pikseller. */
export function resizeMaskLinear(src, w, h, dw, dh) {
  const dst = new Uint8Array(dw * dh), sx = w / dw, sy = h / dh;
  const x0 = new Int32Array(dw), fx = new Float64Array(dw);
  for (let x = 0; x < dw; x++) {
    let f = (x + 0.5) * sx - 0.5, i = Math.floor(f); f -= i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= w - 1) { i = w - 1; f = 0; }
    x0[x] = i; fx[x] = f;
  }
  for (let y = 0; y < dh; y++) {
    let f = (y + 0.5) * sy - 0.5, i = Math.floor(f); f -= i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= h - 1) { i = h - 1; f = 0; }
    const r0 = i * w, r1 = Math.min(i + 1, h - 1) * w;
    for (let x = 0; x < dw; x++) {
      const a = x0[x], b = Math.min(a + 1, w - 1), g = fx[x];
      const v = (1 - f) * ((1 - g) * src[r0 + a] + g * src[r0 + b]) + f * ((1 - g) * src[r1 + a] + g * src[r1 + b]);
      dst[y * dw + x] = v >= 0.5 ? 1 : 0;
    }
  }
  return dst;
}

// ------------------------------------------------------- ikili morfoloji
// scipy.ndimage'in varsayılan yapı elemanı (artı şekli) ile n yineleme = L1 uzaklığı n'ye kadar.
function l1Dist(mask, w, h, target, outsideIsTarget) {
  const INF = 1 << 29, d = new Int32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === target) { d[i] = 0; continue; }
      let v = INF;
      const l = x > 0 ? d[i - 1] + 1 : outsideIsTarget ? 1 : INF;
      const u = y > 0 ? d[i - w] + 1 : outsideIsTarget ? 1 : INF;
      if (l < v) v = l; if (u < v) v = u;
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      const r = x < w - 1 ? d[i + 1] + 1 : outsideIsTarget ? 1 : INF;
      const b = y < h - 1 ? d[i + w] + 1 : outsideIsTarget ? 1 : INF;
      if (r < v) v = r; if (b < v) v = b;
      d[i] = v;
    }
  return d;
}
/** ndi.binary_dilation(mask, iterations=n) */
export function dilate(mask, w, h, n) {
  const d = l1Dist(mask, w, h, 1, false), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= n ? 1 : 0;
  return out;
}
/** ndi.binary_erosion(mask, iterations=n) — görüntü dışı 0 sayılır (border_value=0). */
export function erode(mask, w, h, n) {
  const d = l1Dist(mask, w, h, 0, true), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] > n ? 1 : 0;
  return out;
}
export const binaryClosing = (m, w, h, n) => erode(dilate(m, w, h, n), w, h, n);
export const binaryOpening = (m, w, h, n) => dilate(erode(m, w, h, n), w, h, n);

/** Bağlı bileşen etiketleme; etiketler satır taramasında ilk görülme sırasıyla 1..n.
 *  conn: 4 (ndi.label varsayılanı) ya da 8. */
export function label(mask, w, h, conn = 4) {
  const lab = new Int32Array(w * h), areas = [0];
  let stack = new Int32Array(1024), n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s]) continue;
    n++;
    let sp = 0, area = 0;
    stack[sp++] = s; lab[s] = n;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i - x) / w;
      area++;
      if (sp + 8 > stack.length) { const t = new Int32Array(stack.length * 2); t.set(stack); stack = t; }
      if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = n; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = n; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !lab[i - w]) { lab[i - w] = n; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !lab[i + w]) { lab[i + w] = n; stack[sp++] = i + w; }
      if (conn === 8) {
        if (x > 0 && y > 0 && mask[i - w - 1] && !lab[i - w - 1]) { lab[i - w - 1] = n; stack[sp++] = i - w - 1; }
        if (x < w - 1 && y > 0 && mask[i - w + 1] && !lab[i - w + 1]) { lab[i - w + 1] = n; stack[sp++] = i - w + 1; }
        if (x > 0 && y < h - 1 && mask[i + w - 1] && !lab[i + w - 1]) { lab[i + w - 1] = n; stack[sp++] = i + w - 1; }
        if (x < w - 1 && y < h - 1 && mask[i + w + 1] && !lab[i + w + 1]) { lab[i + w + 1] = n; stack[sp++] = i + w + 1; }
      }
    }
    areas.push(area);
  }
  return { lab, n, areas };            // areas[etiket] = piksel sayısı
}

/** ndi.binary_fill_holes(mask): kenardan ulaşılamayan arka plan da 1 olur. */
export function fillHoles(mask, w, h) {
  const out = new Uint8Array(w * h).fill(1);
  let stack = new Int32Array(1024), sp = 0;
  const push = (i) => {
    if (mask[i] || !out[i]) return;
    out[i] = 0;
    if (sp === stack.length) { const t = new Int32Array(sp * 2); t.set(stack); stack = t; }
    stack[sp++] = i;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return out;
}

// ------------------------------------------------------------ mesafe dönüşümü
/** Tam Öklid mesafe dönüşümü (Meijster). mask=1 pikseller için en yakın mask=0 piksele
 *  mesafenin karesi; hiç 0 yoksa Infinity. wantIdx ise en yakın 0 pikselin indisi de döner. */
export function edtSq(mask, w, h, wantIdx = false) {
  const INF = 1e8, n = w * h;
  const g = new Int32Array(n), ny = wantIdx ? new Int32Array(n) : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) { g[i] = 0; if (ny) ny[i] = y; }
      else if (y > 0 && g[i - w] < INF) { g[i] = g[i - w] + 1; if (ny) ny[i] = ny[i - w]; }
      else g[i] = INF;
    }
  for (let y = h - 2; y >= 0; y--)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (g[i + w] + 1 < g[i]) { g[i] = g[i + w] + 1; if (ny) ny[i] = ny[i + w]; }
    }
  const d2 = new Float64Array(n), idx = wantIdx ? new Int32Array(n) : null;
  const s = new Int32Array(w), t = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let q = 0; s[0] = 0; t[0] = 0;
    for (let u = 1; u < w; u++) {
      const gu = g[o + u], gu2 = gu * gu;
      while (q >= 0) {
        const sq = s[q], gs = g[o + sq], dx1 = t[q] - sq, dx2 = t[q] - u;
        if (dx1 * dx1 + gs * gs > dx2 * dx2 + gu2) q--; else break;
      }
      if (q < 0) { q = 0; s[0] = u; }
      else {
        const sq = s[q], gs = g[o + sq];
        const wv = 1 + Math.floor((u * u - sq * sq + gu2 - gs * gs) / (2 * (u - sq)));
        if (wv < w) { q++; s[q] = u; t[q] = wv; }
      }
    }
    for (let u = w - 1; u >= 0; u--) {
      const sq = s[q], gs = g[o + sq], dx = u - sq;
      d2[o + u] = gs >= INF ? Infinity : dx * dx + gs * gs;
      if (idx) idx[o + u] = gs >= INF ? -1 : ny[o + sq] * w + sq;
      if (u === t[q]) q--;
    }
  }
  return { d2, idx };
}
/** ndi.distance_transform_edt(mask) */
export function edt(mask, w, h) {
  const { d2 } = edtSq(mask, w, h);
  for (let i = 0; i < d2.length; i++) d2[i] = Math.sqrt(d2[i]);
  return d2;
}

// ------------------------------------------------------------------ iskelet
// skimage.morphology.skeletonize (Zhang 1984) arama tablosu: 1 -> ilk geçişte, 2 -> ikinci
// geçişte, 3 -> her iki geçişte silinir. Kaynak: scikit-image (BSD-3), _skeletonize_various_cy.pyx
const SKEL_LUT = new Uint8Array([
  0, 0, 0, 1, 0, 0, 1, 3, 0, 0, 3, 1, 1, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 3, 0, 3, 3,
  0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 2,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0, 2, 0,
  0, 0, 3, 1, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 3, 1, 3, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  2, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 1, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0, 0, 0,
]);

/** skimage.morphology.skeletonize(mask) — 2B Zhang inceltmesi. */
export function skeletonize(mask, w, h) {
  const W = w + 2, H = h + 2;
  const sk = new Uint8Array(W * H), cl = new Uint8Array(W * H);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) sk[(y + 1) * W + x + 1] = mask[y * w + x] ? 1 : 0;
  cl.set(sk);
  let removed = true;
  while (removed) {
    removed = false;
    for (let pass = 1; pass <= 2; pass++) {
      for (let y = 1; y < H - 1; y++) {
        const o = y * W;
        for (let x = 1; x < W - 1; x++) {
          const i = o + x;
          if (!sk[i]) continue;
          const nb = SKEL_LUT[sk[i - W - 1] + 2 * sk[i - W] + 4 * sk[i - W + 1] + 8 * sk[i + 1]
            + 16 * sk[i + W + 1] + 32 * sk[i + W] + 64 * sk[i + W - 1] + 128 * sk[i - 1]];
          if (nb & pass) { cl[i] = 0; removed = true; }
        }
      }
      sk.set(cl);
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = sk[(y + 1) * W + x + 1];
  return out;
}
