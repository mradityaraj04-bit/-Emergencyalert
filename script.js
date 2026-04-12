 'use strict';

/* ════ CONSTANTS ════ */
const HOLD_MS = 2000;
const CIRCUM  = 2 * Math.PI * 72;
const DEFAULT_LAT = 22.5726, DEFAULT_LNG = 88.3639; // Kolkata fallback

/* ════ EMERGENCY NUMBERS — INDIA ════ */
const EMERGENCY_NUMBERS = [
  { num: '112', label: 'Emergency', cls: '' },
  { num: '108', label: 'Ambulance', cls: '' },
  { num: '100', label: 'Police',    cls: 'police' },
  { num: '101', label: 'Fire',      cls: 'fire' },
  { num: '102', label: 'Maternity', cls: '' },
  { num: '1091', label: 'Women',   cls: 'women' },
  { num: '1098', label: 'Child',   cls: 'child' },
  { num: '1070', label: 'NDRF',    cls: '' },
  { num: '104',  label: 'Medical Helpline', cls: '' },
  { num: '14567', label: 'Senior Citizen', cls: '' },
];

/* ════ STATE ════ */
let currentLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG, fresh: false };
let holdStart = null, holdRaf = null, holdTimer = null;
let alarmInterval = null, audioCtx = null;
let leafletMap = null, leafletMarker = null;
let lastSMSMessage = '', lastCallScript = '';
let nearbyHospitals = [];
let autoCallSequenceActive = false;

/* ════ DOM REFS ════ */
const $ = id => document.getElementById(id);
const sosBtn         = $('sosBtn');
const progressCircle = $('progressCircle');
const sosIcon        = $('sosIcon');
const sosHint        = $('sosHint');
const sosBadge       = $('sosBadge');
const accBtn         = $('accBtn');
const accForm        = $('accidentForm');
const sendAccBtn     = $('sendAccBtn');
const cancelAccBtn   = $('cancelAccBtn');
const toastEl        = $('toast');
const alarmOv        = $('alarmOverlay');
const alertLogEl     = $('alertLog');
const smsModal       = $('smsModal');
const callScriptModal= $('callScriptModal');

