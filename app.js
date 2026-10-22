// ----- Firebase (v10 modular) -----
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/** 1) Firebase Configuration */
const firebaseConfig = {
  apiKey: "AIzaSyBb426TWAtgNOu32ZeP7gSIySZiWrtZBM4",
  authDomain: "timetable-97e6a.firebaseapp.com",
  projectId: "timetable-97e6a",
  storageBucket: "timetable-97e6a.firebasestorage.app",
  messagingSenderId: "106716769819",
  appId: "1:106716769819:web:62d3acc8201dbbc46d52be",
  measurementId: "G-1J2PXCG1XD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----- Constants -----
let PEOPLE = ["עובד 1", "עובד 2", "עובד 3"];
const MS_DAY = 86400000;
// Calendar-safe day arithmetic (immune to DST shifts, unlike adding MS_DAY)
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

const WEEKDAY_SHIFT_OPTIONS = [
  { value: "14:30-22:00", label: "14:30–22:00" },
  { value: "15:00-22:00", label: "15:00–22:00" },
  { value: "15:30-22:00", label: "15:30–22:00" },
  { value: "16:00-22:00", label: "16:00–22:00" },
  { value: "16:30-22:00", label: "16:30–22:00" },
  { value: "17:00-22:00", label: "17:00–22:00" },
  { value: "", label: "—————————", disabled: true },
  { value: "08:00-14:00", label: "08:00–14:00" },
  { value: "08:30-14:00", label: "08:30–14:00" },
  { value: "09:00-14:00", label: "09:00–14:00" },
  { value: "08:00-16:00", label: "08:00–16:00" },
  { value: "08:30-16:00", label: "08:30–16:00" },
  { value: "09:00-16:00", label: "09:00–16:00" }
];

const FRIDAY_SHIFT_OPTIONS = [
  { value: "08:00-14:00", label: "08:00–14:00" },
  { value: "08:30-14:00", label: "08:30–14:00" },
  { value: "09:00-14:00", label: "09:00–14:00" }
];

function getShiftLabelAndStart(val, jsDow) {
  if (!val) {
    val = jsDow === 5 ? "08:00" : "16:00";
  }

  val = val.trim();

  if (val.includes('-') || val.includes('–')) {
    const parts = val.split(/[-–]/);
    const start = parts[0].trim();
    const end = parts[1].trim();
    return {
      label: `${start}–${end}`,
      startTime: start,
      value: `${start}-${end}`
    };
  }

  const start = val;
  let end = "";
  if (jsDow === 5) {
    end = "14:00";
  } else {
    const classicStarts = ["14:30", "15:00", "15:30", "16:00", "16:30", "17:00"];
    if (classicStarts.includes(start)) {
      end = "22:00";
    } else {
      end = "14:00";
    }
  }

  return {
    label: `${start}–${end}`,
    startTime: start,
    value: `${start}-${end}`
  };
}

function getIsraelTime() {
  const now = new Date();
  // We use the browser's locale conversion to ensure we are looking at Israel time
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
}

function getAutoStartDate(mode, roomObj = null) {
  const now = getIsraelTime();
  const day = now.getDay();
  const hour = now.getHours();
  const minutes = now.getMinutes();

  if (mode === "hub" || mode === "view") {
    // Hub and View Only display current week until Saturday 07:00 PM (end of the work week)
    let hubSun = new Date(now);
    hubSun.setHours(0, 0, 0, 0);
    hubSun.setDate(hubSun.getDate() - hubSun.getDay());
    if (day === 6 && hour >= 19) {
      hubSun.setDate(hubSun.getDate() + 7);
    }
    return hubSun;
  } else {
    // Selection panel (regular mode) displays current week until Thursday 12:00 PM (or custom room reset time),
    // then switches to the NEXT week's board to allow filling constraints in advance.
    let targetSun = new Date(now);
    targetSun.setHours(0, 0, 0, 0);
    // Go to the Sunday of the current week
    targetSun.setDate(targetSun.getDate() - targetSun.getDay());
    
    // Switch to next week only from reset time onwards
    let resetDay = 4; // Thursday default
    let resetHour = 12; // 12:00 default
    let resetMin = 0;
    
    if (roomObj) {
      if (roomObj.resetDay !== undefined) resetDay = parseInt(roomObj.resetDay, 10);
      if (roomObj.resetTime) {
        const [h, m] = roomObj.resetTime.split(":").map(Number);
        resetHour = h;
        resetMin = m || 0;
      }
    }
    
    const hasPassed = (day > resetDay) || 
                      (day === resetDay && (hour > resetHour || (hour === resetHour && minutes >= resetMin)));
                      
    if (hasPassed) {
      targetSun.setDate(targetSun.getDate() + 7);
    }
    return targetSun;
  }
}


let ROOMS = [
  { id: "printers", name: "חדר מדפסות", people: ["עובד 1", "עובד 2", "עובד 3"] },
  { id: "wood", name: "חדר עץ", people: ["עובד 1", "עובד 2"] },
  { id: "metal", name: "חדר מתכת", people: ["עובד 1"] },
  { id: "sewing", name: "חדר תפירה", people: ["עובד 2"] },
  { id: "machining", name: "חדר עיבוד שבבים", people: ["עובד 2", "עובד 3"] }
];

const urlParams = new URLSearchParams(window.location.search);
let activeRoom = urlParams.get("room") || localStorage.getItem("scheduler_room") || "wood";
if (urlParams.get("room")) {
  localStorage.setItem("scheduler_room", activeRoom);
}

const bottomTabs = document.getElementById("bottomTabs");
const appTitle = document.getElementById("appTitle");
const daysGrid = document.getElementById("daysGrid");
const scheduleGrid = document.getElementById("scheduleGrid");
const dateRangeBadge = document.getElementById("dateRangeBadge");
const resetMineBtn = document.getElementById("resetMineBtn");
const themeBtn = document.getElementById("themeBtn");
const whoamiEl = document.getElementById("whoami");
const themeIcon = document.getElementById("themeIcon");
const switchUserBtn = document.getElementById("switchUserBtn");
const identityBackdrop = document.getElementById("identityBackdrop");
const identitySelect = document.getElementById("identitySelect");
const identityStartBtn = document.getElementById("identityStartBtn");
const viewOnlyBtn = document.getElementById("viewOnlyBtn");
const addCalendarBtn = document.getElementById("addCalendarBtn");
const helpBtn = document.getElementById("helpBtn");
const helpBackdrop = document.getElementById("helpBackdrop");
const helpCloseBtn = document.getElementById("helpCloseBtn");
const welcomeBackdrop = document.getElementById("welcomeBackdrop");
const welcomeCloseBtn = document.getElementById("welcomeCloseBtn");
const resetNotificationBackdrop = document.getElementById("resetNotificationBackdrop");
const resetNotificationCloseBtn = document.getElementById("resetNotificationCloseBtn");

const hubBtn = document.getElementById("hubBtn");
const hubView = document.getElementById("hubView");
const mainContainer = document.getElementById("mainContainer");
const mainSchedulePanel = document.getElementById("mainSchedulePanel");
const mainConstraintsPanel = document.getElementById("mainConstraintsPanel");
const hubGrid = document.getElementById("hubGrid");
const hubDateBadge = document.getElementById("hubDateBadge");
const loaderOverlay = document.getElementById("loaderOverlay");

function showLoader() { if (loaderOverlay) loaderOverlay.classList.remove("hidden"); }
function hideLoader() { if (loaderOverlay) loaderOverlay.classList.add("hidden"); }

let isBypassMode = localStorage.getItem("isBypassMode") === "true";
let isManualMode = false;

const adminManualBtn = document.getElementById("adminManualBtn");

function updateAdvancedBtns() {
  if (adminManualBtn) adminManualBtn.style.border = isManualMode ? "2px solid var(--md-sys-color-primary)" : "none";
}
if (adminManualBtn) adminManualBtn.addEventListener("click", () => { 
  enterManualMode();
});

// ----- Floating Admin Bar Logic -----
const floatingAdminBar = document.getElementById("floatingAdminBar");
const bypassCheckbox = document.getElementById("bypassCheckbox");
const manualUndoBtn = document.getElementById("manualUndoBtn");
const manualRedoBtn = document.getElementById("manualRedoBtn");
const manualSaveBtn = document.getElementById("manualSaveBtn");
const manualCancelBtn = document.getElementById("manualCancelBtn");

let manualHistory = []; // Last 3 states
let manualRedoStack = [];
let originalStateSnapshot = null;
let originalBypassSnapshot = false;

function enterManualMode() {
  isManualMode = true;
  originalStateSnapshot = JSON.parse(JSON.stringify(state));
  originalBypassSnapshot = isBypassMode;
  
  manualHistory = [JSON.parse(JSON.stringify(state))];
  manualRedoStack = [];
  
  if (adminBackdrop) adminBackdrop.style.display = "none";
  if (floatingAdminBar) floatingAdminBar.style.display = "block";
  if (bypassCheckbox) bypassCheckbox.checked = isBypassMode;
  
  updateUndoRedoBtns();
  refreshScheduleUI();
}

function updateUndoRedoBtns() {
  if (manualUndoBtn) manualUndoBtn.disabled = manualHistory.length <= 1;
  if (manualRedoBtn) manualRedoBtn.disabled = manualRedoStack.length === 0;
}

function pushHistory() {
  manualHistory.push(JSON.parse(JSON.stringify(state)));
  if (manualHistory.length > 4) manualHistory.shift(); // Keep current + 3 previous
  manualRedoStack = [];
  updateUndoRedoBtns();
}

if (bypassCheckbox) {
  bypassCheckbox.addEventListener("change", (e) => {
    isBypassMode = e.target.checked;
    refreshScheduleUI();
  });
}

if (manualUndoBtn) {
  manualUndoBtn.addEventListener("click", () => {
    if (manualHistory.length > 1) {
      const current = manualHistory.pop();
      manualRedoStack.push(current);
      state = JSON.parse(JSON.stringify(manualHistory[manualHistory.length - 1]));
      updateUndoRedoBtns();
      refreshScheduleUI();
    }
  });
}

if (manualRedoBtn) {
  manualRedoBtn.addEventListener("click", () => {
    if (manualRedoStack.length > 0) {
      const next = manualRedoStack.pop();
      manualHistory.push(next);
      state = JSON.parse(JSON.stringify(next));
      updateUndoRedoBtns();
      refreshScheduleUI();
    }
  });
}

if (manualCancelBtn) {
  manualCancelBtn.addEventListener("click", () => {
    state = JSON.parse(JSON.stringify(originalStateSnapshot));
    isBypassMode = originalBypassSnapshot;
    isManualMode = false;
    if (floatingAdminBar) floatingAdminBar.style.display = "none";
    refreshScheduleUI();
  });
}

if (manualSaveBtn) {
  manualSaveBtn.addEventListener("click", async () => {
    showLoader();
    try {
      // Find all date keys that changed
      const keys = new Set([
        ...Object.keys(state),
        ...Object.keys(originalStateSnapshot)
      ]);
      
      for (const key of keys) {
        const currentData = state[key] || {};
        const originalData = originalStateSnapshot[key] || {};
        
        // Only save if data actually changed
        if (JSON.stringify(currentData) !== JSON.stringify(originalData)) {
          await saveConstraint(key, currentData);
        }
      }
      
      localStorage.setItem("isBypassMode", isBypassMode);
      isManualMode = false;
      if (floatingAdminBar) floatingAdminBar.style.display = "none";
      alert("השינויים נשמרו בהצלחה!");
    } catch (err) {
      console.error("Save failed", err);
      alert("שגיאה בשמירת הנתונים.");
    } finally {
      hideLoader();
      refreshScheduleUI();
    }
  });
}


const urlWeek = urlParams.get("week");
let isHubMode = urlParams.get("view") === "hub";

// View Mode handling
const isViewMode = urlParams.get("view") === "1";
if (isViewMode) {
  document.body.classList.add("view-only");
  const viewPrevWeekBtn = document.getElementById("viewPrevWeekBtn");
  if (viewPrevWeekBtn) {
    viewPrevWeekBtn.style.display = "inline-block";
    viewPrevWeekBtn.addEventListener("click", () => {
      const weekStart = new Date(startDate);
      while (weekStart.getDay() !== 0) { weekStart.setDate(weekStart.getDate() - 1); }
      const prevWeekStart = addDays(weekStart, -7);
      
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("week", fmtDateKey(prevWeekStart));
      window.location.href = newUrl.toString();
    });
  }
}

let activePerson = localStorage.getItem(`scheduler_person_${activeRoom}`) || PEOPLE[0];
let rangeWeeks = 4;
let today = startOfDay(getIsraelTime());

let startDate;
// In Selection mode (regular editing), we always want the dynamic auto-reset date on load.
// We only respect urlWeek for View-only mode or Hub mode which are more likely to be used with specific shared links.
if (urlWeek && (isViewMode || isHubMode)) {
  startDate = startOfDay(new Date(urlWeek));
} else {
  startDate = getAutoStartDate(isHubMode ? "hub" : (isViewMode ? "view" : "selection"));
}

// Sync URL to ensure it always has room, week, and view if applicable
const syncUrl = new URL(window.location.href);
syncUrl.searchParams.set("room", activeRoom);
syncUrl.searchParams.set("week", fmtDateKey(startDate));
if (isHubMode) syncUrl.searchParams.set("view", "hub");
else if (isViewMode) syncUrl.searchParams.set("view", "1");
window.history.replaceState({}, "", syncUrl.toString());

let endDate = addDays(startDate, 30);

let monthKey = monthKeyFrom(startDate);

// Local state: dateKey -> { name: 0/1/2 }
let state = Object.create(null);
let specialDays = Object.create(null); // dateKey -> { title, type }
let excludedUsers = [];
let staffColors = Object.create(null); // name -> colorClass

let metaUnsub = null;
let daysUnsub = null;

// ----- Color Palette & Auto Assignment -----
const PALETTE_CLASSES = [
  'palette-red', 'palette-pink', 'palette-purple', 'palette-indigo', 
  'palette-blue', 'palette-cyan', 'palette-teal', 'palette-green', 
  'palette-amber', 'palette-orange', 'palette-brown',
  'palette-lime', 'palette-magenta', 'palette-slate', 'palette-olive',
  'palette-coral', 'palette-mint'
];

function stringHash(str) {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getStaffColor(personName) {
  if (!personName) return 'palette-slate';
  if (staffColors[personName]) return staffColors[personName];
  const idx = stringHash(personName) % PALETTE_CLASSES.length;
  return PALETTE_CLASSES[idx];
}

function getRoomColor(roomObj) {
  if (roomObj.color) return roomObj.color;
  if (roomObj.id === "printers") return "palette-purple";
  const idx = stringHash(roomObj.id) % PALETTE_CLASSES.length;
  return PALETTE_CLASSES[idx];
}

// ----- Date Utils -----
function startOfDay(d) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function fmtDateKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function fmtDM(d) {
  const dd = String(d.getDate()).padStart(2, "0"), mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}
function fmtHuman(d) { return fmtDM(d) + "." + d.getFullYear(); }
function rangeDays(d0, d1) { const out = []; let t = startOfDay(d0).getTime(), t1 = startOfDay(d1).getTime(); for (let d = new Date(t); d.getTime() <= t1; d = addDays(d, 1)) out.push(d); return out; }
const hebDays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const hebDaysLong = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function shiftForDate(d, customRoom = null) {
  const jsDow = d.getDay();
  const key = fmtDateKey(d);
  const special = specialDays[key];

  if (special && special.type === "no_shifts") {
    return { label: special.title, specialType: "no_shifts" };
  }

  const targetRoom = customRoom || ROOMS.find(r => r.id === activeRoom) || ROOMS[0];
  let baseLabel = "";

  if (jsDow === 6) return null; // Saturday

  const dayData = state[key] || {};
  const customShiftTimes = dayData.customShiftTimes || {};
  let startStr = customShiftTimes[targetRoom.id];

  if (!startStr) {
    if (targetRoom && targetRoom.shiftTimes && targetRoom.shiftTimes[jsDow]) {
      startStr = targetRoom.shiftTimes[jsDow];
    } else {
      if (jsDow >= 0 && jsDow <= 4) startStr = "16:00";
      else if (jsDow === 5) startStr = "08:00";
      else return null;
    }
  }

  const res = getShiftLabelAndStart(startStr, jsDow);
  baseLabel = res.label;

  if (special && special.type === "close_early") {
    return { label: `${special.title} (סוגרים מוקדם)`, specialType: "close_early", originalHours: baseLabel, startTime: res.startTime, endTime: baseLabel.split('–')[1] };
  }

  return { label: baseLabel, startTime: res.startTime, endTime: baseLabel.split('–')[1] };
}
function monthKeyFrom(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"); return `${y}-${m}`; }
function prevSunday(d) {
  const x = startOfDay(d);
  return addDays(x, -x.getDay());
}
function weekIndexFor(date) {
  let s = prevSunday(startDate);
  return Math.floor(Math.round((startOfDay(date) - s) / MS_DAY) / 7);
}

// ----- UI: Person Selection -----
async function toggleExcludedUser(p) {
  if (excludedUsers.includes(p)) {
    excludedUsers = excludedUsers.filter(x => x !== p);
  } else {
    excludedUsers.push(p);
  }
  const ref = doc(db, "constraints", monthKey, "days", "_meta");
  await setDoc(ref, { excludedUsers }, { merge: true });
  updatePersonUI();
  refreshScheduleUI();
}

function updatePersonUI() {
  document.querySelectorAll("#peopleChipsContainer .chip").forEach(btn => {
    const p = btn.dataset.person;
    btn.classList.toggle("active", p === activePerson);
    
    // Apply staff color
    const colorCls = getStaffColor(p);
    PALETTE_CLASSES.forEach(c => btn.classList.remove(c));
    btn.classList.add(colorCls);
    
    if (excludedUsers.includes(p)) {
      btn.style.textDecoration = "line-through";
      btn.style.opacity = "0.5";
    } else {
      btn.style.textDecoration = "none";
      btn.style.opacity = "1";
    }

    btn.onclick = (e) => {
      activePerson = p;
      localStorage.setItem(`scheduler_person_${activeRoom}`, activePerson);
      whoamiEl.textContent = "אתה: " + activePerson;
      updatePersonUI();
      renderCalendar();
    };

    btn.ondblclick = (e) => {
      toggleExcludedUser(p);
    };
  });
}

function renderPeopleUI() {
  const chipsHtml = PEOPLE.map(p => `<button class="chip" data-person="${p}">${p}</button>`).join("");
  const container = document.getElementById("peopleChipsContainer");
  if (container) container.innerHTML = chipsHtml;

  const optionsHtml = PEOPLE.map(p => `<option value="${p}">${p}</option>`).join("");
  identitySelect.innerHTML = optionsHtml;
  if (PEOPLE.includes(activePerson)) {
    identitySelect.value = activePerson;
  }

  updatePersonUI();
}

renderPeopleUI();
whoamiEl.textContent = "אתה: " + activePerson;

// ----- UI: Theme Toggle -----
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function getInitialTheme() {
  const saved = localStorage.getItem("scheduler_theme");
  if (saved) return saved;
  return systemPrefersDark.matches ? "dark" : "light";
}

let currentTheme = getInitialTheme();
document.documentElement.setAttribute("data-theme", currentTheme);

systemPrefersDark.addEventListener('change', (e) => {
  if (!localStorage.getItem("scheduler_theme")) {
    currentTheme = e.matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    renderThemeIcon();
  }
});

function renderThemeIcon() {
  themeIcon.innerHTML = currentTheme === "dark"
    ? `<path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/>`
    : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
}

renderThemeIcon();

themeBtn.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", currentTheme);
  localStorage.setItem("scheduler_theme", currentTheme);
  renderThemeIcon();
});

// ----- UI: Switch User (Identity) -----
if (switchUserBtn) {
  switchUserBtn.addEventListener("click", () => {
    const roomObj = ROOMS.find(r => r.id === activeRoom) || ROOMS[0];
    const titleEl = document.getElementById("identityModalTitle");
    if (titleEl) titleEl.textContent = `מי אתה? (${roomObj ? roomObj.name : 'חדר'})`;
    identitySelect.value = activePerson;
    identityBackdrop.style.display = "flex";
  });
}
identityStartBtn.addEventListener("click", () => {
  activePerson = identitySelect.value;
  localStorage.setItem(`scheduler_person_${activeRoom}`, activePerson);
  whoamiEl.textContent = "אתה: " + activePerson;
  updatePersonUI();
  renderCalendar();
  identityBackdrop.style.display = "none";
});

// ----- UI: Render Calendar (Constraints) -----
// Coalesce bursts of live-sync snapshots into a single render per frame
let liveRenderQueued = false;
function scheduleLiveRender() {
  if (liveRenderQueued) return;
  liveRenderQueued = true;
  requestAnimationFrame(() => {
    liveRenderQueued = false;
    if (isHubMode) {
      renderHub();
    } else {
      renderCalendar();
      refreshScheduleUI();
    }
  });
}

function renderCalendar() {
  const days = rangeDays(startDate, endDate);
  // Filter out Saturday (6) from headers
  const headDays = hebDays.slice(0, 6); // א'-ו'
  const head = headDays.map(h => `<div class="day head" aria-hidden="true"><div class="d1"></div><div class="d2">${h}</div></div>`).join("");

  let html = head;
  for (const d of days) {
    const jsDow = d.getDay();
    if (jsDow === 6) continue; // Skip Saturday entirely

    const key = fmtDateKey(d);
    const sh = shiftForDate(d);
    const cur = (state[key] || {});
    const val = Number(cur[activePerson] ?? 0);

    const isNoShift = sh && sh.specialType === "no_shifts";
    const disabledClass = isNoShift ? "disabled" : "";

    html += `
      <div class="day ${jsDow === 5 ? 'fri' : ''} state-${val} ${disabledClass}" data-key="${key}" ${isNoShift ? 'style="opacity:0.5; pointer-events:none;"' : ''}>
        <div class="d1">${hebDays[jsDow]}, ${fmtDM(d)}</div>
        <div class="d2">${sh ? sh.label : "—"}</div>
      </div>
    `;
  }
  daysGrid.innerHTML = html;

  daysGrid.querySelectorAll(".day").forEach(el => {
    const key = el.dataset.key;
    if (!key) return;
    const jsDow = new Date(key).getDay();
    if (jsDow === 6) return;
    el.addEventListener("click", () => {
      const sh = shiftForDate(new Date(key));
      if (sh && sh.specialType === "no_shifts") return;

      const cur = state[key] || {};
      const old = Number(cur[activePerson] ?? 0);
      const next = (old + 1) % 3;
      cur[activePerson] = next;
      state[key] = cur;
      el.classList.remove("state-0", "state-1", "state-2");
      el.classList.add(`state-${next}`);
      saveConstraint(key, state[key]);
      refreshScheduleUI(); // Instant local update
    });
  });
  updateSundayLockUI();
}

// ----- Sunday Lock Logic -----
function isSundayLocked() {
  const now = getIsraelTime();
  const weekSunday = startOfDay(startDate);
  
  if (now.getTime() < weekSunday.getTime()) {
    return false;
  }
  
  const unlockKey = `unlockedConstraints_${activeRoom}_${fmtDateKey(weekSunday)}`;
  const unlockedUntil = localStorage.getItem(unlockKey);
  if (unlockedUntil && parseInt(unlockedUntil, 10) > now.getTime()) {
    return false;
  }
  return true;
}

function updateSundayLockUI() {
  const isLocked = isSundayLocked();
  const lockBtn = document.getElementById("sundayLockBtn");
  const bd = mainConstraintsPanel.querySelector(".bd");
  
  const now = getIsraelTime();
  const weekSunday = startOfDay(startDate);
  const inLockWindow = now.getTime() >= weekSunday.getTime();

  if (lockBtn) {
    if (inLockWindow) {
      lockBtn.style.display = "flex";
      if (isLocked) {
        lockBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
        lockBtn.title = "לוח נעול (בחדר זה) - לחץ לפתיחה";
        lockBtn.style.color = "inherit";
      } else {
        lockBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
        lockBtn.title = "לוח פתוח זמנית (בחדר זה) - לחץ לנעילה מחודשת";
        lockBtn.style.color = "var(--md-sys-color-primary)";
      }
    } else {
      lockBtn.style.display = "none";
    }
  }

  if (bd) {
    if (isLocked) {
      bd.style.opacity = "0.4";
      bd.style.pointerEvents = "none";
    } else {
      bd.style.opacity = "1";
      bd.style.pointerEvents = "auto";
    }
  }
}

const sundayLockBtn = document.getElementById("sundayLockBtn");
const unlockConfirmBackdrop = document.getElementById("unlockConfirmBackdrop");
const unlockCancelBtn = document.getElementById("unlockCancelBtn");
const unlockActionBtn = document.getElementById("unlockActionBtn");

if (sundayLockBtn) {
  sundayLockBtn.addEventListener("click", () => {
    if (isSundayLocked()) {
      if (unlockConfirmBackdrop) unlockConfirmBackdrop.style.display = "flex";
    } else {
      const weekSunday = startOfDay(startDate);
      localStorage.removeItem(`unlockedConstraints_${activeRoom}_${fmtDateKey(weekSunday)}`);
      updateSundayLockUI();
    }
  });
}

if (unlockCancelBtn) {
  unlockCancelBtn.addEventListener("click", () => {
    if (unlockConfirmBackdrop) unlockConfirmBackdrop.style.display = "none";
  });
}

if (unlockActionBtn) {
  unlockActionBtn.addEventListener("click", () => {
    const now = getIsraelTime();
    const weekSunday = startOfDay(startDate);
    const unlockTime = now.getTime() + 24 * 60 * 60 * 1000;
    localStorage.setItem(`unlockedConstraints_${activeRoom}_${fmtDateKey(weekSunday)}`, unlockTime);
    updateSundayLockUI();
    if (unlockConfirmBackdrop) unlockConfirmBackdrop.style.display = "none";
  });
}

if (helpBtn) {
  helpBtn.addEventListener("click", () => {
    if (helpBackdrop) helpBackdrop.style.display = "flex";
  });
}
if (helpCloseBtn) {
  helpCloseBtn.addEventListener("click", () => {
    if (helpBackdrop) helpBackdrop.style.display = "none";
  });
}
if (helpBackdrop) {
  helpBackdrop.addEventListener("click", (e) => {
    if (e.target === helpBackdrop) {
      helpBackdrop.style.display = "none";
    }
  });
}

if (welcomeCloseBtn) {
  welcomeCloseBtn.addEventListener("click", () => {
    if (welcomeBackdrop) welcomeBackdrop.style.display = "none";
    localStorage.setItem("scheduler_welcome_whatsnew_v1.5", "true");
  });
}
if (welcomeBackdrop) {
  welcomeBackdrop.addEventListener("click", (e) => {
    if (e.target === welcomeBackdrop) {
      welcomeBackdrop.style.display = "none";
      localStorage.setItem("scheduler_welcome_whatsnew_v1.5", "true");
    }
  });
}

if (resetNotificationCloseBtn) {
  resetNotificationCloseBtn.addEventListener("click", () => {
    if (resetNotificationBackdrop) resetNotificationBackdrop.style.display = "none";
  });
}
if (resetNotificationBackdrop) {
  resetNotificationBackdrop.addEventListener("click", (e) => {
    if (e.target === resetNotificationBackdrop) {
      resetNotificationBackdrop.style.display = "none";
    }
  });
}


function refreshScheduleUI() {
  const pack = computeSchedule();
  renderSchedule(pack);
  renderSummary(pack);
}

// ----- Firebase Logic -----
async function loadConstraints() {
  const metaRef = doc(db, "constraints", monthKey, "days", "_meta");
  try {
    const metaSnap = await getDoc(metaRef);
    if (metaSnap.exists() && metaSnap.data().excludedUsers) {
      excludedUsers = metaSnap.data().excludedUsers;
    } else {
      excludedUsers = [];
    }
  } catch (err) {
    console.warn("Could not load _meta", err);
    excludedUsers = [];
  }

  const q = query(collection(db, "constraints", monthKey, "days"));
  const snap = await getDocs(q);
  snap.forEach(docSnap => {
    if (docSnap.id === "_meta") return;
    state[docSnap.id] = docSnap.data();
  });
}

async function saveConstraint(dateKey, data) {
  const ref = doc(db, "constraints", monthKey, "days", dateKey);
  await setDoc(ref, data, { merge: true });
}

// ----- Schedule Logic (Simplified from Original) -----
function computeSchedule() {
  const days = rangeDays(startDate, endDate);
  const totalCounts = Object.fromEntries(PEOPLE.map(p => [p, 0]));
  const fridayCounts = Object.fromEntries(PEOPLE.map(p => [p, 0]));
  const weekCounts = []; // [ {נבו: 1, טל: 2}, ... ]
  const assign = {};

  // Group shift days by week
  const weeks = [];
  for (const d of days) {
    const sh = shiftForDate(d);
    if (!sh || sh.specialType === "no_shifts") continue;
    const wIdx = weekIndexFor(d);
    (weeks[wIdx] ||= []).push(d);
  }

  // Cost weights (lower total cost wins). Balance dominates everything else.
  const W_BALANCE = 1000;  // sum of squared weekly counts -> spreads shifts as evenly as possible
  const W_PREFER_NOT = 10; // each "prefer not" (v=1) assignment
  const W_FRIDAY = 3;      // Friday goes to whoever has had fewer Fridays
  const W_TOTAL = 1;       // long-run fairness across weeks

  for (let wIdx = 0; wIdx < weeks.length; wIdx++) {
    const wDays = weeks[wIdx];
    weekCounts[wIdx] = Object.fromEntries(PEOPLE.map(p => [p, 0]));
    if (!wDays) continue;

    // Build per-day slot info: fixed manual pick or list of candidates with their preference value
    const slots = wDays.map(d => {
      const key = fmtDateKey(d);
      const row = state[key] || {};
      const isFri = d.getDay() === 5;
      const manualWho = (row.manualAssigns || {})[activeRoom];
      if (manualWho) return { key, isFri, fixed: manualWho };
      const cands = PEOPLE
        .filter(p => !excludedUsers.includes(p) && Number(row[p] ?? 0) < 2)
        .map(p => ({ p, pref: isBypassMode ? 0 : Number(row[p] ?? 0) }));
      return { key, isFri, cands };
    });

    // Most constrained days first -> much stronger pruning
    const order = slots.map((_, i) => i).sort((i, j) =>
      (slots[i].fixed ? -1 : slots[i].cands.length) - (slots[j].fixed ? -1 : slots[j].cands.length));

    const cnt = Object.fromEntries(PEOPLE.map(p => [p, 0]));
    const pick = new Array(slots.length).fill(null);
    let best = null, bestCost = Infinity;

    // Exact branch & bound: every term is non-negative, so partial cost is a valid lower bound
    const dfs = (k, cost) => {
      if (cost >= bestCost) return;
      if (k === order.length) { bestCost = cost; best = pick.slice(); return; }
      const i = order[k], slot = slots[i];
      if (slot.fixed) {
        const p = slot.fixed, known = p in cnt;
        const add = known ? W_BALANCE * (2 * cnt[p] + 1) : 0;
        if (known) cnt[p]++;
        pick[i] = p; dfs(k + 1, cost + add);
        if (known) cnt[p]--;
        return;
      }
      if (slot.cands.length === 0) { pick[i] = null; dfs(k + 1, cost); return; }
      // Try the cheapest candidates first so a good bound is found early
      const opts = slot.cands.map(({ p, pref }) => ({
        p,
        add: W_BALANCE * (2 * cnt[p] + 1) + W_PREFER_NOT * pref +
             (slot.isFri ? W_FRIDAY * fridayCounts[p] : 0) + W_TOTAL * totalCounts[p]
      })).sort((x, y) => x.add - y.add);
      for (const { p, add } of opts) {
        cnt[p]++; pick[i] = p;
        dfs(k + 1, cost + add);
        cnt[p]--;
      }
      pick[i] = null;
    };
    dfs(0, 0);

    slots.forEach((slot, i) => {
      const p = best ? best[i] : null;
      if (!p) return;
      assign[slot.key] = p;
      if (p in totalCounts) {
        totalCounts[p]++;
        weekCounts[wIdx][p]++;
        if (slot.isFri) fridayCounts[p]++;
      }
    });
  }

  return { assign, weekCounts, fridayCounts, totalCounts };
}

function renderSummary(pack) {
  const summaryBox = document.getElementById("summaryBox");
  const { weekCounts, fridayCounts, totalCounts } = pack;

  const currentRoomObj = ROOMS.find(r => r.id === activeRoom);
  const isPeriodMode = Boolean(currentRoomObj && currentRoomObj.endDate);

  const titleText = isPeriodMode ? "סיכום תקופה + ימי שישי" : "סיכום שבועי + ימי שישי";
  const colHeaderText = isPeriodMode ? "תקופה" : "שבוע";

  const html = `
    <div class="panel" style="margin-top:16px">
      <div class="hd"><h3 style="margin:0">${titleText}</h3></div>
      <div class="bd">
        <div style="overflow-x:auto">
          <table style="width:100%; border-collapse:collapse; font-size:14px; text-align:center">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="padding:8px; text-align:right">${colHeaderText}</th>
                ${PEOPLE.map(p => `<th style="padding:8px">${p}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${weekCounts.map((wc, idx) => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px; text-align:right; font-weight:600">שבוע ${idx + 1}</td>
                  ${PEOPLE.map(p => `<td style="padding:8px">${wc[p] || 0}</td>`).join("")}
                </tr>
              `).join("")}
              ${isPeriodMode && totalCounts ? `
                <tr style="border-top:2px solid var(--border); font-weight:700; background:var(--md-sys-color-surface-container-high)">
                  <td style="padding:8px; text-align:right">סה״כ לתקופה</td>
                  ${PEOPLE.map(p => `<td style="padding:8px">${totalCounts[p] || 0}</td>`).join("")}
                </tr>
              ` : ""}
            </tbody>
          </table>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:16px">
          ${PEOPLE.map(p => `
            <div class="pill">
              <b>${p}:</b> שישי — ${fridayCounts[p] || 0}
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
  summaryBox.innerHTML = html;
}

function renderSchedule(pack) {
  const { assign } = pack;
  let html = `
    <div></div>
    <div class="col-hd">א׳</div><div class="col-hd">ב׳</div><div class="col-hd">ג׳</div>
    <div class="col-hd">ד׳</div><div class="col-hd">ה׳</div><div class="col-hd">ו׳</div>
  `;
  let weekStart = new Date(startDate);
  while (weekStart.getDay() !== 0) { weekStart = addDays(weekStart, -1); }

  while (weekStart <= endDate) {
    const weekEnd = addDays(weekStart, 6);
    html += `<div class="muted">${fmtDM(weekStart)} – ${fmtDM(weekEnd)}</div>`;
    for (let i = 0; i < 6; i++) {
      const cur = addDays(weekStart, i);
      const key = fmtDateKey(cur);
      const sh = shiftForDate(cur);
      const inRange = cur >= startDate && cur <= endDate;

      if (!inRange || !sh) {
        html += `<div class="slot" style="opacity:.35"><div class="date">${hebDaysLong[cur.getDay()]}, ${fmtDM(cur)}</div><div class="muted">אין משמרת</div></div>`;
      } else if (sh.specialType === "no_shifts") {
        html += `
          <div class="slot" style="background:var(--md-sys-color-surface-container-high)">
            <div class="date">${hebDaysLong[cur.getDay()]}, ${fmtDM(cur)}</div>
            <div class="pill warn wrap">${sh.label}</div>
            <div class="muted">אין משמרת</div>
          </div>
        `;
      } else {
        const who = assign[key] || null;
        const row = state[key] || {};
        const manualAssigns = row.manualAssigns || {};
        const isManuallyAssigned = !!manualAssigns[activeRoom];
        const absent = PEOPLE.filter(p => Number(row[p] ?? 0) === 2);
        const prefer = PEOPLE.filter(p => Number(row[p] ?? 0) === 1);

        const colorCls = who ? getStaffColor(who) : '';

        let shiftTimeHtml = "";
        if (isViewMode) {
          shiftTimeHtml = `<div class="pill ${sh.specialType ? 'wrap' : ''}">${sh.label}</div>`;
        } else {
          const isFriday = cur.getDay() === 5;
          const currentOptions = isFriday ? FRIDAY_SHIFT_OPTIONS : WEEKDAY_SHIFT_OPTIONS;
          const currentNormalized = getShiftLabelAndStart(sh.label, cur.getDay());
          
          shiftTimeHtml = `
            <div class="shift-select-container">
              <select class="shift-time-select" data-key="${key}">
                ${currentOptions.map(opt => {
                  if (opt.disabled) {
                    return `<option value="" disabled>${opt.label}</option>`;
                  }
                  return `<option value="${opt.value}" ${opt.value === currentNormalized.value ? 'selected' : ''}>${opt.label}</option>`;
                }).join("")}
              </select>
            </div>
          `;
        }

        html += `
          <div class="slot ${cur.getDay() === 5 ? 'fri' : ''} ${isManualMode ? 'manual-clickable' : ''}" 
               ${isManualMode ? `onclick="handleManualAssign('${key}')"` : ''} 
               data-key="${key}" data-who="${who || ''}"
               style="${isManualMode ? 'cursor:pointer; border:1px dashed var(--md-sys-color-primary);' : ''}">
            <div class="datebox">
               <div class="d-top">${hebDays[cur.getDay()]}</div>
               <div class="d-time">${fmtDM(cur)}</div>
            </div>
            <div class="assignee-block" style="width: 100%; display: flex; justify-content: center;" title="לחץ פעמיים להחלפת משמרת">
              <div class="${who ? `pill ${colorCls}` : 'pill bad'}">${isManuallyAssigned ? '🔒 ' : ''}${who ? `משובץ: <b>${who}</b>` : '❌ אין משובץ'}</div>
            </div>
            ${shiftTimeHtml}
            ${prefer.length ? `<div class="pill warn" style="font-size:11px">${prefer.join(", ")}</div>` : ``}
            ${absent.length ? `<div class="pill bad" style="font-size:11px">${absent.join(", ")}</div>` : ``}
          </div>
        `;
      }
    }
    weekStart = addDays(weekStart, 7);
  }
  scheduleGrid.innerHTML = html;

  // Bind change listeners to shift time selects
  scheduleGrid.querySelectorAll(".shift-time-select").forEach(select => {
    select.addEventListener("dblclick", (e) => e.stopPropagation());
    select.addEventListener("change", async (e) => {
      const dateKey = select.dataset.key;
      const newTime = e.target.value;
      
      if (!state[dateKey]) state[dateKey] = {};
      if (!state[dateKey].customShiftTimes) state[dateKey].customShiftTimes = {};
      state[dateKey].customShiftTimes[activeRoom] = newTime;
      
      await saveConstraint(dateKey, state[dateKey]);
      renderCalendar();
      refreshScheduleUI();
    });
  });

  // Bind double-click to slot cards for manual override swap
  scheduleGrid.querySelectorAll(".slot").forEach(slot => {
    if (isViewMode) return;
    
    // Ensure interactable items inside slot do not bubble double-clicks
    slot.querySelectorAll("select, input, button").forEach(elem => {
      elem.addEventListener("dblclick", (e) => e.stopPropagation());
    });
    
    slot.addEventListener("dblclick", (e) => {
      const block = slot.querySelector(".assignee-block");
      if (!block || block.querySelector(".assign-select")) return;

      const dateKey = slot.dataset.key;
      const currentWho = slot.dataset.who;
      
      const select = document.createElement("select");
      select.className = "assign-select";
      select.innerHTML = `
        <option value="">(אוטומטי)</option>
        ${PEOPLE.map(p => `<option value="${p}" ${p === currentWho ? 'selected' : ''}>${p}</option>`).join("")}
      `;
      
      block.innerHTML = "";
      block.appendChild(select);
      select.focus();
      
      select.addEventListener("dblclick", (e) => e.stopPropagation());
      
      let saved = false;
      const handleSave = async () => {
        if (saved) return;
        saved = true;
        
        const newAssignee = select.value;
        if (!state[dateKey]) state[dateKey] = {};
        if (!state[dateKey].manualAssigns) state[dateKey].manualAssigns = {};
        
        if (newAssignee === "") {
          delete state[dateKey].manualAssigns[activeRoom];
        } else {
          state[dateKey].manualAssigns[activeRoom] = newAssignee;
        }
        
        await saveConstraint(dateKey, state[dateKey]);
        refreshScheduleUI();
      };
      
      select.addEventListener("change", handleSave);
      select.addEventListener("blur", () => {
        setTimeout(() => {
          if (!saved) {
            refreshScheduleUI();
          }
        }, 150);
      });
    });
  });
}

// ----- Event Listeners -----
resetMineBtn.addEventListener("click", () => {
  for (const d of rangeDays(startDate, endDate)) {
    const key = fmtDateKey(d);
    if (state[key] && state[key][activePerson] !== undefined) {
      state[key][activePerson] = 0;
      saveConstraint(key, state[key]);
    }
  }
  renderCalendar();
  refreshScheduleUI();
});

// ----- Admin Panel Logic -----
const adminBtn = document.getElementById("adminBtn");
const adminBackdrop = document.getElementById("adminBackdrop");
const adminSaveBtn = document.getElementById("adminSaveBtn");
const adminCancelBtn = document.getElementById("adminCancelBtn");
const dateInput = document.getElementById("dateInput");
const rangeWeeksInput = document.getElementById("rangeWeeksInput");
const endDateRow = document.getElementById("endDateRow");
const endDateInput = document.getElementById("endDateInput");
const rangeWeeksRow = document.getElementById("rangeWeeksRow");
const startDateRow = document.getElementById("startDateRow");
const startDateLabel = document.getElementById("startDateLabel");

function setEndDateModeUI(enabled) {
  if (enabled) {
    if (endDateRow) endDateRow.style.display = "flex";
    if (rangeWeeksInput) rangeWeeksInput.disabled = true;
    if (rangeWeeksRow) rangeWeeksRow.style.opacity = "0.5";
  } else {
    if (endDateRow) endDateRow.style.display = "none";
    if (endDateInput) endDateInput.value = "";
    if (rangeWeeksInput) rangeWeeksInput.disabled = false;
    if (rangeWeeksRow) rangeWeeksRow.style.opacity = "1";
  }
}

function toggleEndDateMode(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    e.stopPropagation();
    const isCurrentlyActive = endDateRow && endDateRow.style.display !== "none";
    if (isCurrentlyActive) {
      setEndDateModeUI(false);
    } else {
      setEndDateModeUI(true);
      if (endDateInput && !endDateInput.value) {
        const baseDateStr = dateInput ? dateInput.value : "";
        let baseDate = baseDateStr ? startOfDay(new Date(baseDateStr)) : startOfDay(new Date());
        if (isNaN(baseDate.getTime())) baseDate = startOfDay(new Date());
        const defaultEnd = addDays(baseDate, 26);
        endDateInput.value = fmtDateKey(defaultEnd);
      }
    }
  }
}

if (startDateLabel) startDateLabel.addEventListener("click", toggleEndDateMode);
if (dateInput) dateInput.addEventListener("click", toggleEndDateMode);
if (startDateRow) startDateRow.addEventListener("click", (e) => {
  if (e.ctrlKey || e.metaKey) {
    toggleEndDateMode(e);
  }
});

const specialDateInput = document.getElementById("specialDateInput");
const specialTitleInput = document.getElementById("specialTitleInput");
const specialTypeInput = document.getElementById("specialTypeInput");
const addSpecialDayBtn = document.getElementById("addSpecialDayBtn");
const adminSpecialDaysList = document.getElementById("adminSpecialDaysList");

// Tabs & Rooms DOM
const adminTabRoomBtn = document.getElementById("adminTabRoomBtn");
const adminTabSystemBtn = document.getElementById("adminTabSystemBtn");
const adminTabSpecialBtn = document.getElementById("adminTabSpecialBtn");
const adminTabRoomContent = document.getElementById("adminTabRoomContent");
const adminTabSystemContent = document.getElementById("adminTabSystemContent");
const adminTabSpecialContent = document.getElementById("adminTabSpecialContent");
const adminCurrentRoomLabel = document.getElementById("adminCurrentRoomLabel");
const adminRoomsList = document.getElementById("adminRoomsList");
const adminAddRoomBtn = document.getElementById("adminAddRoomBtn");

const adminResetBtn = document.getElementById("adminResetBtn");
const confirmResetBackdrop = document.getElementById("confirmResetBackdrop");
const confirmResetCancelBtn = document.getElementById("confirmResetCancelBtn");
const confirmResetActionBtn = document.getElementById("confirmResetActionBtn");
const adminShiftTimesList = document.getElementById("adminShiftTimesList");

// Admin mode now controlled by Ctrl+Click on the gear icon

function showAdminTab(tabName) {
  adminTabRoomBtn.className = tabName === "room" ? "secondary" : "ghost";
  adminTabSystemBtn.className = tabName === "system" ? "secondary" : "ghost";
  if (adminTabSpecialBtn) adminTabSpecialBtn.className = tabName === "special" ? "secondary" : "ghost";

  adminTabRoomContent.style.display = tabName === "room" ? "block" : "none";
  adminTabSystemContent.style.display = tabName === "system" ? "block" : "none";
  if (adminTabSpecialContent) adminTabSpecialContent.style.display = tabName === "special" ? "block" : "none";
}

function renderAdminShiftTimes(roomObj) {
  if (!adminShiftTimesList) return;
  const daysMap = {0: "ראשון", 1: "שני", 2: "שלישי", 3: "רביעי", 4: "חמישי", 5: "שישי"};
  
  let html = "";
  for (let i=0; i<6; i++) {
    const isFriday = i === 5;
    const currentOptions = isFriday ? FRIDAY_SHIFT_OPTIONS : WEEKDAY_SHIFT_OPTIONS;
    let val = (roomObj && roomObj.shiftTimes && roomObj.shiftTimes[i]) ? roomObj.shiftTimes[i] : (isFriday ? "08:00" : "16:00");
    
    const normalized = getShiftLabelAndStart(val, i);

    html += `
      <div style="display:flex; flex-direction:column; gap:4px;">
        <label style="font-size:13px; color:var(--md-sys-color-on-surface-variant);">${daysMap[i]}</label>
        <select class="select shift-time-input" data-day="${i}">
          ${currentOptions.map(opt => {
            if (opt.disabled) return '';
            return `<option value="${opt.value}" ${opt.value === normalized.value ? "selected" : ""}>${opt.label}</option>`;
          }).join("")}
        </select>
      </div>
    `;
  }
  adminShiftTimesList.innerHTML = html;
}

if (adminTabRoomBtn) adminTabRoomBtn.addEventListener("click", () => showAdminTab("room"));
if (adminTabSystemBtn) adminTabSystemBtn.addEventListener("click", () => showAdminTab("system"));
if (adminTabSpecialBtn) adminTabSpecialBtn.addEventListener("click", () => showAdminTab("special"));

function renderAdminSpecialDays() {
  if (!adminSpecialDaysList) return;
  adminSpecialDaysList.innerHTML = "";
  const keys = Object.keys(specialDays).sort();
  for (const k of keys) {
    const sp = specialDays[k];
    const typeLabel = sp.type === "no_shifts" ? "אין משמרות" : "סוגרים מוקדם";
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.justifyContent = "space-between";
    div.style.alignItems = "center";
    div.style.background = "var(--md-sys-color-surface-variant)";
    div.style.padding = "4px 8px";
    div.style.borderRadius = "4px";
    div.innerHTML = `
      <div><b>${k}</b> • ${sp.title} <span class="muted" style="margin-right:8px; font-size:0.9em">${typeLabel}</span></div>
      <button type="button" class="icon-btn" style="color:#fca5a5" data-key="${k}">✖</button>
    `;
    div.querySelector("button").onclick = () => {
      delete specialDays[k];
      renderAdminSpecialDays();
    };
    adminSpecialDaysList.appendChild(div);
  }
}

if (addSpecialDayBtn) {
  addSpecialDayBtn.addEventListener("click", () => {
    const d = specialDateInput.value;
    const t = specialTitleInput.value.trim();
    const type = specialTypeInput.value;
    if (!d || !t) return alert("יש להזין תאריך וכותרת.");
    specialDays[d] = { title: t, type };
    specialTitleInput.value = "";
    renderAdminSpecialDays();
  });
}

let editingRooms = [];

window.updateEditingRoom = function(index, field, value) {
  if (field === 'name') editingRooms[index].name = value;
  if (field === 'people') editingRooms[index].people = value.split(",").map(s => s.trim()).filter(s => s);
};
window.deleteEditingRoom = function(index) {
  if(confirm("האם למחוק את החדר הזה?")) {
    editingRooms.splice(index, 1);
    renderAdminRoomsList();
  }
};

function renderAdminRoomsList() {
  if (!adminRoomsList) return;
  adminRoomsList.innerHTML = "";
  editingRooms.forEach((r, index) => {
    const div = document.createElement("div");
    div.style.background = "var(--md-sys-color-surface-container-highest)";
    div.style.padding = "12px";
    div.style.borderRadius = "8px";
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.gap = "8px";
    
    // Generate staff chips
    const staffChipsHtml = (r.people || []).map(p => {
      const colorCls = getStaffColor(p);
      return `<span class="pill ${colorCls} admin-staff-chip" data-person="${p}" style="cursor:pointer; user-select:none;" title="לחץ פעמיים לשינוי צבע">${p}</span>`;
    }).join("");
    
    const roomColorCls = getRoomColor(r);

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="pill ${roomColorCls} admin-room-color-btn" data-index="${index}" style="cursor:pointer; padding:8px; margin-left:8px;" title="לחץ פעמיים לשינוי צבע חדר">🎨</div>
        <input type="text" class="select room-name-input" data-index="${index}" placeholder="שם החדר" value="${r.name}" style="flex:1; margin-left:8px;" />
        <button type="button" class="icon-btn" style="color:var(--md-sys-color-error)" onclick="deleteEditingRoom(${index})" title="מחק חדר">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      <div>
        <input type="text" class="select room-people-input" data-index="${index}" placeholder="שמות הצוות (מופרדים בפסיק)" value="${r.people ? r.people.join(', ') : ''}" style="width:100%; font-size:14px; margin-bottom:8px;" />
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${staffChipsHtml}</div>
      </div>
    `;
    
    // Add event listeners after rendering
    setTimeout(() => {
      div.querySelectorAll('.admin-staff-chip').forEach(el => {
        el.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const pName = el.dataset.person;
          openColorPicker('person', pName, pName, getStaffColor(pName));
        });
      });
      
      div.querySelectorAll('.admin-room-color-btn').forEach(el => {
        el.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const idx = el.dataset.index;
          openColorPicker('room', idx, editingRooms[idx].name, getRoomColor(editingRooms[idx]));
        });
      });
    }, 0);
    
    adminRoomsList.appendChild(div);
  });
}

if (adminAddRoomBtn) {
  adminAddRoomBtn.addEventListener("click", () => {
    const newId = "room_" + Date.now();
    editingRooms.push({ id: newId, name: "חדר חדש", people: [], resetDay: 4, resetTime: "12:00" });
    renderAdminRoomsList();
  });
}

if (adminResetBtn) {
  adminResetBtn.addEventListener("click", () => {
    confirmResetBackdrop.style.display = "flex";
  });
}
if (confirmResetCancelBtn) {
  confirmResetCancelBtn.addEventListener("click", () => {
    confirmResetBackdrop.style.display = "none";
  });
}
if (confirmResetActionBtn) {
  confirmResetActionBtn.addEventListener("click", async () => {
    confirmResetActionBtn.disabled = true;
    confirmResetActionBtn.textContent = "מוחק...";
    
    for (const d of rangeDays(startDate, endDate)) {
      const key = fmtDateKey(d);
      state[key] = {}; // Reset local cache
      await saveConstraint(key, {}); // Overwrite in firestore
    }
    
    renderCalendar();
    refreshScheduleUI();
    
    confirmResetBackdrop.style.display = "none";
    confirmResetActionBtn.disabled = false;
    confirmResetActionBtn.textContent = "כן, מחק הכל";
    
    // Optional: show toast/alert
    alert("טבלת החדר אופסה בהצלחה!");
  });
}

let adminClickCount = 0;
let adminClickTimer;
adminBtn.addEventListener("click", (e) => {
  const isExpanded = e.ctrlKey || e.metaKey;
  if (isExpanded) {
     clearTimeout(adminClickTimer);
     adminClickCount = 0;
     openAdminModal(true);
     return;
  }
  
  adminClickCount++;
  if (adminClickCount === 1) {
    adminClickTimer = setTimeout(() => {
      openAdminModal(false); 
      adminClickCount = 0;
    }, 300);
  } else if (adminClickCount === 2) {
    clearTimeout(adminClickTimer);
    openAdminModal(true);
    adminClickCount = 0;
  }
});

function openAdminModal(isExpanded) {
  if (isExpanded) {
    if (adminTabSystemBtn) adminTabSystemBtn.style.display = "block";
    showAdminTab("system");
  } else {
    if (adminTabSystemBtn) adminTabSystemBtn.style.display = "none";
    showAdminTab("room");
  }

  const roomObj = ROOMS.find(r => r.id === activeRoom) || ROOMS[0];
  if (adminCurrentRoomLabel) adminCurrentRoomLabel.textContent = roomObj ? roomObj.name : "חדר";
  
  if (roomObj && roomObj.startDate) {
    dateInput.value = roomObj.startDate;
  } else {
    let propDate = startOfDay(new Date());
    if (propDate.getDay() !== 0) {
      propDate = addDays(propDate, 7 - propDate.getDay());
    }
    dateInput.value = fmtDateKey(propDate);
  }
  if (roomObj && roomObj.rangeWeeks) {
    rangeWeeksInput.value = String(roomObj.rangeWeeks);
  } else {
    rangeWeeksInput.value = String(rangeWeeks);
  }

  if (roomObj && roomObj.endDate) {
    if (endDateInput) endDateInput.value = roomObj.endDate;
    setEndDateModeUI(true);
  } else {
    setEndDateModeUI(false);
  }

  const resetDayInput = document.getElementById("resetDayInput");
  const resetTimeInput = document.getElementById("resetTimeInput");
  if (resetDayInput) {
    resetDayInput.value = (roomObj && roomObj.resetDay !== undefined) ? String(roomObj.resetDay) : "4";
  }
  if (resetTimeInput) {
    resetTimeInput.value = (roomObj && roomObj.resetTime) ? roomObj.resetTime : "12:00";
  }
  
  renderAdminShiftTimes(roomObj);
  
  renderAdminSpecialDays();
  
  editingRooms = JSON.parse(JSON.stringify(ROOMS));
  renderAdminRoomsList();
  
  adminBackdrop.style.display = "flex";
}
adminCancelBtn.addEventListener("click", () => { adminBackdrop.style.display = "none"; });

adminSaveBtn.addEventListener("click", async () => {
  // Sync inputs to editingRooms
  document.querySelectorAll('.room-name-input').forEach(input => {
    const idx = input.dataset.index;
    if (editingRooms[idx]) editingRooms[idx].name = input.value;
  });
  document.querySelectorAll('.room-people-input').forEach(input => {
    const idx = input.dataset.index;
    if (editingRooms[idx]) {
      editingRooms[idx].people = input.value.split(',').map(s => s.trim()).filter(Boolean);
    }
  });

  // save to DB
  const ref = doc(db, "settings", "global");
  const newDate = dateInput.value;
  const newRange = parseInt(rangeWeeksInput.value, 10);

  if (editingRooms.length === 0) {
    alert("חובה להשאיר לפחות חדר אחד במערכת.");
    return;
  }
  
  // Save date range for current active room only
  const activeIdx = editingRooms.findIndex(r => r.id === activeRoom);
  if (activeIdx !== -1) {
    editingRooms[activeIdx].startDate = newDate;
    editingRooms[activeIdx].rangeWeeks = newRange;

    if (endDateRow && endDateRow.style.display !== "none" && endDateInput && endDateInput.value) {
      editingRooms[activeIdx].endDate = endDateInput.value;
    } else {
      delete editingRooms[activeIdx].endDate;
    }

    const resetDayInput = document.getElementById("resetDayInput");
    const resetTimeInput = document.getElementById("resetTimeInput");
    if (resetDayInput) {
      editingRooms[activeIdx].resetDay = parseInt(resetDayInput.value, 10);
    }
    if (resetTimeInput) {
      editingRooms[activeIdx].resetTime = resetTimeInput.value;
    }

    const shiftTimeInputs = document.querySelectorAll('.shift-time-input');
    if (shiftTimeInputs.length > 0) {
      const times = {};
      shiftTimeInputs.forEach(sel => {
        times[sel.dataset.day] = sel.value;
      });
      editingRooms[activeIdx].shiftTimes = times;
    }
  }

  await setDoc(ref, { specialDays, rooms: editingRooms, staffColors }, { merge: true });
  adminBackdrop.style.display = "none";
  window.location.reload(); // Hard refresh to apply global changes
});

// ----- Color Picker Logic -----
const colorPickerBackdrop = document.getElementById("colorPickerBackdrop");
const colorPickerGrid = document.getElementById("colorPickerGrid");
const colorPickerCancelBtn = document.getElementById("colorPickerCancelBtn");
const colorPickerSaveBtn = document.getElementById("colorPickerSaveBtn");
const colorPickerTargetName = document.getElementById("colorPickerTargetName");

let colorPickerTargetType = null; // 'person' or 'room'
let colorPickerTargetId = null; // person name or room index
let selectedColorClass = null;

function openColorPicker(type, id, displayName, currentColor) {
  colorPickerTargetType = type;
  colorPickerTargetId = id;
  selectedColorClass = currentColor;
  
  if (colorPickerTargetName) colorPickerTargetName.textContent = displayName;
  
  if (colorPickerGrid) {
    colorPickerGrid.innerHTML = PALETTE_CLASSES.map(cls => `
      <div class="color-swatch ${cls} ${cls === selectedColorClass ? 'selected' : ''}" data-color="${cls}"></div>
    `).join("");
    
    colorPickerGrid.querySelectorAll('.color-swatch').forEach(el => {
      el.addEventListener('click', () => {
        colorPickerGrid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        selectedColorClass = el.dataset.color;
      });
    });
  }
  
  if (colorPickerBackdrop) colorPickerBackdrop.style.display = "flex";
}

if (colorPickerCancelBtn) {
  colorPickerCancelBtn.addEventListener("click", () => {
    colorPickerBackdrop.style.display = "none";
  });
}

if (colorPickerSaveBtn) {
  colorPickerSaveBtn.addEventListener("click", () => {
    if (colorPickerTargetType === 'person') {
      staffColors[colorPickerTargetId] = selectedColorClass;
      updatePersonUI();
      refreshScheduleUI();
      renderAdminRoomsList();
    } else if (colorPickerTargetType === 'room') {
      const idx = colorPickerTargetId;
      if (editingRooms[idx]) {
        editingRooms[idx].color = selectedColorClass;
        // Also update immediately if it's the active room to reflect in tabs
        if (editingRooms[idx].id === activeRoom) {
          const r = ROOMS.find(r => r.id === activeRoom);
          if (r) r.color = selectedColorClass;
        }
        renderAdminRoomsList();
      }
    }
    colorPickerBackdrop.style.display = "none";
  });
}

async function loadGlobalSettings() {
  const ref = doc(db, "settings", "global");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (data.specialDays) {
      specialDays = data.specialDays;
    }
    if (data.staffColors) {
      staffColors = data.staffColors;
    }
    if (data.rooms && Array.isArray(data.rooms) && data.rooms.length > 0) {
      ROOMS = data.rooms;
    }
    
    let currentRoomData = ROOMS.find(r => r.id === activeRoom);
    if (!currentRoomData) {
      // Fallback: try by name if ID changed
      if (activeRoom === "cnc" || activeRoom === "machining") {
        currentRoomData = ROOMS.find(r => r.name && r.name.includes("שבבים"));
      }
      if (!currentRoomData) currentRoomData = ROOMS[0];
      
      activeRoom = currentRoomData.id;
      localStorage.setItem("scheduler_room", activeRoom);
    }
    
    // Fallbacks or per-room overrides - Only apply if not using auto-dates or specific week URL
    if (urlWeek && (isViewMode || isHubMode)) {
       // URL param wins for view/hub
    } else if (isHubMode || isViewMode) {
       // Hub and View modes always use dynamic calculations based on current time
       startDate = getAutoStartDate(isHubMode ? "hub" : "view");
    } else {
       if (currentRoomData && currentRoomData.startDate) {
          startDate = startOfDay(new Date(currentRoomData.startDate));
       }
       if (isNaN(startDate.getTime())) {
          startDate = getAutoStartDate("selection", currentRoomData);
       }
    }

    // Auto-transition of rooms once custom resetDay and resetTime (or default Thursday 12:00 PM) has passed
    try {
      if (!isViewMode && !isHubMode) {
        let anyChanged = false;
        const nowIsrael = getIsraelTime();
        
        for (const r of ROOMS) {
          if (r.startDate) {
            let rStart = startOfDay(new Date(r.startDate));
            
            let resetDay = r.resetDay !== undefined ? parseInt(r.resetDay, 10) : 4;
            let resetHour = 12;
            let resetMin = 0;
            if (r.resetTime) {
              const [h, m] = r.resetTime.split(":").map(Number);
              resetHour = h;
              resetMin = m || 0;
            }
            
            let transitionTime = new Date(addDays(rStart, resetDay).getTime() + resetHour * 60 * 60 * 1000 + resetMin * 60 * 1000);
            
            while (nowIsrael >= transitionTime) {
              rStart = addDays(rStart, 7);
              r.startDate = fmtDateKey(rStart);
              transitionTime = new Date(addDays(rStart, resetDay).getTime() + resetHour * 60 * 60 * 1000 + resetMin * 60 * 1000);
              anyChanged = true;
            }
          }
        }
        
        if (anyChanged) {
          // Save updated rooms configuration to DB
          const refGlobal = doc(db, "settings", "global");
          await setDoc(refGlobal, { rooms: ROOMS }, { merge: true });
          
          // Re-sync local variable for active room since it might have changed
          if (currentRoomData && currentRoomData.startDate) {
            startDate = startOfDay(new Date(currentRoomData.startDate));
          }
        }
      }
    } catch (err) {
      console.error("Auto-transition error bypassed safely:", err);
    }
    
    if (currentRoomData && currentRoomData.rangeWeeks) {
      rangeWeeks = currentRoomData.rangeWeeks;
    } else if (data.rangeWeeks) {
      rangeWeeks = data.rangeWeeks;
    }

    if (currentRoomData && currentRoomData.people && currentRoomData.people.length > 0) {
      PEOPLE = currentRoomData.people;
    } else if (data.people && Array.isArray(data.people) && data.people.length > 0) {
      PEOPLE = data.people;
    }
    
    let savedPerson = localStorage.getItem(`scheduler_person_${activeRoom}`);
    if (savedPerson && PEOPLE.includes(savedPerson)) {
      activePerson = savedPerson;
    } else {
      activePerson = PEOPLE.includes(activePerson) ? activePerson : (PEOPLE[0] || "אורח");
      localStorage.setItem(`scheduler_person_${activeRoom}`, activePerson);
      
      const roomObj = ROOMS.find(r => r.id === activeRoom) || ROOMS[0];
      const titleEl = document.getElementById("identityModalTitle");
      if (titleEl) titleEl.textContent = `מי אתה? (${roomObj ? roomObj.name : 'חדר'})`;
      identitySelect.value = activePerson;
      identityBackdrop.style.display = "flex";
    }
    whoamiEl.textContent = "אתה: " + activePerson;
    if (currentRoomData && currentRoomData.endDate) {
      const parsedEnd = startOfDay(new Date(currentRoomData.endDate));
      if (!isNaN(parsedEnd.getTime())) {
        endDate = parsedEnd;
      } else {
        endDate = addDays(startDate, rangeWeeks * 7 - 2);
      }
    } else {
      endDate = addDays(startDate, rangeWeeks * 7 - 2); // Approx
    }
    monthKey = monthKeyFrom(startDate);
    renderPeopleUI();

    // Reset Notification Trigger
    if (!isViewMode && !isHubMode) {
      const lastSeen = localStorage.getItem(`lastSeenStartDate_${activeRoom}`);
      const currentStartStr = fmtDateKey(startDate);
      if (lastSeen !== currentStartStr) {
        if (resetNotificationBackdrop) resetNotificationBackdrop.style.display = "flex";
      }
      localStorage.setItem(`lastSeenStartDate_${activeRoom}`, currentStartStr);
    }
  }
}

// ----- UI Utilities -----
function pad(n) { return String(n).padStart(2, "0"); }
function toICSDateUTC(d, h, m) {
  const z = new Date(d); z.setUTCHours(h, m, 0, 0);
  return `${z.getUTCFullYear()}${pad(z.getUTCMonth() + 1)}${pad(z.getUTCDate())}T${pad(z.getUTCHours())}${pad(z.getUTCMinutes())}00Z`;
}

function downloadICSForMe() {
  if (!activePerson) {
    alert("אנא בחר משתמש קודם.");
    return;
  }
  const pack = computeSchedule();
  const { assign } = pack;
  const days = rangeDays(startDate, endDate);

  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SADNA//Schedule//HE
CALSCALE:GREGORIAN
METHOD:PUBLISH
`;

  for (const d of days) {
    const sh = shiftForDate(d);
    if (!sh || sh.specialType === "no_shifts") continue;
    const key = fmtDateKey(d);
    const who = assign[key];
    if (who !== activePerson) continue;

    let shStart = [16, 0], shEnd = [22, 0];
    if (sh.startTime && sh.endTime) {
      shStart = sh.startTime.split(':').map(Number);
      shEnd = sh.endTime.split(':').map(Number);
    } else if (d.getDay() === 5) {
      shStart = [8, 0];
      shEnd = [14, 0];
    }

    const uid = `${key}-${activePerson}@oz-schedule`;
    ics += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${toICSDateUTC(new Date(), 0, 0)}
DTSTART:${toICSDateUTC(d, shStart[0], shStart[1])}
DTEND:${toICSDateUTC(d, shEnd[0], shEnd[1])}
SUMMARY:משמרת – ${activePerson}
DESCRIPTION:משמרת ${sh.label}
LOCATION:אולם הדפסות
END:VEVENT
`;
  }
  ics += "END:VCALENDAR";

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `schedule_${activePerson}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 300);
}

function openViewOnlyLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "1");
  url.searchParams.set("week", fmtDateKey(startDate));

  window.open(url.toString(), "_blank");
}


viewOnlyBtn.addEventListener("click", openViewOnlyLink);
addCalendarBtn.addEventListener("click", downloadICSForMe);

if (isHubMode) {
  hubBtn.title = "חזור לחדר קודם";
  hubBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`;
  // Ensure actions stay on the left in RTL when title is hidden
  const actions = document.querySelector(".header-actions");
  if (actions) actions.style.marginInlineStart = "auto";
} else {
  hubBtn.style.display = "flex";
  hubBtn.title = "מסך ראשי (Hub)";
  hubBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
  const actions = document.querySelector(".header-actions");
  if (actions) actions.style.marginInlineStart = "0";
}

hubBtn.addEventListener("click", () => {
  showLoader();
  const newUrl = new URL(window.location.href);
  if (isHubMode) {
    newUrl.searchParams.delete("view");
    const savedRoom = localStorage.getItem("scheduler_room") || "wood";
    newUrl.searchParams.set("room", savedRoom);
  } else {
    newUrl.searchParams.set("view", "hub");
    newUrl.searchParams.delete("room");
  }
  window.location.href = newUrl.toString();
});

const hubPrevWeekBtn = document.getElementById("hubPrevWeekBtn");
if (hubPrevWeekBtn) {
  hubPrevWeekBtn.addEventListener("click", () => {
    const weekStart = new Date(startDate);
    while (weekStart.getDay() !== 0) { weekStart.setDate(weekStart.getDate() - 1); }
    const prevWeekStart = addDays(weekStart, -7);
    
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("week", fmtDateKey(prevWeekStart));
    newUrl.searchParams.set("view", "hub");
    window.open(newUrl.toString(), "_blank");
  });
}

function renderHub() {
  const weekStart = new Date(startDate);
  // Get Sunday of current week
  while (weekStart.getDay() !== 0) { weekStart.setDate(weekStart.getDate() - 1); }
  const weekEnd = addDays(weekStart, 5); // Friday
  
  hubDateBadge.textContent = "שבוע נוכחי: " + fmtDM(weekStart) + " – " + fmtDM(weekEnd);
  
  let html = "";
  
  const originalPeople = [...PEOPLE];
  const originalRoom = activeRoom;
  
  // Create a sorted copy of ROOMS for consistent display
  const sortedRooms = [...ROOMS].sort((a,b) => (a.name || "").localeCompare(b.name || ""));

  for (const room of sortedRooms) {
    PEOPLE = room.people || [];
    activeRoom = room.id;
    
    const pack = computeSchedule();
    const { assign } = pack;
    
    html += `
      <div class="panel hub-room-card">
        <div class="hub-room-header">
          <h4>${room.name}</h4>
        </div>
        <div class="hub-room-body">
    `;
    
    for (let i = 0; i < 6; i++) {
      const cur = addDays(weekStart, i);
      const key = fmtDateKey(cur);
      const sh = shiftForDate(cur, room);
      
      const isFri = cur.getDay() === 5;
      const bgStyle = isFri ? 'background:var(--fri-bg)' : 'background:var(--md-sys-color-surface-container-highest)';
      
      if (!sh) continue;
      
      if (sh.specialType === "no_shifts") {
        html += `
          <div class="hub-day-row special">
            <div class="hub-day-name">${hebDays[cur.getDay()]}</div>
            <div class="pill ok" style="font-size:13px; font-weight: 600; background:transparent; color:inherit;">${sh.label}</div>
          </div>
        `;
      } else {
        const who = assign[key] || null;
        const colorCls = who ? getStaffColor(who) : '';
        html += `
          <div class="hub-day-row" style="${bgStyle}">
            <div class="hub-day-name">${hebDays[cur.getDay()]}</div>
            <div class="hub-day-time">${sh.startTime || sh.label}</div>
            <div class="hub-day-who ${who ? `pill ${colorCls}` : 'pill bad'}">${who ? who : '❌'}</div>
          </div>
        `;
      }
    }
    html += `</div></div>`;
  }
  
  PEOPLE = originalPeople;
  activeRoom = originalRoom;
  
  hubGrid.innerHTML = html;
}

// ----- Start-up -----
onAuthStateChanged(auth, async (user) => {
  showLoader();
  if (user) {
    await loadGlobalSettings();
    await loadConstraints();

    dateRangeBadge.textContent = "טווח: " + fmtDM(startDate) + " ← " + fmtDM(endDate);
    
    if (isHubMode) {
      mainSchedulePanel.style.display = "none";
      mainConstraintsPanel.style.display = "none";
      hubView.style.display = "block";
      document.body.classList.add("view-only"); // Hide sidebar UI actions
      if (bottomTabs) bottomTabs.style.display = "none";
      if (appTitle) appTitle.parentElement.style.display = "none";
      renderHub();
    } else {
      mainSchedulePanel.style.display = "block";
      mainConstraintsPanel.style.display = "block";
      hubView.style.display = "none";
      if (bottomTabs) bottomTabs.style.display = "flex";
      if (appTitle) appTitle.parentElement.style.display = "block";
      renderCalendar();
      const pack = computeSchedule();
      renderSchedule(pack);
      renderSummary(pack);
    }
    
    setTimeout(() => {
      hideLoader();
      const welcomeSeen = localStorage.getItem("scheduler_welcome_whatsnew_v1.5");
      if (!welcomeSeen && !isViewMode && !isHubMode) {
        if (welcomeBackdrop) welcomeBackdrop.style.display = "flex";
      }
    }, 500);

    // Live sync
    onSnapshot(doc(db, "constraints", monthKey, "days", "_meta"), (snap) => {
      if (snap.exists() && snap.data().excludedUsers) {
        excludedUsers = snap.data().excludedUsers;
      } else {
        excludedUsers = [];
      }
      updatePersonUI();
      scheduleLiveRender();
    }, (err) => console.log("Meta snapshot error", err));

    onSnapshot(collection(db, "constraints", monthKey, "days"), (snap) => {
      if (isManualMode) return; // Don't overwrite staged changes
      snap.docChanges().forEach(ch => {
        if (ch.doc.id === "_meta") return;
        state[ch.doc.id] = ch.doc.data();
      });
      scheduleLiveRender();
    });
  } else {
    signInAnonymously(auth).catch(console.error);
  }
});

// ----- UI: Render Tabs -----
function renderTabs() {
  if (!bottomTabs) return;
  bottomTabs.innerHTML = ROOMS.map(r => `
    <div class="tab ${r.id === activeRoom ? 'active ' + getRoomColor(r) : ''}" data-room="${r.id}">
      ${r.name}
    </div>
  `).join("");

  bottomTabs.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", () => {
      const roomId = el.dataset.room;
      if (roomId === activeRoom) return;
      showLoader();
      activeRoom = roomId;
      localStorage.setItem("scheduler_room", activeRoom);
      
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("room", activeRoom);
      window.location.href = newUrl.toString();
    });
  });
}

if (appTitle) {
  const roomObj = ROOMS.find(r => r.id === activeRoom);
  appTitle.textContent = "לוח שיבוצים - " + (roomObj ? roomObj.name : "חדר");
}

// Initial draw
if (!isNaN(startDate.getTime())) {
  dateRangeBadge.textContent = "טווח: " + fmtHuman(startDate) + " ← " + fmtHuman(endDate);
  renderTabs();
  renderCalendar();
} else {
  // If stuck, fallback and reload
  console.warn("Invalid date state detected, resetting...");
  localStorage.removeItem("scheduler_room");
  // window.location.reload(); 
}

window.handleManualAssign = function(dateKey) {
  if (!isManualMode) return;
  
  if (!state[dateKey]) state[dateKey] = {};
  if (!state[dateKey].manualAssigns) state[dateKey].manualAssigns = {};
  
  const current = state[dateKey].manualAssigns[activeRoom] || "";
  const name = prompt("הזן שם לשיבוץ ידני (או השאר ריק לביטול):", current);
  if (name === null) return;
  
  const trimmed = name.trim();
  if (trimmed === "") {
    delete state[dateKey].manualAssigns[activeRoom];
  } else {
    state[dateKey].manualAssigns[activeRoom] = trimmed;
  }
  
  pushHistory();
  refreshScheduleUI();
};

updateAdvancedBtns();


// ----- Admin: Force cache clear (logic lives in index.html) -----
document.getElementById("adminClearCacheBtn")?.addEventListener("click", (e) => {
  e.currentTarget.disabled = true;
  e.currentTarget.textContent = "מנקה מטמון...";
  window.forceCacheClear();
});
