 'use strict';

/* ════════════════════════════════════════
   RESCUENET INDIA — APP SCRIPT 2025
   Auth in auth.js | App logic here
   ════════════════════════════════════════ */


const HOLD_MS = 2000;
const CIRCUM  = 2 * Math.PI * 72;
const DEFAULT_LAT = 22.5726, DEFAULT_LNG = 88.3639; // Kolkata fallback

const EMERGENCY_NUMBERS = [
  { num: '112',   label: 'Emergency',       cls: '' },
  { num: '108',   label: 'Ambulance',       cls: '' },
  { num: '100',   label: 'Police',          cls: 'police' },
  { num: '101',   label: 'Fire',            cls: 'fire' },
  { num: '102',   label: 'Maternity',       cls: '' },
  { num: '1091',  label: 'Women Safety',    cls: 'women' },
  { num: '1098',  label: 'Child Helpline',  cls: 'child' },
  { num: '1070',  label: 'NDRF',            cls: '' },
  { num: '104',   label: 'Medical Help',    cls: '' },
  { num: '14567', label: 'Senior Citizen',  cls: '' },
];

const CRISIS_CONFIG = {
  medical:  { title: 'MEDICAL EMERGENCY',    emoji: '🚑', call: '108', tag: 'medical' },
  fire:     { title: 'FIRE EMERGENCY',       emoji: '🔥', call: '101', tag: 'fire' },
  accident: { title: 'ROAD ACCIDENT',        emoji: '💥', call: '108', tag: 'accident' },
  crime:    { title: 'CRIME / THREAT',       emoji: '🚨', call: '100', tag: 'crime' },
  flood:    { title: 'FLOOD / DISASTER',     emoji: '🌊', call: '1070', tag: 'flood' },
  woman:    { title: 'WOMEN SAFETY ALERT',   emoji: '🆘', call: '1091', tag: 'woman' },
  child:    { title: 'CHILD SAFETY ALERT',   emoji: '👶', call: '1098', tag: 'child' },
  mental:   { title: 'MENTAL HEALTH CRISIS', emoji: '💙', call: '104',  tag: 'mental' },
};

const firebaseConfig = {
  apiKey: "AIzaSyAC_zvy-abqLldF2ez4k-xZk8ZrvalghXE",
  authDomain: "fastest-emergency-response.firebaseapp.com",
  projectId: "fastest-emergency-response",
  storageBucket: "fastest-emergency-response.firebasestorage.app",
  messagingSenderId: "670811171460",
  appId: "1:670811171460:web:dde9ba73b525347945f0d1",
  measurementId: "G-G03KTEZ2CS"
};
const FIREBASE_ENABLED = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
let firebaseApp = null;
let firebaseDB = null;

function initFirebase() {
  if (!FIREBASE_ENABLED || typeof firebase === 'undefined') return false;
  if (firebaseApp) return true;
  try {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    firebaseDB = firebase.firestore();
    return true;
  } catch (e) {
    console.warn('Firebase init failed', e);
    return false;
  }
}