/* ════ TOAST ════ */
function toast(msg, type='success', ms=4000) {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type} show`;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ════ ALARM ════ */
function playAlarm() {
  try {
    if (audioCtx) { try { audioCtx.close(); } catch(_){} }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function beep(freq, delay, dur) {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
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

function showAlarm(type, msg, details, callNum='112') {
  $('alarmIcon').textContent  = type === 'ACCIDENT' ? '⚠️' : '🆘';
  $('alarmTitle').textContent = type === 'ACCIDENT' ? '🚨 ACCIDENT REPORTED' : '🆘 SOS ACTIVATED';
  $('alarmMsg').textContent   = msg;
  $('alarmDetails').textContent = details;
  $('alarmCallBtn').onclick   = () => { window.location.href = `tel:${callNum}`; hideAlarm(); };

  // Show nearest hospital in alarm
  const nearEl = $('alarmNearest');
  if (nearbyHospitals.length > 0 && nearEl) {
    const h = nearbyHospitals[0];
    nearEl.style.display = 'block';
    nearEl.innerHTML = `<strong>🏥 Nearest Hospital:</strong>${h.name} — ${h.distance}<br><small>${h.address || ''}</small>`;
  } else if (nearEl) {
    nearEl.style.display = 'none';
  }

  alarmOv.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  playAlarm();
  if (navigator.vibrate) navigator.vibrate([300,100,300,100,300,200,500]);
}

function hideAlarm() {
  alarmOv.classList.add('hidden');
  document.body.style.overflow = '';
  stopAlarm();
}

$('alarmCloseBtn').addEventListener('click', hideAlarm);

/* ════ PROGRESS RING ════ */
function setProgress(ratio) {
  if (progressCircle) progressCircle.style.strokeDashoffset = CIRCUM * (1 - Math.max(0, Math.min(1, ratio)));
}

function setBadge(state) {
  const map = {
    ready:   { text:'READY',    col:'#10b981' },
    sending: { text:'SENDING…', col:'#f59e0b' },
    sent:    { text:'ALERT SENT',col:'#10b981' },
    error:   { text:'ERROR',    col:'#ef4444' }
  };
  const s = map[state] || map.ready;
  sosBadge.innerHTML = `<span class="badge-dot" style="background:${s.col}"></span>${s.text}`;
  sosBadge.className = `sos-badge ${state}`;
}

/* ════ LEAFLET MAP ════ */
function initMap() {
  if (leafletMap) return;
  const mapDiv = $('leafletMap');
  if (!mapDiv || typeof L === 'undefined') return;

  leafletMap = L.map('leafletMap', { zoomControl: true }).setView([currentLocation.lat, currentLocation.lng], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20
  }).addTo(leafletMap);

  const redIcon = L.divIcon({
    html: '<div style="width:18px;height:18px;background:#dc2626;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px rgba(220,38,38,.8)"></div>',
    className: '', iconSize: [18, 18], iconAnchor: [9, 9]
  });

  leafletMarker = L.marker([currentLocation.lat, currentLocation.lng], { icon: redIcon })
    .addTo(leafletMap)
    .bindPopup('<b>📍 Your Location</b><br>Emergency services will be directed here.');

  setTimeout(() => leafletMap.invalidateSize(), 400);
}

function updateMapLocation(lat, lng) {
  if (!leafletMap) { initMap(); return; }
  const pos = [lat, lng];
  leafletMap.setView(pos, 16);
  if (leafletMarker) leafletMarker.setLatLng(pos);
  setTimeout(() => leafletMap.invalidateSize(), 100);
}

// Add hospital markers to map
function addHospitalMarkers(hospitals) {
  if (!leafletMap || !hospitals.length) return;
  const hospIcon = L.divIcon({
    html: '<div style="width:20px;height:20px;background:#2563eb;border:3px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;box-shadow:0 0 8px rgba(37,99,235,.8)">H</div>',
    className: '', iconSize: [20, 20], iconAnchor: [10, 10]
  });
  hospitals.forEach(h => {
    if (h.lat && h.lng) {
      L.marker([h.lat, h.lng], { icon: hospIcon })
        .addTo(leafletMap)
        .bindPopup(`<b>🏥 ${h.name}</b><br>${h.distance}<br>${h.address || ''}`);
    }
  });
}

const mapObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { initMap(); mapObserver.disconnect(); } });
}, { threshold: 0.1 });
const mapSection = $('location');
if (mapSection) mapObserver.observe(mapSection);

/* ════ GEOLOCATION ════ */
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      const err = 'Geolocation not supported by this browser';
      toast(err, 'error'); reject(err); return;
    }
    $('locStatusText').textContent = '⏳ Fetching location…';
    $('getLocationBtn').disabled = true;
    $('getLocationBtn').innerHTML = '<span class="spinner"></span> Locating…';

    navigator.geolocation.getCurrentPosition(
      pos => {
        currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, fresh: true };
        $('latValue').textContent  = currentLocation.lat.toFixed(6) + '°';
        $('lngValue').textContent  = currentLocation.lng.toFixed(6) + '°';
        $('accuracyText').textContent  = pos.coords.accuracy ? `±${Math.round(pos.coords.accuracy)}m` : 'High';
        $('locStatusText').textContent = '✅ Location active';
        $('locStatusText').style.color = '#10b981';
        $('lastUpdated').textContent   = new Date().toLocaleTimeString('en-IN');
        $('getLocationBtn').disabled   = false;
        $('getLocationBtn').innerHTML  = '📍 Get My Location';

        const mapsBtn = $('openMapsBtn');
        mapsBtn.href = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
        mapsBtn.style.display = 'block';

        updateMapLocation(currentLocation.lat, currentLocation.lng);
        toast('📍 Location updated successfully', 'success');
        resolve(currentLocation);
      },
      err => {
        $('getLocationBtn').disabled  = false;
        $('getLocationBtn').innerHTML = '📍 Get My Location';
        let msg = 'Location error';
        if (err.code === 1) msg = '⛔ Location permission denied. Please allow in browser settings.';
        if (err.code === 2) msg = '📡 Location unavailable. Check GPS/network.';
        if (err.code === 3) msg = '⏱ Location request timed out. Try again.';
        $('locStatusText').textContent = msg;
        $('locStatusText').style.color = '#ef4444';
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

/* ════ NEARBY HOSPITALS (Overpass API — OpenStreetMap) ════ */
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
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' }
    });
    if (!res.ok) throw new Error('Overpass API error');
    const data = await res.json();

    const hospitals = data.elements
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

    // Mark on map
    if (leafletMap) addHospitalMarkers(nearbyHospitals);

    if (nearbyHospitals.length === 0) toast('No hospitals found nearby. Try increasing radius.', 'info');
    else toast(`🏥 Found ${nearbyHospitals.length} hospitals nearby`, 'success');

  } catch(e) {
    console.error('Hospital fetch error:', e);
    if (grid) grid.innerHTML = `<div class="hospitals-empty"><span>⚠️</span><p>Could not fetch hospitals. Check your connection.</p><p style="font-size:.75rem;margin-top:.5rem">Try again or use Google Maps to find hospitals near you.</p></div>`;
    toast('⚠ Could not fetch nearby hospitals', 'error');
  }
}

function renderHospitals() {
  const grid = $('hospitalsGrid');
  if (!grid) return;
  if (!nearbyHospitals.length) {
    grid.innerHTML = `<div class="hospitals-empty"><span>🏥</span><p>No hospitals found</p><p style="font-size:.8rem;margin-top:.3rem">Click "Find Hospitals" after enabling location</p></div>`;
    return;
  }
  grid.innerHTML = nearbyHospitals.map(h => {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`;
    const callHtml = h.phone
      ? `<a href="tel:${h.phone}" class="hosp-call-btn">📞 Call</a>`
      : `<button class="hosp-call-btn" onclick="toast('No direct number. Call 108 for ambulance.','info')">📞 108 Ambulance</button>`;
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

/* ════ AUTO-CALL ALL EMERGENCY NUMBERS ════ */
function autoCallAllEmergency() {
  if (autoCallSequenceActive) return;
  const btn = $('autoCallBtn');

  const confirmed = confirm(
    '📞 AUTO EMERGENCY CALL\n\n' +
    'This will open phone calls to all Indian emergency numbers one by one:\n' +
    '112 → 108 → 100 → 101\n\n' +
    'Your browser will open each call in sequence.\n\n' +
    'Press OK to proceed.'
  );
  if (!confirmed) return;

  autoCallSequenceActive = true;
  btn.classList.add('calling');
  btn.textContent = '📞 CALLING EMERGENCY SERVICES…';

  const callSequence = ['112', '108', '100', '101'];
  let idx = 0;

  function callNext() {
    if (idx >= callSequence.length) {
      autoCallSequenceActive = false;
      btn.classList.remove('calling');
      btn.innerHTML = '📞 AUTO-CALL ALL EMERGENCY NUMBERS';
      toast('✅ Emergency call sequence completed', 'success', 5000);
      return;
    }
    const num = callSequence[idx];
    toast(`📞 Calling ${num}…`, 'info', 3000);
    window.location.href = `tel:${num}`;
    idx++;
    setTimeout(callNext, 4000);
  }

  callNext();
}

function callSingleNumber(num, label) {
  toast(`📞 Calling ${label} (${num})…`, 'info', 2000);
  window.location.href = `tel:${num}`;
}

/* ════ RENDER EMERGENCY NUMBER GRID ════ */
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

/* ════ CONTACTS (localStorage) ════ */
const DEFAULT_CONTACTS = [
  { id: 1, name: 'Police Control',    phone: '100',  relation: 'Police',   isDefault: true },
  { id: 2, name: 'Ambulance Service', phone: '108',  relation: 'Medical',  isDefault: true },
  { id: 3, name: 'Fire Brigade',      phone: '101',  relation: 'Fire',     isDefault: true },
];

