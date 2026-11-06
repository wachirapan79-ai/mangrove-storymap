if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}
// =========================================
// 1. ตัวแปรเก็บฐานข้อมูล
// =========================================
let db = {};
let uiTranslations = {};
let currentLang = localStorage.getItem("selectedLang") || "th";
let activeSubRoute = null;
// =========================================
// 2. ระบบดึงข้อมูล (Fetch JSON) & เริ่มต้นทำงาน
// =========================================
async function initSystem() {
  console.log("กำลังเริ่มดึงข้อมูลจาก JSON...");

  try {
    const [resDb, resTranslate] = await Promise.all([
      fetch("../storage/info.json?t=" + Date.now()),
      fetch("../storage/index_translate.json?t=" + Date.now()),
    ]);

    console.log(
      "สถานะไฟล์ DB:",
      resDb.status,
      "| สถานะไฟล์แปลภาษา:",
      resTranslate.status,
    );

    if (!resDb.ok)
      throw new Error(
        `หาไฟล์ index.json ไม่เจอ (HTTP ${resDb.status}) - เช็ค Path อีกครั้ง`,
      );
    if (!resTranslate.ok)
      throw new Error(
        `หาไฟล์ index_translate.json ไม่เจอ (HTTP ${resTranslate.status}) - เช็ค Path อีกครั้ง`,
      );

    db = await resDb.json();
    uiTranslations = await resTranslate.json();

    console.log(
      "ดึงข้อมูลสำเร็จ! โหลด DB ได้:",
      Object.keys(db).length,
      "เส้นทาง",
    );

    // เมื่อข้อมูลพร้อมแล้ว ค่อยรันระบบ UI และแผนที่
    startApp();
  } catch (error) {
    console.error("🔥 System Error:", error);

    const loadingScreen = document.getElementById("loading-screen");
    if (loadingScreen) {
      loadingScreen.classList.remove("hidden");
      loadingScreen.innerHTML = `
                <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                    <h3 style="color: #d32f2f; margin-bottom: 10px;">🚨 เกิดข้อผิดพลาดในการดึงข้อมูล</h3>
                    <p style="color: #333;">${error.message}</p>
                    <p style="font-size: 0.9rem; color: #666; margin-top: 15px;">กรุณากด <b>F12</b> แล้วดูแท็บ <b>Console</b> เพื่อดูรายละเอียด</p>
                </div>
            `;
    }
  }
}

// ฟังก์ชันรวมสำหรับเริ่มทำงานหลังจากดึงข้อมูลเสร็จ
function startApp() {
  updateRealTime();
  setCardImagesFromDB();
  getRealLocation();

  changeLanguage(currentLang);

  const urlParams = new URLSearchParams(window.location.search);
  const routeParam = urlParams.get("route");

  const statsSkeleton = document.getElementById("stats-skeleton");
  const statsActual = document.getElementById("actual-stats");
  const cardsSkeleton = document.getElementById("cards-skeleton");
  const cardsActual = document.getElementById("actual-cards");

  if (statsSkeleton && statsActual) {
    statsSkeleton.style.display = "none";
    statsActual.style.display = ""; //
  }

  if (cardsSkeleton && cardsActual) {
    cardsSkeleton.style.display = "none";
    cardsActual.style.display = "";
    void cardsActual.offsetWidth;
  }

  let targetCard = document.querySelector(".card.wellness"); // Default
  let targetType = "wellness";

  if (routeParam === "spiritual") {
    targetCard = document.querySelector(".card.spiritual");
    targetType = "spiritual";
  } else if (routeParam === "sightseeing") {
    targetCard = document.querySelector(".card.sightseeing");
    targetType = "sightseeing";
  }

  if (targetCard) {
    selectRoute(targetCard, targetType, false, true);

    // 🎯 ใช้ requestAnimationFrame รอให้เบราว์เซอร์พร้อม 100% ก่อนเริ่มจับเวลาเลื่อน
    requestAnimationFrame(() => {
      setTimeout(() => {
        const container = targetCard.closest(".cards-container");

        if (container) {
          container.style.scrollSnapType = "none";

          targetCard.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
          });

          setTimeout(() => {
            if (container) {
              container.style.scrollSnapType = "";
            }
          }, 800);
        }
      }, 500);
    });
  }

  setTimeout(hideLoadingScreen, 600);
}