function getFirebaseUserKey() {
  const email = currentUser?.email || '';
  return email.replace(/[.#$[\]\/]/g, '_');
}

function firebaseSaveDoc(collection, docId, data) {
  if (!initFirebase()) return Promise.resolve(null);
  if (!collection || !docId) return Promise.resolve(null);
  return firebaseDB.collection(collection).doc(docId)
    .set(data, { merge: true })
    .catch(e => { console.warn('Firebase save failed', e); });
}

function firebaseLoadDoc(collection, docId) {
  if (!initFirebase()) return Promise.resolve(null);
  if (!collection || !docId) return Promise.resolve(null);
  return firebaseDB.collection(collection).doc(docId).get()
    .then(doc => doc.exists ? doc.data() : null)
    .catch(e => { console.warn('Firebase load failed', e); return null; });
}

async function syncFirebaseUserData() {
  if (!currentUser || !initFirebase()) return;
  const docId = getFirebaseUserKey();
  if (!docId) return;
  const payload = {
    profile: JSON.parse(localStorage.getItem('rn_profile') || '{}'),
    contacts: loadContacts(),
    alerts: alertHistory,
    crashLog,
    updatedAt: new Date().toISOString()
  };
  await firebaseSaveDoc('users', docId, payload);
}

async function loadFirebaseUserData() {
  if (!currentUser || !initFirebase()) return;
  const docId = getFirebaseUserKey();
  if (!docId) return;
  const data = await firebaseLoadDoc('users', docId);
  if (!data) return;
  if (data.profile) {
    try { localStorage.setItem('rn_profile', JSON.stringify(data.profile)); } catch (_) {}
  }
  if (data.contacts && Array.isArray(data.contacts)) {
    try { localStorage.setItem('rn_contacts', JSON.stringify(data.contacts)); } catch (_) {}
    contacts = data.contacts;
  }
  if (data.alerts && Array.isArray(data.alerts)) {
    alertHistory = [];
    const alertLogEl = $('alertLog');
    if (alertLogEl) alertLogEl.innerHTML = '';
    data.alerts.slice().reverse().forEach(alert => addAlertToLog(alert));
  }
  if (data.crashLog && Array.isArray(data.crashLog)) {
    crashLog = data.crashLog;
  }
}

/* ════ STATE ════ */
let currentLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG, fresh: false };
let holdStart = null, holdRaf = null, holdTimer = null;
let alarmInterval = null, audioCtx = null;
let leafletMap = null, leafletMarker = null;
let lastSMSMessage = '', lastCallScript = '';
let nearbyHospitals = [];
let autoCallSequenceActive = false;
let currentUser = null;
let alertHistory = [];
let alertCounter = 1;
let crashLog = [];
let contacts = [];

/* ════ DOM ════ */
const $ = id => document.getElementById(id);

/* ════════════════════════════════════════
   AUTH SYSTEM
   ════════════════════════════════════════ */

function togglePass(inputId, btn) {
  const el = $(inputId);
  if (!el) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
  else { el.type = 'password'; btn.textContent = '👁'; }
}

function switchAuth(panel) {
  ['loginPanel','signupPanel','forgotPanel'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
  const target = panel === 'login' ? 'loginPanel' : panel === 'signup' ? 'signupPanel' : 'forgotPanel';
  const el = $(target);
  if (el) el.classList.remove('hidden');
}

function showForgot() { switchAuth('forgot'); }

function getUsers() {
  try { return JSON.parse(localStorage.getItem('rn_users') || '{}'); } catch { return {}; }
}

function saveUsers(users) {
  try { localStorage.setItem('rn_users', JSON.stringify(users)); } catch(_) {}
}

function doLogin() {
  const emailEl = $('loginEmail');
  const passEl  = $('loginPass');
  if (!emailEl || !passEl) return;

  const email = emailEl.value.trim();
  const pass  = passEl.value;

  if (!email || !pass) {
    authToast('Please fill in all fields', 'error'); return;
  }

  const users = getUsers();
  const user = users[email.toLowerCase()];

  if (!user) {
    authToast('No account found. Create one first.', 'error'); return;
  }
  if (user.password !== btoa(pass)) {
    authToast('Incorrect password. Try again.', 'error'); return;
  }

  const btn = $('loginBtn');
  if (btn) { btn.textContent = '⏳ Signing in…'; btn.disabled = true; }

  setTimeout(() => {
    if (btn) { btn.textContent = '🔐 SIGN IN'; btn.disabled = false; }
    currentUser = { email: user.email, name: user.name || 'User', phone: user.phone || '' };
    try {
      if ($('rememberMe') && $('rememberMe').checked) {
        localStorage.setItem('rn_session', JSON.stringify(currentUser));
      } else {
        sessionStorage.setItem('rn_session', JSON.stringify(currentUser));
      }
    } catch(_) {}
    enterApp();
  }, 900);
}

function demoLogin() {
  currentUser = { email: 'demo@rescuenet.in', name: 'Demo User', phone: '+91 98765 43210' };
  try { sessionStorage.setItem('rn_session', JSON.stringify(currentUser)); } catch(_) {}
  enterApp();
}

function doSignup() {
  const first = $('signupFirst')?.value.trim();
  const last  = $('signupLast')?.value.trim();
  const email = $('signupEmail')?.value.trim().toLowerCase();
  const phone = $('signupPhone')?.value.trim();
  const city  = $('signupCity')?.value.trim();
  const pass  = $('signupPass')?.value;
  const pass2 = $('signupPass2')?.value;
  const agree = $('agreeTerms')?.checked;

  if (!first || !last) return authToast('Please enter your name', 'error');
  if (!email || !email.includes('@')) return authToast('Valid email required', 'error');
  if (!phone) return authToast('Phone number required', 'error');
  if (!pass || pass.length < 8) return authToast('Password must be at least 8 characters', 'error');
  if (pass !== pass2) return authToast('Passwords do not match', 'error');
  if (!agree) return authToast('Please accept the Terms of Service', 'error');

  const users = getUsers();
  if (users[email]) return authToast('Account already exists. Sign in instead.', 'error');

  const user = {
    email, name: first + ' ' + last,
    phone, city, password: btoa(pass)
  };
  users[email] = user;
  saveUsers(users);

  // Auto-login
  currentUser = { email, name: user.name, phone };
  try { sessionStorage.setItem('rn_session', JSON.stringify(currentUser)); } catch(_) {}

  authToast('✅ Account created!', 'success');
  setTimeout(enterApp, 800);
}

function doForgot() {
  const email = $('forgotEmail')?.value.trim().toLowerCase();
  if (!email || !email.includes('@')) return authToast('Enter a valid email', 'error');
  const users = getUsers();
  if (!users[email]) return authToast('No account found with that email', 'error');
  authToast('📧 Reset link sent! (Demo: password is "password123")', 'success');
}

function doLogout() {
  if (!confirm('Sign out of RescueNet?')) return;
  try {
    localStorage.removeItem('rn_session');
    sessionStorage.removeItem('rn_session');
  } catch(_) {}
  currentUser = null;

  // Stop crash detection
  if (typeof crashDetectionActive !== 'undefined' && crashDetectionActive) {
    deactivateCrashDetection();
  }

  const appScreen = $('appScreen');
  const authScreen = $('authScreen');
  if (appScreen) appScreen.classList.add('hidden');
  if (authScreen) authScreen.classList.remove('hidden');

  // Clear inputs
  ['loginEmail','loginPass'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  switchAuth('login');
  authToast('You have been signed out', 'info');
}

function enterApp() {
  const authScreen = $('authScreen');
  const appScreen  = $('appScreen');
  if (authScreen) authScreen.classList.add('hidden');
  if (appScreen)  appScreen.classList.remove('hidden');

  updateNavUser();
  initApp();

  if (initFirebase()) {
    loadFirebaseUserData().then(() => {
      updateNavUser();
      renderContacts();
      updateIDCard();
      renderCrashLog();
      if (leafletMap) leafletMap.invalidateSize();
    });
  }
}

function updateNavUser() {
  if (!currentUser) return;
  const nav = $('navAvatar');
  const dropName  = $('dropdownName');
  const dropEmail = $('dropdownEmail');
  if (nav) nav.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
  if (dropName)  dropName.textContent  = currentUser.name  || 'User';
  if (dropEmail) dropEmail.textContent = currentUser.email || '';
}

function toggleUserMenu() {
  const dd = $('userDropdown');
  if (dd) dd.classList.toggle('active');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  const menu = $('navUserMenu');
  if (menu && !menu.contains(e.target)) {
    const dd = $('userDropdown');
    if (dd) dd.classList.remove('active');
  }
});

function authToast(msg, type = 'info') {
  const existing = document.getElementById('authToast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'authToast';
  el.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#0a1628;color:#e8f4fd;padding:10px 20px;border-radius:30px;
    font-size:.82rem;font-weight:600;z-index:99999;
    border:1px solid ${type === 'error' ? '#ff1744' : type === 'success' ? '#00e676' : '#00d4ff'};
    color:${type === 'error' ? '#ff8a9a' : type === 'success' ? '#80ffc8' : '#00d4ff'};
    max-width:90vw;text-align:center;font-family:'Rajdhani',sans-serif;
    animation:fadeIn .3s ease;
  `;
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
  document.head.appendChild(style);
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 3500);
}

// Password strength indicator
const signupPassEl = $('signupPass');
if (signupPassEl) {
  signupPassEl.addEventListener('input', () => {
    const val = signupPassEl.value;
    const el  = $('passStrength');
    if (!el) return;
    if (!val) { el.textContent = ''; return; }
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const labels = ['', '🔴 Weak', '🟠 Fair', '🟡 Good', '🟢 Strong'];
    el.textContent = labels[score] || '';
  });
}

/* ════ CHECK EXISTING SESSION ════ */
(function checkSession() {
  try {
    let session = JSON.parse(localStorage.getItem('rn_session') || 'null')
                || JSON.parse(sessionStorage.getItem('rn_session') || 'null');
    if (session && session.email) {
      currentUser = session;
      const authScreen = $('authScreen');
      const appScreen  = $('appScreen');
      if (authScreen) authScreen.classList.add('hidden');
      if (appScreen)  appScreen.classList.remove('hidden');
      // We'll call initApp after DOM is ready
    }
  } catch(_) {}
})();

/* ════════════════════════════════════════
   SECTION NAVIGATION
   ════════════════════════════════════════ */

function navigateTo(sectionId) {
  document.querySelectorAll('.section-page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.getAttribute('onclick') && l.getAttribute('onclick').includes(`'${sectionId}'`));
  });

  // Update bottom nav active state
  const bnMap = { home:'bn-home', location:'bn-location', hospitals:'bn-hospitals', profile:'bn-profile', contacts:'bn-profile', alerts:'bn-profile', crash:'bn-home' };
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  const activeBn = bnMap[sectionId];
  if (activeBn) { const el = $(activeBn); if (el) el.classList.add('active'); }

  if (sectionId === 'location') {
    setTimeout(() => { initMap(); if (leafletMap) leafletMap.invalidateSize(); }, 300);
  }
  if (sectionId === 'crash') {
    setTimeout(() => renderCrashLog(), 100);
  }
}

function closeMobileMenu() {
  $('mobileMenu')?.classList.remove('active');
}

function openCrisisModal() {
  const modal = $('crisisModal');
  if (modal) modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCrisisModal() {
  const modal = $('crisisModal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

/* ════════════════════════════════════════
   TOAST
   ════════════════════════════════════════ */
function toast(msg, type = 'success', ms = 4000) {
  const toastEl = $('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ════════════════════════════════════════
   ALARM AUDIO
   ════════════════════════════════════════ */
function playAlarm() {
  try {
    if (audioCtx) { try { audioCtx.close(); } catch(_){} }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function beep(freq, delay, dur) {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, audioCtx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + delay + 0.02);
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime + delay + dur - 0.04);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + dur);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + dur);
    }
    function pat() { beep(900,0,.18); beep(680,.28,.18); beep(900,.56,.18); beep(680,.9,.18); }
    pat();
    alarmInterval = setInterval(pat, 2200);
  } catch(e) { console.warn('Audio unavailable'); }
}

function stopAlarm() {
  if (alarmInterval) clearInterval(alarmInterval);
  try { if (audioCtx) audioCtx.close(); } catch(_){}
}

/* ════════════════════════════════════════
   ALARM OVERLAY
   ════════════════════════════════════════ */
function showAlarm(type, msg, details, callNum = '112') {
  $('alarmIcon').textContent  = type === 'ACCIDENT' ? '⚠️' : type === 'CRISIS' ? '⚡' : '🆘';
  $('alarmTitle').textContent = type === 'ACCIDENT' ? '🚨 ACCIDENT REPORTED' : type === 'CRISIS' ? '⚡ CRISIS RESPONSE ACTIVATED' : '🆘 SOS ACTIVATED';
  $('alarmMsg').textContent   = msg;
  $('alarmDetails').textContent = details;
  $('alarmCallBtn').onclick   = () => { window.location.href = `tel:${callNum}`; hideAlarm(); };

  const nearEl = $('alarmNearest');
  if (nearbyHospitals.length > 0 && nearEl) {
    const h = nearbyHospitals[0];
    nearEl.style.display = 'block';
    nearEl.innerHTML = `<strong>🏥 Nearest Hospital:</strong>${h.name} — ${h.distance}<br><small>${h.address || ''}</small>`;
  } else if (nearEl) {
    nearEl.style.display = 'none';
  }

  const alarmOv = $('alarmOverlay');
  if (alarmOv) alarmOv.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  playAlarm();
  if (navigator.vibrate) navigator.vibrate([300,100,300,100,300,200,500]);
}

function hideAlarm() {
  const alarmOv = $('alarmOverlay');
  if (alarmOv) alarmOv.classList.add('hidden');
  document.body.style.overflow = '';
  stopAlarm();
}

/* ════════════════════════════════════════
   RAPID CRISIS RESPONSE
   ════════════════════════════════════════ */
async function triggerCrisis(type) {
  const cfg = CRISIS_CONFIG[type];
  if (!cfg) return;

  const statusEl = $('crisisStatus');
  if (statusEl) statusEl.textContent = `⚡ Activating ${cfg.title}…`;

  closeCrisisModal();

  let loc;
  try { loc = await getLocationForAlert(); } catch(_) { loc = currentLocation; }
  let profile = {};
  try { profile = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_) {}

  const mapsUrl = `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  const msg = `${cfg.emoji} ${cfg.title}\n\n👤 ${profile.name || 'User'}\n📍 Location: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n🗺️ Maps: ${mapsUrl}\n📞 Emergency Call: ${cfg.call}\n\nSent via RescueNet India`;

  const callScript = `🚨 CRISIS CALL — ${cfg.title}\n\n"Hello, I need emergency assistance. Type: ${cfg.title}\n📍 Location: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n🗺️ Google Maps: ${mapsUrl}\n${profile.name ? `\nPerson: ${profile.name}` : ''}\n\nPlease send help immediately."`;

  const alertId = alertCounter++;
  const alertData = {
    id: alertId,
    type: 'CRISIS',
    crisisType: type,
    loc,
    message: `${cfg.title} — ${cfg.emoji}`,
    smsMsg: msg,
    callScript
  };
  addAlertToLog(alertData);

  showAlarm('CRISIS', `${cfg.title} alert sent!`, `📍 ${loc.lat.toFixed(4)}°N, ${loc.lng.toFixed(4)}°E\n📞 Recommended: Call ${cfg.call}\n👥 ${contacts.length} contact(s) will receive alert`, cfg.call);

  toast(`${cfg.emoji} ${cfg.title} activated! Call ${cfg.call}`, 'warning', 5000);

  // Open WhatsApp for personal contacts
  const personalContacts = contacts.filter(c => !c.isDefault);
  if (personalContacts.length > 0) {
    setTimeout(() => {
      personalContacts.forEach((c, i) => {
        setTimeout(() => {
          window.open(`https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
        }, i * 1200);
      });
    }, 2000);
  }
}

/* ════════════════════════════════════════
   LEAFLET MAP (OpenStreetMap)
   ════════════════════════════════════════ */
function initMap() {
  if (leafletMap) return;
  const mapDiv = $('leafletMap');
  if (!mapDiv || typeof L === 'undefined') return;

  leafletMap = L.map('leafletMap', { zoomControl: true }).setView([currentLocation.lat, currentLocation.lng], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20
  }).addTo(leafletMap);

  const userIcon = L.divIcon({
    html: '<div style="width:20px;height:20px;background:#00d4ff;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(0,212,255,.9)"></div>',
    className: '', iconSize: [20, 20], iconAnchor: [10, 10]
  });

  leafletMarker = L.marker([currentLocation.lat, currentLocation.lng], { icon: userIcon })
    .addTo(leafletMap)
    .bindPopup('<b style="color:#00d4ff">📍 Your Location</b><br>Emergency services will be directed here.');

  setTimeout(() => leafletMap.invalidateSize(), 400);
}

function updateMapLocation(lat, lng) {
  if (!leafletMap) { initMap(); return; }
  const pos = [lat, lng];
  leafletMap.setView(pos, 16);
  if (leafletMarker) leafletMarker.setLatLng(pos);
  setTimeout(() => leafletMap.invalidateSize(), 100);
}

function addHospitalMarkers(hospitals) {
  if (!leafletMap || !hospitals.length) return;
  const hospIcon = L.divIcon({
    html: '<div style="width:22px;height:22px;background:#00b0ff;border:3px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;box-shadow:0 0 8px rgba(0,176,255,.8);font-weight:900">H</div>',
    className: '', iconSize: [22, 22], iconAnchor: [11, 11]
  });
  hospitals.forEach(h => {
    if (h.lat && h.lng) {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
      L.marker([h.lat, h.lng], { icon: hospIcon })
        .addTo(leafletMap)
        .bindPopup(`<b>🏥 ${h.name}</b><br>${h.distance}<br>${h.address || ''}<br><a href="${mapsUrl}" target="_blank" style="color:#00d4ff;font-weight:700">🗺️ Get Directions</a>`);
    }
  });
}

const mapObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { initMap(); mapObserver.disconnect(); } });
}, { threshold: 0.1 });
const mapSection = $('location');
if (mapSection) mapObserver.observe(mapSection);

/* ════════════════════════════════════════
   GEOLOCATION + GOOGLE MAPS
   ════════════════════════════════════════ */
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      const err = 'Geolocation not supported';
      toast(err, 'error'); reject(err); return;
    }
    const locStatusEl = $('locStatusText');
    const getBtn = $('getLocationBtn');
    if (locStatusEl) locStatusEl.textContent = '⏳ Fetching location…';
    if (getBtn) { getBtn.disabled = true; getBtn.innerHTML = '<span class="spinner"></span> Locating…'; }

    navigator.geolocation.getCurrentPosition(
      pos => {
        currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, fresh: true };

        const latEl = $('latValue');
        const lngEl = $('lngValue');
        const accEl = $('accuracyText');
        const updEl = $('lastUpdated');
        if (latEl) latEl.textContent = currentLocation.lat.toFixed(6) + '°';
        if (lngEl) lngEl.textContent = currentLocation.lng.toFixed(6) + '°';
        if (accEl) accEl.textContent = pos.coords.accuracy ? `±${Math.round(pos.coords.accuracy)}m` : 'High';
        if (locStatusEl) { locStatusEl.textContent = '✅ Location active'; locStatusEl.style.color = '#00e676'; }
        if (updEl) updEl.textContent = new Date().toLocaleTimeString('en-IN');
        if (getBtn) { getBtn.disabled = false; getBtn.innerHTML = '📍 Get My Location'; }

        // Google Maps buttons
        const lat = currentLocation.lat, lng = currentLocation.lng;
        const mapsBtn = $('openMapsBtn');
        const navBtn  = $('openGMapsNavBtn');
        const svBtn   = $('streetViewBtn');
        if (mapsBtn) {
          mapsBtn.href = `https://www.google.com/maps?q=${lat},${lng}`;
          mapsBtn.style.display = 'block';
        }
        if (navBtn) {
          navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
          navBtn.style.display = 'block';
        }
        if (svBtn) {
          svBtn.href = `https://www.google.com/maps?layer=c&cbll=${lat},${lng}`;
          svBtn.style.display = 'inline-flex';
        }

        updateMapLocation(lat, lng);
        toast('📍 Location updated successfully', 'success');
        resolve(currentLocation);
      },
      err => {
        if (getBtn) { getBtn.disabled = false; getBtn.innerHTML = '📍 Get My Location'; }
        let msg = 'Location error';
        if (err.code === 1) msg = '⛔ Location permission denied. Allow in browser settings.';
        if (err.code === 2) msg = '📡 Location unavailable. Check GPS/network.';
        if (err.code === 3) msg = '⏱ Location request timed out. Try again.';
        if (locStatusEl) { locStatusEl.textContent = msg; locStatusEl.style.color = '#ff1744'; }
        toast(msg, 'error', 6000);
        resolve(currentLocation);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function getLocationForAlert() {
  if (currentLocation.fresh) return currentLocation;
  return await getCurrentLocation();
}

/* ════════════════════════════════════════
   NEARBY HOSPITALS (OpenStreetMap)
   ════════════════════════════════════════ */
function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDist(km) {
  return km < 1 ? `${Math.round(km * 1000)}m away` : `${km.toFixed(1)} km away`;
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

async function fetchOverpass(query) {
  let lastError = null;
  const body = query.trim();

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        mode: 'cors',
        cache: 'no-cache'
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn(`Overpass fetch failed (${endpoint}):`, error);
      lastError = error;
    }
  }

  throw lastError || new Error('Overpass query failed');
}

async function fetchNearbyHospitals(lat, lng, radius = 5000) {
  const grid = $('hospitalsGrid');
  if (grid) grid.innerHTML = `<div class="hospitals-empty"><span><span class="spinner"></span></span><p>Searching hospitals near you…</p></div>`;

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="clinic"](around:${radius},${lat},${lng});
      node["healthcare"="hospital"](around:${radius},${lat},${lng});
      way["amenity"="hospital"](around:${radius},${lat},${lng});
      way["amenity"="clinic"](around:${radius},${lat},${lng});
    );
    out body center 20;
  `;

  try {
    const data = await fetchOverpass(query);
    const hospitals = (data.elements || [])
      .map(el => {
        const elLat = el.lat || el.center?.lat;
        const elLng = el.lon || el.center?.lon;
        if (!elLat || !elLng) return null;
        const dist = calcDist(lat, lng, elLat, elLng);
        const tags = el.tags || {};
        return {
          id: el.id,
          name: tags.name || tags['name:en'] || 'Hospital / Clinic',
          type: tags.amenity === 'hospital' ? 'Hospital' : tags.amenity === 'clinic' ? 'Clinic' : 'Healthcare',
          address: [tags['addr:housename'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(', ') || tags['addr:full'] || '',
          phone: tags.phone || tags['contact:phone'] || '',
          lat: elLat, lng: elLng, dist
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 12);

    nearbyHospitals = hospitals.map(h => ({ ...h, distance: formatDist(h.dist) }));
    renderHospitals();
    if (leafletMap) addHospitalMarkers(nearbyHospitals);
    if (nearbyHospitals.length === 0) toast('No hospitals found nearby. Try increasing radius.', 'info');
    else toast(`🏥 Found ${nearbyHospitals.length} hospitals nearby`, 'success');

  } catch(e) {
    console.warn('Hospital fetch error:', e);
    if (grid) grid.innerHTML = `<div class="hospitals-empty"><span>⚠️</span><p>Could not fetch hospitals. Check your connection.</p></div>`;
    toast('⚠ Could not fetch nearby hospitals. Please retry.', 'error');
  }
}

function renderHospitals() {
  const grid = $('hospitalsGrid');
  if (!grid) return;
  if (!nearbyHospitals.length) {
    grid.innerHTML = `<div class="hospitals-empty"><span>🏥</span><p>No hospitals found</p><p>Click "Find Hospitals" after enabling location</p></div>`;
    return;
  }
  grid.innerHTML = nearbyHospitals.map(h => {
    const mapsUrl  = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
    const gMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name)}&query_place_id=${h.lat},${h.lng}`;
    const callHtml = h.phone
      ? `<a href="tel:${h.phone}" class="hosp-call-btn">📞 Call</a>`
      : `<button class="hosp-call-btn" onclick="toast('No direct number. Call 108 for ambulance.','info')">📞 108 Ambu</button>`;
    return `
      <div class="hospital-card">
        <div class="hospital-header">
          <div class="hospital-icon">🏥</div>
          <div class="hospital-info">
            <div class="hospital-name">${escHtml(h.name)}</div>
            <span class="hospital-type">${h.type}</span>
            <div class="hospital-dist">📍 ${h.distance}</div>
          </div>
        </div>
        ${h.address ? `<div class="hospital-addr">📌 ${escHtml(h.address)}</div>` : ''}
        <div class="hospital-actions">
          ${callHtml}
          <a href="${mapsUrl}" target="_blank" class="hosp-dir-btn">🗺️ Directions</a>
        </div>
      </div>`;
  }).join('');
}

/* ════════════════════════════════════════
   AUTO-CALL EMERGENCY
   ════════════════════════════════════════ */
function autoCallAllEmergency() {
  if (autoCallSequenceActive) return;
  const btn = $('autoCallBtn');
  if (!confirm('📞 AUTO EMERGENCY CALL\n\nThis will open calls to:\n112 → 108 → 100 → 101\n\nUse ONLY in real emergencies.\nPress OK to proceed.')) return;

  autoCallSequenceActive = true;
  if (btn) { btn.classList.add('calling'); btn.textContent = '📞 CALLING EMERGENCY SERVICES…'; }

  const seq = ['112', '108', '100', '101'];
  let idx = 0;

  function callNext() {
    if (idx >= seq.length) {
      autoCallSequenceActive = false;
      if (btn) { btn.classList.remove('calling'); btn.innerHTML = '📞 AUTO-CALL ALL EMERGENCY NUMBERS'; }
      toast('✅ Emergency call sequence completed', 'success', 5000);
      return;
    }
    const num = seq[idx];
    toast(`📞 Calling ${num}…`, 'info', 3000);
    window.location.href = `tel:${num}`;
    idx++;
    setTimeout(callNext, 4000);
  }
  callNext();
}

function renderEmergencyNumbers() {
  const grid = $('emergencyNumbersGrid');
  if (!grid) return;
  grid.innerHTML = EMERGENCY_NUMBERS.map(e => `
    <a href="tel:${e.num}" class="call-num-card ${e.cls}" onclick="toast('📞 Calling ${e.label}…','info',2000)">
      <div class="n">${e.num}</div>
      <div class="l">${e.label}</div>
    </a>
  `).join('');
}

/* ════════════════════════════════════════
   CONTACTS
   ════════════════════════════════════════ */
const DEFAULT_CONTACTS = [
  { id: 1, name: 'Police Control',    phone: '100', relation: 'Police',  isDefault: true },
  { id: 2, name: 'Ambulance Service', phone: '108', relation: 'Medical', isDefault: true },
  { id: 3, name: 'Fire Brigade',      phone: '101', relation: 'Fire',    isDefault: true },
];

function loadContacts() {
  try {
    const stored = JSON.parse(localStorage.getItem('rn_contacts') || 'null');
    return stored && stored.length ? stored : [...DEFAULT_CONTACTS];
  } catch { return [...DEFAULT_CONTACTS]; }
}

function saveContactsToStorage(list) {
  try { localStorage.setItem('rn_contacts', JSON.stringify(list)); } catch(_) {}
  if (FIREBASE_ENABLED && currentUser) {
    syncFirebaseUserData();
  }
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatWAPhone(phone) {
  let p = phone.replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;
  if (p.startsWith('0')) p = '91' + p.slice(1);
  return p;
}

function renderContacts() {
  const container = $('contactList');
  const countSpan = $('contactCount');
  if (!container) return;
  if (countSpan) countSpan.textContent = contacts.length;

  if (!contacts.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">No contacts yet. Add your first emergency contact.</div>';
    return;
  }

  container.innerHTML = contacts.map(c => `
    <div class="contact-item">
      <div class="contact-info">
        <div class="contact-name">${escHtml(c.name)} ${c.isDefault ? '<span style="font-size:.58rem;background:rgba(0,212,255,.1);color:var(--primary);padding:1px 5px;border-radius:3px;font-weight:700;letter-spacing:.5px">DEFAULT</span>' : ''}</div>
        <div class="contact-detail">${escHtml(c.phone)} · ${escHtml(c.relation)}</div>
      </div>
      <div class="contact-actions">
        <a href="tel:${escHtml(c.phone)}" class="contact-btn">📞</a>
        <a href="https://wa.me/${formatWAPhone(c.phone)}" target="_blank" class="contact-btn">📲</a>
        ${!c.isDefault ? `<button class="contact-btn del" data-id="${c.id}">🗑</button>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.contact-btn.del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      contacts = contacts.filter(c => c.id !== id);
      saveContactsToStorage(contacts);
      renderContacts();
      toast('Contact removed', 'info');
    });
  });
}

/* ════════════════════════════════════════
   PROFILE
   ════════════════════════════════════════ */
function updateIDCard() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_) {}

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('patientName',   p.name     || 'Your Name');
  set('bloodType',     p.blood    || '—');
  set('infoBlood',     p.blood    || '—');
  set('infoAge',       p.age      || '—');
  set('infoGender',    p.gender   || '—');
  set('infoPhone',     p.phone    || '—');
  set('infoAllergies', p.allergies || 'None listed');
  set('infoConditions',p.medical  || 'None listed');
  set('infoMedication',p.medication || 'None listed');
  set('infoDoctor',    [p.doctor, p.doctorPhone].filter(Boolean).join(' · ') || '—');

  const avatarEl = $('avatar');
  if (avatarEl) avatarEl.textContent = (p.name || '?').charAt(0).toUpperCase();

  // Nav avatar too
  if (currentUser) {
    const navAv = $('navAvatar');
    if (navAv) navAv.textContent = (currentUser.name || p.name || '?').charAt(0).toUpperCase();
  }

  const savedPhoto = localStorage.getItem('rn_profile_photo');
  if (savedPhoto) showProfilePhoto(savedPhoto);

  updateIDCardTags(p);

  const pct = calcProfileCompleteness(p);
  const pctEl = $('completenessPercent');
  const fillEl = $('completenessFill');
  if (pctEl) pctEl.textContent = pct + '%';
  if (fillEl) fillEl.style.width = pct + '%';

  // Fill form
  const fillInput = (id, val) => { const el = $(id); if (el && val) el.value = val; };
  fillInput('pName', p.name); fillInput('pPhone', p.phone); fillInput('pAge', p.age);
  fillInput('pAddress', p.address); fillInput('pAllergies', p.allergies);
  fillInput('pMedical', p.medical); fillInput('pMedication', p.medication);
  fillInput('pAadhar', p.aadhar); fillInput('pOccupation', p.occupation);
  fillInput('pDisability', p.disability); fillInput('pHeight', p.height); fillInput('pWeight', p.weight);
  fillInput('pEcName', p.ecName); fillInput('pEcPhone', p.ecPhone);
  fillInput('pDoctor', p.doctor); fillInput('pDoctorPhone', p.doctorPhone);
  fillInput('pInsurance', p.insurance); fillInput('pEmergencyNote', p.emergencyNote);
  const gEl = $('pGender'); if (gEl && p.gender) gEl.value = p.gender;
  const bEl = $('pBlood');  if (bEl && p.blood)  bEl.value = p.blood;
  const dEl = $('pDonor');  if (dEl && p.donor)  dEl.value = p.donor;
}

function calcProfileCompleteness(p) {
  const fields = ['name','phone','age','gender','blood','address','allergies','medical','medication','ecName','ecPhone','doctor'];
  const filled = fields.filter(f => p[f] && String(p[f]).trim()).length;
  return Math.round((filled / fields.length) * 100);
}

function updateIDCardTags(p) {
  const el = $('idCardTags');
  if (!el) return;
  const tags = [];
  if (p.allergies) tags.push(`<span class="id-tag">⚠️ ${p.allergies.split(',')[0].trim()}</span>`);
  if (p.medical)   tags.push(`<span class="id-tag">🏥 ${p.medical.split(',')[0].trim()}</span>`);
  if (p.donor === 'Yes') tags.push(`<span class="id-tag">🫀 Organ Donor</span>`);
  el.innerHTML = tags.join('');
}

function showProfilePhoto(dataUrl) {
  const photoEl  = $('avatarPhoto');
  const avatarEl = $('avatar');
  if (dataUrl) {
    if (photoEl) { photoEl.src = dataUrl; photoEl.classList.remove('hidden'); }
    if (avatarEl) avatarEl.style.display = 'none';
  } else {
    if (photoEl) photoEl.classList.add('hidden');
    if (avatarEl) avatarEl.style.display = 'flex';
  }
}

/* ════════════════════════════════════════
   SMS + CALL SCRIPT
   ════════════════════════════════════════ */
function buildSMS(type, loc, profile, accDetails) {
  const mapsUrl = `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  let msg = `🆘 ${type === 'ACCIDENT' ? 'ACCIDENT ALERT' : 'SOS EMERGENCY'} — RescueNet India\n\n`;
  if (profile.name) msg += `👤 ${profile.name}\n`;
  if (profile.blood) msg += `🩸 Blood: ${profile.blood}`;
  if (profile.age)   msg += ` | Age: ${profile.age}`;
  msg += `\n📍 GPS: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n🗺️ ${mapsUrl}\n`;
  if (profile.address) msg += `📌 ${profile.address}\n`;
  if (profile.allergies) msg += `⚠️ Allergies: ${profile.allergies}\n`;
  if (profile.medical)   msg += `🏥 Conditions: ${profile.medical}\n`;
  if (profile.medication) msg += `💊 Meds: ${profile.medication}\n`;
  if (accDetails) {
    msg += `\n🚗 Accident Info:\n`;
    msg += `• Severity: ${accDetails.severity}\n• Vehicle: ${accDetails.vehicleType}\n• Injured: ${accDetails.injuredCount}\n`;
    if (accDetails.description) msg += `• Note: ${accDetails.description}\n`;
  }
  if (nearbyHospitals.length > 0) {
    const h = nearbyHospitals[0];
    msg += `\n🏥 Nearest Hospital: ${h.name} (${h.distance})\n`;
    const hMaps = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
    msg += `🗺️ Hospital Directions: ${hMaps}\n`;
  }
  msg += `\n📞 Call 112 (Emergency) or 108 (Ambulance)\n⚡ Sent via RescueNet India`;
  return msg;
}

function buildCallScript(type, loc, profile, accDetails) {
  const mapsUrl = `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  let s = `🚨 EMERGENCY CALL SCRIPT — READ THIS ALOUD 🚨\n\n`;
  s += `"Hello, I am calling to report an emergency ${type === 'ACCIDENT' ? 'road accident' : 'SOS situation'}.\n\n`;
  s += `📍 LOCATION:\n`;
  s += `• Coordinates: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n`;
  s += `• Google Maps: ${mapsUrl}\n`;
  if (profile && profile.address) s += `• Address: ${profile.address}\n`;
  s += `\n👤 PERSON:\n`;
  if (profile.name)     s += `• Name: ${profile.name}\n`;
  if (profile.phone)    s += `• Phone: ${profile.phone}\n`;
  if (profile.blood)    s += `• Blood Group: ${profile.blood}\n`;
  if (profile.allergies) s += `• Allergies: ${profile.allergies}\n`;
  if (profile.medical)   s += `• Medical Conditions: ${profile.medical}\n`;
  if (profile.medication) s += `• Medications: ${profile.medication}\n`;
  if (accDetails) {
    s += `\n🚗 ACCIDENT:\n`;
    s += `• Severity: ${accDetails.severity}\n• Vehicle: ${accDetails.vehicleType}\n• Injured: ${accDetails.injuredCount}\n`;
    if (accDetails.description) s += `• Details: ${accDetails.description}\n`;
  }
  if (nearbyHospitals.length > 0) {
    s += `\n🏥 NEAREST HOSPITAL: ${nearbyHospitals[0].name} — ${nearbyHospitals[0].distance}\n`;
  }
  s += `\nPlease dispatch emergency services IMMEDIATELY."\n\n`;
  s += `⚠️ STAY CALM. DO NOT HANG UP. Follow the operator's instructions.`;
  return s;
}

/* ════════════════════════════════════════
   ALERT LOG
   ════════════════════════════════════════ */
function addAlertToLog(alertData) {
  alertHistory.unshift(alertData);
  const alertLogEl = $('alertLog');
  if (!alertLogEl) return;
  const empty = alertLogEl.querySelector('.alert-empty');
  if (empty) empty.remove();

  const mapsUrl = `https://maps.google.com/?q=${alertData.loc.lat.toFixed(6)},${alertData.loc.lng.toFixed(6)}`;
  const div = document.createElement('div');
  const typeClass = alertData.type === 'ACCIDENT' ? 'acc-type' : alertData.type === 'CRISIS' ? 'crisis-type' : 'sos-type';
  const icon = alertData.type === 'ACCIDENT' ? '⚠️' : alertData.type === 'CRISIS' ? '⚡' : '🆘';

  div.className = `alert-item ${typeClass}`;
  div.innerHTML = `
    <div class="alert-icon">${icon}</div>
    <div class="alert-content">
      <div class="alert-title">${alertData.type} ALERT · #${alertData.id}</div>
      <div class="alert-time">📍 ${alertData.loc.lat.toFixed(4)}°N, ${alertData.loc.lng.toFixed(4)}°E · 🕐 ${new Date().toLocaleTimeString('en-IN')}</div>
      <div class="alert-loc">${alertData.message}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:.35rem;align-items:flex-end">
      <button class="alert-sms-btn sms-btn">💬 SMS</button>
      <button class="alert-sms-btn call-btn" style="background:rgba(0,230,118,.08);border-color:rgba(0,230,118,.15);color:#00e676">📞 Script</button>
      <a class="alert-sms-btn" href="${mapsUrl}" target="_blank" style="background:rgba(41,121,255,.08);border-color:rgba(41,121,255,.15);color:#2979ff;text-decoration:none;text-align:center">🗺️ Map</a>
    </div>
  `;

  div.querySelector('.sms-btn').addEventListener('click', () => showSMSModal(alertData.smsMsg, contacts));
  div.querySelector('.call-btn').addEventListener('click', () => showCallModal(alertData.callScript));
  alertLogEl.insertBefore(div, alertLogEl.firstChild);
  if (FIREBASE_ENABLED && currentUser) syncFirebaseUserData();
}

/* ════ SMS MODAL ════ */
function showSMSModal(msg, recipientList) {
  lastSMSMessage = msg;
  const preview = $('smsPreview');
  const recip   = $('smsRecipients');
  const smsModal= $('smsModal');
  if (preview) preview.textContent = msg;
  if (recip) {
    recip.innerHTML = `<strong>📱 Will be sent to ${recipientList.length} contact(s):</strong><br><br>` +
      recipientList.map(c => {
        const url = `https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(msg)}`;
        return `• ${escHtml(c.name)} (${escHtml(c.phone)}) — <a href="${url}" target="_blank" style="color:#25D366;font-weight:700">📲 WhatsApp</a>`;
      }).join('<br>');
  }
  if (smsModal) smsModal.classList.remove('hidden');
}

function hideSMSModal() {
  const smsModal = $('smsModal');
  if (smsModal) smsModal.classList.add('hidden');
}

function showCallModal(script) {
  lastCallScript = script;
  const preview = $('callScriptPreview');
  const modal   = $('callScriptModal');
  if (preview) preview.textContent = script;
  if (modal) modal.classList.remove('hidden');
}

function hideCallModal() {
  const modal = $('callScriptModal');
  if (modal) modal.classList.add('hidden');
}

/* ════════════════════════════════════════
   PROGRESS RING + BADGE
   ════════════════════════════════════════ */
function setProgress(ratio) {
  const progressCircle = $('progressCircle');
  if (progressCircle) progressCircle.style.strokeDashoffset = CIRCUM * (1 - Math.max(0, Math.min(1, ratio)));
}

function setBadge(state) {
  const sosBadge = $('sosBadge');
  if (!sosBadge) return;
  const map = {
    ready:   { text:'READY',     col:'#00e676' },
    sending: { text:'SENDING…',  col:'#f59e0b' },
    sent:    { text:'ALERT SENT',col:'#00e676' },
    error:   { text:'ERROR',     col:'#ff1744' }
  };
  const s = map[state] || map.ready;
  sosBadge.innerHTML = `<span class="badge-dot" style="background:${s.col}"></span>${s.text}`;
  sosBadge.className = `sos-badge ${state}`;
}

/* ════════════════════════════════════════
   CORE SOS TRIGGER
   ════════════════════════════════════════ */
async function triggerSOS(type = 'SOS', extra = {}) {
  const sosBtn  = $('sosBtn');
  const sosIcon = $('sosIcon');
  const sosHint = $('sosHint');

  setBadge('sending');
  if (sosIcon) sosIcon.textContent = '···';
  if (sosHint) sosHint.textContent = 'Sending…';
  if (sosBtn)  sosBtn.disabled = true;

  let loc, profile, smsMsg, callScript;
  try { loc = await getLocationForAlert(); } catch(_) { loc = currentLocation; }
  try { profile = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_) { profile = {}; }

  const accDetails = type === 'ACCIDENT' ? {
    severity:     extra.severity    || 'HIGH',
    vehicleType:  extra.vehicleType || 'Car',
    injuredCount: extra.injuredCount|| 1,
    description:  extra.desc        || ''
  } : null;

  smsMsg     = buildSMS(type, loc, profile, accDetails);
  callScript = buildCallScript(type, loc, profile, accDetails);

  const alertId = alertCounter++;
  const message = type === 'SOS'
    ? 'URGENT SOS! Immediate medical assistance required.'
    : `ACCIDENT: ${accDetails.severity} severity. ${accDetails.injuredCount} injured. Vehicle: ${accDetails.vehicleType}.`;

  const alertData = { id: alertId, type, loc, message, smsMsg, callScript, accDetails };
  addAlertToLog(alertData);

  const alarmDetails = `📍 ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n💬 SMS ready for ${contacts.length} contacts\n🗺️ Google Maps link included`;
  showAlarm(type, `Alert #${alertId} — ${contacts.length} contact(s) notified`, alarmDetails, type === 'ACCIDENT' ? '108' : '112');

  showSMSModal(smsMsg, contacts);
  setTimeout(() => { hideSMSModal(); showCallModal(callScript); }, 1500);

  toast(`🚨 ${type} Alert #${alertId} sent! ${contacts.length} contact(s) notified.`, 'success', 6000);
  setBadge('sent');
  if (sosIcon) sosIcon.textContent = '✓';
  if (sosHint) sosHint.textContent = 'Sent!';

  const personalContacts = contacts.filter(c => !c.isDefault);
  if (personalContacts.length > 0) {
    setTimeout(() => {
      personalContacts.forEach((c, i) => {
        setTimeout(() => {
          window.open(`https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(smsMsg)}`, '_blank');
        }, i * 1200);
      });
    }, 3000);
  }

  if (sosBtn) sosBtn.disabled = false;
  setTimeout(() => {
    setBadge('ready');
    if (sosIcon) sosIcon.textContent = 'SOS';
    if (sosHint) sosHint.textContent = 'Hold 2s';
    setProgress(0);
  }, 6000);
}

/* ════════════════════════════════════════
   SOS HOLD LOGIC
   ════════════════════════════════════════ */
function initSOSButton() {
  const sosBtn = $('sosBtn');
  if (!sosBtn) return;

  function onHoldStart() {
    if (holdTimer) return;
    holdStart = Date.now();
    const sosHint = $('sosHint');
    if (sosHint) sosHint.textContent = 'Hold…';
    sosBtn.classList.add('pressing');

    function tick() {
      const ratio = Math.min((Date.now() - holdStart) / HOLD_MS, 1);
      setProgress(ratio);
      holdRaf = requestAnimationFrame(tick);
    }
    holdRaf = requestAnimationFrame(tick);

    holdTimer = setTimeout(() => {
      cancelAnimationFrame(holdRaf); holdRaf = null; holdTimer = null;
      setProgress(1); sosBtn.classList.remove('pressing');
      triggerSOS('SOS');
    }, HOLD_MS);
  }

  function onHoldEnd() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdRaf)   { cancelAnimationFrame(holdRaf); holdRaf = null; }
    const sosHint = $('sosHint');
    if (!sosBtn.disabled) {
      setProgress(0);
      if (sosHint) sosHint.textContent = 'Hold 2s';
      sosBtn.classList.remove('pressing');
    }
  }

  sosBtn.addEventListener('mousedown',   onHoldStart);
  sosBtn.addEventListener('mouseup',     onHoldEnd);
  sosBtn.addEventListener('mouseleave',  onHoldEnd);
  sosBtn.addEventListener('touchstart',  e => { e.preventDefault(); onHoldStart(); }, { passive: false });
  sosBtn.addEventListener('touchend',    e => { e.preventDefault(); onHoldEnd(); },   { passive: false });
  sosBtn.addEventListener('touchcancel', onHoldEnd);
}

