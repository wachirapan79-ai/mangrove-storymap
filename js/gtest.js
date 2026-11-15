/* gtest.js — ชุดทดสอบ glide บนโทรศัพท์จริง (เปิดใช้เมื่อมี ?gtest=1 ใน URL)
   ขั้น 1: เดินรอบแรก "บันทึกเส้นทาง"  → ขั้น 2: "สร้างเส้นทาง" (ใช้เป็นเส้นให้ระบบเกาะ)
   ขั้น 3: เดินรอบทดสอบ กด "เริ่มบันทึก" / "หยุด" แล้ว "ดาวน์โหลด" ไฟล์ JSON ไปวิเคราะห์
   ไม่แก้ตรรกะของแอป: ดักพิกัดดิบ และอ่านตำแหน่งจุดที่แสดงทุกเฟรม */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("gtest") !== "1") return;

  const st = { mode: "idle", raw: [], frames: [], fixes: [], lap1: [], t0: 0 };
  const glideOn = q.get("glide") !== "off";

  // ดักพิกัดดิบจาก GPS (ไม่เปลี่ยนค่าที่ส่งต่อให้แอป)
  const wp = navigator.geolocation.watchPosition.bind(navigator.geolocation);
  navigator.geolocation.watchPosition = function (ok, err, opt) {
    return wp(
      (pos) => {
        const c = pos.coords;
        const r = { t: Date.now(), lat: c.latitude, lng: c.longitude, acc: c.accuracy };
        if (st.mode === "rec1") st.lap1.push(r);
        if (st.mode === "test") st.fixes.push(r);
        ok(pos);
      },
      err,
      opt,
    );
  };

  // ตำแหน่งจุดที่แสดงบนจอ ทุกเฟรม (เก็บเป็น [t,lat,lng])
  function frame() {
    if (st.mode === "test" && typeof userMarker !== "undefined" && userMarker) {
      const p = userMarker.getLatLng();
      st.frames.push([Date.now(), +p.lat.toFixed(7), +p.lng.toFixed(7), typeof glide !== "undefined" && glide ? 1 : 0]);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- สร้างเส้นทางจากรอบแรก: เฉลี่ยเคลื่อนที่ 5 จุด แล้วสุ่มทุก ~3 ม. ----
  function buildFromLap(fixes) {
    const g = fixes.filter((f) => f.acc <= 15);
    const sm = g.map((_, i) => {
      const a = g.slice(Math.max(0, i - 2), i + 3);
      return [a.reduce((s, x) => s + x.lat, 0) / a.length, a.reduce((s, x) => s + x.lng, 0) / a.length];
    });
    const out = [];
    let last = null;
    for (const p of sm) {
      if (!last || metersBetween(last[0], last[1], p[0], p[1]) >= 3) {
        out.push(p);
        last = p;
      }
    }
    return out;
  }

  function injectRoute(pts) {
    db.hometest = pts.map((p, i) => ({ lat: p[0], lng: p[1], id: i === 0 ? 1 : undefined, dist: 0 }));
    if (!SNAP_ROUTE_KEYS.includes("hometest")) SNAP_ROUTE_KEYS.push("hometest");
    snapCache = { src: null, routes: {} };
    // วาดเส้นให้เห็นบนแผนที่
    if (window.__gtLine) map.removeLayer(window.__gtLine);
    window.__gtLine = L.polyline(pts, { color: "#e91e63", weight: 3, opacity: 0.8 }).addTo(map);
    return buildRoute("hometest").paths[0].cum.slice(-1)[0];
  }

  // ---- แผงควบคุม ----
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;left:6px;right:6px;bottom:6px;z-index:99999;background:rgba(20,28,40,.92);color:#fff;" +
    "font:13px/1.4 sans-serif;padding:8px;border-radius:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center";
  const info = document.createElement("div");
  info.style.cssText = "width:100%";
  box.appendChild(info);
  function btn(label, fn) {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "flex:1;min-width:30%;padding:8px;border:0;border-radius:6px;background:#2d8f6f;color:#fff;font-size:13px";
    b.onclick = fn;
    box.appendChild(b);
    return b;
  }
  // ระยะจาก fix ล่าสุดถึงเส้นทางบ้าน: ต้องใกล้กว่ารัศมีเกาะเส้น (≥12 ม.) glide จึงทำงาน
  function offRoute() {
    try {
      const f = st.fixes[st.fixes.length - 1];
      if (!db.hometest || !f) return "";
      const n = nearestOnSegments(f.lat, f.lng, buildRoute("hometest").segs);
      const on = typeof glide !== "undefined" && glide;
      return ` | ห่างเส้น ${n.d.toFixed(0)} ม. | glide ${on ? "ทำงาน" : "ไม่ทำงาน (เดินให้ใกล้เส้นสีชมพู)"}`;
    } catch (e) { return ""; }
  }
  function say() {
    info.textContent =
      `glide=${glideOn ? "ON" : "OFF"} | โหมด: ${st.mode} | รอบแรก ${st.lap1.length} จุด | ทดสอบ: fix ${st.fixes.length}, เฟรม ${st.frames.length}` +
      (db && db.hometest ? " | เส้นทางบ้านพร้อม" : "") + offRoute();
  }
  btn("1 เริ่มบันทึกรอบแรก", () => { st.lap1 = []; st.mode = "rec1"; say(); });
  btn("2 สร้างเส้นทาง", () => {
    st.mode = "idle";
    const pts = buildFromLap(st.lap1);
    if (pts.length < 8) { info.textContent = "จุดน้อยเกินไป เดินรอบแรกใหม่"; return; }
    const len = injectRoute(pts);
    st.route = pts;
    say();
    info.textContent += ` | ยาว ${len.toFixed(0)} ม.`;
  });
  btn("3 เริ่มทดสอบ", () => { st.fixes = []; st.frames = []; st.t0 = Date.now(); st.mode = "test"; say(); });
  btn("หยุด", () => { st.mode = "idle"; say(); });
  btn("ดาวน์โหลด JSON", () => {
    const blob = new Blob([JSON.stringify({
      glide: glideOn, ua: navigator.userAgent, t0: st.t0, route: st.route || null,
      fixes: st.fixes, frames: st.frames,
    })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gtest_${glideOn ? "glide" : "plain"}_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  setInterval(say, 1000);
  const mount = () => { if (!box.parentNode) document.body.appendChild(box); };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  window.__gtest = { st, injectRoute, buildFromLap };
})();
