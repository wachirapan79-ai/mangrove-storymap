/* =========================================
   1. GLOBAL VARIABLES & CONFIGURATION
   ========================================= */
let currentLang = localStorage.getItem("selectedLang") || "th";

let db = {};
let ui = {};

let currentRoute = "wellness",
  currentSubRoute = "wellness1",
  currentPos = [12.5288, 102.0945],
  isSatellite = false,
  totalDistanceTraveled = 0,
  lastRecordedPos = null,
  lastRecordedTime = 0;

const hour = new Date().getHours();
let soundEnabled = true,
  lastPopupId = null,
  deviceHeading = 0,
  isTracking = false,
  isSimulating = false,
  activeViewpoints = {},
  userMarker = null,
  lastHeading = 0,
  isFollowingHeading = false,
  popupDebounce = null,
  compassEnabled = false;

let smoothedHeading = null,
  currentIconRotation = 0,
  targetHeading = 0,
  currentRenderHeading = 0,
  isCompassAnimating = false;
let compassActive = false;
let compassHandler = null;
let lastCompassHeading = 0;
let headingBuffer = [];
const BUFFER_SIZE = 5;

let isPromptingRoute = false,
  routeIgnoreCooldown = false;

let isUserInZone = false;
const ALERT_DISTANCE = 20;

let showAllViewpoints = false;
let showAllFlora = false;

// =========================================
// ตัวแปรควบคุม GPS ให้เสถียร (ป้องกันค้าง)
// =========================================
let gpsWatchId = null;
let gpsWatchdog = null;
let lastGpsUpdateTime = 0;

// =========================================
// ตัวแปรจับสถิติเส้นทางสุขภาพ
// =========================================
let routeStartTime = Date.now();
let routeStartDistance = 0;
let isRouteFinished = false;

/* =========================================
   2. MAP & MARKER SETUP
   ========================================= */

let savedCenter = currentPos;
let savedZoom = 16;
try {
  const savedMapState = localStorage.getItem("mapState");
  if (savedMapState) {
    const parsedState = JSON.parse(savedMapState);
    if (parsedState.lat && parsedState.lng && parsedState.zoom) {
      savedCenter = [parsedState.lat, parsedState.lng];
      savedZoom = parsedState.zoom;
    }
  }
} catch (e) {
  console.error("Failed to parse saved map state", e);
}

const map = L.map("map", {
  zoomControl: false,
  preferCanvas: true,
  rotate: true,
  touchRotate: true,
  bearing: 0,
  updateWhenIdle: true,
}).setView(savedCenter, savedZoom);

map.on("zoomend", function () {
  if (map._renderer) map._renderer._update();
  saveMapState();
});

map.on("moveend", function () {
  saveMapState();
});

const street = L.tileLayer(
  `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=${getGoogleMapLang(currentLang)}&sbc=1`,
  { maxZoom: 20, attribution: "© Google Maps" },
).addTo(map);

const satellite = L.tileLayer(
  `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=${getGoogleMapLang(currentLang)}&sbc=1`,
  { maxZoom: 20, attribution: "© Google Maps" },
);

let routeLayer = L.layerGroup().addTo(map);
const activePathLayer = L.featureGroup().addTo(map);
let viewpointLayer = L.featureGroup().addTo(map);
let floraLayer = L.featureGroup().addTo(map);

map.on("rotatestart", function () {
  isFollowingHeading = false;
  document.querySelector(".compass-btn")?.classList.remove("active");
});

map.on("dragstart", function (e) {
  // ยกเลิกการติดตาม เฉพาะตอนที่ผู้ใช้ใช้นิ้วลากแผนที่เองเท่านั้น
  if (e.originalEvent) {
    isTracking = false;
    document.querySelector(".gps-btn")?.classList.remove("active");

    if (typeof watchPositionId !== "undefined" && watchPositionId) {
      navigator.geolocation.clearWatch(watchPositionId);
      watchPositionId = null;
    }
  }
});
userMarker = L.marker(currentPos, {
  draggable: true,
  zIndexOffset: 1000,
  icon: L.divIcon({
    className: "custom-user-icon",
    html: '<div class="user-dot"></div>',
    iconSize: [20, 20],
  }),
}).addTo(map);

userMarker.on("dragstart", function () {
  isTracking = false;
  isSimulating = true;
  document.querySelector(".gps-btn")?.classList.remove("active");
});

userMarker.on("drag", function (e) {
  const newPos = e.target.getLatLng();
  currentPos = [newPos.lat, newPos.lng];

  if (typeof trackDistance === "function") trackDistance(newPos);

  autoRouteSwitch();
  checkAutoPopup();
  checkNearbyViewpoints();
  checkNearbyFlora();
});

userMarker.on("dragend", function (e) {
  map.panTo(currentPos);
});

function saveMapState() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const mapState = { lat: center.lat, lng: center.lng, zoom: zoom };
  localStorage.setItem("mapState", JSON.stringify(mapState));
}

map.on("click", function (e) {
  isTracking = false;
  isSimulating = true;
  currentPos = [e.latlng.lat, e.latlng.lng];
  userMarker.setLatLng(currentPos);
  trackDistance(e.latlng);

  document.querySelector(".gps-btn")?.classList.remove("active");

  // L.popup()
  //   .setLatLng(e.latlng)
  //   .setContent(
  //     `
  //     <div style="text-align: center; font-family: 'Prompt', sans-serif;">
  //         "lat": ${e.latlng.lat.toFixed(5)},<br>
  //         "lng": ${e.latlng.lng.toFixed(5)},
  //     </div>
  //     `,
  //   )
  //   .openOn(map);

  autoRouteSwitch();
  checkAutoPopup();
  checkNearbyViewpoints();
  checkNearbyFlora();
  checkRouteCompletion(e.latlng.lat, e.latlng.lng);
});

/* =========================================
   3. CORE FUNCTIONS (COMPASS & SENSORS)
   ========================================= */
function getShortestAngle(from, to) {
  let diff = to - from;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}
function normalizeHeading(heading) {
  if (heading == null) return 0;
  let normalized = heading % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

/**
 * ฟังก์ชันหมุนไอคอน User Marker
 * @param {number} heading - องศาที่ต้องการหมุน
 */
function rotateUserMarker(heading) {
  if (!userMarker) return;

  const markerElement = userMarker.getElement();
  if (!markerElement) return;

  const innerIcon = markerElement.querySelector(".user-dot");
  if (innerIcon) {
    innerIcon.style.transition =
      "transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)";
    innerIcon.style.transform = `rotate(${heading}deg)`;
  }
}

/**
 * ฟังก์ชันหมุนไอคอนปุ่มเข็มทิศ
 */
function rotateCompassButton(heading) {
  const compassBtn = document.querySelector(".compass-btn i");
  if (compassBtn) {
    compassBtn.style.transition = "transform 0.5s ease-out";
    compassBtn.style.transform = `rotate(${heading}deg)`;
  }
}

/**
 * ฟังก์ชันจัดการค่าเข็มทิศ (Handler หลัก)
 */
compassHandler = function (event) {
  if (!compassActive) return;

  let heading = event.alpha || event.webkitCompassHeading;

  // iOS ใช้ webkitCompassHeading (0 = เหนือ, 90 = ตะวันออก)
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
  }
  // Android ใช้ alpha (ต้องกลับทิศ)
  else if (event.alpha !== undefined && event.alpha !== null) {
    heading = 360 - event.alpha;
  }

  if (heading == null) return;

  heading = normalizeHeading(heading);

  // กรองค่าที่เปลี่ยนแปลงน้อยกว่า 2 องศา (ป้องกันสั่น)
  if (Math.abs(heading - lastCompassHeading) < 2) return;

  lastCompassHeading = heading;

  // ✅ สำคัญ: หมุน User Marker กลับทิศ → ลูกศรชี้เหนือเสมอ
  rotateUserMarker(-heading);

  // หมุนไอคอนปุ่มเข็มทิศ (กลับทิศ)
  rotateCompassButton(-heading);
};

/**
 * ฟังก์ชันเปิด/ปิดเข็มทิศ (ปุ่มหลัก)
 */
async function toggleCompass() {
  const compassBtn = document.querySelector(".compass-btn");

  // ========================================
  // 🔴 กรณีที่ 1: กำลังเปิดอยู่ → ต้องการปิด
  // ========================================
  if (compassActive) {
    // ลบ Event Listener ทั้งหมด
    window.removeEventListener("deviceorientation", compassHandler, true);
    window.removeEventListener(
      "deviceorientationabsolute",
      compassHandler,
      true,
    );

    // ปิดสถานะ
    compassActive = false;
    compassBtn?.classList.remove("active");

    // ✅ รีเซ็ตมุม User Marker กลับเป็น 0° (ชี้ขึ้นบนตามค่าเริ่มต้น)
    const markerElement = userMarker?.getElement();
    if (markerElement) {
      const innerIcon = markerElement.querySelector(".user-dot");
      if (innerIcon) {
        innerIcon.style.transform = "rotate(0deg)";
      }
    }

    // ✅ รีเซ็ตมุมปุ่มเข็มทิศ
    const compassBtnIcon = document.querySelector(".compass-btn i");
    if (compassBtnIcon) {
      compassBtnIcon.style.transform = "rotate(0deg)";
    }

    showNotification("🧭 ปิดเข็มทิศแล้ว");
    return;
  }

  // ========================================
  // 🟢 กรณีที่ 2: กำลังปิดอยู่ → ต้องการเปิด
  // ========================================

  try {
    // ฟังก์ชันเปิดการฟังเซนเซอร์ (Android / เบราว์เซอร์ทั่วไป)
    const listenSensor = () => {
      if ("ondeviceorientationabsolute" in window) {
        window.addEventListener(
          "deviceorientationabsolute",
          compassHandler,
          true,
        );
      } else {
        window.addEventListener("deviceorientation", compassHandler, true);
      }
    };
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      // ต้องขอ Permission ก่อน (iOS และบางเบราว์เซอร์)
      let permission = "denied";
      try {
        permission = await DeviceOrientationEvent.requestPermission();
      } catch (e) {
        permission = "denied";
      }

      if (permission === "granted") {
        window.addEventListener("deviceorientation", compassHandler, true);
      } else if (!isIOS && "ondeviceorientationabsolute" in window) {
        // ไม่ใช่ iOS: ลองฟังเซนเซอร์ต่อ ไม่ต้องรอ permission
        listenSensor();
      } else {
        alert(
          isIOS
            ? "❌ กรุณาอนุญาตการใช้เข็มทิศในการตั้งค่า Safari\n\nSettings → Safari → Motion & Orientation Access → เปิด"
            : "❌ เบราว์เซอร์ไม่อนุญาตให้ใช้เซนเซอร์ทิศทาง\n\nเปิดสิทธิ์ Motion sensors ของเว็บไซต์นี้ในการตั้งค่าเบราว์เซอร์ หรือลองใช้ Chrome",
        );
        return;
      }
    } else {
      // Android / Desktop: ใช้ได้เลย
      listenSensor();
    }

    // เปิดสถานะ
    compassActive = true;
    compassBtn?.classList.add("active");
    showNotification("🧭 เข็มทิศเปิดใช้งานแล้ว - ลูกศรจะชี้ทิศเหนือเสมอ");
  } catch (error) {
    alert("❌ ไม่สามารถเปิดเข็มทิศได้\n" + error.message);
  }
}