function loadContacts() {
  try {
    const stored = JSON.parse(localStorage.getItem('rn_contacts') || 'null');
    return stored && stored.length ? stored : [...DEFAULT_CONTACTS];
  } catch { return [...DEFAULT_CONTACTS]; }
}

function saveContactsToStorage(list) {
  try { localStorage.setItem('rn_contacts', JSON.stringify(list)); } catch(_){}
}

let contacts = loadContacts();

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
  countSpan.textContent = contacts.length;

  if (!contacts.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3)">No contacts yet<br>Add your first emergency contact</div>';
    return;
  }

  container.innerHTML = contacts.map(c => `
    <div class="contact-item">
      <div class="contact-avatar">${escHtml(c.name.charAt(0).toUpperCase())}</div>
      <div class="contact-info">
        <div class="contact-name">${escHtml(c.name)} ${c.isDefault ? '<span class="contact-default-badge">DEFAULT</span>' : ''}</div>
        <div class="contact-phone">${escHtml(c.phone)}</div>
        <span class="contact-relation">${escHtml(c.relation)}</span>
      </div>
      <div class="contact-actions">
        <a href="tel:${escHtml(c.phone)}" class="contact-call" title="Call">📞</a>
        <a href="https://wa.me/${formatWAPhone(c.phone)}" class="contact-whatsapp" target="_blank" title="WhatsApp">📲</a>
        ${!c.isDefault ? `<button class="contact-delete" data-id="${c.id}" title="Delete">🗑</button>` : ''}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.contact-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      contacts = contacts.filter(c => c.id !== id);
      saveContactsToStorage(contacts);
      renderContacts();
      toast('Contact removed', 'info');
    });
  });
}

$('addContactBtn').addEventListener('click', () => {
  const name     = $('cName').value.trim();
  let phone      = $('cPhone').value.trim();
  const relation = $('cRelation').value.trim();
  if (!name)  return toast('Please enter contact name', 'error');
  if (!phone) return toast('Please enter phone number', 'error');

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) cleanPhone = '+91' + cleanPhone;
  else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = '+' + cleanPhone;
  else if (!phone.startsWith('+')) cleanPhone = '+91' + cleanPhone;
  else cleanPhone = phone;

  contacts.push({ id: Date.now(), name, phone: cleanPhone, relation: relation || 'Personal', isDefault: false });
  saveContactsToStorage(contacts);
  renderContacts();
  $('cName').value = ''; $('cPhone').value = ''; $('cRelation').value = '';
  toast(`✅ ${name} added to emergency contacts`, 'success');
});

/* ════ PROFILE ════ */
function updateIDCard() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_){}
  $('patientName').textContent   = p.name     || 'Your Name';
  $('bloodType').textContent     = p.blood    || '—';
  $('infoBlood').textContent     = p.blood    || '—';
  $('infoAge').textContent       = p.age      || '—';
  $('infoGender').textContent    = p.gender   || '—';
  $('infoPhone').textContent     = p.phone    || '—';
  $('infoAllergies').textContent = p.allergies || 'None listed';
  $('infoConditions').textContent= p.medical  || 'None listed';
  $('infoMedication') && ($('infoMedication').textContent = p.medication || 'None listed');
  $('infoDoctor') && ($('infoDoctor').textContent = [p.doctor, p.doctorPhone].filter(Boolean).join(' · ') || '—');
  $('avatar').textContent        = (p.name || '?').charAt(0).toUpperCase();

  // Profile photo
  const savedPhoto = localStorage.getItem('rn_profile_photo');
  if (savedPhoto) showProfilePhoto(savedPhoto);

  // Tags
  updateIDCardTags(p);

  // Completeness
  const pct = calcProfileCompleteness(p);
  $('completenessPercent') && ($('completenessPercent').textContent = pct + '%');
  $('completenessFill') && ($('completenessFill').style.width = pct + '%');

  // Populate form fields
  if (p.name)         $('pName').value      = p.name;
  if (p.phone)        $('pPhone').value     = p.phone;
  if (p.age)          $('pAge').value       = p.age;
  if (p.gender)       $('pGender').value    = p.gender;
  if (p.blood)        $('pBlood').value     = p.blood;
  if (p.address)      $('pAddress').value   = p.address;
  if (p.aadhar)       $('pAadhar') && ($('pAadhar').value = p.aadhar);
  if (p.occupation)   $('pOccupation') && ($('pOccupation').value = p.occupation);
  if (p.allergies)    $('pAllergies').value = p.allergies;
  if (p.medical)      $('pMedical').value   = p.medical;
  if (p.medication)   $('pMedication') && ($('pMedication').value = p.medication);
  if (p.disability)   $('pDisability') && ($('pDisability').value = p.disability);
  if (p.donor)        $('pDonor') && ($('pDonor').value = p.donor);
  if (p.height)       $('pHeight') && ($('pHeight').value = p.height);
  if (p.weight)       $('pWeight') && ($('pWeight').value = p.weight);
  if (p.ecName)       $('pEcName') && ($('pEcName').value = p.ecName);
  if (p.ecPhone)      $('pEcPhone') && ($('pEcPhone').value = p.ecPhone);
  if (p.doctor)       $('pDoctor') && ($('pDoctor').value = p.doctor);
  if (p.doctorPhone)  $('pDoctorPhone') && ($('pDoctorPhone').value = p.doctorPhone);
  if (p.insurance)    $('pInsurance') && ($('pInsurance').value = p.insurance);
  if (p.emergencyNote) $('pEmergencyNote') && ($('pEmergencyNote').value = p.emergencyNote);
}

$('saveProfileBtn').addEventListener('click', () => {
  const name = $('pName').value.trim();
  if (!name) return toast('Please enter your full name', 'error');
  const profile = {
    name, phone: $('pPhone').value.trim(), age: $('pAge').value.trim(),
    gender: $('pGender').value, blood: $('pBlood').value,
    address: $('pAddress').value.trim(),
    aadhar: $('pAadhar') ? $('pAadhar').value.trim() : '',
    occupation: $('pOccupation') ? $('pOccupation').value.trim() : '',
    allergies: $('pAllergies').value.trim(),
    medical: $('pMedical').value.trim(),
    medication: $('pMedication') ? $('pMedication').value.trim() : '',
    disability: $('pDisability') ? $('pDisability').value.trim() : '',
    donor: $('pDonor') ? $('pDonor').value : '',
    height: $('pHeight') ? $('pHeight').value.trim() : '',
    weight: $('pWeight') ? $('pWeight').value.trim() : '',
    ecName: $('pEcName') ? $('pEcName').value.trim() : '',
    ecPhone: $('pEcPhone') ? $('pEcPhone').value.trim() : '',
    doctor: $('pDoctor') ? $('pDoctor').value.trim() : '',
    doctorPhone: $('pDoctorPhone') ? $('pDoctorPhone').value.trim() : '',
    insurance: $('pInsurance') ? $('pInsurance').value.trim() : '',
    emergencyNote: $('pEmergencyNote') ? $('pEmergencyNote').value.trim() : ''
  };
  localStorage.setItem('rn_profile', JSON.stringify(profile));
  updateIDCard();
  toast('✅ Emergency profile saved', 'success');
});

$('clearProfileBtn').addEventListener('click', () => {
  if (!confirm('Clear all profile data?')) return;
  localStorage.removeItem('rn_profile');
  localStorage.removeItem('rn_profile_photo');
  ['pName','pPhone','pAge','pAddress','pAllergies','pMedical'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  ['pAadhar','pOccupation','pMedication','pDisability','pHeight','pWeight','pEcName','pEcPhone','pDoctor','pDoctorPhone','pInsurance','pEmergencyNote'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  showProfilePhoto(null);
  updateIDCard();
  toast('Profile cleared', 'info');
});

/* ════ SMS & CALL SCRIPT BUILDERS ════ */
function buildSMS(type, loc, profile, accDetails) {
  const mapsUrl = `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  let msg = `🚨 RESCUENET INDIA ${type} ALERT 🚨\n\n`;
  msg += `📍 Live Location:\n${mapsUrl}\n`;
  msg += `📌 Coordinates: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n\n`;
  if (profile && profile.name)       msg += `👤 Name: ${profile.name}\n`;
  if (profile && profile.blood)      msg += `🩸 Blood Group: ${profile.blood}\n`;
  if (profile && profile.phone)      msg += `📞 Contact: ${profile.phone}\n`;
  if (profile && profile.age)        msg += `🎂 Age: ${profile.age} | ${profile.gender || ''}\n`;
  if (profile && profile.allergies)  msg += `⚠️ Allergies: ${profile.allergies}\n`;
  if (profile && profile.medical)    msg += `🏥 Conditions: ${profile.medical}\n`;
  if (profile && profile.medication) msg += `💊 Medications: ${profile.medication}\n`;
  if (profile && profile.disability) msg += `♿ Disability: ${profile.disability}\n`;
  if (profile && profile.ecName)     msg += `🆘 Emergency Contact: ${profile.ecName} (${profile.ecPhone || '—'})\n`;
  if (profile && profile.doctor)     msg += `👨‍⚕️ Doctor: ${profile.doctor} (${profile.doctorPhone || '—'})\n`;
  if (profile && profile.address)    msg += `📍 Address: ${profile.address}\n`;
  if (accDetails) {
    msg += `\n🚗 ACCIDENT DETAILS:\n`;
    msg += `• Severity: ${accDetails.severity}\n`;
    msg += `• Vehicle: ${accDetails.vehicleType}\n`;
    msg += `• Injured: ${accDetails.injuredCount} person(s)\n`;
    if (accDetails.description) msg += `• Info: ${accDetails.description}\n`;
  }
  if (nearbyHospitals.length > 0) {
    msg += `\n🏥 NEAREST HOSPITAL:\n`;
    msg += `• ${nearbyHospitals[0].name} (${nearbyHospitals[0].distance})\n`;
    if (nearbyHospitals[0].address) msg += `• ${nearbyHospitals[0].address}\n`;
  }
  msg += `\n📞 IMMEDIATE HELP:\n`;
  msg += `• 112 (Emergency) | 108 (Ambulance) | 100 (Police)\n`;
  msg += `• 101 (Fire) | 1091 (Women) | 1098 (Child)\n`;
  msg += `\n⚡ Sent via RescueNet India — Emergency Response System`;
  return msg;
}

