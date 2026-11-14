// drawing2pendant.py'nin 2. ve 3. adımları: iskelet -> kalem darbeleri -> önem sırasıyla seçim.
// Noktalar Python'daki gibi (satır, sütun) sırasıyla düz Float64Array'de tutulur: [r0, c0, r1, c1, ...].
import * as I from "./img.js";

// ------------------------------------------------------------------ yardımcılar
/** numpy.argsort (varsayılan 'quicksort' = introsort) ile aynı sıra; eşit değerlerde de. */
export function npArgsort(v) {
  const n = v.length, t = new Int32Array(n);
  for (let i = 0; i < n; i++) t[i] = i;
  if (n < 2) return t;
  const swap = (a, b) => { const x = t[a]; t[a] = t[b]; t[b] = x; };
  const heapsort = (lo, m) => {                 // t[lo .. lo+m-1], 1 tabanlı yığın
    const a = (i) => t[lo + i - 1], set = (i, x) => { t[lo + i - 1] = x; };
    const sift = (tmp, i, m2) => {
      for (let j = i << 1; j <= m2;) {
        if (j < m2 && v[a(j)] < v[a(j + 1)]) j++;
        if (v[tmp] < v[a(j)]) { set(i, a(j)); i = j; j += j; } else break;
      }
      set(i, tmp);
    };
    for (let l = m >> 1; l > 0; l--) sift(a(l), l, m);
    for (; m > 1;) { const tmp = a(m); set(m, a(1)); m--; sift(tmp, 1, m); }
  };
  let msb = 0;
  for (let k = n; k >>= 1;) msb++;
  let pl = 0, pr = n - 1, cdepth = msb * 2;
  const stack = [], dstack = [];
  for (;;) {
    if (cdepth < 0) heapsort(pl, pr - pl + 1);
    else {
      while (pr - pl > 16) {
        const pm = pl + ((pr - pl) >> 1);
        if (v[t[pm]] < v[t[pl]]) swap(pm, pl);
        if (v[t[pr]] < v[t[pm]]) swap(pr, pm);
        if (v[t[pm]] < v[t[pl]]) swap(pm, pl);
        const vp = v[t[pm]];
        let pi = pl, pj = pr - 1;
        swap(pm, pj);
        for (;;) {
          do pi++; while (v[t[pi]] < vp);
          do pj--; while (vp < v[t[pj]]);
          if (pi >= pj) break;
          swap(pi, pj);
        }
        swap(pi, pr - 1);
        if (pi - pl < pr - pi) { stack.push(pi + 1, pr); pr = pi - 1; }
        else { stack.push(pl, pi - 1); pl = pi + 1; }
        dstack.push(--cdepth);
      }
      for (let pi = pl + 1; pi <= pr; pi++) {
        const vi = t[pi], vp = v[vi];
        let pj = pi;
        while (pj > pl && vp < v[t[pj - 1]]) { t[pj] = t[pj - 1]; pj--; }
        t[pj] = vi;
      }
    }
    if (!stack.length) break;
    pr = stack.pop(); pl = stack.pop(); cdepth = dstack.pop();
  }
  return t;
}