function initCompass() {
  return Promise.resolve(false);
}
function averageAngles(angles) {
  let x = 0,
    y = 0;
  angles.forEach((angle) => {
    const rad = (angle * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  });
  x /= angles.length;
  y /= angles.length;
  let avg = (Math.atan2(y, x) * 180) / Math.PI;
  if (avg < 0) avg += 360;
  return avg;
}

function lowPassFilter(newHeading) {
  headingBuffer.push(newHeading);
  if (headingBuffer.length > BUFFER_SIZE) headingBuffer.shift();
  return averageAngles(headingBuffer);
}

function applySmoothing(newHeading) {
  if (smoothedHeading === null) {
    smoothedHeading = newHeading;
    return newHeading;
  }
  let diff = newHeading - smoothedHeading;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  if (Math.abs(diff) < 1.5) return smoothedHeading;
  smoothedHeading += diff * 0.15;
  smoothedHeading = (smoothedHeading + 360) % 360;
  return smoothedHeading;
}

function updateCompassDisplay(heading) {
  const compassOverlay = document.getElementById("compass-overlay");
  const compassValue = document.getElementById("compass-value");
  if (compassOverlay && compassValue) {
    compassOverlay.style.display = "flex";
    const directions = [
      "เหนือ",
      "เหนือ-ตอ.",
      "ตะวันออกเฉียงเหนือ",
      "ตอ.-เหนือ",
      "ตะวันออก",
      "ตอ.-ใต้",
      "ตะวันออกเฉียงใต้",
      "ใต้-ตอ.",
      "ใต้",
      "ใต้-ตต.",
      "ตะวันตกเฉียงใต้",
      "ตต.-ใต้",
      "ตะวันตก",
      "ตต.-เหนือ",
      "ตะวันตกเฉียงเหนือ",
      "เหนือ-ตต.",
    ];
    const index = Math.round(heading / 22.5) % 16;
    if (directions[index]) {
      compassValue.textContent = `${directions[index]} (${heading.toFixed(0)}°)`;
    }
  }
}

let isCompassActive = false; // ตัวแปรเช็คสถานะเข็มทิศ

/* =========================================
   4. AUTO ROUTE SWITCH & TRACKING
   ========================================= */
function trackDistance(newPos) {
  const currentTime = Date.now();
  if (!lastRecordedPos) {
    lastRecordedPos = newPos;
    lastRecordedTime = currentTime;
    return;
  }

  const p1 = L.latLng(lastRecordedPos);
  const p2 = L.latLng(newPos);
  const dist = p1.distanceTo(p2);
  const timeDiff = (currentTime - lastRecordedTime) / 1000;
  const speed = timeDiff > 0 ? dist / timeDiff : 0;

  lastRecordedPos = newPos;
  lastRecordedTime = currentTime;

  if (dist > 0.5 && speed <= 3.5) {
    totalDistanceTraveled += dist;
    updateKcalDisplay();
  }
}

function autoRouteSwitch() {
  let oppositeTargets =
    currentRoute === "wellness"
      ? ["spiritual1", "spiritual2"]
      : ["wellness1", "wellness2"];

  let minDist = Infinity;
  let nearestSub = null;
  let nearestMain = null;

  oppositeTargets.forEach((key) => {
    db[key]?.forEach((p) => {
      let d = L.latLng(currentPos).distanceTo(L.latLng(p.lat, p.lng));
      if (d < minDist) {
        minDist = d;
        nearestSub = key;
        nearestMain = currentRoute === "wellness" ? "spiritual" : "wellness";
      }
    });
  });

  let distToCurrent = Infinity;
  db[currentSubRoute]?.forEach((p) => {
    let d = L.latLng(currentPos).distanceTo(L.latLng(p.lat, p.lng));
    if (d < distToCurrent) distToCurrent = d;
  });

  if (nearestSub && distToCurrent > 50 && minDist < 30) {
    if (!isPromptingRoute && !routeIgnoreCooldown) {
      showRoutePrompt(nearestMain, nearestSub);
    }
  }
}

function showRoutePrompt(newMainRoute, newSubRoute) {
  isPromptingRoute = true;
  const oldPrompt = document.getElementById("route-prompt");
  if (oldPrompt) oldPrompt.remove();

  const promptI18n = {
    th: {
      title: "เปลี่ยนเส้นทาง?",
      desc1: "ดูเหมือนคุณกำลังเดินเข้าสู่",
      desc2: "ต้องการให้ระบบเปลี่ยนแผนที่นำทางหรือไม่?",
      btnCancel: "เดินเส้นเดิม",
      btnConfirm: "เปลี่ยนเลย",
      wellness: "เส้นทางสุขภาพ",
      spiritual: "เส้นทางสายมู",
      notif: "🔄 สลับเป็น",
    },
    en: {
      title: "Change Route?",
      desc1: "It looks like you are entering the",
      desc2: "Do you want to switch the navigation map?",
      btnCancel: "Stay on Route",
      btnConfirm: "Switch Now",
      wellness: "Wellness Route",
      spiritual: "Spiritual Route",
      notif: "🔄 Switched to ",
    },
    zh: {
      title: "更改路线？",
      desc1: "您似乎正在进入",
      desc2: "您想切换导航地图吗？",
      btnCancel: "保持原路线",
      btnConfirm: "立即切换",
      wellness: "健康路线",
      spiritual: "精神路线",
      notif: "🔄 已切换至",
    },
  };

  const langData = promptI18n[currentLang] || promptI18n["th"];
  const routeNameStr =
    newMainRoute === "wellness" ? langData.wellness : langData.spiritual;

  const promptDiv = document.createElement("div");
  promptDiv.id = "route-prompt";
  promptDiv.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9998; backdrop-filter: blur(3px);"></div>
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 25px 20px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); z-index: 9999; text-align: center; width: 85%; max-width: 320px; font-family: 'Prompt', sans-serif;">
            <div style="width: 60px; height: 60px; background: #fff3e0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                <i class="fa-solid fa-map-location-dot" style="font-size: 28px; color: #e67e22;"></i>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 1.1rem; color: #333;">${langData.title}</h3>
            <p style="font-size: 0.85rem; color: #666; margin-bottom: 20px; line-height: 1.5;">${langData.desc1} <b>${routeNameStr}</b><br>${langData.desc2}</p>
            <div style="display: flex; gap: 10px; justify-content: center;">
                <button id="btn-cancel-route" style="flex: 1; padding: 12px; border-radius: 10px; border: 1px solid #ddd; background: #f8f9fa; color: #555; font-weight: 600; cursor: pointer;">${langData.btnCancel}</button>
                <button id="btn-confirm-route" style="flex: 1; padding: 12px; border-radius: 10px; border: none; background: #27ae60; color: white; font-weight: 600; cursor: pointer; box-shadow: 0 4px 10px rgba(39, 174, 96, 0.3);">${langData.btnConfirm}</button>
            </div>
        </div>
    `;
  document.body.appendChild(promptDiv);

  document.getElementById("btn-cancel-route").onclick = () => {
    promptDiv.remove();
    isPromptingRoute = false;
    routeIgnoreCooldown = true;
    setTimeout(() => {
      routeIgnoreCooldown = false;
    }, 60000);
  };

  document.getElementById("btn-confirm-route").onclick = () => {
    resetRouteSession();
    currentRoute = newMainRoute;
    currentSubRoute = newSubRoute;

    const tabWellness = document.getElementById("tab-wellness");
    const tabSpiritual = document.getElementById("tab-spiritual");
    if (tabWellness)
      tabWellness.classList.toggle("active", newMainRoute === "wellness");
    if (tabSpiritual)
      tabSpiritual.classList.toggle("active", newMainRoute === "spiritual");

    showNotification(`${langData.notif}${routeNameStr}`);
    renderUI();
    promptDiv.remove();
    isPromptingRoute = false;
  };
}

function checkAutoPopup() {
  clearTimeout(popupDebounce);
  popupDebounce = setTimeout(() => {
    const stations = db[currentSubRoute];
    if (!stations || stations.length === 0) return;

    const triggerDistance = 30; // เพิ่มจาก 20 → 30
    const closeDistance = 45;

    let nearestStation = null;
    let nearestDistance = Infinity;

    // วนจาก data โดยตรง ไม่ต้องง้อ layer
    stations.forEach((station) => {
      const dist = L.latLng(currentPos).distanceTo(
        L.latLng(station.lat, station.lng),
      );
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestStation = station;
      }
    });

    // เข้าโซน
    if (nearestDistance <= triggerDistance && nearestStation) {
      if (lastPopupId !== nearestStation.id) {
        lastPopupId = nearestStation.id;

        // เปิด popup จาก routeLayer
        routeLayer.eachLayer((layer) => {
          if (layer instanceof L.CircleMarker || layer instanceof L.Marker) {
            const latlng = layer.getLatLng();
            const d = L.latLng(latlng).distanceTo(
              L.latLng(nearestStation.lat, nearestStation.lng),
            );
            if (d < 5 && layer.getPopup()) {
              layer.openPopup();
            }
          }
        });

        const langData = nearestStation[currentLang] || nearestStation["th"];
        showNotification(`📍 ${langData.t}`);
        playNotificationSound();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }
    }

    // ออกโซน → reset
    if (nearestDistance > closeDistance) {
      if (lastPopupId !== null) {
        map.closePopup();
        lastPopupId = null;
      }
    }
  }, 300);
}

function getDistText() {
  const distTextMap = { th: "ห่างจากคุณ", en: "Distance", zh: "距离" };
  return (
    (ui && ui[currentLang] && ui[currentLang].distText) ||
    distTextMap[currentLang] ||
    distTextMap["th"]
  );
}

// =========================================
// จุดชมวิว (Viewpoints)
// =========================================
function toggleViewpoints() {
  showAllViewpoints = !showAllViewpoints;
  const btn = document.getElementById("btn-toggle-vp");

  if (showAllViewpoints) {
    btn.style.background = "#007bff";
    btn.style.color = "white";
    showNotification("👀 แสดงจุดชมวิวทั้งหมดบนแผนที่");
  } else {
    btn.style.background = "white";
    btn.style.color = "#333";
    showNotification("📍 กลับสู่โหมดแสดงเมื่อเข้าใกล้");
  }
  checkNearbyViewpoints(true);
}

const VP_VISIBLE_DIST = 20;
function checkNearbyViewpoints(forceRedraw = false) {
  if (typeof viewpointLayer === "undefined") return;

  let isPopupOpen = false;
  viewpointLayer.eachLayer((layer) => {
    if (layer.isPopupOpen()) isPopupOpen = true;
  });
  if (isPopupOpen && !forceRedraw) return;

  viewpointLayer.clearLayers();

  let allViewpoints = db.viewpoints || [];

  allViewpoints.forEach((vp, vpIndex) => {
    let distToUser = L.latLng(currentPos).distanceTo([vp.lat, vp.lng]);

    if (showAllViewpoints || distToUser <= VP_VISIBLE_DIST) {
      let vpMarker = L.circleMarker([vp.lat, vp.lng], {
        color: "#ffffff",
        fillColor: "#007bff",
        fillOpacity: 1,
        radius: showAllViewpoints ? 6 : 8,
        weight: 2,
        className: showAllViewpoints ? "" : "viewpoint-pulse",
        customType: "viewpoint",
      }).addTo(viewpointLayer);

      let currentVpLang = vp[currentLang] ? vp[currentLang] : vp["th"];
      let vpTitle =
        currentVpLang && currentVpLang.t ? currentVpLang.t : "จุดชมวิว";
      let vpDesc = currentVpLang && currentVpLang.d ? currentVpLang.d : "";

      let popupCloseHTML = `<button onclick="event.stopPropagation(); map.closePopup();" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.5); border: none; color: white; width: 26px; height: 26px; border-radius: 50%; cursor: pointer; z-index: 1000; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-xmark" style="font-size: 14px;"></i></button>`;

      let mediaHTML = "";

      if (vp.pano) {
        mediaHTML = `
            <div style="position: relative;">
                <div id="pano-vp-${vpIndex}" style="width: 100%; height: 220px; border-radius: 16px 16px 0 0; background: #000;"></div>
                ${popupCloseHTML}
            </div>`;
      } else {
        let imageList = [];
        if (vp.imgs && Array.isArray(vp.imgs) && vp.imgs.length > 0)
          imageList = vp.imgs;
        else if (vp.img && vp.img !== "") imageList = [vp.img];
        else imageList = ["https://via.placeholder.com/150x80?text=No+Image"];

        const hasMultiple = imageList.length > 1;
        const popupCarouselId = `popup-carousel-vp-${vpIndex}`;
        let popupImagesHTML = "",
          popupIndicatorsHTML = "",
          popupCounterHTML = "",
          popupButtonsHTML = "";

        imageList.forEach((img, i) => {
          popupImagesHTML += `<img 
    src="${img}" 
    alt="${vpTitle}"
    class="carousel-img ${i === 0 ? "active" : ""}" 
    loading="lazy"
    data-carousel-id="${popupCarouselId}"
    style="width: 100%; height: 220px; object-fit: cover; display: block; border-radius: 16px 16px 0 0; margin: 0; cursor: pointer;">`;
        });

        if (hasMultiple) {
          popupIndicatorsHTML =
            '<div class="carousel-indicators" style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; z-index: 100;">';
          imageList.forEach((_, i) => {
            popupIndicatorsHTML += `<span class="indicator ${i === 0 ? "active" : ""}" onclick="event.stopPropagation(); goToImage('${popupCarouselId}', ${i})" style="width: 8px; height: 8px; background: rgba(255,255,255,0.5); border-radius: 50%; cursor: pointer;"></span>`;
          });
          popupIndicatorsHTML += "</div>";
          popupCounterHTML = `<div class="carousel-counter" style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.5); color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; z-index: 100;">1/${imageList.length}</div>`;
          popupButtonsHTML = `
            <button class="carousel-btn carousel-prev" onclick="event.stopPropagation(); prevImage('${popupCarouselId}')" style="position: absolute; top: 50%; left: 5px; transform: translateY(-50%); background: rgba(0,0,0,0.3); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; z-index: 100;"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="carousel-btn carousel-next" onclick="event.stopPropagation(); nextImage('${popupCarouselId}')" style="position: absolute; top: 50%; right: 5px; transform: translateY(-50%); background: rgba(0,0,0,0.3); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; z-index: 100;"><i class="fa-solid fa-chevron-right"></i></button>`;
        }

        mediaHTML = `
            <div class="card-carousel" id="${popupCarouselId}" style="position: relative; height: 220px;">
                <div class="carousel-container" style="position: relative; overflow: hidden; border-radius: 16px 16px 0 0; height: 220px;">
                    ${popupImagesHTML}
                </div>
                ${popupCloseHTML} ${popupButtonsHTML}${popupIndicatorsHTML}${popupCounterHTML}
            </div>`;
      }

      let distText = getDistText();

      const isMobilePopup = window.innerWidth <= 768;
      const popupWidth = isMobilePopup ? "280px" : "min(320px, 90vw)";
      const textMaxHeight = isMobilePopup ? "160px" : "max-content";
      const textOverflow = isMobilePopup ? "auto" : "visible";

      vpMarker.bindPopup(
        `<div style="width: ${popupWidth};">
        ${mediaHTML}
        <div class="popup-content-padding" style="text-align: left; padding: 15px 20px; box-sizing: border-box; max-height: ${textMaxHeight}; overflow-y: ${textOverflow};">
            <b style="color:#007bff; font-size:15px; display:block; margin-bottom:4px;"><i class="fa-solid fa-camera-retro" style="font-size: 0.7em; color: #5D8AA8;"></i> ${vpTitle}</b>
            <div style="font-size:13px; color:#555; margin-bottom:8px;">${vpDesc}</div>
            <div style="text-align: center; margin-top: 10px;">
                <div style="font-size:12px; color:#fff; background:#27ae60; padding:4px 10px; border-radius:12px; display:inline-block; font-weight:600;">
                    <i class="fa-solid fa-person-walking"></i> ${distText} ~${Math.round(distToUser)} ${currentLang === "en" ? "m" : currentLang === "zh" ? "米" : "ม."}
                </div>
            </div>
        </div>
    </div>`,
        { closeButton: false, offset: L.point(0, -5), maxWidth: 350 },
      );

      vpMarker.on("click", function (e) {
        const bounds = L.latLngBounds([e.latlng]);

        map.fitBounds(bounds, {
          paddingTopLeft: [60, 120],
          paddingBottomRight: window.innerWidth <= 768 ? [10, 0] : [10, 10],
          maxZoom: map.getZoom(), // ไม่ zoom เข้าเกิน
          animate: true,
          duration: 0.8,
        });
      });

      if (vp.pano) {
        vpMarker.on("popupopen", function () {
          setTimeout(() => {
            const containerId = `pano-vp-${vpIndex}`;
            const panoContainer = document.getElementById(containerId);
            if (
              panoContainer &&
              !panoContainer.classList.contains("pnlm-container")
            ) {
              pannellum.viewer(containerId, {
                type: "equirectangular",
                panorama: vp.pano,
                autoLoad: true,
                compass: false,
                showControls: false,
                mouseZoom: false,
              });
            }
          }, 100);
        });
      }

      if (!showAllViewpoints) vpMarker.bringToFront();
      if (distToUser <= ALERT_DISTANCE) vpMarker._shouldAutoOpen = true;
    }
  });
}