// สั่งให้โหลดข้อมูลทันทีที่เปิดหน้าเว็บ
window.addEventListener("DOMContentLoaded", initSystem);
window.addEventListener("pageshow", function (event) {
  // เช็คว่าเป็นการโหลดหน้าจากการกด Back/Forward (persisted) หรือไม่
  if (
    event.persisted ||
    (window.performance && window.performance.navigation.type === 2)
  ) {
    console.log("🔄 ย้อนกลับมาหน้า Index: บังคับโหลดระบบใหม่");

    // โชว์ Loading ก่อนกันเหนียว
    const loader = document.getElementById("loading-screen");
    if (loader) loader.classList.remove("hidden");

    // สั่งรันระบบดึงข้อมูล JSON ใหม่อีกครั้ง
    initSystem();
  }
});
// =========================================
// 3. แผนที่ Leaflet พื้นฐาน
// =========================================

const map = L.map("map", {
  doubleClickZoom: false,
  keyboard: false,
  preferCanvas: true,
  updateWhenIdle: true,
}).setView([12.525, 102.098], 16);

const cleanMap = L.tileLayer(
  "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
  {
    maxZoom: 22,
    attribution: "Google Satellite",
  },
).addTo(map);

let routeLayer = L.layerGroup().addTo(map);

const activePathLayer = L.featureGroup().addTo(map);
function selectSubRoute(subType, event) {
  if (event) {
    event.stopPropagation();
    const allBadges = document.querySelectorAll(".route-badge");
    allBadges.forEach((badge) => badge.classList.remove("active"));

    event.currentTarget.classList.add("active");
  }

  if (typeof activePathLayer !== "undefined") activePathLayer.clearLayers();
  if (typeof routeLayer !== "undefined") routeLayer.clearLayers();

  activeSubRoute = subType;
  const mainType = subType.includes("wellness") ? "wellness" : "spiritual";
  const card = document.querySelector(`.card.${mainType}`);

  selectRoute(card, mainType, true);

  if (db[subType] && db[subType].length > 0) {
    const coords = db[subType].map((p) => [p.lat, p.lng]);
    const bounds = L.latLngBounds(coords);
    const isMobile = window.innerWidth <= 768;

    map.fitBounds(bounds, {
      paddingTopLeft: isMobile ? [10, 120] : [80, 50],
      paddingBottomRight: isMobile ? [10, 400] : [200, 150],
      maxZoom: 16.5,
      animate: true,
      duration: 0.8,
    });
  }
}
// =========================================
// 4. ฟังก์ชันจัดการเส้นทาง (Map Routes)
// =========================================
function drawRoute(routeData, color, routeKey, drawLine = true) {
  let opacityValue = 0.9;
  if (activeSubRoute && activeSubRoute !== routeKey) {
    opacityValue = 0.15; // จางลงเหลือ 15%
  }

  let lineSegments = [];
  let currentSegment = [];

  routeData.forEach((p) => {
    if (p.isNewPath && currentSegment.length > 0) {
      lineSegments.push(currentSegment);
      currentSegment = [];
    }
    currentSegment.push([p.lat, p.lng]);
  });

  if (currentSegment.length > 0) {
    lineSegments.push(currentSegment);
  }

  // 🎯 ใช้ routeData.length แทน coords.length เพราะเราเปลี่ยนวิธีเก็บค่า
  if (routeData.length > 1 && drawLine) {
    // เส้นขอบขาว
    // ส่ง Array ซ้อน Array (lineSegments) เข้าไป Leaflet จะฉลาดพอที่จะแยกเส้นให้เอง
    L.polyline(lineSegments, {
      color: "#ffffff",
      weight: 10,
      opacity: opacityValue,
    }).addTo(activePathLayer);

    // เส้นสีหลัก
    L.polyline(lineSegments, {
      color: color,
      weight: 6,
      opacity: opacityValue,
    }).addTo(activePathLayer);
  }

  routeData.forEach((p) => {
    let langData =
      p[currentLang] && p[currentLang].t !== "" ? p[currentLang] : p.th;

    if (langData && langData.t !== "") {
      L.circleMarker([p.lat, p.lng], {
        radius: 6,
        fillColor: color,
        color: "#ffffff",
        weight: 2,
        opacity: opacityValue,
        fillOpacity: opacityValue,
      })
        .addTo(activePathLayer)
        .bindPopup(`<b>${langData.t}</b><br>${langData.d || ""}`);
    }
  });
}
// =========================================
// 5. ฟังก์ชันแสดง Timeline
// =========================================
function renderTimeline(routeData) {
  const container = document.getElementById("timeline-container");
  if (!container) return;

  const fragment = document.createDocumentFragment();
  container.innerHTML = "";

  const stops = routeData.filter((p) => {
    let langData =
      p[currentLang] && p[currentLang].t !== "" ? p[currentLang] : p.th;
    return langData && langData.t !== "";
  });

  const activeCard = document.querySelector(".card.active");
  const isSightseeing =
    activeCard && activeCard.classList.contains("sightseeing");

  stops.forEach((stop, index) => {
    if (index > 0 && stop.id === 1 && !isSightseeing) {
      const divider = document.createElement("div");
      divider.className = "timeline-divider";

      let dividerText = "เส้นทางที่ 2";
      if (currentLang === "en") dividerText = "Route 2";
      if (currentLang === "zh") dividerText = "路线 2";

      divider.innerHTML = `<span><i class="fa-solid fa-flag"></i> ${dividerText}</span>`;
      fragment.appendChild(divider);
    }

    const div = document.createElement("div");
    div.className = "timeline-item";

    let rawImg =
      stop.imgs && stop.imgs.length > 0 ? stop.imgs[0] : stop.img || "";
    let imgSrc = rawImg
      ? rawImg
      : "https://via.placeholder.com/200x150?text=No+Image";

    let langData =
      stop[currentLang] && stop[currentLang].t !== ""
        ? stop[currentLang]
        : stop.th;

    // ✅ สร้าง img แยก เพื่อให้ onerror และ onclick ทำงานได้แน่นอน
    const img = document.createElement("img");
    img.src = imgSrc;
    img.className = "timeline-img";
    img.alt = langData.t.replace(/<[^>]*>/g, ""); // strip HTML tags สำหรับ alt
    img.loading = "lazy";
    img.onerror = function () {
      this.onerror = null;
      this.src = "https://via.placeholder.com/200x150?text=Not+Found";
    };
    img.addEventListener("click", function () {
      if (typeof openImageModal === "function") {
        openImageModal(this.src);
      }
    });

    // ✅ สร้าง content แยก
    const content = document.createElement("div");
    content.className = "timeline-content";
    content.innerHTML = `
      <div class="tl-header"><span class="tl-title">${langData.t}</span></div>
      <div class="tl-desc">${langData.d || ""}</div>`;

    div.appendChild(img);
    div.appendChild(content);
    fragment.appendChild(div);
  });

  container.appendChild(fragment);
} 

