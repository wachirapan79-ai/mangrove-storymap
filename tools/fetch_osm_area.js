/* fetch_osm_area.js — ดึงข้อมูลแผนที่ OpenStreetMap เฉพาะพื้นที่เส้นทางของแอป
   แล้วบันทึกเป็น storage/osm_area.json (GeoJSON ขนาดเล็ก) ใช้วาดแผนที่พื้นฐานตอนออฟไลน์
   รันครั้งเดียวที่โฟลเดอร์โปรเจกต์:   node tools/fetch_osm_area.js
   (ต้องใช้ Node 18 ขึ้นไป และต่ออินเทอร์เน็ต)
   ข้อมูล © OpenStreetMap contributors (ODbL) — ต้องแสดงที่มาไว้บนแผนที่ (แอปทำให้แล้ว) */
const fs = require("fs");
const path = require("path");

const BUFFER_M = 500; // ขยายขอบเขตรอบเส้นทางทุกด้าน
const root = path.join(__dirname, "..");
const info = JSON.parse(fs.readFileSync(path.join(root, "storage", "info.json"), "utf8"));

let s = 90, w = 180, n = -90, e = -180;
for (const k of ["wellness1", "wellness2", "spiritual1", "spiritual2", "viewpoints"]) {
  for (const p of info[k] || []) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng);
  }
}
const dLat = BUFFER_M / 111320;
const dLng = BUFFER_M / (111320 * Math.cos(((s + n) / 2) * Math.PI / 180));
s -= dLat; n += dLat; w -= dLng; e += dLng;
const bbox = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
console.log("bbox (s,w,n,e):", bbox);

const query = `[out:json][timeout:60];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["waterway"](${bbox});
  way["natural"~"^(water|wood|wetland|coastline|scrub|beach|mud)$"](${bbox});
  way["landuse"](${bbox});
  way["leisure"~"^(park|garden|nature_reserve)$"](${bbox});
  way["water"](${bbox});
  relation["natural"~"^(water|wood|wetland)$"](${bbox});
  relation["landuse"](${bbox});
);
out geom tags;`;

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function cls(t) {
  if (t.building) return "building";
  if (t.highway) {
    if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)/.test(t.highway)) return "road";
    return "path";
  }
  if (t.waterway) return "waterway";
  if (t.natural === "coastline") return "coast";
  if (t.natural === "water" || t.water) return "water";
  if (t.natural === "wetland" || t.natural === "mud") return "wetland";
  if (t.natural === "wood" || t.landuse === "forest") return "wood";
  if (t.natural === "scrub" || t.natural === "beach") return "scrub";
  if (t.landuse || t.leisure) return "green";
  return null;
}
const closed = (g) => g.length > 3 && g[0][0] === g[g.length - 1][0] && g[0][1] === g[g.length - 1][1];
const r6 = (p) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6];

function toFeatures(el) {
  const t = el.tags || {};
  const c = cls(t);
  if (!c) return [];
  const out = [];
  const polyKinds = ["building", "water", "wetland", "wood", "scrub", "green"];
  if (el.type === "way" && el.geometry) {
    const g = el.geometry.map(r6);
    if (g.length < 2) return [];
    if (polyKinds.includes(c) && closed(g)) out.push({ c, type: "Polygon", coordinates: [g] });
    else out.push({ c, type: "LineString", coordinates: g });
  } else if (el.type === "relation" && el.members) {
    for (const m of el.members) {
      if (m.type !== "way" || m.role !== "outer" || !m.geometry) continue;
      const g = m.geometry.map(r6);
      if (closed(g)) out.push({ c, type: "Polygon", coordinates: [g] });
      else if (g.length > 1) out.push({ c, type: "LineString", coordinates: g });
    }
  }
  return out;
}

async function main() {
  let data = null, lastErr;
  for (const url of MIRRORS) {
    try {
      console.log("ขอข้อมูลจาก", url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "mangrove-storymap-offline-map/1.0" },
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
      break;
    } catch (err) { lastErr = err; console.warn("ล้มเหลว:", err.message); }
  }
  if (!data) { console.error("ดึงข้อมูลไม่สำเร็จ:", lastErr && lastErr.message); process.exit(1); }

  const features = [];
  for (const el of data.elements) {
    for (const f of toFeatures(el)) {
      features.push({ type: "Feature", properties: { c: f.c }, geometry: { type: f.type, coordinates: f.coordinates } });
    }
  }
  const fc = {
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright",
    bbox: [w, s, e, n],
    fetched: new Date().toISOString().slice(0, 10),
    features,
  };
  const outFile = path.join(root, "storage", "osm_area.json");
  fs.writeFileSync(outFile, JSON.stringify(fc));
  const count = {};
  features.forEach((f) => (count[f.properties.c] = (count[f.properties.c] || 0) + 1));
  console.log("บันทึก", outFile, (fs.statSync(outFile).size / 1024).toFixed(0), "KB");
  console.log("จำนวนวัตถุ:", count);
}
main();