// =========================================
// พันธ์ุไม้ (Flora)
// =========================================
function toggleFlora() {
  showAllFlora = !showAllFlora;
  const btn = document.getElementById("btn-toggle-flora");

  if (showAllFlora) {
    btn.style.background = "#27ae60";
    btn.style.color = "white";
    showNotification("🌿 แสดงพันธ์ุไม้ทั้งหมดบนแผนที่");
  } else {
    btn.style.background = "white";
    btn.style.color = "#333";
    showNotification("📍 กลับสู่โหมดแสดงเมื่อเข้าใกล้");
  }
  checkNearbyFlora(true);
}

const FLORA_TRIGGER_DIST = 20;
function checkNearbyFlora(forceRedraw = false) {
  if (typeof floraLayer === "undefined") return;

  let isPopupOpen = false;
  floraLayer.eachLayer((layer) => {
    if (layer.isPopupOpen()) isPopupOpen = true;
  });
  if (isPopupOpen && !forceRedraw) return;

  floraLayer.clearLayers();

  let allFlora = db.flora || [];

  allFlora.forEach((flora, floraIndex) => {
    let distToUser = L.latLng(currentPos).distanceTo([flora.lat, flora.lng]);

    if (showAllFlora || distToUser <= FLORA_TRIGGER_DIST) {
      let floraMarker = L.circleMarker([flora.lat, flora.lng], {
        color: "#ffffff",
        fillColor: "#27ae60",
        fillOpacity: 1,
        radius: showAllFlora ? 6 : 8,
        weight: 2,
        className: showAllFlora ? "" : "flora-pulse",
        customType: "flora",
      }).addTo(floraLayer);

      let currentFloraLang = flora[currentLang]
        ? flora[currentLang]
        : flora["th"];
      let floraTitle =
        currentFloraLang && currentFloraLang.t
          ? currentFloraLang.t
          : "พันธ์ุไม้";
      let floraDesc =
        currentFloraLang && currentFloraLang.d ? currentFloraLang.d : "";

      let imageList = [];
      if (flora.imgs && Array.isArray(flora.imgs) && flora.imgs.length > 0)
        imageList = flora.imgs;
      else if (flora.img && flora.img !== "") imageList = [flora.img];
      else imageList = ["https://via.placeholder.com/150x80?text=No+Image"];

      const hasMultiple = imageList.length > 1;
      const popupCarouselId = `popup-carousel-flora-${floraIndex}`;

      let popupImagesHTML = "",
        popupIndicatorsHTML = "",
        popupCounterHTML = "",
        popupButtonsHTML = "";
      let popupCloseHTML = `<button onclick="event.stopPropagation(); map.closePopup();" style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.5); border: none; color: white; width: 26px; height: 26px; border-radius: 50%; cursor: pointer; z-index: 100; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-xmark" style="font-size: 14px;"></i></button>`;

      imageList.forEach((img, i) => {
        popupImagesHTML += `<img src="${img}" alt="${floraTitle}" class="carousel-img ${i === 0 ? "active" : ""}" loading="lazy" onclick="openImageModal(this.src)" style="width: 100%; height: 220px; object-fit: cover; display: block; border-radius: 16px 16px 0 0; margin: 0;">`;
      });

      if (hasMultiple) {
        popupIndicatorsHTML =
          '<div class="carousel-indicators" style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; z-index: 100;">';
        imageList.forEach((_, i) => {
          popupIndicatorsHTML += `<span class="indicator ${i === 0 ? "active" : ""}" onclick="event.stopPropagation(); goToImage('${popupCarouselId}', ${i})" style="width: 8px; height: 8px; background: rgba(255,255,255,0.5); border-radius: 50%; cursor: pointer;"></span>`;
        });
        popupIndicatorsHTML += "</div>";
        popupCounterHTML = `<div class="carousel-counter" style="position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.5); color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; z-index: 100;">1/${imageList.length}</div>`;
        popupButtonsHTML = `
            <button class="carousel-btn carousel-prev" onclick="event.stopPropagation(); prevImage('${popupCarouselId}')" style="position: absolute; top: 50%; left: 5px; transform: translateY(-50%); background: rgba(0,0,0,0.3); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; z-index: 100;"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="carousel-btn carousel-next" onclick="event.stopPropagation(); nextImage('${popupCarouselId}')" style="position: absolute; top: 50%; right: 5px; transform: translateY(-50%); background: rgba(0,0,0,0.3); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; z-index: 100;"><i class="fa-solid fa-chevron-right"></i></button>`;
      }

      let distText = getDistText();

      const isMobilePopup = window.innerWidth <= 1024;
      const popupWidth = isMobilePopup ? "280px" : "min(320px, 90vw)";
      const imgHeight = isMobilePopup ? "180px" : "220px";
      const textMaxHeight = "160px";
      const textOverflow = "auto";

      floraMarker.bindPopup(
        `<div style="width: ${popupWidth};">
        <div class="card-carousel" id="${popupCarouselId}" style="position: relative;">
            <div class="carousel-container" style="position: relative; overflow: hidden; border-radius: 16px 16px 0 0; height: ${imgHeight};">
                ${popupImagesHTML}
            </div>
            ${popupCloseHTML} ${popupButtonsHTML}${popupIndicatorsHTML}${popupCounterHTML}
        </div>
        
        <div class="popup-content-padding" style="text-align: left; padding: 15px 20px; box-sizing: border-box; max-height: ${textMaxHeight}; overflow-y: ${textOverflow};">
            <b style="color:#27ae60; font-size:15px; display:block; margin-bottom:4px;"><i class="fa-solid fa-tree" style="font-size: 0.7em; color: #4E8A63;"></i> ${floraTitle}</b>
            <div style="font-size:13px; color:#555; margin-bottom:8px;">${floraDesc}</div>
            <div style="text-align: center; margin-top: 10px;">
                <div style="font-size:12px; color:#fff; background:#e67e22; padding:4px 10px; border-radius:12px; display:inline-block; font-weight:600;">
                    <i class="fa-solid fa-person-walking"></i> ${distText} ~${Math.round(distToUser)} ${currentLang === "en" ? "m" : currentLang === "zh" ? "米" : "ม."}
                </div>
            </div>
        </div>
    </div>`,
        { closeButton: false, offset: L.point(0, -5), maxWidth: 350 },
      );

      floraMarker.on("click", function (e) {
        const bounds = L.latLngBounds([e.latlng]);

        map.fitBounds(bounds, {
          paddingTopLeft: [60, 120],
          paddingBottomRight: window.innerWidth <= 768 ? [10, 0] : [10, 10],
          maxZoom: map.getZoom(), // ไม่ zoom เข้าเกิน
          animate: true,
          duration: 0.8,
        });
      });

      if (!showAllFlora) floraMarker.bringToFront();
      if (distToUser <= FLORA_TRIGGER_DIST) floraMarker._shouldAutoOpen = true;
    }
  });
}

function updateKcalDisplay() {
  const weight = 65;
  const distanceKm = totalDistanceTraveled / 1000;
  const totalKcal = distanceKm * weight * 0.75;
  const displayElem = document.getElementById("total-kcal-display");
  if (displayElem) displayElem.innerText = totalKcal.toFixed(1);
}

/* =========================================
   5. RENDERING (MAP & UI)
   ========================================= */