const roundHalfEven = (v) => {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** Çizgiyi eşit aralıklı (yaklaşık step) noktalarla yeniden örnekle. */
export function resample(rc, step) {
  const m = rc.length >> 1, t = new Float64Array(m);
  for (let i = 1; i < m; i++)
    t[i] = t[i - 1] + Math.hypot(rc[2 * i] - rc[2 * i - 2], rc[2 * i + 1] - rc[2 * i - 1]);
  const total = t[m - 1], n = Math.max(Math.floor(total / step), 2);
  const out = new Float64Array(2 * n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ts = i === n - 1 ? total : (i * total) / (n - 1);
    while (j < m - 2 && t[j + 1] <= ts) j++;
    const d = t[j + 1] - t[j], f = d > 0 ? Math.min(Math.max((ts - t[j]) / d, 0), 1) : 0;
    out[2 * i] = rc[2 * j] + f * (rc[2 * j + 2] - rc[2 * j]);
    out[2 * i + 1] = rc[2 * j + 1] + f * (rc[2 * j + 3] - rc[2 * j + 1]);
  }
  if (m === 1) { out[0] = out[2] = rc[0]; out[1] = out[3] = rc[1]; }
  return out;
}

/** Nokta kümesi için düzgün ızgara: yarıçap içi ve en yakın komşu sorguları (cKDTree yerine). */
export class PointGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.r = []; this.c = []; }
  get size() { return this.r.length; }
  key(gr, gc) { return (gr + 4096) * 65536 + gc + 4096; }
  add(r, c) {
    const k = this.key(Math.floor(r / this.cell), Math.floor(c / this.cell));
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = []));
    b.push(this.r.length); this.r.push(r); this.c.push(c);
  }
  addAll(rc) { for (let i = 0; i < rc.length; i += 2) this.add(rc[i], rc[i + 1]); }
  /** (r, c)'ye uzaklığı <= R olan noktaların indisleri (indis < limit). */
  ball(r, c, R, limit = Infinity, out = []) {
    out.length = 0;
    const g0 = Math.floor((r - R) / this.cell), g1 = Math.floor((r + R) / this.cell);
    const h0 = Math.floor((c - R) / this.cell), h1 = Math.floor((c + R) / this.cell), R2 = R * R;
    for (let gr = g0; gr <= g1; gr++)
      for (let gc = h0; gc <= h1; gc++) {
        const b = this.map.get(this.key(gr, gc));
        if (!b) continue;
        for (const i of b) {
          if (i >= limit) break;
          const dr = this.r[i] - r, dc = this.c[i] - c;
          if (dr * dr + dc * dc <= R2) out.push(i);
        }
      }
    return out;
  }
  /** En yakın noktanın indisi (indis < limit); yoksa -1. */
  nearest(r, c, limit = Infinity) {
    const gr0 = Math.floor(r / this.cell), gc0 = Math.floor(c / this.cell);
    let best = -1, bd = Infinity;
    for (let k = 0; k < 4096; k++) {
      for (let gr = gr0 - k; gr <= gr0 + k; gr++) {
        const edge = gr === gr0 - k || gr === gr0 + k;
        for (let gc = gc0 - k; gc <= gc0 + k; gc += edge ? 1 : Math.max(2 * k, 1)) {
          const b = this.map.get(this.key(gr, gc));
          if (!b) continue;
          for (const i of b) {
            if (i >= limit) break;
            const dr = this.r[i] - r, dc = this.c[i] - c, d = dr * dr + dc * dc;
            if (d < bd || (d === bd && i < best)) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0 && bd <= (k * this.cell) ** 2) break;
    }
    return best;
  }
}

// ------------------------------------------------- 2. iskelet -> kalem darbeleri
/** skan.Skeleton karşılığı: iskelet piksel çizgesi (kavşak kümeleri en küçük kapsayan ağaca
 *  indirgenmiş), dereceler ve derecesi 2 olmayan düğümler arasındaki yollar. */
export function skeletonPaths(skel, w, h) {
  const id = new Int32Array(w * h).fill(-1);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (skel[i]) id[i] = n++;
  const pix = new Int32Array(n);
  for (let i = 0; i < w * h; i++) if (id[i] >= 0) pix[id[i]] = i;
  // 8 komşu, düğüm numarasına göre artan sırada; k'nin tersi 7-k
  const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  const nb = new Int32Array(n * 8).fill(-1), deg0 = new Int32Array(n);
  for (let a = 0; a < n; a++) {
    const p = pix[a], x = p % w, y = (p - x) / w;
    for (let k = 0; k < 8; k++) {
      const xx = x + DX[k], yy = y + DY[k];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const b = id[yy * w + xx];
      if (b >= 0) { nb[a * 8 + k] = b; deg0[a]++; }
    }
  }
  // kavşak pikselleri (derece > 2) arasındaki kenarlar: Kruskal, önce dik (1), sonra çapraz (√2)
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const tree = new Uint8Array(n * 8);
  for (const slots of [[1, 3, 4, 6], [0, 2, 5, 7]])
    for (let a = 0; a < n; a++) {
      if (deg0[a] < 3) continue;
      for (const k of slots) {
        const b = nb[a * 8 + k];
        if (b < 0 || deg0[b] < 3) continue;
        const ra = find(a), rb = find(b);
        if (ra !== rb) { parent[rb] = ra; tree[a * 8 + k] = 1; tree[b * 8 + 7 - k] = 1; }
      }
    }
  const deg = new Int32Array(n);
  for (let a = 0; a < n; a++)
    for (let k = 0; k < 8; k++) {
      const b = nb[a * 8 + k];
      if (b < 0) continue;
      if (deg0[a] >= 3 && deg0[b] >= 3 && !tree[a * 8 + k]) nb[a * 8 + k] = -1;
      else deg[a]++;
    }
  // yollar
  const vis = new Uint8Array(n * 8), paths = [];
  const walk = (node, slot) => {
    const path = [node], start = node;
    let nbr = nb[node * 8 + slot];
    while (!vis[node * 8 + slot]) {
      vis[node * 8 + slot] = 1; vis[nbr * 8 + 7 - slot] = 1;
      path.push(nbr);
      if (deg[nbr] !== 2 || nbr === start) break;
      let s1 = -1, s2 = -1;
      for (let k = 0; k < 8; k++) if (nb[nbr * 8 + k] >= 0) { if (s1 < 0) s1 = k; else s2 = k; }
      const next = nb[nbr * 8 + s1] !== node ? s1 : s2;
      node = nbr; slot = next; nbr = nb[node * 8 + slot];
    }
    return path;
  };
  for (let a = 0; a < n; a++)
    if (deg[a] > 2 || deg[a] === 1)
      for (let k = 0; k < 8; k++) if (nb[a * 8 + k] >= 0 && !vis[a * 8 + k]) paths.push(walk(a, k));
  for (let a = 0; a < n; a++)                       // geri kalanlar yalıtılmış halkalar
    if (deg[a] > 0)
      for (let k = 0; k < 8; k++) if (nb[a * 8 + k] >= 0) { if (!vis[a * 8 + k]) paths.push(walk(a, k)); break; }
  return { n, pix, deg, paths };
}

/** İskelet dallarını kavşaklarda 'düz devam' kuralıyla birleştirip darbelere çevir. */
export function traceStrokes(mask, dark, w, h) {
  const skel = I.skeletonize(mask, w, h);
  const edt = I.edt(mask, w, h);
  const { n, pix, deg, paths } = skeletonPaths(skel, w, h);
  const jimg = new Uint8Array(w * h);
  for (let a = 0; a < n; a++) if (deg[a] > 2) jimg[pix[a]] = 1;
  const jl = I.label(jimg, w, h, 8).lab;
  const node = (p) => (deg[p] > 2 ? "J" + jl[pix[p]] : "E" + p);

  let br = [];
  for (const idx of paths) {
    const m = idx.length, rc = new Float64Array(2 * m), wd = new Float64Array(m);
    let L = 0, ink = 0;
    for (let i = 0; i < m; i++) {
      const p = pix[idx[i]], x = p % w, y = (p - x) / w;
      rc[2 * i] = y; rc[2 * i + 1] = x;
      if (i) L += Math.hypot(y - rc[2 * i - 2], x - rc[2 * i - 1]);
      wd[i] = 2 * edt[p];
      ink += dark[p] * wd[i];
    }
    const a = node(idx[0]), b = node(idx[m - 1]);
    if (a === b && a[0] === "J" && L < 6) continue;
    wd.sort();
    const wm = m % 2 ? wd[(m - 1) / 2] : (wd[m / 2 - 1] + wd[m / 2]) / 2;
    br.push({ rc, a, b, L, w: wm, ink });
  }
  // iskelet kılçıklarını buda
  const isFree = (nd, o) => nd[0] === "E" && nd !== o;
  br = br.filter((x) => !((isFree(x.a, x.b) || isFree(x.b, x.a)) && x.L < 1.5 * x.w
    && (x.a[0] === "J" || x.b[0] === "J")));

  // kavşaklarda eşleştir
  const ends = new Map();
  br.forEach((x, bi) => {
    for (const [e, nd] of [[0, x.a], [1, x.b]]) {
      const m = x.rc.length >> 1, k = Math.min(m - 1, Math.floor(1.5 * x.w) + 2);
      const i0 = e === 0 ? 0 : m - 1, ik = e === 0 ? k : m - 1 - k;
      const dr = x.rc[2 * ik] - x.rc[2 * i0], dc = x.rc[2 * ik + 1] - x.rc[2 * i0 + 1];
      const nrm = Math.hypot(dr, dc) + 1e-9;
      if (!ends.has(nd)) ends.set(nd, []);
      ends.get(nd).push([bi, e, dr / nrm, dc / nrm]);
    }
  });
  const link = new Int32Array(br.length * 2).fill(-1);       // (dal, uç) -> (dal, uç); anahtar dal*2+uç
  for (const lst of ends.values()) {
    if (lst.length === 2) {
      const k0 = lst[0][0] * 2 + lst[0][1], k1 = lst[1][0] * 2 + lst[1][1];
      link[k0] = k1; link[k1] = k0;
    } else if (lst.length > 2) {
      const pairs = [];
      for (let i = 0; i < lst.length; i++)
        for (let j = i + 1; j < lst.length; j++)
          pairs.push([lst[i][2] * lst[j][2] + lst[i][3] * lst[j][3], i, j]);
      pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
      const used = new Set();
      for (const [c, i, j] of pairs)
        if (c < -0.64 && !used.has(i) && !used.has(j)) {
          used.add(i); used.add(j);
          const ki = lst[i][0] * 2 + lst[i][1], kj = lst[j][0] * 2 + lst[j][1];
          link[ki] = kj; link[kj] = ki;
        }
    }
  }

  const strokes = [], seen = new Uint8Array(br.length);
  const walk = (b, eOut, start) => {            // b dalının eOut ucundan çıkıp zinciri izle
    const out = [];
    for (;;) {
      const nxt = link[b * 2 + eOut];
      if (nxt < 0) return [out, false];
      const b2 = nxt >> 1, e2 = nxt & 1;
      if (seen[b2]) return [out, b2 === start];
      seen[b2] = 1; out.push([b2, e2]); b = b2; eOut = 1 - e2;
    }
  };
  const negL = Float64Array.from(br, (x) => -x.L);
  for (const bi of npArgsort(negL)) {
    if (seen[bi]) continue;
    seen[bi] = 1;
    let [fwd, closed] = walk(bi, 1, bi);
    const back = closed ? [] : walk(bi, 0, bi)[0];
    const chain = [...back.reverse().map(([b, e]) => [b, 1 - e]), [bi, 0], ...fwd];   // (dal, başlangıç ucu)
    let total = 0;
    for (const [b] of chain) total += br[b].rc.length;
    const rc = new Float64Array(total);
    let o = 0, L = 0, ink = 0;
    const nodes = new Set();
    for (const [b, e] of chain) {
      const src = br[b].rc;
      if (e === 0) rc.set(src, o);
      else for (let i = 0, m = src.length >> 1; i < m; i++) {
        rc[o + 2 * i] = src[2 * (m - 1 - i)]; rc[o + 2 * i + 1] = src[2 * (m - 1 - i) + 1];
      }
      o += src.length; L += br[b].L; ink += br[b].ink;
      nodes.add(br[b].a); nodes.add(br[b].b);
    }
    const c0 = chain[0], c1 = chain[chain.length - 1];
    const first = c0[1] === 0 ? br[c0[0]].a : br[c0[0]].b;
    const last = c1[1] === 0 ? br[c1[0]].b : br[c1[0]].a;
    if (first === last) closed = true;
    strokes.push({ rc, closed, nodes, L, ink, free: [first[0] === "E" && !closed, last[0] === "E" && !closed] });
  }
  const nodePos = new Map();
  for (const x of br) {
    const m = x.rc.length;
    if (!nodePos.has(x.a)) nodePos.set(x.a, [x.rc[0], x.rc[1]]);
    if (!nodePos.has(x.b)) nodePos.set(x.b, [x.rc[m - 2], x.rc[m - 1]]);
  }
  return { strokes, nodePos };
}

// ------------------------------------------ 3. önem sırasıyla, çakışmadan seçim
/** cv2.polylines(..., kalınlık, LINE_AA) > 0 karşılığı: yuvarlanmış köşeli çizgiye uzaklığı
 *  kalınlık/2 + 0,3 pikselden az olan piksel merkezleri (OpenCV çıktısıyla ölçülerek ayarlandı). */
function rasterStrokes(kept, sc, rows, cols, thick) {
  const img = new Uint8Array(rows * cols), R = thick / 2 + 0.3, R2 = R * R, pad = Math.ceil(R);
  for (const s of kept) {
    const m = s.rc.length >> 1, px = [], py = [];
    for (let i = 0; i < m; i++) {
      const x = roundHalfEven(s.rc[2 * i + 1] * sc) + 10, y = roundHalfEven(s.rc[2 * i] * sc) + 10;
      if (!px.length || x !== px[px.length - 1] || y !== py[py.length - 1]) { px.push(x); py.push(y); }
    }
    if (s.closed && px.length > 1) { px.push(px[0]); py.push(py[0]); }
    for (let i = 0; i < px.length; i++) {
      const ax = px[Math.max(i - 1, 0)], ay = py[Math.max(i - 1, 0)], bx = px[i], by = py[i];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const x0 = Math.max(Math.min(ax, bx) - pad, 0), x1 = Math.min(Math.max(ax, bx) + pad, cols - 1);
      const y0 = Math.max(Math.min(ay, by) - pad, 0), y1 = Math.min(Math.max(ay, by) + pad, rows - 1);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - ax - t * dx, ey = y - ay - t * dy;
          if (ex * ex + ey * ey <= R2) img[y * cols + x] = 1;
        }
    }
  }
  return img;
}

