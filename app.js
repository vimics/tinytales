// Akış: yükle -> işleniyor -> sonuç (#/k/<id>) -> sipariş (#/k/<id>/siparis) -> tamam
// Sunucu yok: kolye tarayıcıda üretilir (worker.js + pipeline/).
const $ = (id) => document.getElementById(id);
const views = ["yukle", "isleniyor", "sonuc", "siparis", "tamam"];
const STYLE_NAMES = { cercevesiz: "Çerçevesiz", cemberli: "Çember içinde" };
let cfg = { sizes: { cercevesiz: [35, 45, 55], cemberli: [30, 36, 42] }, zincirler: [], fiyat: null };
let job = null;            // ekrandaki hazır iş
let pick = null;           // panelde seçili {style, size}
let viewer = null;

function show(view, step) {
  for (const v of views) $("v-" + v).hidden = v !== view;
  for (const li of $("steps").children) {
    const n = +li.dataset.step;
    li.classList.toggle("on", n === step);
    li.classList.toggle("done", n < step);
    if (n === step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------- iş: fotoğraf -> kolye (tarayıcıda)
// Fotoğraf sunucuya gitmez; boru hattı (pipeline/) bir Web Worker'da çalışır.
const NO_INK = "Fotoğrafta yeterince belirgin çizgi bulamadık. Çizimi düz, açık renkli bir zeminde, iyi ışıkta ve tam karşıdan çekip yeniden deneyin.";
const ERRORS = {
  noink: NO_INK,
  mesh: "Bu çizimden tek parça, baskıya uygun bir model çıkaramadık. Daha büyük bir boyut seçmeyi ya da çizgileri daha belirgin bir fotoğraf yüklemeyi deneyin.",
  other: "Bir şeyler ters gitti. Sayfayı yenileyip yeniden deneyin; olmazsa başka bir tarayıcı deneyin.",
};
const LONG_EDGE = 2600;     // boru hattı ~2576 px genişliğinde fotoğrafla ayarlandı
const STAGE_TEXT = {
  murekkep: [5, "Çizgileri kağıttan ayırıyoruz…"], darbe: [35, "Kalemin izini sürüyoruz…"],
  secim: [50, "Hangi çizgi kalacak, seçiyoruz…"], geometri: [60, "Teli büküyoruz…"], kopru: [68, "Teli büküyoruz…"],
  mesh: [78, "Basılır mı diye bakıyoruz…"], olcum: [94, "Bitti sayılır…"],
};
const WHY_COLORS = { soluk: "#3b82f6", "kısa": "#22c55e", "çakışma": "#ef4444", "kırpıldı": "#f59e0b", halka: "#a855f7" };

const jobs = new Map();    // id -> iş; yalnızca bu sekmenin belleğinde
let input = null;          // son yüklenen fotoğraf: { url, blob, width, height }
let worker = null, ticker = 0;

function uploadError(msg) { const e = $("upload-error"); e.textContent = msg || ""; e.hidden = !msg; }

function getWorker() {
  if (worker) return worker;
  worker = new Worker("worker.js?v=4", { type: "module" });
  worker.onmessage = (ev) => onWorkerMessage(ev.data);
  worker.onerror = () => { for (const j of jobs.values()) if (j.status === "isleniyor") fail(j, "other"); worker.terminate(); worker = null; };
  return worker;
}

const canvasBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

/** Dosyayı aç, EXIF yönünü uygula, uzun kenarı LONG_EDGE'e indir. */
async function decode(blob) {
  let src;
  try { src = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch {
    const img = new Image(), url = URL.createObjectURL(blob);
    try { img.src = url; await img.decode(); src = img; }
    catch { throw new Error("Bu dosyayı açamadık. JPG ya da PNG bir fotoğraf yükleyin."); }
    finally { URL.revokeObjectURL(url); }
  }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (Math.min(sw, sh) < 200) throw new Error("Fotoğraf çok küçük. Kısa kenarı en az 200 piksel olmalı.");
  const sc = Math.min(1, LONG_EDGE / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * sc); canvas.height = Math.round(sh * sc);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const jpeg = await canvasBlob(canvas, "image/jpeg", 0.92);
  return { pixels, blob: jpeg, url: URL.createObjectURL(jpeg), width: canvas.width, height: canvas.height };
}

async function startUpload(file) {
  uploadError("");
  if (file.size > 25 * 1024 * 1024) return uploadError("Dosya çok büyük (en fazla 25 MB).");
  await begin(file, "cercevesiz", 45);
}

/** source: yüklenecek Blob/File; null ise son fotoğraf başka stil/boyutla yeniden işlenir. */
async function begin(source, style, size) {
  $("work-img").removeAttribute("src");
  setProgress("murekkep", 0);
  show("isleniyor", 2);
  try {
    let image = null;
    if (source) {
      const d = await decode(source);
      if (input) URL.revokeObjectURL(input.url);
      input = { url: d.url, blob: d.blob, width: d.width, height: d.height };
      image = { data: d.pixels.data.buffer, width: d.width, height: d.height };
    }
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const j = { id, status: "isleniyor", style, size, created: performance.now(), stage: "murekkep", girdi: input.url, input };
    jobs.set(id, j);
    getWorker().postMessage({ id, style, size, image }, image ? [image.data] : []);
    location.hash = `#/k/${id}`;         // route() bekleme ekranını sürdürür
  } catch (e) {
    show("yukle", 1); uploadError(e.message);
  }
}

function fail(j, kind) {
  j.status = "hata"; j.error = ERRORS[kind] || ERRORS.other;
  if (location.hash.startsWith(`#/k/${j.id}`)) { show("yukle", 1); uploadError(j.error); history.replaceState(null, "", "#/"); }
}

async function onWorkerMessage(msg) {
  const j = jobs.get(msg.id);
  if (!j) return;
  if (msg.type === "progress") { j.stage = msg.stage; return; }
  if (msg.type === "error") return fail(j, msg.kind);
  j.metrics = msg.metrics;
  j.stl = URL.createObjectURL(new Blob([msg.stl], { type: "model/stl" }));
  const rc = document.createElement("canvas");
  rc.width = msg.render.width; rc.height = msg.render.height;
  rc.getContext("2d").putImageData(new ImageData(msg.render.data, msg.render.width, msg.render.height), 0, 0);
  j.render = URL.createObjectURL(await canvasBlob(rc, "image/png"));
  j.onizleme = await drawSelection(j, msg.strokes, msg.kept);
  j.status = "hazir";
  for (const old of jobs.values())      // eski sonuçların belleğini bırak; ekrandaki ve yenisi kalır
    if (old !== j && old !== job && old.stl) { URL.revokeObjectURL(old.stl); URL.revokeObjectURL(old.render); URL.revokeObjectURL(old.onizleme); jobs.delete(old.id); }
  if (location.hash.startsWith(`#/k/${j.id}`)) route();
}

/** "Çizgiler" sekmesi: soluk fotoğrafın üstünde kolyeye giren (siyah) ve elenen (renkli) darbeler. */
async function drawSelection(j, strokes, kept) {
  const sc = Math.min(1, 1400 / j.input.width), c = document.createElement("canvas");
  c.width = Math.round(j.input.width * sc); c.height = Math.round(j.input.height * sc);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const img = new Image(); img.src = j.girdi;
  try { await img.decode(); ctx.globalAlpha = 0.15; ctx.drawImage(img, 0, 0, c.width, c.height); ctx.globalAlpha = 1; } catch { /* fotoğrafsız da olur */ }
  ctx.lineJoin = ctx.lineCap = "round";
  const line = (rc, color, lw, closed) => {
    ctx.beginPath();
    for (let i = 0; i < rc.length; i += 2) ctx[i ? "lineTo" : "moveTo"](rc[i + 1] * sc, rc[i] * sc);   // rc: (satır, sütun)
    if (closed) ctx.closePath();
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  };
  const u = c.width / 700;
  for (const s of strokes) if (s.why) line(s.rc, WHY_COLORS[s.why] || "#888", 1.2 * u);
  for (const s of kept) line(s.rc, "#111", 2.4 * u, s.closed);
  return URL.createObjectURL(await canvasBlob(c, "image/jpeg", 0.9));
}

function setProgress(stage, sec) {
  const [pct, text] = STAGE_TEXT[stage] || STAGE_TEXT.murekkep;
  $("work-title").textContent = text;
  $("work-bar").style.width = Math.min(96, pct + 2 * sec) + "%";
  $("work-time").textContent = sec >= 3 ? `Geçen süre: ${Math.round(sec)} sn` : "";
}

function showWorking(j) {
  if ($("v-isleniyor").hidden) show("isleniyor", 2);
  $("work-img").src = j.girdi;
  clearInterval(ticker);
  const tick = () => {
    if (j.status !== "isleniyor" || !location.hash.startsWith(`#/k/${j.id}`)) return clearInterval(ticker);
    setProgress(j.stage, (performance.now() - j.created) / 1000);
  };
  ticker = setInterval(tick, 200); tick();
}

// ----------------------------------------------------------------- sonuç
const fmt = (n, d = 1) => n.toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

function seg(el, values, current, label, onPick) {
  el.replaceChildren(...values.map((v) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label(v);
    b.setAttribute("aria-pressed", String(v === current));
    b.onclick = () => onPick(v);
    return b;
  }));
}

function renderPanel() {
  seg($("seg-style"), Object.keys(STYLE_NAMES), pick.style, (v) => STYLE_NAMES[v], (v) => {
    pick = { style: v, size: cfg.sizes[v][1] }; renderPanel();
  });
  seg($("seg-size"), cfg.sizes[pick.style], pick.size, (v) => `${v} mm`, (v) => { pick.size = v; renderPanel(); });
  $("size-help").textContent = pick.style === "cemberli" ? "(çember dış çapı)" : "(uzun kenar)";
  const changed = pick.style !== job.style || pick.size !== job.size;
  $("redo").hidden = !changed;
  $("go-order").disabled = changed;
  $("go-order").textContent = changed ? "Önce yeniden yapın" : "Bunu istiyorum";
}

function showResult(j) {
  job = j; pick = { style: j.style, size: j.size };
  const m = j.metrics;
  $("result-sub").textContent = m.darbe_toplam
    ? `${m.darbe_toplam} çizgiden ${m.darbe_secilen} tanesi kolyeye girdi.` : "";
  const specs = [
    ["Boyut", m.en ? `${fmt(m.en)} × ${fmt(m.boy)} mm` : "–"],
    ["Kalınlık", m.kalinlik ? `${fmt(m.kalinlik)} mm` : "–"],
    ["Ağırlık", m.gram ? `${fmt(m.gram, 2)} g` : "–"],
    ["Tel kesiti", m.tel ? m.tel.replaceAll(".", ",") : "–"],
  ];
  $("specs").replaceChildren(...specs.map(([k, v]) => {
    const d = document.createElement("div");
    d.append(Object.assign(document.createElement("dt"), { textContent: k }),
             Object.assign(document.createElement("dd"), { textContent: v }));
    return d;
  }));
  $("poster").src = j.render; $("poster").hidden = false;
  $("img-secim").src = j.onizleme; $("img-cizim").src = j.girdi;
  $("dl-stl").href = j.stl; $("dl-stl").download = "cizim-kolye.stl";
  $("hint").textContent = "3B model yükleniyor…"; $("hint").hidden = false;
  selectTab("3d");
  renderPanel();
  show("sonuc", 2);
  load3d(j);
}

function selectTab(name) {
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== name;
  if (name === "3d" && viewer) viewer.resize();
}

async function load3d(j) {
  try {
    if (!viewer) viewer = (await import("./viewer.js")).createViewer($("canvas"));
    await viewer.load(j.stl);
    if (job !== j) return;
    $("poster").hidden = true;
    $("hint").textContent = "Döndürmek için sürükleyin";
    setTimeout(() => { if (job === j) $("hint").hidden = true; }, 6000);
  } catch (e) {
    console.error(e);
    if (job === j) $("hint").textContent = "3B görüntüleyici açılamadı; yukarıdaki görsel modelin önizlemesidir.";
  }
}

// --------------------------------------------------------------- sipariş
function showOrder() {
  const m = job.metrics;
  $("sum-img").src = job.render;
  const rows = [
    ["Stil", STYLE_NAMES[job.style]],
    ["Boyut", m.en ? `${fmt(m.en)} × ${fmt(m.boy)} mm` : `${job.size} mm`],
    ["Malzeme", "Titanyum (Ti6Al4V)"],
    ["Ağırlık", m.gram ? `${fmt(m.gram, 2)} g` : "–"],
  ];
  if (cfg.fiyat != null) rows.push(["Fiyat", `${fmt(cfg.fiyat, 0)} ₺`]);
  $("sum-list").replaceChildren(...rows.map(([k, v]) => {
    const d = document.createElement("div");
    d.append(Object.assign(document.createElement("dt"), { textContent: k }),
             Object.assign(document.createElement("dd"), { textContent: v }));
    return d;
  }));
  $("price-note").textContent = cfg.fiyat != null
    ? "Şimdi para istemiyoruz."
    : "Şimdi para istemiyoruz. Modele baktıktan sonra fiyatı size yazarız.";
  $("order-error").hidden = true;
  show("siparis", 3);
}

/** Siparişi config.json'daki form adresine gönderir: alanlar + çizimin fotoğrafı. Kolye, bu
 *  fotoğraf ve stil/boyutla aynı boru hattından yeniden üretilebildiği için STL eklenmez. */
async function sendOrder(f) {
  if (!cfg.siparis_url) throw new Error("Sipariş alımı henüz açılmadı. Lütfen daha sonra yeniden deneyin.");
  const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
  const no = `TT-${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}-`
    + [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 5).toUpperCase();
  const m = job.metrics, fd = new FormData();
  fd.append("siparis_no", no);
  for (const k of ["ad", "eposta", "telefon", "adres", "adet", "notlar"]) fd.append(k, f[k] ?? "");
  fd.append("zincir", cfg.zincirler.find((z) => z.id === f.zincir)?.ad ?? f.zincir);
  fd.append("stil", STYLE_NAMES[job.style]); fd.append("boyut_mm", String(job.size));
  fd.append("olcumler", `${fmt(m.en)} × ${fmt(m.boy)} × ${fmt(m.kalinlik)} mm, ${fmt(m.gram, 2)} g, ${m.darbe_toplam} çizgiden ${m.darbe_secilen}`);
  fd.append("cizim", job.input.blob, `${no}.jpg`);
  let r;
  try { r = await fetch(cfg.siparis_url, { method: "POST", body: fd, headers: { Accept: "application/json" } }); }
  catch { throw new Error("Sipariş gönderilemedi. Bağlantınızı kontrol edip yeniden deneyin."); }
  if (!r.ok) throw new Error("Sipariş gönderilemedi. Biraz sonra yeniden deneyin.");
  return no;
}

$("order-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget, err = $("order-error");
  err.hidden = true;
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const f = Object.fromEntries(new FormData(form));
  const btn = $("order-submit");
  btn.disabled = true; btn.textContent = "Gönderiliyor…";
  try {
    const no = await sendOrder(f);
    $("done-no").textContent = no; $("done-mail").textContent = f.eposta;
    form.reset();
    show("tamam", 3);
    history.replaceState(null, "", "#/tamam");
  } catch (e) {
    err.textContent = e.message; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Siparişi gönder";
  }
});

// ------------------------------------------------------------------ olaylar
const drop = $("drop");
$("file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) startUpload(f); });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const t of ["dragleave", "drop"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) startUpload(f); });
$("try-sample").onclick = async () => {
  uploadError("");
  try { await begin(await (await fetch("ornek-cizim.jpg")).blob(), "cercevesiz", 45); }
  catch { uploadError("Örnek çizim yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."); }
};
$("redo").onclick = () => begin(null, pick.style, pick.size);
$("go-order").onclick = () => { location.hash = `#/k/${job.id}/siparis`; };
$("back-result").onclick = () => { location.hash = `#/k/${job.id}`; };
for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => selectTab(b.dataset.tab);

function route() {
  const m = location.hash.match(/^#\/k\/([0-9a-f]{32})(\/siparis)?$/);
  const j = m && jobs.get(m[1]);
  if (!j || j.status === "hata") {       // iş yalnızca bellekte yaşar; sayfa yenilenince baştan başlanır
    if (m) history.replaceState(null, "", "#/");
    if (location.hash === "#/tamam" && !$("v-tamam").hidden) return;
    show("yukle", 1); return;
  }
  if (j.status === "isleniyor") return showWorking(j);
  if (job !== j) showResult(j);
  else if (!m[2]) show("sonuc", 2);
  if (m[2]) showOrder();
}
window.addEventListener("hashchange", route);

(async () => {
  try {
    cfg = { ...cfg, ...(await (await fetch("config.json")).json()) };
  } catch { /* varsayılanlarla devam */ }
  $("f-zincir").replaceChildren(...cfg.zincirler.map((z) => new Option(z.ad, z.id)));
  route();
})();