function drawRoute(routeData, routeKey, color) {
  const isActive = routeKey === currentSubRoute;
  const opacity = isActive ? 1 : 0.25;
  const list = document.getElementById("story-list");
  if (list && isActive) list.innerHTML = "";

  const weight = 65;
  const langUI = ui[currentLang] || ui["th"];

  let lineSegments = [];
  let currentSegment = [];

  routeData.forEach((s) => {
    if (s.isNewPath && currentSegment.length > 0) {
      lineSegments.push(currentSegment);
      currentSegment = [];
    }
    currentSegment.push([s.lat, s.lng]);
  });

  if (currentSegment.length > 0) {
    lineSegments.push(currentSegment);
  }

  L.polyline(lineSegments, { color: color, weight: 6, opacity: opacity }).addTo(
    routeLayer,
  );

  let cardsHTMLArray = [];

  routeData.forEach((s, stationIndex) => {
    let langData = s[currentLang];
    if (!langData || !langData.t || langData.t.trim() === "")
      langData = s["th"];

    if (s.th && s.th.t && s.th.t.trim() !== "") {
      let mColor = color,
        mRadius = 9;
      if (!Number.isInteger(s.id)) {
        mColor = "#FFD700";
        mRadius = 6.5;
      }

      let imageList = [];
      if (s.imgs && Array.isArray(s.imgs) && s.imgs.length > 0)
        imageList = s.imgs;
      else if (s.img && s.img !== "") imageList = [s.img];
      else imageList = ["https://via.placeholder.com/400x200?text=No+Image"];

      const hasMultiple = imageList.length > 1;

      // =========================================
      // 1. สร้างการ์ดด้านข้าง (Sidebar)
      // =========================================
      if (isActive && list) {
        const kcal = (3.5 * weight * 0.1).toFixed(1);
        const currentCarouselId = `card-${routeKey}-${stationIndex}`;
        let imagesHTML = "",
          indicatorsHTML = "",
          counterHTML = "",
          buttonsHTML = "";

        imageList.forEach((img, i) => {
          imagesHTML += `<img 
    src="${img}" 
    alt="${langData.t}" 
    class="carousel-img ${i === 0 ? "active" : ""}" 
    loading="lazy"
    data-carousel-id="${currentCarouselId}"
    style="cursor: pointer;">`;
        });

        if (hasMultiple && !s.pano) {
          indicatorsHTML = '<div class="carousel-indicators">';
          imageList.forEach((_, i) => {
            indicatorsHTML += `<span class="indicator ${i === 0 ? "active" : ""}" onclick="event.stopPropagation(); goToImage('${currentCarouselId}', ${i})"></span>`;
          });
          indicatorsHTML += "</div>";
          counterHTML = `<div class="carousel-counter">1/${imageList.length}</div>`;
          buttonsHTML = `
            <button class="carousel-btn carousel-prev" onclick="event.stopPropagation(); prevImage('${currentCarouselId}')"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="carousel-btn carousel-next" onclick="event.stopPropagation(); nextImage('${currentCarouselId}')"><i class="fa-solid fa-chevron-right"></i></button>`;
        }

        const translations = {
          th: {
            animal: "ข้อมูลนก",
            flora: "ข้อมูลพันธ์ุไม้",
            sacred: "สถานที่ศักดิ์สิทธิ์",
            info: "รายละเอียด",
          },
          en: {
            animal: "Bird Info",
            flora: "Plant Info",
            sacred: "Sacred Site",
            info: "Landmark Info",
          },
          zh: {
            animal: "鸟类信息",
            flora: "植物信息",
            sacred: "神圣场所",
            info: "地标信息",
          },
        };

        const langLabels = translations[currentLang] || translations["th"];

        const plantId = s.flora_id !== undefined ? s.flora_id : s.id;
        const infoPageUrl = `plant_info.html?id=${plantId}&lang=${currentLang}`;
        const showBtn = plantId !== 0;

        let btnIcon, btnText, btnColor;

        if (plantId >= 301) {
          btnIcon = "fa-info-circle";
          btnText = langLabels.info;
          btnColor = "#2980b9";
        } else if (plantId >= 201) {
          btnIcon = "fa-hands-praying";
          btnText = langLabels.sacred;
          btnColor = "#f39c12";
        } else if (plantId >= 101) {
          btnIcon = "fa-dove";
          btnText = langLabels.animal;
          btnColor = "#27ae60";
        } else {
          btnIcon = "fa-leaf";
          btnText = langLabels.flora;
          btnColor = "#27ae60";
        }

        cardsHTMLArray.push({
          id: parseFloat(s.id) || 9999,
          html: `
<div class="card"  style="border: 2px solid #d1d0d0; border-radius: 10px; overflow: hidden;" onclick="openMarkerPopupByIndex(${stationIndex}, true)" data-route="${routeKey}" data-station="${stationIndex}">
    <div class="card-carousel" id="${currentCarouselId}">
        <div class="carousel-container">${imagesHTML}</div>
        ${buttonsHTML}${indicatorsHTML}${counterHTML}
    </div>
    <div class="card-body">
        <div class="badge-container">
            <span class="badge badge-route">${routeKey.toUpperCase()}</span>
            <span class="badge badge-shade"><i class="fa-solid fa-tree"></i> ${s.shade || 0}%</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; gap: 10px; width: 100%;">
            <h3 class="card-title" style="margin: 0; text-align: left; white-space: normal; word-break: break-word; flex: 1;">${langData.t}</h3>
            ${
              showBtn
                ? `<a href="${infoPageUrl}" target="_blank" onclick="event.stopPropagation();" class="popup-btn-hover" style="display:inline-block; color:${btnColor}; text-decoration:none; font-size:13px; border:1px solid ${btnColor}; padding:4px 8px; border-radius:6px; white-space: nowrap; flex-shrink: 0;">
                <i class="fa-solid ${btnIcon}"></i> ${btnText}</a>`
                : ""
            }
        </div>
    </div>
</div>`,
        });
      }

      // =========================================
      // 2. สร้าง Popup ในแผนที่ (เช็ค Pano vs รูปปกติ)
      // =========================================
      const popupCarouselId = `popup-carousel-${routeKey}-${stationIndex}`;
      const panoContainerId = `pano-${routeKey}-${stationIndex}`;
      let popupMediaHTML = "";

      if (s.pano) {
        popupMediaHTML = `
            <div style="position: relative; height: 160px; border-radius: 20px 20px 0 0; overflow: hidden; background: #000;">
                <div id="${panoContainerId}" style="width: 100%; height: 100%;"></div>
            </div>`;
      } else {
        let popupImagesHTML = "",
          popupIndicatorsHTML = "",
          popupCounterHTML = "",
          popupButtonsHTML = "";
        imageList.forEach((img, i) => {
          popupImagesHTML += `<img 
    src="${img}" 
    alt="${langData.t}" 
    class="carousel-img ${i === 0 ? "active" : ""}" 
    loading="lazy"
    data-carousel-id="${popupCarouselId}"
    style="width: 100%; height: 220px; object-fit: cover; display: block; border-radius: 16px 16px 0 0; margin: 0; cursor: pointer;">`;
        });

        if (hasMultiple) {
          popupIndicatorsHTML = '<div class="carousel-indicators">';
          imageList.forEach((_, i) => {
            popupIndicatorsHTML += `<span class="indicator ${i === 0 ? "active" : ""}" onclick="event.stopPropagation(); goToImage('${popupCarouselId}', ${i})"></span>`;
          });
          popupIndicatorsHTML += "</div>";
          popupCounterHTML = `<div class="carousel-counter">1/${imageList.length}</div>`;
          popupButtonsHTML = `
            <button class="carousel-btn carousel-prev" onclick="event.stopPropagation(); prevImage('${popupCarouselId}')"><i class="fa-solid fa-chevron-left"></i></button>
            <button class="carousel-btn carousel-next" onclick="event.stopPropagation(); nextImage('${popupCarouselId}')"><i class="fa-solid fa-chevron-right"></i></button>`;
        }

        popupMediaHTML = `
          <div class="card-carousel" id="${popupCarouselId}" style="height: 160px; border-radius: 20px 20px 0 0;">
              <div class="carousel-container">${popupImagesHTML}</div>
              ${popupButtonsHTML}${popupIndicatorsHTML}${popupCounterHTML}
          </div>`;
      }
      const translations = {
        th: {
          animal: "ข้อมูลนก/เรื่องเล่า",
          flora: "ข้อมูลพันธ์ุไม้/เรื่องเล่า",
          sacred: "สถานที่ศักดิ์สิทธิ์/เรื่องเล่า",
          info: "รายละเอียด/เรื่องเล่า",
        },
        en: {
          animal: "Bird Info/Story",
          flora: "Plant Info/Story",
          sacred: "Sacred Site/Story",
          info: "Landmark Info/Story",
        },
        zh: {
          animal: "鸟类信息/故事",
          flora: "植物信息/故事",
          sacred: "神圣场所/故事",
          info: "地标信息/故事",
        },
      };

      const langLabels = translations[currentLang] || translations["th"];

      const plantId = s.flora_id !== undefined ? s.flora_id : s.id;
      const infoPageUrl = `plant_info.html?id=${plantId}&lang=${currentLang}`;
      const showBtn = plantId !== 0;

      let btnIcon, btnText, btnColor;

      if (plantId >= 301) {
        btnIcon = "fa-info-circle";
        btnText = langLabels.info;
        btnColor = "#2980b9";
      } else if (plantId >= 201) {
        btnIcon = "fa-hands-praying";
        btnText = langLabels.sacred;
        btnColor = "#f39c12";
      } else if (plantId >= 101) {
        btnIcon = "fa-dove";
        btnText = langLabels.animal;
        btnColor = "#27ae60";
      } else {
        btnIcon = "fa-leaf";
        btnText = langLabels.flora;
        btnColor = "#27ae60";
      }
      const descStyle =
        currentLang === "th"
          ? "text-align: justify; text-indent: 18px;"
          : "text-align: left; text-indent: 18px;";

      const marker = L.circleMarker([s.lat, s.lng], {
        color: mColor,
        opacity: opacity,
        fillColor: "#fff",
        fillOpacity: opacity,
        radius: mRadius,
        weight: 4,
      })
        .addTo(routeLayer)
        .bindPopup(
          `
          ${popupMediaHTML}
          <div class="popup-content-padding" style="max-height: 160px; overflow-y: auto;">

              <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                  <div class="popup-title" style="margin: 0 0 5px 0; line-height: 1.3; text-align: left; white-space: normal; word-break: break-word; flex: 1;">${langData.t}</div>
              </div>

              <div class="popup-desc" style="${descStyle}">${langData.d || ""}</div>
              ${
                showBtn
                  ? `<a href="${infoPageUrl}" target="_blank" onclick="event.stopPropagation();" class="popup-btn-hover" style="display:flex; align-items:center; gap:5px; color:${btnColor}; background-color: ${btnColor}33; text-decoration:none; font-size:12px; margin-top: 5px; border:1px solid ${btnColor}; padding:4px 8px; border-radius:6px; white-space: nowrap; width: fit-content;">
                          <i class="fa-solid ${btnIcon}"></i> ${btnText}
                         </a>`
                  : ""
              }
          </div>
          `,
          { autoPan: false, closeButton: true },
        );

      // =========================================
      // 3. กำหนดการทำงานตอนกดเปิด Popup
      // =========================================
      marker.on("popupopen", function () {
        if (s.pano) {
          setTimeout(() => {
            const panoContainer = document.getElementById(panoContainerId);
            if (
              panoContainer &&
              !panoContainer.classList.contains("pnlm-container")
            ) {
              pannellum.viewer(panoContainerId, {
                type: "equirectangular",
                panorama: s.pano,
                autoLoad: true,
                compass: false,
                showControls: false,
                mouseZoom: false,
                whiteSpace: "normal",
              });
            }
          }, 100);
        } else {
          setTimeout(() => initCarousels(), 50);
        }
      });

      marker.on("click", function () {
        const isMobile = window.innerWidth <= 1024;
        const mainPanel = document.getElementById("story-panel");
        const isHidden = mainPanel
          ? mainPanel.classList.contains("sidebar-hidden")
          : false;

        // ✅ ปรับ Padding ให้ Marker ขึ้นด้านบน
        const padTop = isMobile ? [10, 200] : [50, 120]; // เพิ่มค่าตัวที่ 2
        const padBottom = isMobile
          ? [10, isHidden ? 80 : 250]
          : [isHidden ? 50 : 50, 50];

        map.flyToBounds(L.latLngBounds([s.lat, s.lng], [s.lat, s.lng]), {
          paddingTopLeft: padTop,
          paddingBottomRight: padBottom,
          maxZoom: 17,
          animate: true,
          duration: 0.8,
        });

        const cardEl = document.querySelector(
          `.card[data-route="${routeKey}"][data-station="${stationIndex}"]`,
        );
        const scrollPanel = document.querySelector(".panel-content");
        if (cardEl && scrollPanel) {
          setTimeout(() => {
            scrollPanel.scrollTo({
              top:
                cardEl.offsetTop -
                scrollPanel.offsetTop -
                (isMobile ? 90 : 140),
              behavior: "smooth",
            });
            document.querySelectorAll(".card").forEach((c) => {
              c.style.border = "1px solid rgba(255,255,255,0.8)";
              c.style.boxShadow = "0 4px 15px rgba(0,0,0,0.05)";
            });
            cardEl.style.transition = "all 0.3s ease";
            cardEl.style.border = "2px solid var(--wellness)";
            cardEl.style.boxShadow = "0 0 20px rgba(39, 174, 96, 0.4)";
          }, 150);
        }
      });
    }
  });

  if (isActive && list) {
    list.innerHTML = cardsHTMLArray
      .sort((a, b) => a.id - b.id)
      .map((card) => card.html)
      .join("");
  }
  setTimeout(() => initCarousels(), 100);
}
// =========================================
// ð¤ï¸ WEATHER ADVICE (Real API + Time Fallback)
// =========================================

/**
 * @param {object} langUI
 * @param {object|null} weather
 */
function _applyWeatherAdvice(langUI, weather) {
  const advText = document.getElementById("adv-text");
  const advisory = document.querySelector(".advisory");
  if (!langUI || !advText) return;

  const hour = new Date().getHours();
  let advice = "";
  let color = "";

  if (weather) {
    const { isRaining, tempC, isNight } = weather;

    if (isRaining) {
      advice = langUI.advise_rain;
      color = "#1565c0";
    } else if (isNight || hour >= 19 || hour < 6) {
      advice = langUI.advise_night;
      color = "#9b59b6";
    } else if (tempC >= 35) {
      advice = langUI.advise_veryhot;
      color = "#c0392b";
    } else if (tempC >= 30) {
      advice = langUI.advise_hot;
      color = "#e67e22";
    } else {
      advice = langUI.advise_cool;
      color = "#2e7d32";
    }
  } else {
    if (hour >= 19 || hour < 6) {
      advice = langUI.advise_night;
      color = "#9b59b6";
    } else if (hour >= 11 && hour <= 15) {
      advice = langUI.advise_hot;
      color = "#e67e22";
    } else {
      advice = langUI.advise_cool;
      color = "#2e7d32";
    }
  }

  advText.innerHTML = advice;

  if (advisory) {
    advisory.style.background = `linear-gradient(330deg, color-mix(in srgb, ${color} 70%, transparent) 10%, ${color} 80%)`;
    advisory.style.boxShadow = `0 2px 8px ${color}`;
    // advText.style.color = color;
  }
}

let cachedWeather = undefined; // undefined = ยังไม่เคยโหลด, null = โหลดแล้วแต่ใช้ fallback