/* ════════════════════════════════════════
   CRASH DETECTION ENGINE
   ════════════════════════════════════════ */
let crashDetectionActive  = false;
let crashThreshold        = 10;
let crashSensitivityLabel = 'Medium';
let crashTimerRAF         = null;
let crashCountdownSec     = 10;
const CRASH_TIMER_CIRCUM  = 2 * Math.PI * 52;
let accelPrev = { x: 0, y: 0, z: 9.8 };

function initCrashDetection() {
  if (typeof DeviceMotionEvent === 'undefined') {
    toast('⚠ Motion sensor not available on this device/browser', 'error', 5000);
    return false;
  }
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('devicemotion', onDeviceMotion);
          activateCrashDetection();
        } else {
          toast('⚠ Motion permission denied. Allow in iOS Settings.', 'error', 6000);
        }
      })
      .catch(e => toast('Motion permission error: ' + e.message, 'error'));
    return false;
  }
  window.addEventListener('devicemotion', onDeviceMotion);
  return true;
}

function activateCrashDetection() {
  crashDetectionActive = true;
  const dot   = document.querySelector('.crash-indicator-dot');
  const label = $('crashStatusLabel');
  const btn   = $('crashToggleBtn');
  if (dot)   dot.className = 'crash-indicator-dot active';
  if (label) label.textContent = 'MONITORING';
  if (btn)   { btn.textContent = 'Disable Detection'; btn.classList.add('active'); }
  toast('💥 Crash Detection ACTIVE — monitoring motion', 'success', 3000);
}

