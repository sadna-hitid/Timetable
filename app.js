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

function getIsraelTime() {
  const now = new Date();
  // We use the browser's locale conversion to ensure we are looking at Israel time
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
}

function getAutoStartDate(mode) {
  const now = getIsraelTime();
  const day = now.getDay();
  const hour = now.getHours();

  if (mode === "hub" || mode === "view") {
    // Hub and View Only display current week until Saturday 08:00 AM
    let hubSun = new Date(now);
    hubSun.setHours(0, 0, 0, 0);
    hubSun.setDate(hubSun.getDate() - hubSun.getDay());
    if (day === 6 && hour >= 8) {
      hubSun.setDate(hubSun.getDate() + 7);
    }
    return hubSun;
  } else {
    // Selection panel displays current week until Wed 12:00 PM, then switches to next week.
    let targetSun = new Date(now);
    targetSun.setHours(0, 0, 0, 0);
    // Go to current week's Sunday
    targetSun.setDate(targetSun.getDate() - targetSun.getDay());
    
    // Switch to next week only from Wednesday 12:00 PM onwards
    if ((day === 3 && hour >= 12) || day > 3) {
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
}

let activePerson = localStorage.getItem(`scheduler_person_${activeRoom}`) || PEOPLE[0];
let rangeWeeks = 4;
let today = startOfDay(getIsraelTime());

let startDate;
if (urlWeek) {
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

let endDate = new Date(startDate.getTime() + 30 * MS_DAY);

let monthKey = monthKeyFrom(startDate);

// Local state: dateKey -> { name: 0/1/2 }
let state = Object.create(null);
let specialDays = Object.create(null); // dateKey -> { title, type }
let excludedUsers = [];

let metaUnsub = null;
let daysUnsub = null;

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
function rangeDays(d0, d1) { const out = []; let t = startOfDay(d0).getTime(), t1 = startOfDay(d1).getTime(); for (; t <= t1; t += MS_DAY) out.push(new Date(t)); return out; }
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

  if (targetRoom && targetRoom.shiftTimes && targetRoom.shiftTimes[jsDow]) {
    const startStr = targetRoom.shiftTimes[jsDow];
    const [h, m] = startStr.split(':').map(Number);
    const endH = (h + 6) % 24;
    const endStr = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    baseLabel = `${startStr}–${endStr}`;
  } else {
    if (jsDow >= 0 && jsDow <= 4) baseLabel = "16:00–22:00";
    else if (jsDow === 5) baseLabel = "08:00–14:00";
    else return null;
  }

  if (special && special.type === "close_early") {
    return { label: `${special.title} (סוגרים מוקדם)`, specialType: "close_early", originalHours: baseLabel };
  }

  return { label: baseLabel, startTime: baseLabel.split('–')[0] };
}
function monthKeyFrom(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"); return `${y}-${m}`; }
function prevSunday(d) {
  let x = startOfDay(d);
  while (x.getDay() !== 0) { x = new Date(x.getTime() - MS_DAY); }
  return x;
}
function weekIndexFor(date) {
  let s = prevSunday(startDate);
  return Math.floor((startOfDay(date) - s) / (7 * MS_DAY));
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
  document.querySelectorAll(".chip").forEach(btn => {
    const p = btn.dataset.person;
    btn.classList.toggle("active", p === activePerson);

    if (excludedUsers.includes(p)) {
      btn.style.textDecoration = "line-through";
      btn.style.opacity = "0.5";
    } else {
      btn.style.textDecoration = "none";
      btn.style.opacity = "1";
    }

    btn.onclick = (e) => {
      if (e.ctrlKey || e.metaKey) {
        toggleExcludedUser(p);
        return;
      }
      activePerson = p;
      localStorage.setItem(`scheduler_person_${activeRoom}`, activePerson);
      whoamiEl.textContent = "אתה: " + activePerson;
      updatePersonUI();
      renderCalendar();
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
const savedTheme = localStorage.getItem("scheduler_theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
renderThemeIcon();

themeBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("scheduler_theme", next);
  renderThemeIcon();
});

function renderThemeIcon() {
  const mode = document.documentElement.getAttribute("data-theme") || "dark";
  themeIcon.innerHTML = mode === "dark"
    ? `<path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/>`
    : `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
}

// ----- UI: Switch User (Identity) -----
switchUserBtn.addEventListener("click", () => {
  const roomObj = ROOMS.find(r => r.id === activeRoom) || ROOMS[0];
  const titleEl = document.getElementById("identityModalTitle");
  if (titleEl) titleEl.textContent = `מי אתה? (${roomObj ? roomObj.name : 'חדר'})`;
  identitySelect.value = activePerson;
  identityBackdrop.style.display = "flex";
});
identityStartBtn.addEventListener("click", () => {
  activePerson = identitySelect.value;
  localStorage.setItem(`scheduler_person_${activeRoom}`, activePerson);
  whoamiEl.textContent = "אתה: " + activePerson;
  updatePersonUI();
  renderCalendar();
  identityBackdrop.style.display = "none";
});

// ----- UI: Render Calendar (Constraints) -----
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

  // Pre-calculate how many shifts each person *could* take in this range
  // This helps us prioritize people with limited availability (Least Constrained Resource)
  const availabilityFrequency = Object.fromEntries(PEOPLE.map(p => [p, 0]));
  for (const d of days) {
    const sh = shiftForDate(d);
    if (!sh || sh.specialType === "no_shifts") continue;
    const key = fmtDateKey(d);
    const row = state[key] || {};
    for (const p of PEOPLE) {
      if (!excludedUsers.includes(p) && Number(row[p] ?? 0) < 2) availabilityFrequency[p]++;
    }
  }

  for (const d of days) {
    const jsDow = d.getDay();
    const sh = shiftForDate(d);
    if (!sh || sh.specialType === "no_shifts") continue;

    const key = fmtDateKey(d);
    const wIdx = weekIndexFor(d);
    if (!weekCounts[wIdx]) weekCounts[wIdx] = Object.fromEntries(PEOPLE.map(p => [p, 0]));

    const row = state[key] || {};

    // Sort all people who aren't "Unavailable" (v=2)
    const candidates = PEOPLE.filter(p => !excludedUsers.includes(p) && Number(row[p] ?? 0) < 2);
    // Algorithm Bypass logic
    if (isBypassMode) {
       // In bypass mode, we ignore constraints and just pick based on total counts
       candidates.sort((a, b) => totalCounts[a] - totalCounts[b]);
    } else {
      candidates.sort((a, b) => {
        // 1. Prioritize people with fewer shifts assigned so far in this range
        if (totalCounts[a] !== totalCounts[b]) return totalCounts[a] - totalCounts[b];

        // 2. Prioritize "Available" (0) over "Prefer Not" (1)
        const vA = Number(row[a] ?? 0);
        const vB = Number(row[b] ?? 0);
        if (vA !== vB) return vA - vB;

        // 3. Tie-breaker: Person with the fewest total available slots in the entire period
        return availabilityFrequency[a] - availabilityFrequency[b];
      });
    }

    // Manual Override check (room-specific)
    const manualAssigns = row.manualAssigns || {};
    const pick = manualAssigns[activeRoom] || candidates[0] || null;

    if (pick) {
      totalCounts[pick]++;
      weekCounts[wIdx][pick]++;
      if (jsDow === 5) fridayCounts[pick]++;
      assign[key] = pick;
    }
  }
  return { assign, weekCounts, fridayCounts };
}

function renderSummary(pack) {
  const summaryBox = document.getElementById("summaryBox");
  const { weekCounts, fridayCounts } = pack;
  const html = `
    <div class="panel" style="margin-top:16px">
      <div class="hd"><h3 style="margin:0">סיכום שבועי + ימי שישי</h3></div>
      <div class="bd">
        <div style="overflow-x:auto">
          <table style="width:100%; border-collapse:collapse; font-size:14px; text-align:center">
            <thead>
              <tr style="border-bottom:1px solid var(--border)">
                <th style="padding:8px; text-align:right">שבוע</th>
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
  while (weekStart.getDay() !== 0) { weekStart = new Date(weekStart.getTime() - MS_DAY); }

  while (weekStart <= endDate) {
    const weekEnd = new Date(weekStart.getTime() + 6 * MS_DAY);
    html += `<div class="muted">${fmtDM(weekStart)} – ${fmtDM(weekEnd)}</div>`;
    for (let i = 0; i < 6; i++) {
      const cur = new Date(weekStart.getTime() + i * MS_DAY);
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

        html += `
          <div class="slot ${cur.getDay() === 5 ? 'fri' : ''} ${isManualMode ? 'manual-clickable' : ''}" 
               ${isManualMode ? `onclick="handleManualAssign('${key}')"` : ''} 
               style="${isManualMode ? 'cursor:pointer; border:1px dashed var(--md-sys-color-primary);' : ''}">
            <div class="date">${hebDaysLong[cur.getDay()]}, ${fmtDM(cur)}</div>
            <div class="${who ? 'pill ok' : 'pill bad'}">${isManuallyAssigned ? '🔒 ' : ''}${who ? `משובץ: <b>${who}</b>` : '❌ אין משובץ'}</div>
            <div class="pill ${sh.specialType ? 'wrap' : ''}">${sh.label}</div>
            ${prefer.length ? `<div class="pill warn" style="font-size:11px">${prefer.join(", ")}</div>` : ``}
            ${absent.length ? `<div class="pill bad" style="font-size:11px">${absent.join(", ")}</div>` : ``}
          </div>
        `;
      }
    }
    weekStart = new Date(weekStart.getTime() + 7 * MS_DAY);
  }
  scheduleGrid.innerHTML = html;
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
  const defaultTimes = {0:"16:00", 1:"16:00", 2:"16:00", 3:"16:00", 4:"16:00", 5:"08:00"};
  const regularOptions = ["14:30", "15:00", "15:30", "16:00", "16:30", "17:00"];
  const fridayOptions = ["08:00", "08:30", "09:00"];
  
  let html = "";
  for (let i=0; i<6; i++) {
    const isFriday = i === 5;
    const currentOptions = isFriday ? fridayOptions : regularOptions;
    let val = (roomObj && roomObj.shiftTimes && roomObj.shiftTimes[i]) ? roomObj.shiftTimes[i] : defaultTimes[i];
    
    if (!currentOptions.includes(val)) {
      val = currentOptions[0];
    }

    html += `
      <div style="display:flex; flex-direction:column; gap:4px;">
        <label style="font-size:13px; color:var(--md-sys-color-on-surface-variant);">${daysMap[i]}</label>
        <select class="select shift-time-input" data-day="${i}">
          ${currentOptions.map(opt => `<option value="${opt}" ${opt === val ? "selected" : ""}>${opt}</option>`).join("")}
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
    
    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <input type="text" class="select room-name-input" data-index="${index}" placeholder="שם החדר" value="${r.name}" style="flex:1; margin-left:8px;" />
        <button type="button" class="icon-btn" style="color:var(--md-sys-color-error)" onclick="deleteEditingRoom(${index})" title="מחק חדר">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      <div>
        <input type="text" class="select room-people-input" data-index="${index}" placeholder="שמות הצוות (מופרדים בפסיק)" value="${r.people ? r.people.join(', ') : ''}" style="width:100%; font-size:14px;" />
      </div>
    `;
    adminRoomsList.appendChild(div);
  });
}

if (adminAddRoomBtn) {
  adminAddRoomBtn.addEventListener("click", () => {
    const newId = "room_" + Date.now();
    editingRooms.push({ id: newId, name: "חדר חדש", people: [] });
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

adminBtn.addEventListener("click", (e) => {
  const isExpanded = e.ctrlKey || e.metaKey;
  
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
      propDate = new Date(propDate.getTime() + (7 - propDate.getDay()) * MS_DAY);
    }
    dateInput.value = fmtDateKey(propDate);
  }
  if (roomObj && roomObj.rangeWeeks) {
    rangeWeeksInput.value = String(roomObj.rangeWeeks);
  } else {
    rangeWeeksInput.value = String(rangeWeeks);
  }
  
  renderAdminShiftTimes(roomObj);
  
  renderAdminSpecialDays();
  
  editingRooms = JSON.parse(JSON.stringify(ROOMS));
  renderAdminRoomsList();
  
  adminBackdrop.style.display = "flex";
});
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

    const times = {};
    document.querySelectorAll('.shift-time-input').forEach(sel => {
      times[sel.dataset.day] = sel.value;
    });
    editingRooms[activeIdx].shiftTimes = times;
  }

  await setDoc(ref, { specialDays, rooms: editingRooms }, { merge: true });
  adminBackdrop.style.display = "none";
  window.location.reload(); // Hard refresh to apply global changes
});

async function loadGlobalSettings() {
  const ref = doc(db, "settings", "global");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    if (data.specialDays) {
      specialDays = data.specialDays;
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
    if (urlWeek) {
       // URL param always wins
    } else {
       // In auto-mode, we ignore the saved startDate to allow the Wednesday reset to work.
       // We only fallback to current calculation if for some reason it's invalid.
       if (isNaN(startDate.getTime())) {
          startDate = getAutoStartDate(isHubMode ? "hub" : "selection");
       }
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
    endDate = new Date(startDate.getTime() + (rangeWeeks * 7 * MS_DAY) - (2 * MS_DAY)); // Approx
    monthKey = monthKeyFrom(startDate);
    renderPeopleUI();
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
    if (d.getDay() === 5) { shStart = [8, 0]; shEnd = [14, 0]; }

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

function copyViewOnlyLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "1");
  url.searchParams.set("week", fmtDateKey(startDate));

  navigator.clipboard.writeText(url.toString()).then(() => {
    alert("לינק לצפייה נקייה הועתק ללוח!");
  });
}


viewOnlyBtn.addEventListener("click", copyViewOnlyLink);
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

function renderHub() {
  const weekStart = new Date(startDate);
  // Get Sunday of current week
  while (weekStart.getDay() !== 0) { weekStart.setTime(weekStart.getTime() - MS_DAY); }
  const weekEnd = new Date(weekStart.getTime() + 5 * MS_DAY); // Friday
  
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
      <div class="panel" style="flex: 1; min-width: 0; border: 1px solid var(--md-sys-color-outline-variant); padding:0; overflow:hidden;">
        <div style="background:var(--md-sys-color-surface-variant); padding:12px; text-align: center;">
          <h4 style="margin:0; font-size:17px; color:var(--md-sys-color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${room.name}</h4>
        </div>
        <div style="padding:10px; display:flex; flex-direction:column; gap:6px;">
    `;
    
    for (let i = 0; i < 6; i++) {
      const cur = new Date(weekStart.getTime() + i * MS_DAY);
      const key = fmtDateKey(cur);
      const sh = shiftForDate(cur, room);
      
      const isFri = cur.getDay() === 5;
      const bgStyle = isFri ? 'background:var(--fri-bg)' : 'background:var(--md-sys-color-surface-container-highest)';
      
      if (!sh) continue;
      
      if (sh.specialType === "no_shifts") {
        html += `
          <div style="${bgStyle}; border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; width:45px; font-size:15px;">${hebDays[cur.getDay()]}</div>
            <div class="pill warn" style="font-size:13px; font-weight: 600;">${sh.label}</div>
          </div>
        `;
      } else {
        const who = assign[key] || null;
        html += `
          <div style="${bgStyle}; border-radius:8px; padding:8px 6px; display:flex; justify-content:space-between; align-items:center; gap:4px;">
            <div style="font-weight:700; width:30px; font-size:14px;">${hebDays[cur.getDay()]}</div>
            <div style="font-size:13px; color:var(--md-sys-color-on-surface-variant); font-variant-numeric: tabular-nums; flex:1; text-align:center; font-weight: 500;">${sh.startTime || sh.label}</div>
            <div class="${who ? 'pill ok' : 'pill bad'}" style="font-size:13px; min-width:65px; padding: 4px 2px; text-align:center; font-weight: 600;">${who ? who : '❌'}</div>
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
    
    setTimeout(hideLoader, 500); // Smooth fade out after initial load

    // Live sync
    onSnapshot(doc(db, "constraints", monthKey, "days", "_meta"), (snap) => {
      if (snap.exists() && snap.data().excludedUsers) {
        excludedUsers = snap.data().excludedUsers;
      } else {
        excludedUsers = [];
      }
      updatePersonUI();
      if (isHubMode) {
        renderHub();
      } else {
        refreshScheduleUI();
      }
    }, (err) => console.log("Meta snapshot error", err));

    onSnapshot(collection(db, "constraints", monthKey, "days"), (snap) => {
      if (isManualMode) return; // Don't overwrite staged changes
      snap.docChanges().forEach(ch => {
        if (ch.doc.id === "_meta") return;
        state[ch.doc.id] = ch.doc.data();
      });
      if (isHubMode) {
        renderHub();
      } else {
        renderCalendar();
        refreshScheduleUI();
      }
    });
  } else {
    signInAnonymously(auth).catch(console.error);
  }
});

// ----- UI: Render Tabs -----
function renderTabs() {
  if (!bottomTabs) return;
  bottomTabs.innerHTML = ROOMS.map(r => `
    <div class="tab ${r.id === activeRoom ? 'active' : ''}" data-room="${r.id}">
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