async function updateWeatherAdvice(langUI) {
  const advText = document.getElementById("adv-text");
  if (!langUI || !advText) return;

  // ถ้าโหลด weather แล้ว แค่ re-apply ด้วยภาษาใหม่
  if (cachedWeather !== undefined) {
    _applyWeatherAdvice(langUI, cachedWeather);
    return;
  }

  if (!currentPos || currentPos.length < 2) {
    cachedWeather = null;
    _applyWeatherAdvice(langUI, null);
    return;
  }

  advText.innerText = "กำลังโหลด ...";

  const [lat, lng] = currentPos;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,precipitation,is_day` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const current = data.current;

    cachedWeather = {
      tempC: current.temperature_2m,
      isRaining: current.precipitation > 0.1,
      isNight: current.is_day === 0,
    };

    console.log("สภาพอากาศ (real):", cachedWeather);
    _applyWeatherAdvice(langUI, cachedWeather);
  } catch (err) {
    console.warn("สภาพอากาศ (fallback):", err.message);
    cachedWeather = null;
    _applyWeatherAdvice(langUI, null);
  }
}
function renderUI() {
  routeLayer.clearLayers();

  if (Object.keys(db).length === 0 || Object.keys(ui).length === 0) return;
  const langUI = ui[currentLang] || ui["th"];
  updateWeatherAdvice(langUI);
  document
    .querySelectorAll("[data-i18n], [data-i18n-title]")
    .forEach((element) => {
      if (element.hasAttribute("data-i18n")) {
        const key = element.getAttribute("data-i18n");
        const text = langUI[key];
        if (text) {
          if (element.tagName === "TITLE") document.title = text;
          else element.innerHTML = text;
        }
      }
      if (element.hasAttribute("data-i18n-title")) {
        const keyTitle = element.getAttribute("data-i18n-title");
        const textTitle = langUI[keyTitle];
        if (textTitle) {
          element.title = textTitle;
        }
      }
    });

  const logoEl = document.getElementById("header-logo");
  if (logoEl)
    logoEl.innerHTML = `<i class="fa-solid fa-leaf" style="color: #ffffff;"></i>
    <a href="../view/intro.html" onclick="event.stopPropagation();" class="logo-text">
        ${langUI.logo || "Mangrove Smart StoryMap"}
    </a>`;

  if (document.getElementById("lbl-weight"))
    document.getElementById("lbl-weight").innerText = langUI.weight;
  if (document.getElementById("lbl-kg"))
    document.getElementById("lbl-kg").innerText = langUI.kg;

  if (document.getElementById("tab-w-text"))
    document.getElementById("tab-w-text").innerText = langUI.tab_w;
  if (document.getElementById("tab-f-text"))
    document.getElementById("tab-f-text").innerText = langUI.tab_f;
  if (document.getElementById("lbl-total-kcal"))
    document.getElementById("lbl-total-kcal").innerText = langUI.kcal;

  updateKcalDisplay();

  if (currentRoute === "wellness") {
    if (db.wellness1) drawRoute(db.wellness1, "wellness1", "#27ae60");
    if (db.wellness2) drawRoute(db.wellness2, "wellness2", "#27ae60");
  } else {
    if (db.spiritual1) drawRoute(db.spiritual1, "spiritual1", "#b8860b");
    if (db.spiritual2) drawRoute(db.spiritual2, "spiritual2", "#b8860b");
  }
}

function setRoute(r) {
  resetRouteSession();
  if (currentRoute === r) {
    if (r === "wellness")
      currentSubRoute =
        currentSubRoute === "wellness1" ? "wellness2" : "wellness1";
    else if (r === "spiritual")
      currentSubRoute =
        currentSubRoute === "spiritual1" ? "spiritual2" : "spiritual1";

    const routeNames = {
      wellness1: "เส้นทางที่ 1",
      wellness2: "เส้นทางที่ 2",
      spiritual1: "เส้นทางที่ 1",
      spiritual2: "เส้นทางที่ 2",
    };
    showNotification(`🔄 สลับเป็นเส้นทาง: ${routeNames[currentSubRoute]}`);
  } else {
    currentRoute = r;
    currentSubRoute = r === "wellness" ? "wellness1" : "spiritual1";
    showNotification(
      `📍 เปลี่ยนโหมดเป็น: ${r === "wellness" ? "เส้นทางสุขภาพ" : "เส้นทางสายมู"}`,
    );
  }

  document
    .getElementById("tab-wellness")
    ?.classList.toggle("active", currentRoute === "wellness");
  document
    .getElementById("tab-spiritual")
    ?.classList.toggle("active", currentRoute === "spiritual");

  renderUI();

  if (db[currentSubRoute] && db[currentSubRoute].length > 0) {
    const startPos = db[currentSubRoute][0];
    const offsetLat = startPos.lat - 0.003;
    map.flyTo([offsetLat, startPos.lng], 16, { duration: 1.0 });
  }
}

function changeLang(lang) {
  const mapLang = getGoogleMapLang(lang);
  const region = lang === "en" ? "US" : lang === "zh" ? "CN" : "TH";

  if (!ui || !ui[lang]) {
    return;
  }

  currentLang = lang;
  localStorage.setItem("selectedLang", lang);

  if (typeof map !== "undefined") map.closePopup();

  renderUI();

  const newUrl = `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=${mapLang}&gl=${region}&sbc=1`;
  street.setUrl(newUrl);

  if (satellite) {
    const satUrl = `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=${mapLang}&gl=${region}&sbc=1`;
    satellite.setUrl(satUrl);
  }

  if (typeof checkNearbyViewpoints === "function") checkNearbyViewpoints();

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.id === `btn-${lang}`);
  });
}

function getGoogleMapLang(lang) {
  if (lang === "zh") return "zh-CN";
  if (lang === "en") return "en-US";
  return "th-TH";
}

/* =========================================
   6. GPS & PERMISSIONS  (v2: filtered + smoothed)
   ========================================= */
let lastCheckPos = null;

// ---------- ค่าปรับแต่ง ----------
const GPS_CFG = {
  MAX_ACCURACY: 10, // ทิ้งพิกัดที่ accuracy เกิน 10 ม. (เดิม 100)
  MAX_SPEED: 8, // ม./วินาที เกินนี้ถือว่ากระโดด (คนเดินปกติ ~1.4)
  Q_METERS_PER_SEC: 3, // ความไวของ Kalman: ยิ่งมาก ยิ่งตามเร็วแต่สั่นมากขึ้น
  DEADBAND_M: 1.5, // ขยับน้อยกว่านี้ไม่อัปเดตจุด (กันจุดสั่นตอนยืนนิ่ง)
  FOLLOW_THRESHOLD_M: 8, // เลื่อนแผนที่ตามเมื่อจุดห่างจากกลางจอเกินนี้
  STALE_MS: 30000, // ไม่มีข้อมูลเกินนี้ถึงจะ restart watch
  SNAP_ENABLED: true, // เปิด/ปิด snap-to-route
  SNAP_MIN_M: 12, // รัศมี snap ขั้นต่ำ (ม.)
  SNAP_MAX_M: 30, // รัศมี snap สูงสุด (ม.) ไกลกว่านี้ถือว่าออกนอกเส้นทาง
  DR_ENABLED: true, // เปิด/ปิดโหมดเดินต่อเองตอนสัญญาณหาย
  DR_START_MS: 3000, // ไม่มีพิกัดดีเกินนี้ ถือว่าสัญญาณหาย แล้วเริ่มเดินต่อเอง
  DR_MAX_MS: 20000, // เดินต่อเองได้นานสุด (หลังจากนั้นหยุดรอสัญญาณ)
  DR_MAX_M: 25, // เดินต่อเองได้ไกลสุด (ม.)
  DR_SPEED_FACTOR: 1.0, // เดินช้ากว่าความเร็วจริงที่ประเมินได้ (0.6 = 60%)
  DR_MAX_SPEED: 1.5, // เพดานความเร็วตอนเดินต่อเอง (ม./วินาที)
  DR_MIN_SPEED: 0.4, // ถ้าก่อนสัญญาณหายเดินช้ากว่านี้ ถือว่ายืนอยู่ ไม่เดินต่อ
};

// ---------- สถานะภายใน ----------
let kf = null; // {lat, lng, variance, ts}
let lastAccepted = null; // {lat, lng, ts}
let spikeCount = 0;
let firstFixDone = false;
let gpsAccuracyCircle = null;
let renderPos = null;
let targetPos = null;
let markerRaf = null;
let wakeLock = null;
let drState = null; // {key, pathIdx, fixS, fixTs, v, s, drDist}
let drTimer = null;
let lastFixAcceptedAt = 0;
let lastAcc = 10;
let signalLost = false;
let drMoved = false;

// ---------- Kalman filter (แบบ 1 มิติต่อแกน ถ่วงน้ำหนักด้วย accuracy) ----------
function kalmanUpdate(lat, lng, accuracy, ts) {
  const acc = Math.max(accuracy, 1);
  if (!kf) {
    kf = { lat, lng, variance: acc * acc, ts };
    return kf;
  }
  const dt = ts - kf.ts;
  if (dt > 0) {
    kf.variance += (dt * GPS_CFG.Q_METERS_PER_SEC * GPS_CFG.Q_METERS_PER_SEC) / 1000;
    kf.ts = ts;
  }
  const K = kf.variance / (kf.variance + acc * acc);
  kf.lat += K * (lat - kf.lat);
  kf.lng += K * (lng - kf.lng);
  kf.variance = (1 - K) * kf.variance;
  return kf;
}

// ---------- Glide: จุดบนจอเลื่อนต่อเนื่องตามเส้นทาง (s = ระยะตามเส้น) ----------
const GLIDE_CFG = {
  GAIN: 1.0, // 1/วินาที: ดึงจุดเข้าหาค่าที่วัดได้ (มาก = ตามเร็วแต่กระตุกขึ้น)
  MAX_V: 4, // ม./วินาที ความเร็วสูงสุดของจุดบนจอ
  LEAD_MS: 3000, // คาดการณ์ล่วงหน้าด้วยความเร็วได้นานสุด (หลังจากนั้นให้ DR ทำงาน)
  RESET_M: 40, // ห่างจากจุดที่แสดงเกินนี้ให้ข้ามไปเลย ไม่เลื่อน
};
let glide = null; // {key, pathIdx, s, tgt, vt, tgtT, last}

// มีพิกัดใหม่ (หรือ dead reckoning): ตั้งเป้าหมายตามเส้นทาง คืน true ถ้าใช้ glide ได้
function glideSetTarget(key, pathIdx, along, vt, now) {
  if (
    !glide ||
    glide.key !== key ||
    glide.pathIdx !== pathIdx ||
    Math.abs(along - glide.s) > GLIDE_CFG.RESET_M
  ) {
    glide = { key, pathIdx, s: along, tgt: along, vt: 0, tgtT: now, last: now };
  }
  glide.tgt = along;
  glide.vt = vt;
  glide.tgtT = now;
  return true;
}

// คืน [lat, lng] ของจุดที่แสดง ณ เวลา now (เรียกทุกเฟรม)
function glideStep(now) {
  const g = glide;
  const path = buildRoute(g.key).paths[g.pathIdx];
  const dt = Math.min(Math.max((now - g.last) / 1000, 0), 0.1);
  g.last = now;
  const lead = Math.min(now - g.tgtT, GLIDE_CFG.LEAD_MS) / 1000;
  const err = g.tgt + g.vt * lead - g.s;
  const v = Math.max(-GLIDE_CFG.MAX_V, Math.min(GLIDE_CFG.MAX_V, g.vt + GLIDE_CFG.GAIN * err));
  const total = path.cum[path.cum.length - 1];
  g.s = Math.max(0, Math.min(total, g.s + v * dt));
  g.settled = Math.abs(err) < 0.05 && (g.vt === 0 || now - g.tgtT > GLIDE_CFG.LEAD_MS);
  return pointAtS(path, g.s);
}

// ---------- ทำให้จุดเลื่อนนุ่ม ไม่กระโดด ----------
function animateMarker() {
  if (glide && isSimulating) glide = null; // โหมดจำลอง/ลากจุดเอง: ไม่ใช้ glide
  if (glide && userMarker) {
    const p = glideStep(Date.now());
    renderPos = [p[0], p[1]];
    userMarker.setLatLng(renderPos);
    markerRaf = glide.settled ? null : requestAnimationFrame(animateMarker);
    return;
  }
  if (!targetPos || !userMarker) return;
  if (!renderPos) renderPos = [targetPos[0], targetPos[1]];
  renderPos[0] += (targetPos[0] - renderPos[0]) * 0.25;
  renderPos[1] += (targetPos[1] - renderPos[1]) * 0.25;
  userMarker.setLatLng(renderPos);
  const done =
    Math.abs(targetPos[0] - renderPos[0]) < 1e-8 &&
    Math.abs(targetPos[1] - renderPos[1]) < 1e-8;
  markerRaf = done ? null : requestAnimationFrame(animateMarker);
}
function moveMarkerSmooth(lat, lng) {
  targetPos = [lat, lng];
  if (!markerRaf) markerRaf = requestAnimationFrame(animateMarker);
}

function updateAccuracyCircle(lat, lng, accuracy) {
  if (!gpsAccuracyCircle) {
    gpsAccuracyCircle = L.circle([lat, lng], {
      radius: accuracy,
      weight: 1,
      color: "#4285F4",
      fillColor: "#4285F4",
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map);
  } else {
    gpsAccuracyCircle.setLatLng([lat, lng]);
    gpsAccuracyCircle.setRadius(accuracy);
  }
}

// ---------- Snap-to-route (Map Matching) ----------
const SNAP_ROUTE_KEYS = ["wellness1", "wellness2", "spiritual1", "spiritual2"];
let snapCache = { src: null, routes: {} };

function metersBetween(alat, alng, blat, blng) {
  const mLat = 110540;
  const mLng = 111320 * Math.cos((((alat + blat) / 2) * Math.PI) / 180);
  return Math.hypot((blng - alng) * mLng, (blat - alat) * mLat);
}

// แปลง waypoint เป็น "ทางเดิน" (paths) + ช่วงเส้นตรง (segs) เคารพ isNewPath เหมือน drawRoute
function buildRoute(key) {
  if (snapCache.src !== db) snapCache = { src: db, routes: {} };
  if (snapCache.routes[key]) return snapCache.routes[key];
  const pts = (db && db[key]) || [];
  const paths = [];
  const segs = [];
  let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.lat == null || p.lng == null) {
      cur = null;
      continue;
    }
    if (!cur || p.isNewPath) {
      cur = { pts: [[p.lat, p.lng]], cum: [0] };
      paths.push(cur);
      continue;
    }
    const prev = cur.pts[cur.pts.length - 1];
    const len = metersBetween(prev[0], prev[1], p.lat, p.lng);
    const cumStart = cur.cum[cur.cum.length - 1];
    segs.push([prev[0], prev[1], p.lat, p.lng, paths.length - 1, cumStart, len]);
    cur.pts.push([p.lat, p.lng]);
    cur.cum.push(cumStart + len);
  }
  return (snapCache.routes[key] = { segs, paths });
}

// พิกัดที่ระยะ s เมตรจากจุดเริ่มของ path
function pointAtS(path, s) {
  const { pts, cum } = path;
  s = Math.max(0, Math.min(s, cum[cum.length - 1]));
  for (let i = 1; i < cum.length; i++) {
    if (s <= cum[i]) {
      const len = cum[i] - cum[i - 1];
      const t = len > 0 ? (s - cum[i - 1]) / len : 0;
      return [
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ];
    }
  }
  return pts[pts.length - 1];
}

// หาจุดบนเส้นที่ใกล้ที่สุด (ฉายจุดลงบนส่วนของเส้นตรงในระนาบเมตรท้องถิ่น)
function nearestOnSegments(lat, lng, segs) {
  const mLat = 110540;
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  let best = null;
  for (const [alat, alng, blat, blng, pathIdx, cumStart, segLen] of segs) {
    const ax = (alng - lng) * mLng,
      ay = (alat - lat) * mLat;
    const bx = (blng - lng) * mLng,
      by = (blat - lat) * mLat;
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx,
      py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (!best || d < best.d) {
      best = {
        d,
        lat: lat + py / mLat,
        lng: lng + px / mLng,
        pathIdx,
        along: cumStart + t * segLen,
      };
    }
  }
  return best;
}

// ดึงจุดเข้าหาเส้นทาง: ใกล้มาก = ดูดเต็ม, ไกลขึ้น = ดูดน้อยลง, เกินรัศมี = ไม่ดูด
function snapToRoute(lat, lng, accuracy) {
  if (!GPS_CFG.SNAP_ENABLED || !db) return { lat, lng, snapped: false };
  const radius = Math.min(
    Math.max(accuracy * 1.5, GPS_CFG.SNAP_MIN_M),
    GPS_CFG.SNAP_MAX_M,
  );
  // ลองเส้นทางปัจจุบันก่อน (กันกระโดดไปเส้นขนาน) แล้วค่อยลองเส้นอื่น
  const keys = [
    currentSubRoute,
    ...SNAP_ROUTE_KEYS.filter((k) => k !== currentSubRoute),
  ];
  for (const key of keys) {
    const segs = buildRoute(key).segs;
    if (!segs.length) continue;
    const n = nearestOnSegments(lat, lng, segs);
    if (n && n.d <= radius) {
      const strength = n.d <= radius * 0.5 ? 1 : (radius - n.d) / (radius * 0.5);
      return {
        lat: lat + (n.lat - lat) * strength,
        lng: lng + (n.lng - lng) * strength,
        snapped: true,
        dist: n.d,
        key,
        pathIdx: n.pathIdx,
        along: n.along,
      };
    }
  }
  return { lat, lng, snapped: false };
}

// ---------- Dead reckoning: เดินต่อเองตามเส้นทางตอนสัญญาณหาย ----------
// ประเมินความเร็วตามแนวเส้นทาง (ม./วินาที, มีเครื่องหมาย = ทิศทาง) จากพิกัดจริงที่ผ่านมา
function updateDrState(sn, ts) {
  if (!sn.snapped) {
    drState = null;
    return;
  }
  if (
    drState &&
    drState.key === sn.key &&
    drState.pathIdx === sn.pathIdx &&
    ts > drState.fixTs
  ) {
    const dt = (ts - drState.fixTs) / 1000;
    if (dt >= 0.5) {
      const inst = (sn.along - drState.fixS) / dt;
      drState.v = 0.7 * drState.v + 0.3 * Math.max(-2, Math.min(2, inst));
      drState.fixS = sn.along;
      drState.fixTs = ts;
    }
  } else {
    drState = { key: sn.key, pathIdx: sn.pathIdx, fixS: sn.along, fixTs: ts, v: 0 };
  }
  drState.s = sn.along;
  drState.drDist = 0;
}

function setSignalLostUI(lost) {
  if (!gpsAccuracyCircle) return;
  const c = lost ? "#f39c12" : "#4285F4";
  gpsAccuracyCircle.setStyle({ color: c, fillColor: c });
}

// ทำงานทุก 0.5 วินาที: ตรวจว่าสัญญาณหายไหม และเดินต่อเองถ้าเข้าเงื่อนไข
function drTick() {
  if (!GPS_CFG.DR_ENABLED || !isTracking || isSimulating || !firstFixDone) return;
  const gap = Date.now() - lastFixAcceptedAt;
  if (gap < GPS_CFG.DR_START_MS) return;

  if (!signalLost) {
    signalLost = true;
    setSignalLostUI(true);
    showNotification("📡 สัญญาณ GPS อ่อน กำลังประมาณตำแหน่ง");
  }

  if (!drState || Math.abs(drState.v) < GPS_CFG.DR_MIN_SPEED) return; // ยืนอยู่: ไม่เดินต่อ
  if (gap > GPS_CFG.DR_MAX_MS || drState.drDist >= GPS_CFG.DR_MAX_M) return; // หยุดรอสัญญาณ

  const path = buildRoute(drState.key).paths[drState.pathIdx];
  if (!path) return;

  // ช้าลงเรื่อยๆ ตามเวลาที่สัญญาณหาย จนหยุดที่ DR_MAX_MS
  const fade = Math.max(
    0,
    1 - (gap - GPS_CFG.DR_START_MS) / (GPS_CFG.DR_MAX_MS - GPS_CFG.DR_START_MS),
  );
  const speed =
    Math.min(Math.abs(drState.v) * GPS_CFG.DR_SPEED_FACTOR, GPS_CFG.DR_MAX_SPEED) * fade;
  const step = Math.sign(drState.v) * speed * 0.5;
  const total = path.cum[path.cum.length - 1];
  const next = Math.max(0, Math.min(total, drState.s + step));
  if (next === drState.s) return; // สุดทางแล้ว

  drState.drDist += Math.abs(next - drState.s);
  drState.s = next;
  const pt = pointAtS(path, next);
  currentPos = pt;
  drMoved = true;
  glideSetTarget(drState.key, drState.pathIdx, next, Math.sign(drState.v) * speed, Date.now());
  if (!markerRaf) markerRaf = requestAnimationFrame(animateMarker);
  updateAccuracyCircle(pt[0], pt[1], lastAcc + drState.drDist);

  if (isTracking && !map.isPopupOpen()) {
    if (L.latLng(pt).distanceTo(map.getCenter()) > GPS_CFG.FOLLOW_THRESHOLD_M) {
      map.panTo(pt, { animate: true, duration: 0.5, easeLinearity: 0.5 });
    }
  }
}

// ---------- ประมวลผลพิกัดทุกครั้งที่ได้จาก GPS ----------
function handleGpsFix(pos) {
  lastGpsUpdateTime = Date.now();
  if (isSimulating) return;

  const { latitude, longitude, accuracy } = pos.coords;
  const ts = pos.timestamp || Date.now();

  // 1) ทิ้งพิกัดที่แย่เกินไป
  if (accuracy > GPS_CFG.MAX_ACCURACY) return;

  // 2) ตัดการกระโดดผิดปกติ (ยอมรับถ้าเกิดซ้ำ 3 ครั้ง = ผู้ใช้เคลื่อนที่จริง)
  if (lastAccepted) {
    const d = L.latLng(latitude, longitude).distanceTo(
      L.latLng(lastAccepted.lat, lastAccepted.lng),
    );
    const dt = Math.max((ts - lastAccepted.ts) / 1000, 0.5);
    if (d / dt > GPS_CFG.MAX_SPEED && d > accuracy * 2 && spikeCount < 3) {
      spikeCount++;
      return;
    }
  }
  spikeCount = 0;

  // ได้พิกัดดีแล้ว: บันทึกเวลา และออกจากโหมดสัญญาณหาย
  lastFixAcceptedAt = Date.now();
  lastAcc = accuracy;
  if (signalLost) {
    signalLost = false;
    setSignalLostUI(false);
    showNotification("✅ สัญญาณ GPS กลับมาแล้ว");
  }

  // 3) Kalman กรองสัญญาณรบกวน
  const k = kalmanUpdate(latitude, longitude, accuracy, ts);

  // 3.5) Snap-to-route (ไม่ย้อนกลับไปปนใน Kalman state)
  const s = snapToRoute(k.lat, k.lng, accuracy);

  // 3.6) ประเมินความเร็วตามเส้นทางไว้ใช้ตอนสัญญาณหาย
  updateDrState(s, ts);

  // 4) Deadband กันจุดสั่นตอนยืนนิ่ง (ข้ามถ้าจุดเพิ่งถูก dead reckoning เลื่อนไป)
  if (lastAccepted && !drMoved) {
    const moved = L.latLng(s.lat, s.lng).distanceTo(
      L.latLng(lastAccepted.lat, lastAccepted.lng),
    );
    if (moved < GPS_CFG.DEADBAND_M) {
      updateAccuracyCircle(s.lat, s.lng, accuracy);
      return;
    }
  }
  drMoved = false;
  lastAccepted = { lat: s.lat, lng: s.lng, ts };

  currentPos = [s.lat, s.lng];
  if (s.snapped && drState) {
    // เกาะเส้นทาง: จุดเลื่อนต่อเนื่องตามระยะบนเส้น พร้อมคาดการณ์ด้วยความเร็ว
    const vt = Math.abs(drState.v) < GPS_CFG.DR_MIN_SPEED ? 0 : Math.max(-2, Math.min(2, drState.v));
    glideSetTarget(s.key, s.pathIdx, s.along, vt, Date.now());
    if (!markerRaf) markerRaf = requestAnimationFrame(animateMarker);
  } else {
    glide = null; // ออกนอกเส้นทาง: ใช้การเลื่อนแบบเดิม
    moveMarkerSmooth(s.lat, s.lng);
  }
  updateAccuracyCircle(s.lat, s.lng, accuracy);
  trackDistance(currentPos);

  // 5) บินไปหาผู้ใช้ครั้งแรกครั้งเดียว
  if (!firstFixDone) {
    firstFixDone = true;
    map.flyTo(currentPos, 17, { duration: 1.0 });
    const dCenter = L.latLng(currentPos).distanceTo(L.latLng(12.5288, 102.0945));
    showNotification(
      dCenter < 1000
        ? "📍 พบตำแหน่งของคุณแล้ว"
        : "📍 คุณอยู่นอกพื้นที่โครงการ (ระบบยังทำงานปกติ)",
    );
  }

  // 6) ตรวจ proximity เมื่อเคลื่อนที่เกิน 5 ม.
  const curLatLng = L.latLng(currentPos);
  if (!lastCheckPos || lastCheckPos.distanceTo(curLatLng) > 5) {
    lastCheckPos = curLatLng;
    const allMarkers = [
      ...floraLayer.getLayers(),
      ...viewpointLayer.getLayers(),
      ...routeLayer.getLayers().filter((l) => l instanceof L.CircleMarker),
    ];
    checkProximityAlert(currentPos[0], currentPos[1], allMarkers);
    checkAutoPopup();
    checkNearbyViewpoints();
    checkNearbyFlora();
    checkRouteCompletion(currentPos[0], currentPos[1]);
  }

  // 7) เลื่อนแผนที่ตามผู้ใช้
  if (isTracking && !map.isPopupOpen()) {
    if (curLatLng.distanceTo(map.getCenter()) > GPS_CFG.FOLLOW_THRESHOLD_M) {
      map.panTo(currentPos, { animate: true, duration: 0.3, easeLinearity: 0.5 });
    }
  }
}

function handleGpsError(error) {
  console.warn("⚠️ GPS error:", error.code, error.message);
  if (error.code === error.PERMISSION_DENIED) {
    isTracking = false;
    document.querySelector(".gps-btn")?.classList.remove("active");
    alert("ไม่สามารถเข้าถึง GPS ได้\nกรุณาเปิดการระบุตำแหน่งในการตั้งค่า");
  }
  // TIMEOUT / POSITION_UNAVAILABLE: ปล่อยให้ watch เดิมทำงานต่อ ไม่ restart
}

// ---------- เริ่ม/หยุด watch ----------
function startGpsWatch() {
  if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = navigator.geolocation.watchPosition(handleGpsFix, handleGpsError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 30000,
  });
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isTracking && !isSimulating) {
    requestWakeLock();
    startGpsWatch(); // กลับมาที่แอป: เริ่ม watch ใหม่เงียบๆ
  }
});

function useRealGPS() {
  if (!navigator.geolocation) {
    alert("❌ อุปกรณ์นี้ไม่รองรับ GPS");
    return;
  }

  // เคลียร์ของเก่า
  if (gpsWatchdog !== null) {
    clearInterval(gpsWatchdog);
    gpsWatchdog = null;
  }

  isTracking = true;
  isSimulating = false;
  firstFixDone = false;
  kf = null;
  lastAccepted = null;
  spikeCount = 0;
  drState = null;
  drMoved = false;
  signalLost = false;
  lastFixAcceptedAt = Date.now();
  document.querySelector(".gps-btn")?.classList.add("active");
  lastGpsUpdateTime = Date.now();

  initCompass().then((success) => {
    if (success) {
      isFollowingHeading = true;
      document.querySelector(".compass-btn")?.classList.add("active");
    }
  });

  requestWakeLock();
  startGpsWatch();

  // ตัวตรวจสัญญาณหาย + เดินต่อเอง (dead reckoning)
  if (drTimer !== null) clearInterval(drTimer);
  drTimer = setInterval(drTick, 500);

  // Watchdog: restart เงียบๆ เฉพาะกรณีไม่มีข้อมูลนานผิดปกติ
  gpsWatchdog = setInterval(() => {
    if (!isSimulating && isTracking && Date.now() - lastGpsUpdateTime > GPS_CFG.STALE_MS) {
      lastGpsUpdateTime = Date.now();
      startGpsWatch();
    }
  }, 10000);
}

let watchPositionId = null; // เก็บ ID ของการ watchPosition

function recenterGPS() {
  // ปุ่ม GPS: เริ่ม/รีสตาร์ตการติดตามตำแหน่งจริง (ผ่านตัวกรอง Kalman + snap-to-route) พร้อมเข็มทิศ
  // เดิมฟังก์ชันนี้สร้าง watchPosition ซ้อนอีกตัวที่เขียนทับตำแหน่งที่กรองแล้วด้วยค่าดิบ
  // และปุ่มยังถูกผูกซ้ำด้วย addEventListener จึงรวมให้เหลือทางเดียว (พฤติกรรมที่ผู้ใช้เห็นเหมือนเดิม)
  useRealGPS();
  initCompass();
}
function requestAllPermissions() {
  if (typeof initCompass === "function") {
    initCompass().then((success) => {
      if (success) {
        isFollowingHeading = true;
        document.querySelector(".compass-btn")?.classList.add("active");
      }
    });
  }
  useRealGPS();

  const popup = document.getElementById("permission-popup");
  if (popup) {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }
}
// หมายเหตุ: ปุ่ม GPS เรียก recenterGPS() จาก onclick ใน mangrove.html (ไม่ผูกซ้ำที่นี่)
/* =========================================
   7. CAROUSEL INTERACTIONS
   ========================================= */
function nextImage(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const images = container.querySelectorAll(".carousel-img");
  const indicators = container.querySelectorAll(".indicator");
  const counter = container.querySelector(".carousel-counter");
  let currentIndex = Array.from(images).findIndex((img) =>
    img.classList.contains("active"),
  );
  let newIndex = (currentIndex + 1) % images.length;
  updateCarouselDisplay(images, indicators, counter, newIndex);
}

function prevImage(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const images = container.querySelectorAll(".carousel-img");
  const indicators = container.querySelectorAll(".indicator");
  const counter = container.querySelector(".carousel-counter");
  let currentIndex = Array.from(images).findIndex((img) =>
    img.classList.contains("active"),
  );
  let newIndex = (currentIndex - 1 + images.length) % images.length;
  updateCarouselDisplay(images, indicators, counter, newIndex);
}

function goToImage(containerId, index) {
  const container = document.getElementById(containerId);
  if (!container) return;
  updateCarouselDisplay(
    container.querySelectorAll(".carousel-img"),
    container.querySelectorAll(".indicator"),
    container.querySelector(".carousel-counter"),
    index,
  );
}

function updateCarouselDisplay(images, indicators, counter, index) {
  images.forEach((img) => img.classList.remove("active"));
  indicators.forEach((ind) => ind.classList.remove("active"));
  if (images[index]) images[index].classList.add("active");
  if (indicators[index]) indicators[index].classList.add("active");
  if (counter) counter.textContent = `${index + 1}/${images.length}`;
}

function initCarousels() {
  document.querySelectorAll(".card-carousel").forEach((carousel) => {
    const container = carousel.querySelector(".carousel-container");
    if (!container) return;
    let touchStartX = 0,
      touchEndX = 0;

    container.addEventListener(
      "touchstart",
      (e) => (touchStartX = e.changedTouches[0].screenX),
      { passive: true },
    );
    container.addEventListener("touchend", (e) => {
      touchEndX = e.changedTouches[0].screenX;
      if (touchStartX - touchEndX > 50) nextImage(carousel.id);
      else if (touchEndX - touchStartX > 50) prevImage(carousel.id);
    });
  });
}

/* =========================================
   8. UTILITIES (SOUND, TOGGLES, NOTIFICATIONS)
   ========================================= */
function playNotificationSound() {
  if (!soundEnabled) return;
  try {
    const audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + 0.3,
    );
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {}
}
function playSuccessSound() {
  if (!soundEnabled) return;
  try {
    const successAudio = new Audio(
      "https://actions.google.com/sounds/v1/crowds/crowd_cheer.ogg",
    );
    successAudio.volume = 0.5;
    successAudio
      .play()
      .catch((e) =>
        console.log("🔇 เบราว์เซอร์บล็อกการเล่นเสียงอัตโนมัติ:", e),
      );
  } catch (error) {
    console.log("Audio not supported", error);
  }
}
function showNotification(message) {
  document.querySelector(".toast-notification")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `<i class="fa-solid fa-bell"></i><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 100);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleMapLayer() {
  isSatellite = !isSatellite;
  if (isSatellite) {
    street.remove();
    satellite.addTo(map);
  } else {
    satellite.remove();
    street.addTo(map);
  }
}