function deactivateCrashDetection() {
  crashDetectionActive = false;
  window.removeEventListener('devicemotion', onDeviceMotion);
  const dot   = document.querySelector('.crash-indicator-dot');
  const label = $('crashStatusLabel');
  const btn   = $('crashToggleBtn');
  if (dot)   dot.className = 'crash-indicator-dot off';
  if (label) label.textContent = 'INACTIVE';
  if (btn)   { btn.textContent = 'Enable Detection'; btn.classList.remove('active'); }
  resetAxisBars();
}

function resetAxisBars() {
  ['axisX','axisY','axisZ','axisG'].forEach(id => { const el = $(id); if (el) el.style.width = '0%'; });
  ['axisXVal','axisYVal','axisZVal','axisGVal'].forEach(id => { const el = $(id); if (el) el.textContent = '0.0'; });
}

function onDeviceMotion(e) {
  if (!crashDetectionActive) return;
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;

  const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
  const alpha = 0.8;
  const sx = alpha * accelPrev.x + (1 - alpha) * x;
  const sy = alpha * accelPrev.y + (1 - alpha) * y;
  const sz = alpha * accelPrev.z + (1 - alpha) * z;
  const dx = Math.abs(x - accelPrev.x);
  const dy = Math.abs(y - accelPrev.y);
  const dz = Math.abs(z - accelPrev.z);
  accelPrev = { x: sx, y: sy, z: sz };

  const gForce = Math.sqrt(dx*dx + dy*dy + dz*dz) / 9.81;

  const setBar = (id, pct) => { const el = $(id); if (el) el.style.width = Math.min(pct, 100) + '%'; };
  const setVal = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  setBar('axisX', Math.abs(x) * 10); setVal('axisXVal', x.toFixed(1));
  setBar('axisY', Math.abs(y) * 10); setVal('axisYVal', y.toFixed(1));
  setBar('axisZ', Math.abs(z) * 10); setVal('axisZVal', z.toFixed(1));
  setBar('axisG', gForce * 10);      setVal('axisGVal', gForce.toFixed(2));

  if (gForce >= crashThreshold && !$('crashCountdownOverlay')?.classList.contains('hidden') === false) {
    startCrashCountdown(gForce);
  }
}

