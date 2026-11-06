let allTranslations = null;

// แก้ไขฟังก์ชัน loadTranslations ในไฟล์ intro.js
async function loadTranslations() {
    try {
        const response = await fetch("../storage/intro_translate.json");
        if (!response.ok) throw new Error("ไม่สามารถโหลดไฟล์ภาษาได้");
        allTranslations = await response.json();

        const savedLang = localStorage.getItem("selectedLang") || "th";
        applyLanguage(savedLang);

        // ✨ เพิ่มบรรทัดเหล่านี้เพื่อสลับ Skeleton เป็นเนื้อหาจริง
        const skeleton = document.getElementById('routes-skeleton');
        const actual = document.getElementById('actual-routes');
        if (skeleton && actual) {
            skeleton.style.display = 'none'; // ซ่อนกระดูก
            actual.style.display = 'grid';   // โชว์เนื้อหาจริง (ใช้ grid ตามคลาสเดิม)
        }

        console.log("✅ โหลดภาษาและสลับเนื้อหาเรียบร้อย");
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

// 🎯 2. ฟังก์ชันเปลี่ยนภาษา (แบบรองรับกรณีไฟล์โหลดช้า)
async function changeLanguage(lang) {
    // บันทึกภาษาลงเครื่องทันที
    localStorage.setItem("selectedLang", lang);

    // ถ้ากดปุ่มขณะที่ไฟล์ JSON ยังโหลดไม่เสร็จ ให้รอแป๊บหนึ่ง
    if (!allTranslations) {
        await loadTranslations();
    }

    applyLanguage(lang);
}

// 🎯 3. ฟังก์ชันแสดงผล (เหมือนเดิมแต่เพิ่มการตรวจสอบ ID)
function applyLanguage(lang) {
    if (!allTranslations || !allTranslations[lang]) return;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.getAttribute("data-i18n");
        const text = allTranslations[lang][key];

        if (text) {
            if (element.tagName === "TITLE") {
                document.title = text;
            } else {
                element.innerHTML = text;
            }
        }
    });

    // 🎯 อัปเดตปุ่ม Active (ตรวจสอบว่า ID ปุ่มใน HTML ตรงกับ btn-th, btn-en, btn-zh)
    document.querySelectorAll(".lang-btn").forEach((btn) => {
        btn.classList.remove("active");
    });
    
    const activeBtn = document.getElementById(`btn-${lang}`);
    if (activeBtn) {
        activeBtn.classList.add("active");
    }
}

document.addEventListener("DOMContentLoaded", loadTranslations);
// ฟังก์ชันตรวจจับการเลื่อนหน้าจอเพื่อเปลี่ยนสถานะ Navbar
window.addEventListener('scroll', function() {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});