function updateSidebarIcon() {
  const panel = document.getElementById("story-panel");
  const btnIcon = document.querySelector(".toggle-sidebar-btn i");
  if (!panel || !btnIcon) return;

  const isMobile = window.innerWidth <= 768;
  const isHidden = panel.classList.contains("sidebar-hidden");

  if (isMobile)
    btnIcon.className = isHidden
      ? "fa-solid fa-chevron-up"
      : "fa-solid fa-chevron-down";
  else
    btnIcon.className = isHidden
      ? "fa-solid fa-chevron-left"
      : "fa-solid fa-chevron-right";
}

function toggleSidebar() {
  const panel = document.getElementById("story-panel");
  panel.classList.toggle("sidebar-hidden");
  updateSidebarIcon();
  setTimeout(() => {
    if (typeof map !== "undefined" && map.invalidateSize) map.invalidateSize();
  }, 300);
}

function openMarkerPopup(lat, lng, pan) {
  if (pan) map.flyTo([lat, lng], 18, { duration: 0.8 });
  setTimeout(
    () => {
      routeLayer.eachLayer((layer) => {
        if (layer instanceof L.CircleMarker) {
          const ll = layer.getLatLng();
          if (
            Math.abs(ll.lat - lat) < 0.0001 &&
            Math.abs(ll.lng - lng) < 0.0001
          ) {
            layer.openPopup();
            const stationData = db[currentSubRoute]?.find(
              (s) =>
                Math.abs(s.lat - lat) < 0.0001 &&
                Math.abs(s.lng - lng) < 0.0001,
            );
            if (stationData) {
              const index = db[currentSubRoute].indexOf(stationData);
              const cardEl = document.querySelector(
                `.card[data-station="${index}"]`,
              );
              if (cardEl) {
                cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
                document.querySelectorAll(".card").forEach((c) => {
                  c.style.border = "1px solid rgba(255,255,255,0.8)";
                  c.style.boxShadow = "0 4px 15px rgba(0,0,0,0.05)";
                });
                cardEl.style.transition = "all 0.3s ease";
                cardEl.style.border = "2px solid var(--wellness)";
                cardEl.style.boxShadow = "0 0 20px rgba(39, 174, 96, 0.4)";
              }
            }
          }
        }
      });
    },
    pan ? 900 : 0,
  );
}

