// drawing2pendant.py'nin 0. ve 1. adımları: kağıt bölgesi ve mürekkep maskesi.
import * as I from "./img.js";

const roundHalfEven = (v) => {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};
function median(vals) {
  const a = Float64Array.from(vals).sort(), n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Kağıt koyu bir zeminin üstündeyse kağıdın (kenar payı düşülmüş) maskesi; değilse null. */
export function paperRegion(rgba, w, h, P) {
  const sc = 400 / Math.max(h, w);
  const sw = roundHalfEven(w * sc), sh = roundHalfEven(h * sc);
  const mx = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) mx[i] = Math.max(rgba[j], rgba[j + 1], rgba[j + 2]);
  const v = I.medianBlur5(I.resizeArea(mx, w, h, sw, sh), sw, sh);
  const hist = new Int32Array(256);
  for (let i = 0; i < v.length; i++) hist[v[i]]++;
  const t = I.otsu(hist, v.length);
  const bw = new Uint8Array(sw * sh);
  for (let i = 0; i < v.length; i++) bw[i] = v[i] > t ? 1 : 0;
  const { lab, n, areas } = I.label(bw, sw, sh, 4);
  if (!n) return null;
  let best = 1;
  for (let k = 2; k <= n; k++) if (areas[k] > areas[best]) best = k;
  const PAD = 12, pw = sw + 2 * PAD, ph = sh + 2 * PAD;
  let big = new Uint8Array(pw * ph);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) big[(y + PAD) * pw + x + PAD] = lab[y * sw + x] === best ? 1 : 0;
  big = I.fillHoles(I.binaryClosing(big, pw, ph, 6), pw, ph);     // çizgiler kağıdın parçası
  big = I.binaryOpening(big, pw, ph, 3);
  const b = new Uint8Array(sw * sh), nb = new Uint8Array(sw * sh);
  let cnt = 0;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const val = big[(y + PAD) * pw + x + PAD];
      b[y * sw + x] = val; nb[y * sw + x] = 1 - val; cnt += val;
    }
  const dIn = I.edt(b, sw, sh), dOut = I.edt(nb, sw, sh);
  const rin = [], rout = [];
  for (let i = 0; i < b.length; i++) {
    if (dIn[i] > 4 && dIn[i] <= 10) rin.push(v[i]);
    if (dOut[i] > 4 && dOut[i] <= 10) rout.push(v[i]);
  }
  if (1 - cnt / b.length < P.paper_min || rout.length < 50 || rin.length < 50) return null;
  // gerçek kağıt kenarı keskindir; yumuşak gölge geçişi (oran ~1) kağıt kenarı sayılmaz
  if (median(rout) / Math.max(median(rin), 1) > P.paper_edge) return null;
  const inner = new Uint8Array(sw * sh);
  for (let i = 0; i < inner.length; i++) inner[i] = dIn[i] > P.paper_margin * 400 ? 1 : 0;
  return I.resizeMaskLinear(inner, sw, sh, w, h);
}

/** Kağıt zeminini tahmin edip mürekkebi ayır. {mask, dark, cropped} döner. */
export function inkMask(rgba, w, h, P) {
  const n = w * h, g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = Math.min(rgba[j], rgba[j + 1], rgba[j + 2]);
  const k = Math.max(Math.floor(w / 40), 31) | 1;
  const closed = I.closeRect(I.medianBlur5(g, w, h), w, h, k);
  const bg = I.gaussianBlurCoarse(closed, w, h, k / 2, I.gaussKsize(k / 2, true));
  let dark = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = 1 - g[i] / Math.max(Math.round(bg[i]), 1);
    dark[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  dark = I.gaussianBlur(dark, w, h, w / 900, I.gaussKsize(w / 900, false));   // kalem grenini erit
  const paper = paperRegion(rgba, w, h, P);
  // eşik yalnızca kağıdın içinden hesaplanır; zeminin dokusu eşiği kaydırmasın
  const hist = new Int32Array(256);
  let total = 0;
  for (let i = 0; i < n; i++) if (!paper || paper[i]) { hist[Math.floor(dark[i] * 255)]++; total++; }
  const t = I.otsu(hist, total);
  let m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = dark[i] * 255 > 0.6 * t && (!paper || paper[i]) ? 1 : 0;
  m = I.binaryClosing(m, w, h, Math.max(Math.floor(w / 800), 1));
  const maxSize = Math.floor((w / 250) ** 2);
  const { lab, areas } = I.label(m, w, h, 4);
  for (let i = 0; i < n; i++) if (m[i] && areas[lab[i]] <= maxSize) m[i] = 0;
  const filled = I.fillHoles(m, w, h), holes = new Uint8Array(n);                // gren delikleri
  for (let i = 0; i < n; i++) holes[i] = filled[i] && !m[i] ? 1 : 0;
  const hl = I.label(holes, w, h, 4), lim = (w / 300) ** 2;
  for (let i = 0; i < n; i++) if (holes[i] && hl.areas[hl.lab[i]] < lim) m[i] = 1;
  return { mask: m, dark, cropped: paper !== null };
}