// =========================================
// 6. ฟังก์ชันจัดการ UI และภาษา
// =========================================
function setCardImagesFromDB() {
  try {
    const getFirstImgPath = (station) => {
      if (!station) return "https://via.placeholder.com/200x150?text=No+Data";

      // ดึงรูปจาก Array 'imgs' เป็นหลัก ถ้าไม่มีให้หาจาก 'img' แบบเดิม
      let raw =
        station.imgs && station.imgs.length > 0
          ? station.imgs[0]
          : station.img || "";

      if (!raw) return "https://via.placeholder.com/200x150?text=No+Image";

      // คืนค่า Path ตามที่เขียนไว้ใน JSON เป๊ะๆ
      return raw;
    };

    const cardImages = document.querySelectorAll(".card-img");
    if (cardImages.length >= 3 && Object.keys(db).length > 0) {
      if (db.wellness1) cardImages[0].src = getFirstImgPath(db.wellness1[0]);
      if (db.spiritual1) cardImages[1].src = getFirstImgPath(db.spiritual1[0]);
      if (db.viewpoints) cardImages[2].src = getFirstImgPath(db.viewpoints[0]);
    }
  } catch (error) {
    console.error("Error setting card images:", error);
  }
}

// 🎯 ฟังก์ชันรับ Event จากปุ่มเปลี่ยนภาษา
function changeLanguage(lang) {
  if (!uiTranslations || Object.keys(uiTranslations).length === 0) return;

  currentLang = lang;
  localStorage.setItem("selectedLang", lang);

  // อัปเดตสีของปุ่มที่ถูกกด
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.id === `btn-${lang}`);
  });

  renderUI();
}