function openMarkerPopupByIndex(stationIndex, pan) {
  let targetData = db[currentSubRoute][stationIndex];
  if (!targetData) return;

  let lat = targetData.lat;
  let lng = targetData.lng;

  if (pan) map.flyTo([lat, lng], 18, { duration: 0.8 });

  setTimeout(
    () => {
      routeLayer.eachLayer((layer) => {
        if (layer instanceof L.CircleMarker) {
          const ll = layer.getLatLng();
          if (
            Math.abs(ll.lat - lat) < 0.00005 &&
            Math.abs(ll.lng - lng) < 0.00005
          ) {
            layer.openPopup();
            const cardEl = document.querySelector(
              `.card[data-station="${stationIndex}"]`,
            );
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
              document.querySelectorAll(".card").forEach((c) => {
                c.style.border = "1px solid rgba(255,255,255,0.8)";
                c.style.boxShadow = "0 4px 15px rgba(0,0,0,0.05)";
              });
              cardEl.style.transition = "all 0.3s ease";
              cardEl.style.border = "2px solid var(--wellness)";
              cardEl.style.boxShadow = "0 0 20px rgba(39, 174, 96, 0.4)";
            }
          }
        }
      });
    },
    pan ? 900 : 0,
  );
}

function checkProximityAlert(userLat, userLng, allMarkers) {
  let foundNearby = false;

  allMarkers.forEach((marker) => {
    let dist = map.distance([userLat, userLng], marker.getLatLng());
    if (dist <= ALERT_DISTANCE) foundNearby = true;
  });

  if (foundNearby && !isUserInZone) {
    isUserInZone = true;
    console.log("🔔 เข้าโซน!");
  } else if (!foundNearby && isUserInZone) {
    isUserInZone = false;
    console.log("🚶 ออกโซน");
  }

  // ให้ checkAutoPopup จัดการ popup เสมอ (ไม่ต้องเงื่อนไข foundNearby)
  checkAutoPopup();
}

/* =========================================
   9. STARTUP LOGIC (LOAD JSON)
   ========================================= */
setInterval(() => {
  const timeEl = document.getElementById("current-time");
  if (timeEl)
    timeEl.innerText = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
}, 1000);

async function loadApp() {
  console.log("🌿 Mangrove Smart StoryMap - Fetching Data...");
  try {
    const [resDb, resUi] = await Promise.all([
      fetch("../storage/info.json?t=" + Date.now()),
      fetch("../storage/mangrove_ui.json?t=" + Date.now()),
    ]);

    if (!resDb.ok) throw new Error("Load DB Failed (info.json not found)");
    if (!resUi.ok)
      throw new Error("Load UI Failed (mangrove_ui.json not found)");

    db = await resDb.json();
    ui = await resUi.json();

    console.log("✅ Data Loaded Successfully");
    changeLang(currentLang);

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    const urlParams = new URLSearchParams(window.location.search);
    const routeParam = urlParams.get("route");
    const subRouteParam = urlParams.get("sub");

    const modal = document.getElementById("route-selection-modal");
    const groupWellness = document.getElementById("group-wellness");
    const groupSpiritual = document.getElementById("group-spiritual");

    if (routeParam && subRouteParam) {
      if (modal) modal.style.display = "none";
      setTimeout(() => {
        startJourney(routeParam, subRouteParam);
      }, 300);
    } else if (modal && groupWellness && groupSpiritual) {
      if (routeParam === "wellness") {
        groupWellness.style.display = "block";
        groupSpiritual.style.display = "none";
        modal.style.display = "flex";
      } else if (routeParam === "spiritual") {
        groupWellness.style.display = "none";
        groupSpiritual.style.display = "block";
        modal.style.display = "flex";
      } else {
        groupWellness.style.display = "block";
        groupSpiritual.style.display = "block";
        groupSpiritual.style.marginTop = "20px";
        modal.style.display = "flex";
      }
    }
  } catch (error) {
    console.error("🔥 Error loading app data:", error);
    alert("ไม่สามารถดึงข้อมูลแผนที่ได้ กรุณาลองรีเฟรชหน้าเว็บอีกครั้ง");
  }
}

/* =========================================
   10. INITIAL ROUTE SELECTION
   ========================================= */
function startJourney(mainRoute, subRoute) {
  resetRouteSession();
  currentRoute = mainRoute;
  currentSubRoute = subRoute;

  const modal = document.getElementById("route-selection-modal");
  if (modal) {
    modal.style.opacity = "0";
    modal.querySelector(".route-modal-content").style.transform =
      "translateY(-50px)";
    setTimeout(() => modal.remove(), 400);
  }

  document
    .getElementById("tab-wellness")
    ?.classList.toggle("active", mainRoute === "wellness");
  document
    .getElementById("tab-spiritual")
    ?.classList.toggle("active", mainRoute === "spiritual");

  renderUI();

  setTimeout(() => {
    showNotification(
      `📍 เริ่มต้นเส้นทาง: ${mainRoute === "wellness" ? "สุขภาพ" : "สายมู"}`,
    );

    let targetCenter, targetZoom;
    if (subRoute === "wellness1") {
      targetCenter = [12.5245, 102.096];
      targetZoom = 15.8;
    } else if (subRoute === "wellness2") {
      targetCenter = [12.5225, 102.0935];
      targetZoom = 15.8;
    } else if (subRoute === "spiritual1") {
      targetCenter = [12.5245, 102.096];
      targetZoom = 16;
    } else if (subRoute === "spiritual2") {
      targetCenter = [12.523, 102.0925];
      targetZoom = 15.8;
    }

    if (targetCenter && targetZoom) {
      map.flyTo(targetCenter, targetZoom, {
        duration: 1.5,
        easeLinearity: 0.25,
      });
    }
  }, 500);
}
// =========================================
// 11. ROUTE SUMMARY (WELLNESS)
// =========================================

// ฟังก์ชันรีเซ็ตสถิติเมื่อเริ่มเดินใหม่หรือเปลี่ยนเส้นทาง
function resetRouteSession() {
  routeStartTime = Date.now();
  routeStartDistance = totalDistanceTraveled; // เก็บระยะเริ่มต้น
  isRouteFinished = false;
  console.log("🔄 รีเซ็ตการบันทึกสถิติเส้นทาง");
}