function buildCallScript(type, loc, profile, accDetails) {
  const mapsUrl = `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  let s = `🚨 EMERGENCY CALL SCRIPT — READ THIS ALOUD 🚨\n\n`;
  s += `"Hello, I am calling to report an emergency ${type === 'ACCIDENT' ? 'road accident' : 'SOS situation'} in India.\n\n`;
  s += `📍 LOCATION DETAILS:\n`;
  s += `• Coordinates: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n`;
  s += `• Google Maps: ${mapsUrl}\n\n`;
  if (profile && profile.address) s += `• Address: ${profile.address}\n`;
  s += `\n👤 PERSONAL INFORMATION:\n`;
  if (profile && profile.name)     s += `• Name: ${profile.name}\n`;
  if (profile && profile.phone)    s += `• Phone: ${profile.phone}\n`;
  if (profile && profile.blood)    s += `• Blood Group: ${profile.blood}\n`;
  if (profile && profile.allergies) s += `• Allergies: ${profile.allergies}\n`;
  if (profile && profile.medical)   s += `• Medical Conditions: ${profile.medical}\n`;
  if (accDetails) {
    s += `\n🚗 ACCIDENT INFORMATION:\n`;
    s += `• Severity: ${accDetails.severity}\n`;
    s += `• Vehicle Type: ${accDetails.vehicleType}\n`;
    s += `• Injured Persons: ${accDetails.injuredCount}\n`;
    if (accDetails.description) s += `• Description: ${accDetails.description}\n`;
  }
  if (nearbyHospitals.length > 0) {
    s += `\n🏥 NEAREST HOSPITAL:\n`;
    s += `• ${nearbyHospitals[0].name} — ${nearbyHospitals[0].distance}\n`;
  }
  s += `\nPlease dispatch emergency services immediately to the above location."\n\n`;
  s += `⚠️ STAY CALM. DO NOT HANG UP. Follow the operator's instructions.`;
  return s;
}