function startCrashCountdown(gForce) {
  if (!$('crashCountdownOverlay')) return;
  const circle = $('crashTimerCircle');
  const sensitLabel = $('crashSensitivityLabel');
  if (sensitLabel) sensitLabel.textContent = crashSensitivityLabel;
  if (circle) { circle.style.strokeDasharray = CRASH_TIMER_CIRCUM; circle.style.strokeDashoffset = 0; }
  $('crashCountdownOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  playAlarm();

  const startTime = Date.now();
  const totalMs   = 10000;

  function tick() {
    const elapsed   = Date.now() - startTime;
    const remaining = Math.ceil((totalMs - elapsed) / 1000);
    const progress  = elapsed / totalMs;
    if (remaining !== crashCountdownSec) {
      crashCountdownSec = remaining;
      const numEl = $('crashTimerNum'), cdEl = $('crashTimerCountdown');
      if (numEl) numEl.textContent = Math.max(0, remaining);
      if (cdEl)  cdEl.textContent  = Math.max(0, remaining);
    }
    if (circle) circle.style.strokeDashoffset = CRASH_TIMER_CIRCUM * progress;
    if (elapsed >= totalMs) {
      closeCrashCountdown();
      triggerSOS('ACCIDENT', { severity: 'HIGH', injuredCount: 1, vehicleType: 'Unknown', desc: `Auto-detected crash. G-force: ${gForce.toFixed(2)}g` });
      addCrashLog(gForce, 'sent');
      return;
    }
    crashTimerRAF = requestAnimationFrame(tick);
  }
  crashTimerRAF = requestAnimationFrame(tick);
}

function closeCrashCountdown() {
  if (crashTimerRAF) { cancelAnimationFrame(crashTimerRAF); crashTimerRAF = null; }
  const overlay = $('crashCountdownOverlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
  stopAlarm();
  const dot = document.querySelector('.crash-indicator-dot');
  if (dot && crashDetectionActive) dot.className = 'crash-indicator-dot active';
  const label = $('crashStatusLabel');
  if (label) label.textContent = crashDetectionActive ? 'MONITORING' : 'INACTIVE';
}

function addCrashLog(gForce, status) {
  crashLog.unshift({ time: new Date().toLocaleString('en-IN'), gForce: gForce.toFixed(2), status });
  renderCrashLog();
  if (FIREBASE_ENABLED && currentUser) syncFirebaseUserData();
}

function renderCrashLog() {
  const el = $('crashLogList');
  if (!el) return;
  if (!crashLog.length) { el.innerHTML = '<div class="crash-log-empty">No crashes detected yet</div>'; return; }
  el.innerHTML = crashLog.slice(0, 10).map(e => `
    <div class="crash-log-item">
      <div>
        <div style="font-size:.82rem;font-weight:700;color:var(--text)">💥 Impact: ${e.gForce}g</div>
        <div style="font-size:.7rem;color:var(--text3);margin-top:.15rem;font-family:var(--mono)">${e.time}</div>
      </div>
      <span style="font-size:.65rem;font-weight:700;padding:3px 8px;border-radius:4px;background:${e.status === 'sent' ? 'rgba(255,23,68,.1)' : 'rgba(0,230,118,.1)'};color:${e.status === 'sent' ? 'var(--red)' : 'var(--green)'}">
        ${e.status === 'sent' ? '🚨 SOS SENT' : '✓ Cancelled'}
      </span>
    </div>
  `).join('');
}

/* ════════════════════════════════════════
   APP INITIALIZATION
   ════════════════════════════════════════ */
function initApp() {
  contacts = loadContacts();

  // SOS Button
  setProgress(0);
  initSOSButton();

  // ID Card
  updateIDCard();
  updateNavUser();

  // Contacts
  renderContacts();

  // Emergency Numbers
  renderEmergencyNumbers();

  // Crash Log
  renderCrashLog();

  // Accident form
  const accBtn    = $('accBtn');
  const accForm   = $('accidentForm');
  const sendAccBtn= $('sendAccBtn');
  const cancelAccBtn=$('cancelAccBtn');

  if (accBtn && accForm) {
    accBtn.addEventListener('click', () => {
      accForm.classList.toggle('active');
      accForm.style.display = accForm.classList.contains('active') ? 'block' : 'none';
    });
  }
  if (cancelAccBtn && accForm) {
    cancelAccBtn.addEventListener('click', () => {
      accForm.classList.remove('active');
      accForm.style.display = 'none';
    });
  }
  if (sendAccBtn) {
    sendAccBtn.addEventListener('click', async () => {
      sendAccBtn.disabled = true;
      sendAccBtn.innerHTML = '<span class="spinner"></span> Sending…';
      try {
        await triggerSOS('ACCIDENT', {
          severity:     $('accSeverity')?.value || 'HIGH',
          injuredCount: parseInt($('accInjured')?.value) || 1,
          vehicleType:  $('accVehicle')?.value  || 'Car',
          desc:         $('accDesc')?.value     || ''
        });
        if (accForm) { accForm.classList.remove('active'); accForm.style.display = 'none'; }
        if ($('accDesc')) $('accDesc').value = '';
      } catch(e) {
        toast('⚠ Accident alert error: ' + e.message, 'error');
      }
      sendAccBtn.disabled = false;
      sendAccBtn.innerHTML = '🚨 SEND ACCIDENT ALERT';
    });
  }

  // Location buttons
  const getLocBtn = $('getLocationBtn');
  const centerBtn = $('centerMapBtn');
  const refreshBtn= $('refreshMapBtn');
  const findHospBtn=$('findHospitalsBtn');
  const autoCallBtn=$('autoCallBtn');
  const closeCrisisEl=$('closeCrisisModal');
  const alarmCloseBtn=$('alarmCloseBtn');

  if (getLocBtn) getLocBtn.addEventListener('click', () => getCurrentLocation());
  if (centerBtn) centerBtn.addEventListener('click', () => {
    if (!leafletMap) { initMap(); toast('Map initialized', 'info'); return; }
    leafletMap.setView([currentLocation.lat, currentLocation.lng], 16);
    leafletMap.invalidateSize();
    toast('📍 Map centered', 'success');
  });
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    if (leafletMap) { leafletMap.invalidateSize(); toast('🔄 Map refreshed', 'success'); }
    else { initMap(); }
  });
  if (findHospBtn) findHospBtn.addEventListener('click', async () => {
    findHospBtn.disabled = true;
    findHospBtn.innerHTML = '<span class="spinner"></span> Searching…';
    try {
      if (!currentLocation.fresh) {
        toast('📍 Getting your location first…', 'info', 2000);
        await getCurrentLocation();
      }
      await fetchNearbyHospitals(currentLocation.lat, currentLocation.lng);
      if (leafletMap && nearbyHospitals.length) addHospitalMarkers(nearbyHospitals);
    } catch(e) { toast('⚠ Could not fetch hospitals', 'error'); }
    findHospBtn.disabled = false;
    findHospBtn.innerHTML = '🏥 Find Hospitals';
  });
  if (autoCallBtn) autoCallBtn.addEventListener('click', autoCallAllEmergency);
  if (closeCrisisEl) closeCrisisEl.addEventListener('click', closeCrisisModal);
  if (alarmCloseBtn) alarmCloseBtn.addEventListener('click', hideAlarm);

  // SMS / Call Modals
  $('closeSmsModal')?.addEventListener('click', hideSMSModal);
  $('closeSmsModalBtn')?.addEventListener('click', hideSMSModal);
  $('closeCallModal')?.addEventListener('click', hideCallModal);
  $('closeCallModalBtn')?.addEventListener('click', hideCallModal);
  $('copySmsBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(lastSMSMessage).then(() => toast('📋 SMS copied!', 'success')).catch(() => toast('Copy failed', 'error'));
  });
  $('copyScriptBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(lastCallScript).then(() => toast('📋 Script copied!', 'success')).catch(() => toast('Copy failed', 'error'));
  });
  $('sendWhatsAppAll')?.addEventListener('click', () => {
    const nc = contacts.filter(c => !c.isDefault);
    if (!nc.length) { toast('Add personal contacts first', 'info', 4000); return; }
    nc.forEach((c, i) => {
      setTimeout(() => window.open(`https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(lastSMSMessage)}`, '_blank'), i * 800);
    });
    toast(`📲 Opening WhatsApp for ${nc.length} contact(s)…`, 'success');
  });
  $('smsModal')?.addEventListener('click', e => { if (e.target === $('smsModal')) hideSMSModal(); });
  $('callScriptModal')?.addEventListener('click', e => { if (e.target === $('callScriptModal')) hideCallModal(); });
  $('crisisModal')?.addEventListener('click', e => { if (e.target === $('crisisModal')) closeCrisisModal(); });

  // Alert log clear
  $('clearAlertsBtn')?.addEventListener('click', () => {
    if (!alertHistory.length) return toast('No alerts to clear', 'info');
    if (!confirm('Clear all alert history?')) return;
    alertHistory = []; alertCounter = 1;
    const alertLogEl = $('alertLog');
    if (alertLogEl) alertLogEl.innerHTML = `<div class="alert-empty"><span>🔕</span><p>No emergency alerts yet</p></div>`;
    toast('Alert history cleared', 'info');
  });

  // Contacts
  $('addContactBtn')?.addEventListener('click', () => {
    const name     = $('cName')?.value.trim();
    let phone      = $('cPhone')?.value.trim();
    const relation = $('cRelation')?.value.trim();
    if (!name)  return toast('Please enter contact name', 'error');
    if (!phone) return toast('Please enter phone number', 'error');

    let cp = phone.replace(/\D/g, '');
    if (cp.length === 10) cp = '+91' + cp;
    else if (cp.length === 12 && cp.startsWith('91')) cp = '+' + cp;
    else if (!phone.startsWith('+')) cp = '+91' + cp;
    else cp = phone;

    contacts.push({ id: Date.now(), name, phone: cp, relation: relation || 'Personal', isDefault: false });
    saveContactsToStorage(contacts);
    renderContacts();
    if ($('cName')) $('cName').value = '';
    if ($('cPhone')) $('cPhone').value = '';
    if ($('cRelation')) $('cRelation').value = '';
    toast(`✅ ${name} added to emergency contacts`, 'success');
  });

  // Profile
  $('saveProfileBtn')?.addEventListener('click', () => {
    const name = $('pName')?.value.trim();
    if (!name) return toast('Please enter your full name', 'error');
    const profile = {
      name,
      phone: $('pPhone')?.value.trim(), age: $('pAge')?.value.trim(),
      gender: $('pGender')?.value, blood: $('pBlood')?.value,
      address: $('pAddress')?.value.trim(),
      aadhar: $('pAadhar')?.value.trim(), occupation: $('pOccupation')?.value.trim(),
      allergies: $('pAllergies')?.value.trim(), medical: $('pMedical')?.value.trim(),
      medication: $('pMedication')?.value.trim(), disability: $('pDisability')?.value.trim(),
      donor: $('pDonor')?.value, height: $('pHeight')?.value.trim(), weight: $('pWeight')?.value.trim(),
      ecName: $('pEcName')?.value.trim(), ecPhone: $('pEcPhone')?.value.trim(),
      doctor: $('pDoctor')?.value.trim(), doctorPhone: $('pDoctorPhone')?.value.trim(),
      insurance: $('pInsurance')?.value.trim(), emergencyNote: $('pEmergencyNote')?.value.trim()
    };
    localStorage.setItem('rn_profile', JSON.stringify(profile));
    updateIDCard();
    toast('✅ Emergency profile saved', 'success');
    if (FIREBASE_ENABLED && currentUser) syncFirebaseUserData();
  });

  $('clearProfileBtn')?.addEventListener('click', () => {
    if (!confirm('Clear all profile data?')) return;
    localStorage.removeItem('rn_profile');
    localStorage.removeItem('rn_profile_photo');
    ['pName','pPhone','pAge','pAddress','pAllergies','pMedical',
     'pAadhar','pOccupation','pMedication','pDisability','pHeight','pWeight',
     'pEcName','pEcPhone','pDoctor','pDoctorPhone','pInsurance','pEmergencyNote']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });
    showProfilePhoto(null);
    updateIDCard();
    toast('Profile cleared', 'info');
  });

  $('exportProfileBtn')?.addEventListener('click', () => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_) {}
    if (!p.name) return toast('Save your profile first', 'error');
    const card = `╔═══════════════════════════════╗
║   ✚ RESCUENET MEDICAL ID      ║
╚═══════════════════════════════╝
👤 Name: ${p.name || '—'}
🩸 Blood: ${p.blood || '—'} | Age: ${p.age || '—'} | ${p.gender || '—'}
📞 Phone: ${p.phone || '—'}
📍 Address: ${p.address || '—'}
⚠️ Allergies: ${p.allergies || 'None'}
🏥 Conditions: ${p.medical || 'None'}
💊 Medications: ${p.medication || 'None'}
🫀 Organ Donor: ${p.donor || 'Not specified'}
📏 Height: ${p.height || '—'}cm | Weight: ${p.weight || '—'}kg
👨‍⚕️ Doctor: ${p.doctor || '—'} (${p.doctorPhone || '—'})
🆘 Emergency Contact: ${p.ecName || '—'} (${p.ecPhone || '—'})
📋 Insurance: ${p.insurance || '—'}
📝 Notes: ${p.emergencyNote || '—'}`.trim();
    navigator.clipboard.writeText(card)
      .then(() => toast('📋 Medical ID copied to clipboard!', 'success', 4000))
      .catch(() => toast('Copy failed — try selecting manually', 'error'));
  });

  $('profilePhotoInput')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      localStorage.setItem('rn_profile_photo', ev.target.result);
      showProfilePhoto(ev.target.result);
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $('tab-' + tab.dataset.tab)?.classList.add('active');
    });
  });

  // Crash detection controls
  $('crashToggleBtn')?.addEventListener('click', () => {
    if (!crashDetectionActive) {
      const started = initCrashDetection();
      if (started) activateCrashDetection();
    } else {
      deactivateCrashDetection();
    }
  });
  $('crashSendNowBtn')?.addEventListener('click', () => {
    if (crashTimerRAF) { cancelAnimationFrame(crashTimerRAF); crashTimerRAF = null; }
    closeCrashCountdown();
    triggerSOS('ACCIDENT', { severity: 'CRITICAL', injuredCount: 1, vehicleType: 'Unknown', desc: 'Auto-detected crash — manual SOS' });
    addCrashLog(0, 'sent');
  });
  $('crashCancelBtn')?.addEventListener('click', () => {
    if (crashTimerRAF) { cancelAnimationFrame(crashTimerRAF); crashTimerRAF = null; }
    closeCrashCountdown();
    addCrashLog(0, 'cancelled');
    toast("✅ You're marked safe. Crash alert cancelled.", 'success', 4000);
  });
  $('clearCrashLog')?.addEventListener('click', () => { crashLog = []; renderCrashLog(); toast('Crash log cleared', 'info'); });

  document.querySelectorAll('.thresh-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.thresh-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      crashThreshold = parseFloat(btn.dataset.thresh);
      crashSensitivityLabel = btn.dataset.label;
      toast(`Crash sensitivity: ${btn.dataset.label} (${crashThreshold}g)`, 'info');
    });
  });

  // Menu
  $('menuBtn')?.addEventListener('click', () => $('mobileMenu')?.classList.toggle('active'));

  // Navigate to home by default
  navigateTo('home');

  toast('🟢 RescueNet India Active — Emergency System Ready', 'success', 4000);

  // Auto get location silently
  setTimeout(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, fresh: true };
        const latEl = $('latValue'), lngEl = $('lngValue');
        if (latEl) latEl.textContent = currentLocation.lat.toFixed(6) + '°';
        if (lngEl) lngEl.textContent = currentLocation.lng.toFixed(6) + '°';
        const locStatusEl = $('locStatusText');
        if (locStatusEl) { locStatusEl.textContent = '✅ Location ready'; locStatusEl.style.color = '#00e676'; }
        const updEl = $('lastUpdated');
        if (updEl) updEl.textContent = new Date().toLocaleTimeString('en-IN');
        const mapsBtn = $('openMapsBtn');
        if (mapsBtn) {
          mapsBtn.href = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
          mapsBtn.style.display = 'block';
        }
        const navBtn = $('openGMapsNavBtn');
        if (navBtn) {
          navBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${currentLocation.lat},${currentLocation.lng}`;
          navBtn.style.display = 'block';
        }
        fetchNearbyHospitals(currentLocation.lat, currentLocation.lng);
      }, () => {}, { enableHighAccuracy: false, timeout: 8000 });
    }
  }, 1200);
}

/* ════════════════════════════════════════
   DOMContentLoaded — START
   ════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Check for existing session
  try {
    const session = JSON.parse(localStorage.getItem('rn_session') || 'null')
                 || JSON.parse(sessionStorage.getItem('rn_session') || 'null');
    if (session && session.email) {
      currentUser = session;
      const authScreen = $('authScreen');
      const appScreen  = $('appScreen');
      if (authScreen) authScreen.classList.add('hidden');
      if (appScreen)  appScreen.classList.remove('hidden');
      updateNavUser();
      initApp();
      if (initFirebase()) {
        loadFirebaseUserData().then(() => {
          updateNavUser();
          renderContacts();
          updateIDCard();
          renderCrashLog();
          if (leafletMap) leafletMap.invalidateSize();
        });
      }
    }
  } catch(_) {}

  // ── PWA Install Prompt ──
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = $('pwaBanner');
    if (banner && !localStorage.getItem('rn_pwa_dismissed')) {
      setTimeout(() => banner.classList.remove('hidden'), 3000);
    }
  });
  $('pwaInstallBtn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('✅ RescueNet installed!', 'success');
    deferredPrompt = null;
    $('pwaBanner')?.classList.add('hidden');
  });
  $('pwaDismissBtn')?.addEventListener('click', () => {
    $('pwaBanner')?.classList.add('hidden');
    try { localStorage.setItem('rn_pwa_dismissed', '1'); } catch(_) {}
  });

  // ── Wake Lock API (keep screen on during emergencies) ──
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch(_) {}
  }
  document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
      await requestWakeLock();
    }
  });
  // Request wake lock when SOS is triggered
  const origTriggerSOS = triggerSOS;
  window._wakeLockRequest = requestWakeLock;

  // ── Swipe gestures for section navigation ──
  const sections = ['home','location','hospitals','crash','profile','contacts','alerts'];
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    // Only horizontal swipes > 60px with small vertical movement
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      const activePage = document.querySelector('.section-page.active');
      if (!activePage) return;
      const currentIdx = sections.indexOf(activePage.id);
      if (currentIdx === -1) return;
      if (dx < 0 && currentIdx < sections.length - 1) navigateTo(sections[currentIdx + 1]);
      if (dx > 0 && currentIdx > 0) navigateTo(sections[currentIdx - 1]);
    }
  }, { passive: true });
});