function renderUI() {
  if (Object.keys(db).length === 0 || Object.keys(uiTranslations).length === 0)
    return;

  const t = uiTranslations[currentLang] || uiTranslations["th"];

  // 1. กวาดแปลข้อความที่มี Attribute data-i18n
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const text = t[key];
    if (text) {
      if (element.tagName === "TITLE") document.title = text;
      else element.innerHTML = text;
    }
  });

  const logoEl = document.getElementById("header-logo");
  if (logoEl) {
    logoEl.innerHTML = `<i class="fa-solid fa-leaf" style="color: #ffffff;"></i>
        <a href="../view/intro.html" onclick="event.stopPropagation();" class="logo-text">
            ${t.logo || "Mangrove Smart StoryMap"}
        </a>`;
  }

  const elements = {
    "#welcome-popup h2": t.popupTitle,
    "#welcome-popup p": t.popupDesc,
    "#welcome-popup .btn-primary": t.popupBtn,
    ".stats-title": t.statsTitle,
    "#path-details-title": t.pathTitle,
  };

  Object.entries(elements).forEach(([selector, value]) => {
    const el = document.querySelector(selector);
    if (el && value) el.innerHTML = value;
  });

  const statLabels = document.querySelectorAll(".stat-label");
  if (statLabels.length >= 3) {
    statLabels[0].textContent = t.dist || "Distance";
    statLabels[1].textContent = t.time || "Time";
    statLabels[2].innerHTML = t.cal || "Calories";
  }

  const cards = document.querySelectorAll(".card");
  if (cards.length >= 3) {
    const routeKeys = ["wellness", "spiritual", "sightseeing"];
    cards.forEach((card, index) => {
      const key = routeKeys[index];

      // 🎯 แก้ไข: เปลี่ยนจาก .textContent เป็น .innerHTML เพื่อให้ไอคอนแสดงผล
      if (card.querySelector(".card-header span"))
        card.querySelector(".card-header span").innerHTML =
          t[`c${index + 1}Title`] || "";

      if (card.querySelector(".card-desc"))
        card.querySelector(".card-desc").innerHTML =
          t[`c${index + 1}Desc`] || "";

      // 🎯 แก้ไข: เปลี่ยนเป็น .innerHTML เผื่อในคำอธิบายมีเว้นบรรทัดหรือแท็ก HTML
      if (card.querySelector(".story-inline-desc"))
        card.querySelector(".story-inline-desc").innerHTML =
          t[`${key}Desc`] || "";

      if (card.querySelector(".btn-start-inline"))
        card.querySelector(".btn-start-inline").textContent =
          t.btnStartInline || "Start";

      const features = card.querySelectorAll(".story-inline-features li");
      const featureIcons = [
        ["fa-wind", "fa-heart-pulse"],
        ["fa-hands-praying", "fa-gopuram"],
        ["fa-camera", "fa-binoculars"],
      ];
      features.forEach((li, fIndex) => {
        if (t[`feature${index + 1}`]) {
          li.innerHTML = `<i class="fa-solid ${featureIcons[index][fIndex]}"></i> ${t[`feature${index + 1}`][fIndex]}`;
        }
      });
    });
  }

  getRealLocation();

  const activeCard = document.querySelector(".card.active");
  if (activeCard) {
    const type = activeCard.classList.contains("wellness")
      ? "wellness"
      : activeCard.classList.contains("spiritual")
        ? "spiritual"
        : "sightseeing";
    // ปล่อยพารามิเตอร์ที่ 4 ว่างไว้ หรือใส่ false
    selectRoute(activeCard, type, true);
  }
}