/* ════ ALERT LOG ════ */
let alertHistory = [];
let alertCounter = 1;

function addAlertToLog(alertData) {
  alertHistory.unshift(alertData);
  const empty = alertLogEl.querySelector('.alert-empty');
  if (empty) empty.remove();

  const mapsUrl = `https://maps.google.com/?q=${alertData.loc.lat.toFixed(6)},${alertData.loc.lng.toFixed(6)}`;
  const div = document.createElement('div');
  div.className = 'alert-item';
  div.innerHTML = `
    <div class="alert-icon ${alertData.type === 'ACCIDENT' ? 'accident' : 'sos'}">${alertData.type === 'ACCIDENT' ? '⚠️' : '🆘'}</div>
    <div class="alert-content">
      <div class="alert-type">${alertData.type} ALERT · #${alertData.id}</div>
      <div class="alert-message">${alertData.message}</div>
      <div class="alert-meta">📍 ${alertData.loc.lat.toFixed(4)}°N, ${alertData.loc.lng.toFixed(4)}°E · 🕐 ${new Date().toLocaleTimeString('en-IN')}</div>
      <div class="alert-meta">💬 Ready to send to ${contacts.length} contact(s)</div>
      <div class="alert-actions">
        <button class="alert-action-btn sms-btn">💬 View SMS</button>
        <button class="alert-action-btn call-btn">📞 Call Script</button>
        <a class="alert-action-btn map-btn" href="${mapsUrl}" target="_blank">🗺️ Open Map</a>
      </div>
    </div>
    <div class="alert-badge">SENT</div>
  `;

  div.querySelectorAll('.sms-btn').forEach(btn => {
    btn.addEventListener('click', () => showSMSModal(alertData.smsMsg, contacts));
  });
  div.querySelectorAll('.call-btn').forEach(btn => {
    btn.addEventListener('click', () => showCallModal(alertData.callScript));
  });

  alertLogEl.insertBefore(div, alertLogEl.firstChild);
}

/* ════ SMS MODAL ════ */
function showSMSModal(msg, recipientList) {
  lastSMSMessage = msg;
  $('smsPreview').textContent = msg;
  $('smsRecipients').innerHTML = `<strong>📱 Will be sent to ${recipientList.length} contact(s):</strong><br><br>` +
    recipientList.map(c => {
      const waPhone = formatWAPhone(c.phone);
      const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
      return `• ${escHtml(c.name)} (${escHtml(c.phone)}) — <a href="${waUrl}" target="_blank" style="color:#25D366;font-weight:700">📲 Send WhatsApp</a>`;
    }).join('<br>');
  smsModal.classList.remove('hidden');
}

function hideSMSModal() { smsModal.classList.add('hidden'); }

function showCallModal(script) {
  lastCallScript = script;
  $('callScriptPreview').textContent = script;
  callScriptModal.classList.remove('hidden');
}

function hideCallModal() { callScriptModal.classList.add('hidden'); }

$('closeSmsModal').addEventListener('click', hideSMSModal);
$('closeSmsModalBtn').addEventListener('click', hideSMSModal);
$('closeCallModal').addEventListener('click', hideCallModal);
$('closeCallModalBtn').addEventListener('click', hideCallModal);

$('copySmsBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(lastSMSMessage).then(() => toast('📋 SMS copied!', 'success')).catch(() => toast('Copy failed – use select all', 'error'));
});

$('copyScriptBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(lastCallScript).then(() => toast('📋 Script copied!', 'success')).catch(() => toast('Copy failed', 'error'));
});

$('sendWhatsAppAll').addEventListener('click', () => {
  const nonDefault = contacts.filter(c => !c.isDefault);
  if (nonDefault.length === 0) {
    toast('Add personal contacts with WhatsApp numbers first', 'info', 4000);
    return;
  }
  nonDefault.forEach((c, i) => {
    setTimeout(() => {
      const url = `https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(lastSMSMessage)}`;
      window.open(url, '_blank');
    }, i * 800);
  });
  toast(`📲 Opening WhatsApp for ${nonDefault.length} contact(s)…`, 'success');
});

smsModal.addEventListener('click', e => { if (e.target === smsModal) hideSMSModal(); });
callScriptModal.addEventListener('click', e => { if (e.target === callScriptModal) hideCallModal(); });

/* ════ CORE SOS TRIGGER ════ */
async function triggerSOS(type = 'SOS', extra = {}) {
  setBadge('sending');
  sosIcon.textContent  = '···';
  sosHint.textContent  = 'Sending…';
  sosBtn.disabled      = true;

  let loc, profile, smsMsg, callScript;

  try { loc = await getLocationForAlert(); } catch(_) { loc = currentLocation; }
  try { profile = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_){ profile = {}; }

  const accDetails = type === 'ACCIDENT' ? {
    severity:    extra.severity    || 'HIGH',
    vehicleType: extra.vehicleType || 'Car',
    injuredCount:extra.injuredCount|| 1,
    description: extra.desc        || ''
  } : null;

  smsMsg     = buildSMS(type, loc, profile, accDetails);
  callScript = buildCallScript(type, loc, profile, accDetails);

  const alertId = alertCounter++;
  const message = type === 'SOS'
    ? 'URGENT SOS! Immediate medical assistance required.'
    : `ACCIDENT: ${accDetails.severity} severity. ${accDetails.injuredCount} injured. Vehicle: ${accDetails.vehicleType}.`;

  const alertData = { id: alertId, type, loc, message, smsMsg, callScript, accDetails };
  addAlertToLog(alertData);

  const alarmDetails = `📍 Location: ${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E\n💬 SMS ready for ${contacts.length} contacts\n📞 Open Call Script to read to operator`;
  showAlarm(type, `Alert #${alertId} — ${contacts.length} contact(s) notified`, alarmDetails, type === 'ACCIDENT' ? '108' : '112');

  showSMSModal(smsMsg, contacts);
  setTimeout(() => {
    hideSMSModal();
    showCallModal(callScript);
  }, 1500);

  toast(`🚨 ${type} Alert #${alertId} ready! Sending to ${contacts.length} contact(s) via WhatsApp.`, 'success', 6000);
  setBadge('sent');
  sosIcon.textContent = '✓';
  sosHint.textContent = 'Sent!';

  const personalContacts = contacts.filter(c => !c.isDefault);
  if (personalContacts.length > 0) {
    setTimeout(() => {
      personalContacts.forEach((c, i) => {
        setTimeout(() => {
          const url = `https://wa.me/${formatWAPhone(c.phone)}?text=${encodeURIComponent(smsMsg)}`;
          window.open(url, '_blank');
        }, i * 1200);
      });
    }, 3000);
  }

  sosBtn.disabled = false;
  setTimeout(() => {
    setBadge('ready');
    sosIcon.textContent = 'SOS';
    sosHint.textContent = 'Hold 2s';
    setProgress(0);
  }, 6000);
}

