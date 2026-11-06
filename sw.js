/* ==========================================================================
   Mangrove Smart StoryMap - Service Worker
   --------------------------------------------------------------------------
   วิธีทำงาน
   - HTML / CSS / JS / JSON : "เน็ตก่อน" -> แก้ไฟล์แล้วเห็นผลทันทีเมื่อออนไลน์
                              ถ้าเน็ตล่ม/ช้า (เกิน NETWORK_TIMEOUT_MS) จะใช้ของที่แคชไว้
   - รูป / ฟอนต์            : "แคชก่อน" -> เปิดเร็วและใช้ออฟไลน์ได้
   - ไลบรารี/ฟอนต์จาก CDN   : แคชไว้ใช้ออฟไลน์ (Leaflet, Pannellum, Font Awesome, Prompt)
   - ไม่ยุ่ง: แผนที่ Google, Nominatim, Open-Meteo, เสียง (ให้เบราว์เซอร์จัดการเอง)

   ⚠ เมื่อเปลี่ยนรูป/ฟอนต์เดิมที่ชื่อไฟล์เหมือนเดิม ให้เพิ่มเลขเวอร์ชัน CACHE_NAME
     (เช่น v4 -> v5) เพื่อให้เครื่องผู้ใช้ดึงไฟล์ใหม่
   ========================================================================== */
const CACHE_PREFIX = "mangrove-cache-";
const CACHE_NAME = CACHE_PREFIX + "v4";
const NETWORK_TIMEOUT_MS = 3500;
const PRECACHE_BATCH = 8;

// ---------- ไฟล์หลักของแอป ----------
const CORE_FILES = [
  "view/intro.html",
  "view/index.html",
  "view/mangrove.html",
  "view/manual.html",
  "view/plant_info.html",
  "css/intro.css",
  "css/index.css",
  "css/mangrove.css",
  "js/intro.js",
  "js/index.js",
  "js/mangrove.js",
  "storage/info.json",
  "storage/plants.json",
  "storage/index_translate.json",
  "storage/intro_translate.json",
  "storage/mangrove_ui.json",
  "manifest.json",
  "image/icon-192x192.png",
  "image/icon-512x512.png",
];

// ---------- รูปภาพ (เฉพาะไฟล์ที่มีอยู่จริงและถูกใช้ในแอป) ----------
const img = (dir, names) => names.map((n) => `image/${dir}/${n}.webp`);
const IMAGE_FILES = [
  ...img("intro", ["hand", "intro", "spiritual", "view", "wellness"]),
  ...img("stations/well1", ["s1_1", "s1_2", "s1_3", "s1_4", "s2_1", "s2_2", "s2_3", "s2_4", "s3_1", "s3_2", "s3_3", "s3_4", "s4_1", "s4_2", "s4_3", "s5_1", "s5_2", "s5_3", "s5_4", "s6_1", "s6_2", "s6_3", "s7_1", "s7_2", "s8_1", "s9_1", "s9_2", "s9_3", "s10_1", "s10_2", "s10_3", "s10_4", "s11_1", "s11_2", "s11_3", "s11_4", "s12_1", "s13_1", "s14_1", "s14_2", "s15_1"]),
  ...img("stations/well2", ["s1_1", "s3_1"]),
  ...img("stations/spirit1", ["s3_1", "s3_2", "s4_1", "s4_2", "s5_1", "s6_1", "s6_2", "s7_1", "s7_2", "s8_1", "s9_1", "s9_2", "s9_3", "s13_1", "s14_1", "s16_1"]),
  ...img("stations/spirit2", ["s1_1", "s1_2", "s2_1", "s2_2", "s3_1", "s4_1", "s4_2", "s5_1", "s5_2"]),
  ...img("views", ["v0_1", "v0_2", "v0_3", "v1_1", "v2_1", "v3_1", "v3_2", "v4_1", "v4_2", "v4_3", "v5_1", "v6_1", "v6_2", "v7_1", "v8_1", "v9_1", "v10_1", "v11_1", "v12_1", "v14_1", "v14_2"]),
  ...img("flora", ["f1_1", "f1_2", "f2_1", "f3_1", "f3_2", "f4_1", "f4_2", "f5_1", "f5_2", "f6_1", "f6_2", "f7_1", "f8_1", "f8_2", "f8_3", "f9_1", "f10_1", "f11_1", "f12_1", "f13_1", "f14_1", "f15_1", "f16_1", "f16_2", "f17_1", "f18_1", "f18_2", "f19_1", "f20_1", "f20_2", "f21_1", "f21_2", "f22_1", "f22_2", "f22_3", "f23_1", "f23_2", "f24_1", "f25_1", "f26_1", "f30_1", "f31_1", "f31_2", "f32_1"]),
  ...img("bird", ["b1_1", "b2_1"]),
];