// =========================================
// 7. การเลือกการ์ดเส้นทาง
// =========================================

function selectRoute(
  clickedCard,
  type,
  isLangSwitch = false,
  isInitialLoad = false,
) {
  const isAlreadyActive = clickedCard.classList.contains("active");
  if (!isLangSwitch && !isInitialLoad && isAlreadyActive) {
    clickedCard.classList.toggle("collapsed");
    return;
  }

  if (isInitialLoad) {
    clickedCard.classList.remove("collapsed");
  }

  // ✅ เพิ่มตรงนี้ — reset sub-route และ badge เมื่อสลับ card
  if (!isLangSwitch) {
    activeSubRoute = null;
    document
      .querySelectorAll(".route-badge")
      .forEach((b) => b.classList.remove("active"));
  }

  // จัดการ UI ของการ์ด
  document.querySelectorAll(".card").forEach((card) => {
    card.classList.remove("active");
    card.classList.remove("collapsed");
    if (card.querySelector(".route-cb"))
      card.querySelector(".route-cb").checked = false;
  });

  clickedCard.classList.add("active");
  // ถือว่าเปิดมาครั้งแรกให้ขยายเนื้อหาเสมอ (ไม่ต้องใส่ collapsed)

  if (clickedCard.querySelector(".route-cb"))
    clickedCard.querySelector(".route-cb").checked = true;

  if (Object.keys(db).length === 0) return;

  // ข้อมูล Config แต่ละเส้น
  const routeConfig = {
    wellness: {
      db1: db.wellness1,
      db2: db.wellness2,
      color: "#4E8A63",
      stats1: { dist: "1.85", time: "28", cal: "110" },
      stats2: { dist: "1.45", time: "22", cal: "85" },
    },
    spiritual: {
      db1: db.spiritual1,
      db2: db.spiritual2,
      color: "#F5A623",
      stats1: { dist: "1.50", time: "23", cal: "90" },
      stats2: { dist: "0.80", time: "12", cal: "50" },
    },
    sightseeing: {
      db1: db.flora,
      db2: null,
      color: "#21f383",
      stats1: { dist: "0.90", time: "13", cal: "13" },
      line: false,
    },
  };
  const cfg = routeConfig[type];

  // ล้างแผนที่เดิม
  activePathLayer.clearLayers();

  // วาดแผนที่
  if (cfg.db1) drawRoute(cfg.db1, cfg.color, `${type}1`, cfg.line !== false);
  if (cfg.db2) drawRoute(cfg.db2, cfg.color, `${type}2`);

  // กรองข้อมูลสำหรับแสดงใน Timeline
  let timelineData = [];

  if (activeSubRoute) {
    if (activeSubRoute === `${type}1` && cfg.db1) {
      timelineData = cfg.db1;
    } else if (activeSubRoute === `${type}2` && cfg.db2) {
      timelineData = cfg.db2;
    }
  } else {
    timelineData = cfg.db2 ? [...cfg.db1, ...cfg.db2] : cfg.db1;
  }

  // ส่งข้อมูลที่ถูกกรองแล้วไปสร้าง Timeline
  renderTimeline(timelineData);

  // อัปเดตตัวเลข Stats
  const t = uiTranslations[currentLang] || uiTranslations["th"];
  const statsPanel = document.querySelector(".stats-panel");

  if (type === "sightseeing") {
    // ซ่อนกล่องสถิติเมื่อเป็นจุดชมวิว
    if (statsPanel) statsPanel.style.display = "none";
  } else {
    // แสดงกล่องสถิติสำหรับเส้นทางอื่น
    if (statsPanel) statsPanel.style.display = "";

    // 🎯 เลือกชุดข้อมูล Stats ให้ตรงกับเส้นทางย่อย (Sub-route) ที่ถูกคลิก
    let activeStats = cfg.stats1; // ค่าเริ่มต้นคือเส้นทางที่ 1
    if (activeSubRoute === `${type}2`) {
      activeStats = cfg.stats2; // สลับเป็นเส้นทางที่ 2 ถ้าถูกเลือก
    }

    if (document.getElementById("ui-dist"))
      document.getElementById("ui-dist").innerHTML =
        `${activeStats.dist} <span style="font-size: 0.7rem">km</span>`;
    if (document.getElementById("ui-time"))
      document.getElementById("ui-time").innerHTML =
        `${activeStats.time} <span style="font-size: 0.7rem">mins</span>`;
    if (document.getElementById("ui-cal"))
      document.getElementById("ui-cal").innerHTML =
        `~${activeStats.cal} <span style="font-size: 0.7rem">kcal</span>`;
  }

  // อนิเมชั่นเลื่อนกล้องบนแผนที่
  if (!isLangSwitch) {
    clickedCard.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
    if (activePathLayer.getLayers().length > 0) {
      const isMobile = window.innerWidth <= 768;
      const padTop = isMobile ? [10, 120] : [80, 50];
      const padBottom = isMobile ? [10, 400] : [200, 150];
      map.fitBounds(activePathLayer.getBounds(), {
        paddingTopLeft: padTop,
        paddingBottomRight: padBottom,
        maxZoom: 16,
        animate: true,
        duration: 0.5,
      });
    }
  }
}
// =========================================
// 8. ฟังก์ชันเครื่องมือ (Utils)
// =========================================
function updateRealTime() {
  const timeDisplay = document.getElementById("current-time");
  if (timeDisplay) {
    timeDisplay.innerText = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
setInterval(updateRealTime, 1000);

function getRealLocation() {
  const locEl = document.getElementById("header-location");
  if (!locEl || !uiTranslations[currentLang]) return;
  const t = uiTranslations[currentLang];

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10&accept-language=${currentLang}`,
        )
          .then((res) => res.json())
          .then((data) => {
            const city =
              data.address.state ||
              data.address.province ||
              data.address.city ||
              (currentLang === "th" ? "ไม่ทราบเมือง" : "Unknown");
            locEl.innerText = `📍 ${city}, ${data.address.country || ""}`;
          })
          .catch(
            () =>
              (locEl.innerText = `📍 ${t.locationError || "Location Error"}`),
          );
      },
      () => (locEl.innerText = `📍 ${t.locationOff || "Location Off"}`),
    );
  }
}

function requestAllPermissions() {
  // ฟังก์ชันเปล่าสำหรับรับ Event จากหน้า Intro ป้องกัน Error
  const popup = document.getElementById("permission-popup");
  if (popup) {
    popup.style.opacity = "0";
    setTimeout(() => popup.remove(), 300);
  }
}

function closePopup() {
  document.getElementById("welcome-popup")?.classList.add("hidden");
}
function hideLoadingScreen() {
  document.getElementById("loading-screen")?.classList.add("hidden");
}
function goToRoute(url) {
  document.getElementById("loading-screen")?.classList.remove("hidden");
  setTimeout(() => {
    window.location.href = url;
  }, 800);
}
function goToMap(mainType) {
  let url = `../view/mangrove.html?route=${mainType}`;

  if (
    typeof activeSubRoute !== "undefined" &&
    activeSubRoute &&
    activeSubRoute.includes(mainType)
  ) {
    url += `&sub=${activeSubRoute}`;
  }

  goToRoute(url);
}
function scrollCards(direction) {
  document
    .getElementById("cards-container")
    ?.scrollBy({ left: direction === "left" ? -320 : 320, behavior: "smooth" });
}
function updateSidebarIcon() {
  const panel = document.querySelector(".dashboard-ui");
  const btnIcon = document.querySelector(".toggle-sidebar-btn i");
  if (!panel || !btnIcon) return;

  const isMobile = window.innerWidth <= 768;
  const isHidden = panel.classList.contains("sidebar-hidden");

  if (isMobile) {
    btnIcon.className = isHidden
      ? "fa-solid fa-chevron-up"
      : "fa-solid fa-chevron-down";
  }
}

function toggleSidebar() {
  const panel = document.querySelector(".dashboard-ui");
  const btn = document.querySelector(".toggle-sidebar-btn");

  if (panel) panel.classList.toggle("sidebar-hidden");
  if (btn) btn.classList.toggle("sidebar-hidden"); // 🎯 บรรทัดนี้สำคัญมาก เพื่อให้ปุ่มมุดตาม

  updateSidebarIcon(); // ฟังก์ชันเปลี่ยนไอคอนลูกศร
}

function togglePathDetails() {
  const timeline = document.getElementById("timeline-container");
  const btnIcon = document.querySelector(".btn-toggle-path i");

  if (timeline.style.display === "none") {
    // ถ้าซ่อนอยู่ ให้เปิดออก
    timeline.style.display = "block";
    btnIcon.className = "fa-solid fa-chevron-up"; // เปลี่ยนลูกศรชี้ขึ้น
  } else {
    // ถ้ากางอยู่ ให้พับเก็บ
    timeline.style.display = "none";
    btnIcon.className = "fa-solid fa-chevron-down"; // เปลี่ยนลูกศรชี้ลง
  }
}
// =========================================
// 9. ฟังก์ชันดูรูปเต็ม (Image Modal) - แบบง่าย
// =========================================

/**
 * เปิด Modal แสดงรูปเดียว
 * @param {string} imgSrc - URL ของรูป
 */
function openImageModal(imgSrc) {
  const modal = document.getElementById("image-modal");
  const modalImg = document.getElementById("full-image");

  if (!modal || !modalImg) {
    console.error("❌ Modal elements not found");
    return;
  }

  console.log("📸 Opening image:", imgSrc);

  // แสดงรูป
  modalImg.src = imgSrc;
  modal.classList.remove("hidden");
  modal.classList.add("show");
  
  // ป้องกัน scroll body
  document.body.style.overflow = "hidden";
}

/**
 * ปิด Modal
 */
function closeImageModal() {
  const modal = document.getElementById("image-modal");
  
  if (!modal) return;

  console.log("❌ Closing modal");

  modal.classList.add("hidden");
  modal.classList.remove("show");
  
  // คืนค่า scroll body
  document.body.style.overflow = "";
}

// Event Listeners
document.addEventListener("DOMContentLoaded", function() {
  // 1. ESC key เพื่อปิด
  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closeImageModal();
    }
  });

  // 2. คลิกพื้นหลังเพื่อปิด
  const modal = document.getElementById("image-modal");
  if (modal) {
    modal.addEventListener("click", function(e) {
      // ปิดเมื่อคลิกพื้นหลัง (ไม่ใช่รูป)
      if (e.target === modal || e.target.classList.contains("image-modal")) {
        closeImageModal();
      }
    });
  }

  // 3. คลิกปุ่ม X เพื่อปิด
  const closeBtn = document.querySelector(".close-modal");
  if (closeBtn) {
    closeBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      closeImageModal();
    });
  }
});