/* ════ SOS HOLD LOGIC ════ */
function onHoldStart() {
  if (holdTimer) return;
  holdStart = Date.now();
  sosHint.textContent = 'Hold…';
  sosBtn.classList.add('holding');

  function tick() {
    const ratio = Math.min((Date.now() - holdStart) / HOLD_MS, 1);
    setProgress(ratio);
    holdRaf = requestAnimationFrame(tick);
  }
  holdRaf = requestAnimationFrame(tick);

  holdTimer = setTimeout(() => {
    cancelAnimationFrame(holdRaf);
    holdRaf = null;
    holdTimer = null;
    setProgress(1);
    sosBtn.classList.remove('holding');
    triggerSOS('SOS');
  }, HOLD_MS);
}

function onHoldEnd() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (holdRaf)   { cancelAnimationFrame(holdRaf); holdRaf = null; }
  if (sosBtn && !sosBtn.disabled) {
    setProgress(0);
    sosHint.textContent = 'Hold 2s';
    sosBtn.classList.remove('holding');
  }
}

sosBtn.addEventListener('mousedown',   onHoldStart);
sosBtn.addEventListener('mouseup',     onHoldEnd);
sosBtn.addEventListener('mouseleave',  onHoldEnd);
sosBtn.addEventListener('touchstart',  e => { e.preventDefault(); onHoldStart(); }, { passive: false });
sosBtn.addEventListener('touchend',    e => { e.preventDefault(); onHoldEnd(); },   { passive: false });
sosBtn.addEventListener('touchcancel', onHoldEnd);

/* ════ ACCIDENT FORM ════ */
accBtn.addEventListener('click', () => {
  accForm.style.display = accForm.style.display === 'flex' ? 'none' : 'flex';
});

cancelAccBtn.addEventListener('click', () => { accForm.style.display = 'none'; });

sendAccBtn.addEventListener('click', async () => {
  sendAccBtn.disabled = true;
  sendAccBtn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    await triggerSOS('ACCIDENT', {
      severity:     $('accSeverity').value || 'HIGH',
      injuredCount: parseInt($('accInjured').value) || 1,
      vehicleType:  $('accVehicle').value  || 'Car',
      desc:         $('accDesc').value     || ''
    });
    accForm.style.display = 'none';
    $('accDesc').value = '';
  } catch(e) {
    toast('⚠ Accident alert error: ' + e.message, 'error');
  }
  sendAccBtn.disabled = false;
  sendAccBtn.innerHTML = '🚨 SEND ACCIDENT ALERT';
});

/* ════ LOCATION BUTTONS ════ */
$('getLocationBtn').addEventListener('click', () => getCurrentLocation());

$('centerMapBtn').addEventListener('click', () => {
  if (!leafletMap) { initMap(); toast('Map initialized', 'info'); return; }
  leafletMap.setView([currentLocation.lat, currentLocation.lng], 16);
  leafletMap.invalidateSize();
  toast('📍 Map centered', 'success');
});

$('refreshMapBtn').addEventListener('click', () => {
  if (leafletMap) { leafletMap.invalidateSize(); toast('🔄 Map refreshed', 'success'); }
  else { initMap(); toast('Map initialized', 'info'); }
});

/* ════ FIND HOSPITALS BUTTON ════ */
$('findHospitalsBtn').addEventListener('click', async () => {
  const btn = $('findHospitalsBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Searching…';
  try {
    if (!currentLocation.fresh) {
      toast('📍 Getting your location first…', 'info', 2000);
      await getCurrentLocation();
    }
    await fetchNearbyHospitals(currentLocation.lat, currentLocation.lng);
    // After hospitals loaded, add markers on map
    if (leafletMap && nearbyHospitals.length) addHospitalMarkers(nearbyHospitals);
  } catch(e) {
    toast('⚠ Could not fetch hospitals', 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '🏥 Find Hospitals';
});

/* ════ AUTO CALL BUTTON ════ */
$('autoCallBtn').addEventListener('click', autoCallAllEmergency);

/* ════ ALERT LOG CLEAR ════ */
$('clearAlertsBtn').addEventListener('click', () => {
  if (!alertHistory.length) return toast('No alerts to clear', 'info');
  if (!confirm('Clear all alert history?')) return;
  alertHistory = [];
  alertCounter = 1;
  alertLogEl.innerHTML = `
    <div class="alert-empty">
      <span>🔕</span>
      <p>No emergency alerts yet</p>
      <p style="font-size:.8rem;margin-top:.3rem">Your alert history will appear here</p>
    </div>`;
  toast('Alert history cleared', 'info');
});

/* ════ NAVIGATION ════ */
document.querySelectorAll('.nav-link, .mobile-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const sec = link.dataset.sec;
    if (sec) document.getElementById(sec)?.scrollIntoView({ behavior: 'smooth' });
    $('mobileMenu')?.classList.remove('active');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`.nav-link[data-sec="${sec}"]`).forEach(l => l.classList.add('active'));
    if (sec === 'location') setTimeout(() => { initMap(); if (leafletMap) leafletMap.invalidateSize(); }, 300);
    if (sec === 'crash') setTimeout(() => { renderCrashLog(); }, 100);
  });
});