/** En çok mürekkep taşıyan darbeden başla; basılınca başka bir çizgiye yapışacak (T+G'den yakın
 *  koşan) darbeleri at. Ortak kavşak çevresindeki yakınlık serbest. Elenen her darbeye why yazılır. */
export function selectStrokes(strokes, nodePos, T, G, mm, P) {
  const R = T + G, R2 = R * R, step = T / 3;
  // soluk doku çizgileri: mürekkep yoğunluğu ana çizgilerin çok altında
  const dens = strokes.map((s) => s.ink / Math.max(s.L, 1));
  let sw = 0, swd = 0;
  strokes.forEach((s, i) => { sw += s.L; swd += s.L * dens[i]; });
  const ref = swd / sw;
  let kept = [];
  const why = {}, bump = (k, by = 1) => { why[k] = (why[k] || 0) + by; };
  const grid = new PointGrid(R);
  // önem: mürekkep x koyuluk (bastırılarak çizilen ana hatlar öne), kapalı şekillere prim
  const imp = strokes.map((s, i) => s.ink * (dens[i] / ref) ** 1.5 * (s.closed ? 2.0 : 1.0));
  const nb = [];
  for (const si of npArgsort(Float64Array.from(imp, (v) => -v))) {
    const s = strokes[si];
    s.imp = imp[si];
    let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (let i = 0; i < s.rc.length; i += 2) {
      r0 = Math.min(r0, s.rc[i]); r1 = Math.max(r1, s.rc[i]);
      c0 = Math.min(c0, s.rc[i + 1]); c1 = Math.max(c1, s.rc[i + 1]);
    }
    const ext = Math.max(r1 - r0, c1 - c0);
    if (dens[si] < P.faint * ref) { bump("soluk"); s.why = "soluk"; continue; }
    if (s.closed && ext < R) { bump("küçük halka"); s.why = "halka"; continue; }
    if (s.L < T || ((s.free[0] || s.free[1]) && s.L < P.min_spur * T)) { bump("kısa"); s.why = "kısa"; continue; }
    const smp = resample(s.rc, step), ns = smp.length >> 1;
    if (grid.size) {
      const n0 = grid.size;
      const npos = [...s.nodes].map((nd) => nodePos.get(nd));
      const bad = new Uint8Array(ns), inZone = new Uint8Array(ns);
      const near = [];
      for (let k = 0; k < ns; k++) {
        const r = smp[2 * k], c = smp[2 * k + 1];
        near.length = 0;
        for (const p of npos) if ((r - p[0]) ** 2 + (c - p[1]) ** 2 < R2) near.push(p);   // yanındaki kendi kavşakları
        inZone[k] = near.length ? 1 : 0;
        grid.ball(r, c, R, n0, nb);
        if (!nb.length) continue;
        if (!near.length) { bad[k] = 1; continue; }
        for (const q of nb) {
          let forgiven = false;
          for (const p of near)
            if ((grid.r[q] - p[0]) ** 2 + (grid.c[q] - p[1]) ** 2 < R2) { forgiven = true; break; }
          if (!forgiven) { bad[k] = 1; break; }
        }
      }
      // kavşaktan dar açıyla ayrılan çizgi: ayrışma bölgesindeki kısa yakınlık serbest
      for (let a = 0; a < ns;) {
        if (!bad[a]) { a++; continue; }
        let b = a;
        while (b < ns && bad[b]) b++;
        const touches = (a > 0 && inZone[a - 1]) || (b < ns && inZone[b]);
        if (touches && (b - a) * T / 3 <= P.diverge * R) bad.fill(0, a, b);
        a = b;
      }
      let nbad = 0;
      for (let k = 0; k < ns; k++) nbad += bad[k];
      if (nbad) {
        // çakışan kısımları kırp, temiz kalan parçaları tut; kesik ucu komşu çizgiye bağla
        if (nbad / ns > P.conflict_max) { bump("çakışma"); s.why = "çakışma"; continue; }
        let added = false;
        for (let a = 0; a < ns;) {
          if (bad[a]) { a++; continue; }
          let b = a;
          while (b < ns && !bad[b]) b++;
          if ((b - a) * T / 3 >= P.min_piece * T) {
            const pre = a > 0 && P.snap ? grid.nearest(smp[2 * a - 2], smp[2 * a - 1], n0) : -1;
            const post = b < ns && P.snap ? grid.nearest(smp[2 * b], smp[2 * b + 1], n0) : -1;
            const piece = new Float64Array(2 * (b - a + (pre >= 0) + (post >= 0)));
            let o = 0;
            if (pre >= 0) { piece[o++] = grid.r[pre]; piece[o++] = grid.c[pre]; }
            piece.set(smp.subarray(2 * a, 2 * b), o); o += 2 * (b - a);
            if (post >= 0) { piece[o++] = grid.r[post]; piece[o++] = grid.c[post]; }
            kept.push({ rc: piece, closed: false, nodes: s.nodes, L: (b - a) * T / 3, ink: s.ink,
                        free: [s.free[0] && a === 0, s.free[1] && b === ns], imp: imp[si] * (b - a) / ns });
            grid.addAll(resample(piece, step));
            added = true;
          }
          a = b;
        }
        bump(added ? "kırpıldı" : "çakışma"); s.why = added ? "kırpıldı" : "çakışma";
        continue;
      }
    }
    kept.push(s);
    grid.addAll(smp);
  }

  // basılınca kapanacak minik delikler: deliği çevreleyen en önemsiz çizgiyi çıkar
  const sc = 4.0 / T * 3;                     // tel kalınlığı ~12 px olacak şekilde küçült
  let mr = 0, mc = 0;
  for (const s of kept) for (let i = 0; i < s.rc.length; i += 2) { mr = Math.max(mr, s.rc[i]); mc = Math.max(mc, s.rc[i + 1]); }
  const rows = Math.floor(mr * sc) + 40, cols = Math.floor(mc * sc) + 40;
  const thick = Math.max(Math.round(T * sc), 1);
  for (let it = 0; it < 80 && kept.length; it++) {
    const img = rasterStrokes(kept, sc, rows, cols, thick);
    const filled = I.fillHoles(img, cols, rows), holes = new Uint8Array(rows * cols);
    for (let i = 0; i < holes.length; i++) holes[i] = filled[i] && !img[i] ? 1 : 0;
    const { lab, n: hn } = I.label(holes, cols, rows, 4);
    if (!hn) break;
    const d = I.edtSq(holes, cols, rows).d2, inr = new Float64Array(hn + 1);
    for (let i = 0; i < d.length; i++) if (lab[i] && d[i] > inr[lab[i]]) inr[lab[i]] = d[i];
    const lim = P.hole * G * sc;
    const small = new Uint8Array(hn + 1);
    let any = false;
    for (let k = 1; k <= hn; k++) { inr[k] = Math.sqrt(inr[k]); if (inr[k] < lim) { small[k] = 1; any = true; } }
    if (!any) break;
    const g2 = new PointGrid(T), ids = [];
    kept.forEach((s, i) => { const ps = resample(s.rc, step); g2.addAll(ps); for (let k = 0; k < ps.length; k += 2) ids.push(i); });
    const nearSets = new Map();               // yalnızca kısa detay çizgileri feda edilir
    for (let i = 0; i < d.length; i++) {
      const k = lab[i];
      if (!k || !small[k]) continue;
      const x = i % cols, y = (i - x) / cols;
      let set = nearSets.get(k);
      if (!set) nearSets.set(k, (set = new Set()));
      for (const q of g2.ball((y - 10) / sc, (x - 10) / sc, T / 2 + inr[k] / sc + 3 / sc, Infinity, nb)) set.add(ids[q]);
    }
    const victims = new Set();
    for (const set of nearSets.values()) {
      let best = -1;
      for (const i of [...set].sort((a, b) => a - b))
        if (kept[i].L < P.detail_len * T && (best < 0 || kept[i].imp < kept[best].imp)) best = i;
      if (best >= 0) victims.add(best);
    }
    if (!victims.size) break;
    kept = kept.filter((_, i) => !victims.has(i));
    bump("delik", victims.size);
  }

  // kısa, bağlantısız adacıkları at (birleşim: ortak kavşak)
  const parent = kept.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const owner = new Map();
  kept.forEach((s, i) => {
    for (const nd of s.nodes) {
      if (owner.has(nd)) parent[find(i)] = find(owner.get(nd));
      else owner.set(nd, i);
    }
  });
  const tot = new Map();
  kept.forEach((s, i) => { const f = find(i); tot.set(f, (tot.get(f) || 0) + s.L); });
  const out = kept.filter((_, i) => tot.get(find(i)) * mm >= P.min_feature);
  why["küçük ada"] = kept.length - out.length;
  return { kept: out, why };
}