// ---------- ไลบรารี / ฟอนต์จาก CDN ----------
const CDN_FILES = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.0/dist/leaflet-rotate-src.js",
  "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js",
  "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2",
  "https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap",
  "https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600&display=swap",
  "https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600&display=swap",
];

const CDN_HOSTS = [
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

// ---------- ตัวช่วย ----------
// คีย์แคชของไฟล์ในโดเมนเดียวกัน = ไม่รวม ?query (เช่น info.json?t=123, index.css?v=1, plant_info.html?id=3)
function cacheKey(url) {
  const u = new URL(url, self.location.href);
  return u.origin + u.pathname;
}

function delay(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function precacheOne(cache, file) {
  try {
    const isCdn = /^https?:\/\//i.test(file);
    const res = await fetch(
      file,
      isCdn ? { mode: "cors", credentials: "omit" } : { cache: "reload" },
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    await cache.put(isCdn ? file : cacheKey(file), res.clone());

    // CSS ของ Google Fonts: ดึงไฟล์ฟอนต์ (woff2) ที่อ้างถึงมาแคชด้วย เพื่อให้ฟอนต์ Prompt ใช้ออฟไลน์ได้
    if (isCdn && file.indexOf("fonts.googleapis.com") !== -1) {
      const css = await res.text();
      const fontUrls = css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s'"]+/g) || [];
      for (const fu of [...new Set(fontUrls)]) await precacheOne(cache, fu);
    }
    return true;
  } catch (err) {
    // ไฟล์ใดไฟล์หนึ่งโหลดไม่ได้ ต้องไม่ทำให้การติดตั้งทั้งหมดล้ม
    console.warn("[SW] ข้ามไฟล์ที่แคชไม่ได้:", file, err && err.message);
    return false;
  }
}

async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  const files = [...CORE_FILES, ...CDN_FILES, ...IMAGE_FILES];
  for (let i = 0; i < files.length; i += PRECACHE_BATCH) {
    await Promise.all(files.slice(i, i + PRECACHE_BATCH).map((f) => precacheOne(cache, f)));
  }
}

// ---------- กลยุทธ์ดึงข้อมูล ----------
async function networkFirst(req, key, isPage) {
  const cache = await caches.open(CACHE_NAME);

  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  network.catch(() => {}); // กัน unhandled rejection กรณีรอไม่ไหวแล้วใช้แคช

  try {
    const res = await Promise.race([network, delay(NETWORK_TIMEOUT_MS)]);
    if (res.ok) return res;
    // เซิร์ฟเวอร์ตอบ error -> ถ้ามีของเดิมในแคชให้ใช้ของเดิม
    const cached = await cache.match(key, { ignoreVary: true });
    return cached || res;
  } catch (err) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return cached;
    if (isPage) {
      const home = await cache.match(cacheKey("view/intro.html"), { ignoreVary: true });
      if (home) return home;
    }
    return network; // ไม่มีแคชเลย: รอเน็ตจริง (ถ้าล้มเหลวเบราว์เซอร์จะแสดงหน้า error ตามปกติ)
  }
}

async function cacheFirst(req, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key, { ignoreVary: true });
  if (cached) return cached;

  const res = await fetch(req);
  if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
  return res;
}

async function cdnStrategy(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req.url, { ignoreVary: true });
  if (cached) return cached;

  try {
    let res;
    try {
      // ขอแบบ CORS เพื่อให้ได้ response ที่เก็บแคชได้ (CDN เหล่านี้เปิด CORS)
      res = await fetch(req.url, { mode: "cors", credentials: "omit" });
    } catch (e) {
      res = await fetch(req);
    }
    if (res && res.ok) cache.put(req.url, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    return Response.error();
  }
}

// ---------- Lifecycle ----------
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAll());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // ลบแคชเวอร์ชันเก่าของแอปนี้ (ไม่แตะแคชอื่นที่ไม่ใช่ของแอปนี้)
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("range")) return; // วิดีโอ/PDF แบบดึงเป็นช่วง ปล่อยให้เบราว์เซอร์จัดการ

  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cdnStrategy(req));
    return;
  }
  if (url.origin !== self.location.origin) return; // แผนที่ / API ภายนอก: ไม่ยุ่ง

  const key = cacheKey(req.url);
  const dest = req.destination;
  const isPage = req.mode === "navigate" || dest === "document";
  const wantFresh =
    isPage || dest === "script" || dest === "style" || /\.json$/i.test(url.pathname);

  event.respondWith(wantFresh ? networkFirst(req, key, isPage) : cacheFirst(req, key));
});