$('menuBtn').addEventListener('click', () => $('mobileMenu').classList.toggle('active'));

/* ════ SCROLL SPY ════ */
const sections = ['home', 'location', 'hospitals', 'crash', 'profile', 'contacts', 'alerts'];
const sectionEls = sections.map(id => document.getElementById(id)).filter(Boolean);

window.addEventListener('scroll', () => {
  const mid = window.scrollY + window.innerHeight / 2;
  let active = sections[0];
  sectionEls.forEach((el, i) => {
    if (el.offsetTop <= mid) active = sections[i];
  });
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.sec === active);
  });
}, { passive: true });

/* ════ CRASH DETECTION ENGINE ════ */
let crashDetectionActive   = false;
let crashThreshold         = 10;   // G-force threshold
let crashSensitivityLabel  = 'Medium';
let crashCountdownTimer    = null;
let crashCountdownSec      = 10;
let crashTimerRAF          = null;
let crashLog               = [];
const CRASH_TIMER_CIRCUM   = 2 * Math.PI * 52;

// Smoothed accelerometer state
let accelPrev = { x: 0, y: 0, z: 9.8 };

function initCrashDetection() {
  if (typeof DeviceMotionEvent === 'undefined') {
    toast('⚠ Motion sensor not available on this device/browser', 'error', 5000);
    return false;
  }

  // iOS 13+ requires permission
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
      .catch(e => { toast('Motion permission error: ' + e.message, 'error'); });
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
  if (dot)   { dot.className = 'crash-indicator-dot on'; }
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
  if (dot)   { dot.className = 'crash-indicator-dot off'; }
  if (label) label.textContent = 'INACTIVE';
  if (btn)   { btn.textContent = 'Enable Detection'; btn.classList.remove('active'); }
  resetAxisBars();
  toast('💥 Crash Detection disabled', 'info');
}

function resetAxisBars() {
  ['axisX','axisY','axisZ','axisG'].forEach(id => { const el = $(id); if (el) el.style.width = '0%'; });
  ['axisXVal','axisYVal','axisZVal','axisGVal'].forEach(id => { const el = $(id); if (el) el.textContent = '0.0'; });
}

function onDeviceMotion(e) {
  if (!crashDetectionActive) return;
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc) return;

  const x = acc.x || 0, y = acc.y || 0, z = acc.z || 0;
  const gForce = Math.sqrt(x*x + y*y + z*z) / 9.81;

  // Update live bars
  const maxG = 20;
  updateAxisBar('axisX', 'axisXVal', Math.abs(x), 20);
  updateAxisBar('axisY', 'axisYVal', Math.abs(y), 20);
  updateAxisBar('axisZ', 'axisZVal', Math.abs(z), 20);
  updateAxisBar('axisG', 'axisGVal', gForce,       maxG, true);

  // Crash detection: compare delta from baseline
  const dx = Math.abs(x - accelPrev.x);
  const dy = Math.abs(y - accelPrev.y);
  const dz = Math.abs(z - accelPrev.z);
  const delta = Math.sqrt(dx*dx + dy*dy + dz*dz) / 9.81;

  accelPrev = { x, y, z };

  if (delta > crashThreshold && !crashCountdownTimer) {
    triggerCrashAlert(gForce, delta);
  }
}

function updateAxisBar(barId, valId, val, max, isG = false) {
  const el = $(barId); const ve = $(valId);
  if (!el || !ve) return;
  const pct = Math.min((val / max) * 100, 100);
  el.style.width = pct + '%';
  ve.textContent = isG ? val.toFixed(2) : val.toFixed(1);
  // Color code
  if (isG) {
    if (pct > 70) el.style.background = '#ef4444';
    else if (pct > 40) el.style.background = '#f59e0b';
    else el.style.background = '#10b981';
  }
}