// ฟังก์ชันตรวจเช็คว่าถึงจุดจบหรือยัง
function checkRouteCompletion(lat, lng) {
  if (currentRoute !== "wellness" || isRouteFinished) return;
  if (!db[currentSubRoute] || db[currentSubRoute].length === 0) return;

  const stations = db[currentSubRoute];
  const lastStation = stations[stations.length - 1];

  const distToEnd = map.distance(
    [lat, lng],
    [lastStation.lat, lastStation.lng],
  );

  // 1. เช็คว่าถึงจุดสุดท้ายแล้ว (ระยะ < 20 เมตร)
  if (distToEnd <= 20) {
    // 🎯 2. เพิ่มลอจิกป้องกันการโกง: เช็คระยะทางสะสมขั้นต่ำ
    // ตัวอย่าง: ถ้าเส้นทางยาว 3 กม. เราอาจจะกำหนดว่าต้องเดินได้อย่างน้อย 500 เมตร ถึงจะผ่าน
    const MIN_REQUIRED_DISTANCE = 500;

    if (totalDistanceTraveled < MIN_REQUIRED_DISTANCE) {
      console.log("❌ ตรวจพบการข้ามเส้นทาง หรือ ขับรถมา (ระยะไม่ถึงเกณฑ์)");
      return;
    }

    // 3. ถ้าผ่านเงื่อนไขทั้งหมด ค่อยให้จบเส้นทาง
    isRouteFinished = true;
    showRouteSummaryPopup();

    if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 500]);
    playSuccessSound();
  }
}

// ฟังก์ชันสร้างหน้าต่างสรุปผล (UI)
function showRouteSummaryPopup() {
  // 1. คำนวณสถิติ
  const netDistance = (totalDistanceTraveled - routeStartDistance) / 1000; // แปลงเป็นกิโลเมตร
  const netTimeMs = Date.now() - routeStartTime;
  const netTimeMin = Math.max(1, Math.round(netTimeMs / 60000)); // นาที
  const weight = 65;
  const netKcal = netDistance * weight * 0.75;

  // 2. คำแปลภาษา
  const langData = {
    th: {
      title: "ยินดีด้วย!",
      desc: "คุณพิชิตเส้นทางสุขภาพสำเร็จแล้ว",
      dist: "ระยะทาง",
      time: "เวลา",
      kcal: "เผาผลาญ",
      btn: "ปิด",
    },
    en: {
      title: "Congratulations!",
      desc: "You completed the Wellness Route.",
      dist: "Distance",
      time: "Time",
      kcal: "Burned",
      btn: "Close",
    },
    zh: {
      title: "恭喜！",
      desc: "您已完成健康路线",
      dist: "距离",
      time: "时间",
      kcal: "消耗",
      btn: "关闭",
    },
  }[currentLang] || {
    title: "ยินดีด้วย!",
    desc: "คุณพิชิตเส้นทางสุขภาพสำเร็จแล้ว",
    dist: "ระยะ",
    time: "เวลา",
    kcal: "เผาผลาญ",
    btn: "ปิด",
  };

  // 3. สร้าง UI โชว์กลางจอ
  const promptDiv = document.createElement("div");
  promptDiv.id = "route-summary-popup";
  promptDiv.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); z-index: 9998; backdrop-filter: blur(4px);"></div>
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px 20px; border-radius: 20px; box-shadow: 0 15px 40px rgba(0,0,0,0.3); z-index: 9999; text-align: center; width: 85%; max-width: 340px; font-family: 'Prompt', sans-serif;">
            <div style="width: 70px; height: 70px; background: #e8f5e9; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                <i class="fa-solid fa-medal" style="font-size: 35px; color: #27ae60;"></i>
            </div>
            <h3 style="margin: 0 0 5px 0; font-size: 1.3rem; color: #27ae60;">${langData.title}</h3>
            <p style="font-size: 0.9rem; color: #666; margin-bottom: 25px;">${langData.desc}</p>
            
            <div style="display: flex; justify-content: space-between; background: #f8f9fa; padding: 15px; border-radius: 12px; margin-bottom: 20px;">
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #888;">${langData.dist}</div>
                    <div style="font-size: 1.1rem; color: #333; font-weight: 600;">${netDistance.toFixed(2)} <span style="font-size: 0.7rem">km</span></div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #888;">${langData.time}</div>
                    <div style="font-size: 1.1rem; color: #333; font-weight: 600;">${netTimeMin} <span style="font-size: 0.7rem">min</span></div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 0.75rem; color: #888;">${langData.kcal}</div>
                    <div style="font-size: 1.1rem; color: #e74c3c; font-weight: 600;">${netKcal.toFixed(1)}</div>
                </div>
            </div>

            <button id="btn-close-summary" style="width: 100%; padding: 14px; border-radius: 12px; border: none; background: #27ae60; color: white; font-weight: 600; font-size: 1rem; cursor: pointer; box-shadow: 0 4px 15px rgba(39, 174, 96, 0.3);">${langData.btn}</button>
        </div>
    `;
  document.body.appendChild(promptDiv);

  document.getElementById("btn-close-summary").onclick = () => {
    promptDiv.remove();
  };
}
// =========================================
// ฟังก์ชันดูรูปเต็ม (Image Modal)
// =========================================
let currentModalImages = [];
let currentModalIndex = 0;
let touchStartX = 0;
let touchEndX = 0;

function openImageModal(imgSrc, containerId = null, imgsArray = null) {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("full-image");

  if (!modal || !modalImg) {
    console.error("❌ Modal elements not found");
    return;
  }

  // ⭐ Reset ค่าเดิมทันที
  currentModalImages = [];
  currentModalIndex = 0;

  let allImages = [];
  let startIndex = 0;

  // ============================================
  // Priority 1: ใช้ imgsArray ที่ส่งมา (แนะนำ)
  // ============================================
  if (imgsArray && Array.isArray(imgsArray) && imgsArray.length > 0) {
    allImages = imgsArray;
    startIndex = allImages.findIndex((url) => {
      const srcFile = imgSrc.split("/").pop();
      const urlFile = url.split("/").pop();
      return srcFile === urlFile || url === imgSrc;
    });

    if (startIndex === -1) startIndex = 0;
    console.log("✅ Priority 1 (imgsArray):", allImages.length);
  }

  // ============================================
  // Priority 2: ใช้ containerId หารูปใน carousel
  // ============================================
  if (allImages.length === 0 && containerId) {
    const container = document.getElementById(containerId);

    if (container) {
      const images = container.querySelectorAll(".carousel-img");

      if (images.length > 0) {
        allImages = Array.from(images).map((img) => img.src);

        // ลบรูปซ้ำ
        allImages = [...new Set(allImages)];

        startIndex = allImages.findIndex((url) => {
          const srcFile = imgSrc.split("/").pop();
          const urlFile = url.split("/").pop();
          return srcFile === urlFile;
        });

        if (startIndex === -1) startIndex = 0;
        console.log("✅ Priority 2 (containerId):", allImages.length);
      }
    }
  }

  // ============================================
  // Priority 3: ถ้ายังไม่ได้ ให้ใช้รูปเดียว
  // ============================================
  if (allImages.length === 0) {
    allImages = [imgSrc];
    startIndex = 0;
    console.warn("⚠️ Single image mode");
  }

  // บันทึกและแสดง
  currentModalImages = allImages;
  currentModalIndex = startIndex >= 0 ? startIndex : 0;

  modalImg.src = imgSrc;
  modal.classList.add("show");
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");

  updateModalNavigation();

  console.log(
    `✅ Modal: ${currentModalIndex + 1}/${currentModalImages.length}`,
  );
  console.log("📸 Images:", allImages);
}

/**
 * ไปภาพถัดไปใน Modal
 */
function nextModalImage() {
  if (currentModalImages.length <= 1) return;

  currentModalIndex = (currentModalIndex + 1) % currentModalImages.length;
  updateModalImage();
}

/**
 * ย้อนกลับไปภาพก่อนหน้าใน Modal
 */
function prevModalImage() {
  if (currentModalImages.length <= 1) return;

  currentModalIndex =
    (currentModalIndex - 1 + currentModalImages.length) %
    currentModalImages.length;
  updateModalImage();
}

/**
 * อัพเดตภาพใน Modal
 */
function updateModalImage() {
  const modalImg = document.getElementById("full-image");
  const counter = document.getElementById("modal-counter");

  if (modalImg && currentModalImages.length > 0) {
    modalImg.src = currentModalImages[currentModalIndex];

    if (counter) {
      counter.textContent = `${currentModalIndex + 1} / ${currentModalImages.length}`;
    }

    updateModalNavigation();
  }
}

/**
 * อัพเดตสถานะปุ่ม Navigation
 */
function updateModalNavigation() {
  const prevBtn = document.getElementById("modal-prev-btn");
  const nextBtn = document.getElementById("modal-next-btn");
  const counter = document.getElementById("modal-counter");

  console.log("🔄 Updating navigation:", {
    currentIndex: currentModalIndex,
    totalImages: currentModalImages.length,
  });

  // ถ้ามีรูปเดียว = ซ่อนปุ่มและ counter
  if (currentModalImages.length <= 1) {
    if (prevBtn) {
      prevBtn.style.display = "none";
      console.log("  ⬅️ Prev button hidden");
    }
    if (nextBtn) {
      nextBtn.style.display = "none";
      console.log("  ➡️ Next button hidden");
    }
    if (counter) {
      counter.style.display = "none";
      console.log("  🔢 Counter hidden");
    }
  }
  // ถ้ามีหลายรูป = แสดงปุ่มและ counter
  else {
    if (prevBtn) {
      prevBtn.style.display = "flex";
    }
    if (nextBtn) {
      nextBtn.style.display = "flex";
    }
    if (counter) {
      counter.style.display = "block";
      counter.textContent = `${currentModalIndex + 1} / ${currentModalImages.length}`;
      console.log(`  🔢 Counter updated: ${counter.textContent}`);
    }
  }
}

/**
 * ปิด Modal
 */
function closeImageModal() {
  console.log("🔴 closeImageModal called");

  const modal = document.getElementById("image-modal");
  if (!modal) {
    console.error("❌ Modal not found");
    return;
  }

  // ลบ class show
  modal.classList.remove("show");
  modal.classList.add("hidden");

  // ปลดล็อก scroll
  document.body.classList.remove("modal-open");

  // Reset หลัง animation เสร็จ
  setTimeout(() => {
    currentModalImages = [];
    currentModalIndex = 0;

    // Reset image src
    const modalImg = document.getElementById("full-image");
    if (modalImg) modalImg.src = "";
  }, 300);

  console.log("✅ Modal closed");
}

/**
 * Event Listeners
 */

// 1. Click background to close
document.addEventListener("click", function (event) {
  const modal = document.getElementById("image-modal");

  // ตรวจสอบว่าคลิกตรงที่ modal overlay (ไม่ใช่ส่วนอื่น)
  if (event.target === modal && modal.classList.contains("show")) {
    console.log("🖱️ Clicked background");
    closeImageModal();
  }
});

// 2. ESC key to close
document.addEventListener("keydown", function (event) {
  const modal = document.getElementById("image-modal");
  if (!modal || !modal.classList.contains("show")) return;

  if (event.key === "Escape") {
    console.log("⌨️ ESC pressed");
    event.preventDefault();
    closeImageModal();
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    prevModalImage();
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    nextModalImage();
  }
});

// 3. Close button click (backup - ใช้ onclick ใน HTML)
// แต่เพิ่ม event listener เผื่อ onclick ไม่ทำงาน
document.addEventListener("DOMContentLoaded", function () {
  const closeBtn = document.querySelector(".close-modal");
  if (closeBtn) {
    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      console.log("🖱️ Close button clicked");
      closeImageModal();
    });
  }
});

function handleSwipe() {
  if (touchEndX < touchStartX - 50) nextModalImage();
  if (touchEndX > touchStartX + 50) prevModalImage();
}

document.addEventListener("touchstart", function (e) {
  const modalImg = document.getElementById("full-image");
  if (modalImg && e.target === modalImg) {
    touchStartX = e.changedTouches[0].screenX;
  }
});

document.addEventListener("touchend", function (e) {
  const modalImg = document.getElementById("full-image");
  if (modalImg && e.target === modalImg) {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }
});
document.addEventListener(
  "click",
  function (e) {
    // ตรวจสอบว่าคลิกที่รูป carousel-img หรือไม่
    if (e.target.classList.contains("carousel-img")) {
      e.preventDefault();
      e.stopPropagation();

      const imgSrc = e.target.src;
      const container = e.target.closest(".card-carousel");

      if (!container) {
        openImageModal(imgSrc, null, null);
        return;
      }

      const containerId = container.id;
      const allImgs = Array.from(
        container.querySelectorAll(".carousel-img"),
      ).map((img) => img.src);

      // เปิด Modal พร้อมส่ง array รูปทั้งหมด
      openImageModal(imgSrc, containerId, allImgs);
    }
  },
  true,
); // ใช้ capture phase

// เริ่มโหลดข้อมูลทันทีเมื่อ DOM พร้อม ไม่รอเหตุการณ์ load (ซึ่งรอภาพแผนที่ทุกชิ้น ถ้าเน็ตค้างหน้าจะไม่ขึ้นเลย)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadApp);
} else {
  loadApp();
}
window.addEventListener("DOMContentLoaded", updateSidebarIcon);
window.addEventListener("resize", updateSidebarIcon);

window.addEventListener("pageshow", function (event) {
  if (
    event.persisted ||
    (window.performance && window.performance.navigation.type === 2)
  ) {
    const loader = document.getElementById("loading-screen");
    if (loader) loader.classList.remove("hidden");
    loadApp();
  }
});
