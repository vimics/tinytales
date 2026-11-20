// Boru hattını arayüzü dondurmadan çalıştıran Web Worker. Fotoğraf cihazdan çıkmaz.
import { run, MeshError, NoInkError } from "./pipeline/index.js";

// Stil -> boru hattı parametreleri (README'deki iki ayarlanmış kombinasyon)
const STYLES = {
  cercevesiz: (size) => ({ frame: 0, size }),
  cemberli: (size) => ({ frame: 1, line_d: 0.6, bail_hole: 3, bail_d: 1.4, outer_d: size }),
};
const MIN_SHORT_SIDE = 6.0;   // mm; çerçevesiz kolyenin kısa kenarı bundan küçükse çizim bulunamamış sayılır

let image = null;             // son yüklenen fotoğraf; stil/boyut değişince yeniden kullanılır

self.onmessage = (ev) => {
  const { id, style, size } = ev.data;
  if (ev.data.image) image = ev.data.image;
  try {
    const r = run(new Uint8ClampedArray(image.data), image.width, image.height, STYLES[style](size),
                  (stage) => self.postMessage({ id, type: "progress", stage }));
    const m = r.metrics;
    // boş kağıt / tek karalama: boru hattı kağıt dokusundan şerit gibi bir "kolye" üretebiliyor
    if (style === "cercevesiz" && Math.min(m.en, m.boy) < MIN_SHORT_SIDE) throw new NoInkError("çok küçük");
    // Tarayıcıda STL dosyası üretilmez (indirilebilir üretim dosyası sipariş sonrası Python ile çıkar);
    // görüntüleyiciye yalnızca üçgen köşeleri gider.
    const tris = new Float32Array(r.faces.length * 3);
    for (let i = 0; i < r.faces.length; i++) tris.set(r.verts.subarray(3 * r.faces[i], 3 * r.faces[i] + 3), 3 * i);
    self.postMessage({ id, type: "done", tris, render: r.render, strokes: r.strokes, kept: r.kept, metrics: m },
                     [tris.buffer, r.render.data.buffer]);
  } catch (e) {
    console.error(e);
    self.postMessage({ id, type: "error", kind: e instanceof MeshError ? "mesh" : e instanceof NoInkError ? "noink" : "other" });
  }
};