function triggerCrashAlert(gForce, delta) {
  if (navigator.vibrate) navigator.vibrate([500,200,500,200,500]);
  // Visual indicator
  const dot = document.querySelector('.crash-indicator-dot');
  if (dot) dot.className = 'crash-indicator-dot detecting';
  $('crashStatusLabel').textContent = 'CRASH DETECTED!';

  // Show countdown modal
  crashCountdownSec = 10;
  $('crashTimerNum').textContent = crashCountdownSec;
  $('crashTimerCountdown').textContent = crashCountdownSec;
  $('crashSensitivityLabel').textContent = crashSensitivityLabel;
  const circle = $('crashTimerCircle');
  if (circle) { circle.style.strokeDasharray = CRASH_TIMER_CIRCUM; circle.style.strokeDashoffset = 0; }
  $('crashCountdownOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  playAlarm();

  const startTime = Date.now();
  const totalMs   = 10000;

  function tick() {
    const elapsed = Date.now() - startTime;
    const remaining = Math.ceil((totalMs - elapsed) / 1000);
    const progress  = elapsed / totalMs;

    if (remaining !== crashCountdownSec) {
      crashCountdownSec = remaining;
      $('crashTimerNum').textContent = Math.max(0, remaining);
      $('crashTimerCountdown').textContent = Math.max(0, remaining);
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
  $('crashCountdownOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  stopAlarm();
  // Restore indicator
  const dot = document.querySelector('.crash-indicator-dot');
  if (dot && crashDetectionActive) dot.className = 'crash-indicator-dot on';
  $('crashStatusLabel').textContent = crashDetectionActive ? 'MONITORING' : 'INACTIVE';
}

function addCrashLog(gForce, status) {
  const entry = { time: new Date().toLocaleString('en-IN'), gForce: gForce.toFixed(2), status };
  crashLog.unshift(entry);
  renderCrashLog();
}

function renderCrashLog() {
  const el = $('crashLogList');
  if (!el) return;
  if (!crashLog.length) { el.innerHTML = '<div class="crash-log-empty">No crashes detected yet</div>'; return; }
  el.innerHTML = crashLog.slice(0, 10).map(e => `
    <div class="crash-log-item">
      <div class="crash-log-icon">💥</div>
      <div class="crash-log-info">
        <div class="crash-log-title">Impact: ${e.gForce}g detected</div>
        <div class="crash-log-meta">${e.time}</div>
        <span class="crash-log-badge ${e.status}">${e.status === 'sent' ? '🚨 SOS SENT' : '✓ Cancelled (Safe)'}</span>
      </div>
    </div>
  `).join('');
}

// Crash Detection Controls
$('crashToggleBtn').addEventListener('click', () => {
  if (!crashDetectionActive) {
    const started = initCrashDetection();
    if (started) activateCrashDetection();
  } else {
    deactivateCrashDetection();
  }
});

$('crashSendNowBtn').addEventListener('click', () => {
  if (crashTimerRAF) { cancelAnimationFrame(crashTimerRAF); crashTimerRAF = null; }
  closeCrashCountdown();
  triggerSOS('ACCIDENT', { severity: 'CRITICAL', injuredCount: 1, vehicleType: 'Unknown', desc: 'Auto-detected crash — manual SOS activation' });
  addCrashLog(0, 'sent');
});

$('crashCancelBtn').addEventListener('click', () => {
  if (crashTimerRAF) { cancelAnimationFrame(crashTimerRAF); crashTimerRAF = null; }
  closeCrashCountdown();
  addCrashLog(0, 'cancelled');
  toast('✅ You\'re marked safe. Crash alert cancelled.', 'success', 4000);
});

$('clearCrashLog').addEventListener('click', () => { crashLog = []; renderCrashLog(); toast('Crash log cleared', 'info'); });

document.querySelectorAll('.thresh-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.thresh-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    crashThreshold       = parseFloat(btn.dataset.thresh);
    crashSensitivityLabel = btn.dataset.label;
    toast(`Crash sensitivity set to ${btn.dataset.label} (${crashThreshold}g)`, 'info');
  });
});

/* ════ ENHANCED PROFILE ════ */
// Profile Photo Upload
$('profilePhotoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    localStorage.setItem('rn_profile_photo', dataUrl);
    showProfilePhoto(dataUrl);
  };
  reader.readAsDataURL(file);
});

function showProfilePhoto(dataUrl) {
  const photoEl = $('avatarPhoto');
  const avatarEl = $('avatar');
  if (dataUrl) {
    photoEl.src = dataUrl;
    photoEl.classList.remove('hidden');
    avatarEl.style.display = 'none';
  } else {
    photoEl.classList.add('hidden');
    avatarEl.style.display = 'flex';
  }
}

// Profile Tabs
document.querySelectorAll('.profile-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// Export Profile as Text Card
$('exportProfileBtn')?.addEventListener('click', () => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch(_){}
  if (!p.name) return toast('Save your profile first', 'error');
  const card = `
╔══════════════════════════════╗
║   ✚ RESCUENET MEDICAL ID     ║
╚══════════════════════════════╝
👤 Name: ${p.name || '—'}
🩸 Blood: ${p.blood || '—'} | Age: ${p.age || '—'} | ${p.gender || '—'}
📞 Phone: ${p.phone || '—'}
📍 Address: ${p.address || '—'}
⚠️ Allergies: ${p.allergies || 'None'}
🏥 Conditions: ${p.medical || 'None'}
💊 Medications: ${p.medication || 'None'}
♿ Disability: ${p.disability || 'None'}
🫀 Organ Donor: ${p.donor || 'Not specified'}
📏 Height: ${p.height || '—'}cm | Weight: ${p.weight || '—'}kg
👨‍⚕️ Doctor: ${p.doctor || '—'} (${p.doctorPhone || '—'})
🆘 Emergency Contact: ${p.ecName || '—'} (${p.ecPhone || '—'})
📋 Insurance: ${p.insurance || '—'}
📝 Notes: ${p.emergencyNote || '—'}
`.trim();
  navigator.clipboard.writeText(card)
    .then(() => toast('📋 Medical ID copied to clipboard!', 'success', 4000))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = card; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      toast('📋 Medical ID copied!', 'success');
    });
});

// Profile Completeness
function calcProfileCompleteness(p) {
  const fields = ['name','phone','age','gender','blood','address','allergies','medical','medication','ecName','ecPhone','doctor'];
  const filled = fields.filter(f => p[f] && String(p[f]).trim()).length;
  return Math.round((filled / fields.length) * 100);
}

function updateIDCardTags(p) {
  const el = $('idCardTags');
  if (!el) return;
  const tags = [];
  if (p.allergies) tags.push(`<span class="id-card-tag allergy">⚠️ ${p.allergies.split(',')[0].trim()}</span>`);
  if (p.medical)   tags.push(`<span class="id-card-tag condition">🏥 ${p.medical.split(',')[0].trim()}</span>`);
  if (p.donor === 'Yes') tags.push(`<span class="id-card-tag donor">🫀 Organ Donor</span>`);
  el.innerHTML = tags.join('');
}

/* ════ INIT ════ */
setProgress(0);
updateIDCard();
renderContacts();
renderEmergencyNumbers();
renderCrashLog();
toast('🟢 RescueNet India Active — Emergency System Ready', 'success', 4000);

// Auto-get location silently on load
setTimeout(() => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, fresh: true };
      $('latValue').textContent = currentLocation.lat.toFixed(6) + '°';
      $('lngValue').textContent = currentLocation.lng.toFixed(6) + '°';
      $('locStatusText').textContent = '✅ Location ready';
      $('locStatusText').style.color = '#10b981';
      $('lastUpdated').textContent = new Date().toLocaleTimeString('en-IN');
      const mapsBtn = $('openMapsBtn');
      mapsBtn.href = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
      mapsBtn.style.display = 'block';

      // Auto-load hospitals once location is available
      fetchNearbyHospitals(currentLocation.lat, currentLocation.lng);
    }, () => {}, { enableHighAccuracy: false, timeout: 8000 });
  }
}, 1000);
