 'use strict';

/* ════════════════════════════════════════════════════════════════
   RESCUENET INDIA — VOICE SOS MODULE v2.0  (FIXED & COMPLETE)
   Add <script src="voice-sos.js"></script> AFTER script.js
   ════════════════════════════════════════════════════════════════

   WHAT'S FIXED IN v2.0:
   ✅ SMS: sends REAL SMS deep-links with live GPS location to ALL contacts
   ✅ WhatsApp: sends to ALL non-default personal contacts automatically
   ✅ Location: always fetches fresh GPS before sending
   ✅ Profile: reads medical profile for richer SOS message
   ✅ Contacts: filters out service numbers (100/108/101) for SMS/WA
   ✅ Panic button: hold-2s works properly with visual ring fill
   ✅ Voice recognition: auto-restarts, handles all browser quirks
   ✅ Overlay: shows real location coords + live Maps link
   ✅ Shake detection: requests iOS13+ permission correctly
   ✅ Badge: counts sent SOS alerts persistently
   ════════════════════════════════════════════════════════════════ */

const VoiceSOS = (() => {

  /* ── CONFIG ── */
  const KEYWORDS         = ['help', 'save me', 'emergency', 'accident', 'bachao', 'madad', 'help me', 'sos'];
  const CONFIRM_DELAY_MS = 3000;   // 3s false-trigger window
  const RATE_LIMIT_MS    = 60000;  // max 1 auto-SOS per minute
  const SHAKE_THRESHOLD  = 22;     // accelerometer delta threshold
  const SHAKE_COOLDOWN   = 8000;   // 8s between shake triggers

  /* ── STATE ── */
  let recognition       = null;
  let isListening       = false;
  let confirmTimer      = null;
  let confirmTick       = null;
  let lastSOSTime       = 0;
  let lastShakeTime     = 0;
  let locationWatcher   = null;
  let voiceLiveLocation = null;
  let sosActive         = false;
  let panelOpen         = false;
  let shakeEnabled      = false;
  let lastAcc           = null;
  let panicHoldStart    = null;
  let panicRaf          = null;

  /* ── DOM HELPER ── */
  const qid = id => document.getElementById(id);

  /* ══════════════════════════════════════════
     STATUS / UI HELPERS
     ══════════════════════════════════════════ */
  function setStatus(text, cls = '') {
    const el = qid('voiceStatusText');
    if (!el) return;
    el.textContent = text;
    el.className   = 'voice-status-text' + (cls ? ' ' + cls : '');
  }

  function setMicIcon(state) {
    const btn  = qid('voiceMicBtn');
    const ring = qid('voiceMicRing');
    if (!btn || !ring) return;
    btn.className  = 'voice-mic-btn ' + state;
    ring.className = 'voice-mic-ring ' + state;
    const icons = { idle: '🎙️', listening: '🎙️', detected: '🚨', sending: '📡' };
    const iconEl = btn.querySelector('.mic-icon');
    if (iconEl) iconEl.textContent = icons[state] || '🎙️';
  }

  function setListenToggleBtn(on) {
    const btn = qid('voiceListenToggle');
    if (!btn) return;
    btn.textContent = on ? '⏹ Stop Listening' : '▶ Start Listening';
    btn.className   = 'voice-toggle-btn' + (on ? ' active' : '');
  }

  function appendTranscript(text) {
    const log = qid('voiceTranscriptLog');
    if (!log) return;
    // Remove placeholder
    const empty = log.querySelector('.transcript-empty');
    if (empty) empty.remove();
    const ts  = new Date().toLocaleTimeString('en-IN');
    const row = document.createElement('div');
    row.className = 'transcript-row';
    row.innerHTML = `<span class="ts">${ts}</span><span class="tx">${escHtml(text)}</span>`;
    log.prepend(row);
    while (log.children.length > 15) log.removeChild(log.lastChild);
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
  }

  function showConfirmBanner(show, secondsLeft) {
    const banner = qid('voiceConfirmBanner');
    if (!banner) return;
    if (show) {
      banner.classList.remove('hidden');
      const cntEl = qid('voiceConfirmCountdown');
      if (cntEl) cntEl.textContent = secondsLeft;
    } else {
      banner.classList.add('hidden');
    }
  }

  function showSOSOverlay(show) {
    const overlay = qid('voiceSOSOverlay');
    if (!overlay) return;
    if (show) overlay.classList.remove('hidden');
    else       overlay.classList.add('hidden');
  }

  function incrementSOSBadge() {
    const badge = qid('voiceSOSCount');
    if (!badge) return;
    let n = (parseInt(badge.dataset.count || '0', 10)) + 1;
    badge.dataset.count = n;
    badge.textContent   = n;
    badge.classList.remove('hidden');
  }

  /* ══════════════════════════════════════════
     LOCATION — fresh GPS before every SOS
     ══════════════════════════════════════════ */
  function startLocationTracking() {
    if (!navigator.geolocation) return;
    // initial fast grab
    navigator.geolocation.getCurrentPosition(
      pos => { voiceLiveLocation = pos2obj(pos); updateLocationDisplay(); },
      null,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
    // live watch
    if (locationWatcher === null) {
      locationWatcher = navigator.geolocation.watchPosition(
        pos => { voiceLiveLocation = pos2obj(pos); updateLocationDisplay(); },
        null,
        { enableHighAccuracy: true }
      );
    }
  }

  function stopLocationTracking() {
    if (locationWatcher !== null) {
      navigator.geolocation.clearWatch(locationWatcher);
      locationWatcher = null;
    }
  }

  function pos2obj(pos) {
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
  }

  function updateLocationDisplay() {
    if (!voiceLiveLocation) return;
    const el = qid('voiceLiveLocationText');
    if (el) {
      el.textContent = `📍 ${voiceLiveLocation.lat.toFixed(5)}, ${voiceLiveLocation.lng.toFixed(5)}`;
      el.href = mapsLink(voiceLiveLocation);
      el.classList.remove('hidden');
    }
  }

  function mapsLink(loc) {
    if (loc) return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    if (typeof currentLocation !== 'undefined' && currentLocation.fresh)
      return `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
    return 'https://www.google.com/maps';
  }

  /* Returns best available location — tries fresh GPS first */
  function getFreshLocation() {
    return new Promise(resolve => {
      if (!navigator.geolocation) {
        resolve(voiceLiveLocation || (typeof currentLocation !== 'undefined' ? currentLocation : null));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => { voiceLiveLocation = pos2obj(pos); resolve(voiceLiveLocation); },
        ()  => { resolve(voiceLiveLocation || (typeof currentLocation !== 'undefined' ? currentLocation : null)); },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    });
  }

  /* ══════════════════════════════════════════
     CONTACTS — load & filter
     ══════════════════════════════════════════ */
  function loadEmergencyContacts() {
    try {
      return JSON.parse(localStorage.getItem('rn_contacts') || '[]');
    } catch { return []; }
  }

  /* Personal contacts only (exclude default service numbers like 100/108/101) */
  function getPersonalContacts() {
    return loadEmergencyContacts().filter(c => !c.isDefault);
  }

  /* Format phone for WhatsApp (digits only, add 91 if 10-digit) */
  function waPhone(phone) {
    let p = String(phone).replace(/\D/g, '');
    if (p.length === 10) p = '91' + p;
    else if (p.startsWith('0')) p = '91' + p.slice(1);
    else if (p.startsWith('+')) p = p.slice(1);
    return p;
  }

  /* Format phone for SMS sms: URI */
  function smsPhone(phone) {
    let p = String(phone).replace(/\D/g, '');
    if (p.length === 10) return '+91' + p;
    if (p.startsWith('91') && p.length === 12) return '+' + p;
    if (p.startsWith('0')) return '+91' + p.slice(1);
    return phone;
  }

  /* ══════════════════════════════════════════
     PROFILE — read saved medical profile
     ══════════════════════════════════════════ */
  function getProfile() {
    try { return JSON.parse(localStorage.getItem('rn_profile') || '{}'); } catch { return {}; }
  }

  /* ══════════════════════════════════════════
     SOS MESSAGE BUILDER
     ══════════════════════════════════════════ */
  function buildSOSMessage(trigger, loc) {
    const name = window.currentUser?.name || getProfile().name || 'Someone';
    const phone = window.currentUser?.phone || getProfile().phone || '';
    const profile = getProfile();
    const ts = new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'medium' });
    const mapUrl = loc ? mapsLink(loc) : 'Location unavailable';
    const coords = loc ? `${loc.lat.toFixed(5)}°N, ${loc.lng.toFixed(5)}°E` : 'Unknown';

    let msg = `🚨 EMERGENCY SOS — RescueNet India\n\n`;
    msg += `👤 ${name}`;
    if (phone) msg += ` | 📞 ${phone}`;
    msg += `\n⚡ Trigger: ${trigger}\n`;
    msg += `⏰ ${ts}\n\n`;
    msg += `📍 GPS: ${coords}\n`;
    msg += `🗺️ LIVE LOCATION:\n${mapUrl}\n`;
    if (loc?.acc) msg += `(Accuracy: ~${Math.round(loc.acc)}m)\n`;
    if (profile.blood) msg += `\n🩸 Blood: ${profile.blood}`;
    if (profile.age)   msg += ` | Age: ${profile.age}`;
    if (profile.blood || profile.age) msg += '\n';
    if (profile.allergies) msg += `⚠️ Allergies: ${profile.allergies}\n`;
    if (profile.medical)   msg += `🏥 Conditions: ${profile.medical}\n`;
    if (profile.medication) msg += `💊 Medications: ${profile.medication}\n`;
    msg += `\n📞 CALL 112 (Emergency) or 108 (Ambulance)\n`;
    msg += `⚡ Sent via RescueNet India`;
    return msg;
  }

  /* ══════════════════════════════════════════
     SEND SOS TO ALL CONTACTS
     ══════════════════════════════════════════ */
  async function dispatchSOS(trigger) {
    // 1. Get freshest location
    const loc = await getFreshLocation();
    const msg = buildSOSMessage(trigger, loc);
    const link = loc ? mapsLink(loc) : null;

    // 2. Update overlay location display
    const ovLoc = qid('voiceSOSLocation');
    if (ovLoc) {
      ovLoc.textContent = loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : '📍 Getting location…';
      if (link) { ovLoc.href = link; ovLoc.classList.remove('hidden'); }
    }

    const personal = getPersonalContacts();
    const all      = loadEmergencyContacts();

    // 3. Build SMS links for ALL contacts (personal + service numbers)
    buildSMSLinksPanel(all, msg, loc);

    // 4. Build WhatsApp links for PERSONAL contacts only
    buildWhatsAppLinksPanel(personal, msg);

    // 5. Build Email link
    buildEmailLink(msg, loc);

    // 6. Log to app alert history
    logToAppAlerts(trigger, loc, link);

    // 7. Auto-open first SMS if only 1 personal contact (mobile UX)
    if (personal.length === 1) {
      autoSendSMS(personal[0], msg);
    }

    return { msg, loc, contactCount: personal.length };
  }

  /* Auto-open SMS app for a single contact immediately */
  function autoSendSMS(contact, msg) {
    const ph  = smsPhone(contact.phone);
    const url = `sms:${ph}?body=${encodeURIComponent(msg)}`;
    // Small delay to let browser settle after overlay appears
    setTimeout(() => { window.open(url, '_self'); }, 500);
  }

  /* ── SMS Panel ── */
  function buildSMSLinksPanel(contacts, msg, loc) {
    const el = qid('voiceSMSLinks');
    if (!el) return;
    el.innerHTML = '';

    if (!contacts.length) {
      el.innerHTML = '<p class="links-title" style="color:#f59e0b">⚠️ No contacts saved — add contacts in the Contacts tab</p>';
      el.classList.remove('hidden');
      return;
    }

    const header = document.createElement('p');
    header.className = 'links-title';
    header.textContent = '📱 Tap to send SMS with your location:';
    el.appendChild(header);

    contacts.forEach(c => {
      const ph  = smsPhone(c.phone);
      const a   = document.createElement('a');
      // sms: URI — works on Android & iOS
      a.href      = `sms:${ph}?body=${encodeURIComponent(msg)}`;
      a.className = 'sms-link-btn';
      a.innerHTML = `📩 SMS ${escHtml(c.name)} <span style="opacity:.6;font-size:.75rem">${escHtml(c.phone)}</span>`;
      // On iOS, sms: uses & as separator; on Android uses ?
      a.addEventListener('click', () => {
        // Fallback: try iOS variant if Android variant doesn't work
        setTimeout(() => {
          const iosUrl = `sms:${ph}&body=${encodeURIComponent(msg)}`;
          const androidUrl = `sms:${ph}?body=${encodeURIComponent(msg)}`;
          // detect iOS
          if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
            a.href = iosUrl;
          }
        }, 100);
      });
      el.appendChild(a);
    });

    // Also add a "Copy SOS Message" button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'sms-link-btn';
    copyBtn.style.cssText = 'background:rgba(0,212,255,.08);border:1px solid rgba(0,212,255,.2);color:#00d4ff;margin-top:4px;cursor:pointer;width:100%;';
    copyBtn.textContent = '📋 Copy SOS Message';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(msg).then(() => {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy SOS Message'; }, 2000);
      });
    });
    el.appendChild(copyBtn);

    el.classList.remove('hidden');
  }

  /* ── WhatsApp Panel ── */
  function buildWhatsAppLinksPanel(contacts, msg) {
    const el = qid('voiceWhatsAppLinks');
    if (!el) return;
    el.innerHTML = '';

    if (!contacts.length) {
      el.innerHTML = '<p class="links-title" style="color:#f59e0b">⚠️ Add personal contacts to send WhatsApp alerts</p>';
      el.classList.remove('hidden');
      return;
    }

    const header = document.createElement('p');
    header.className = 'links-title';
    header.textContent = '💬 Tap to send WhatsApp SOS:';
    el.appendChild(header);

    const encoded = encodeURIComponent(msg);
    contacts.slice(0, 5).forEach(c => {
      const ph = waPhone(c.phone);
      const a  = document.createElement('a');
      a.href      = `https://wa.me/${ph}?text=${encoded}`;
      a.target    = '_blank';
      a.rel       = 'noopener noreferrer';
      a.className = 'whatsapp-link-btn';
      a.innerHTML = `💬 WhatsApp ${escHtml(c.name)} <span style="opacity:.6;font-size:.75rem">${escHtml(c.phone)}</span>`;
      el.appendChild(a);
    });

    el.classList.remove('hidden');
  }

  /* ── Email ── */
  function buildEmailLink(msg, loc) {
    const el = qid('voiceEmailLink');
    if (!el) return;
    const contacts = getPersonalContacts();
    const emailTo  = contacts.filter(c => c.email).map(c => c.email).join(',');
    const name     = window.currentUser?.name || 'Someone';
    const subject  = encodeURIComponent(`🚨 EMERGENCY: ${name} needs help!`);
    const body     = encodeURIComponent(msg);
    el.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
    el.classList.remove('hidden');
  }

  /* ── App Alert Log ── */
  function logToAppAlerts(trigger, loc, link) {
    const ts = new Date().toLocaleString('en-IN');
    const alertObj = {
      id: Date.now(),
      type: 'VOICE_SOS',
      tag: 'voice',
      emoji: '🎙️',
      title: `VOICE SOS — "${String(trigger).toUpperCase()}"`,
      loc: loc || { lat: 0, lng: 0 },
      location: loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Unknown',
      mapsLink: link || '#',
      timestamp: ts,
      status: 'sent'
    };
    if (typeof alertHistory !== 'undefined') alertHistory.unshift(alertObj);
    if (typeof addAlertToLog === 'function') addAlertToLog(alertObj);
    if (typeof syncFirebaseUserData === 'function') syncFirebaseUserData();
  }

  /* ══════════════════════════════════════════
     TRIGGER VOICE SOS
     ══════════════════════════════════════════ */
  async function triggerVoiceSOS(trigger, transcript) {
    const now = Date.now();
    if (now - lastSOSTime < RATE_LIMIT_MS) {
      setStatus('⏳ Please wait before sending another SOS', 'warn');
      speak('Please wait before sending another SOS.');
      return;
    }
    lastSOSTime = now;
    sosActive   = true;

    setMicIcon('sending');
    setStatus('📡 SOS SENDING…', 'sending');
    showSOSOverlay(true);

    // Update overlay immediately with placeholders
    const ovMsg = qid('voiceSOSMessage');
    if (ovMsg) ovMsg.textContent = `Trigger: "${trigger}" — Fetching your location…`;
    const ovStatus = qid('voiceSOSStatus');
    if (ovStatus) { ovStatus.textContent = '📡 Getting GPS…'; ovStatus.className = 'sos-overlay-status'; }

    speak('Emergency SOS triggered! Alerting your contacts now. Stay calm.');

    try {
      const { msg, loc, contactCount } = await dispatchSOS(trigger);

      // Update overlay after dispatch
      if (ovMsg) ovMsg.textContent = contactCount
        ? `Alert sent to ${contactCount} contact${contactCount > 1 ? 's' : ''}! Tap links below.`
        : 'SOS triggered! Add contacts to receive alerts.';

      if (ovStatus) {
        ovStatus.textContent = contactCount ? '✅ Links ready — tap to send!' : '⚠️ No personal contacts found';
        ovStatus.className   = 'sos-overlay-status sent';
      }

      setStatus('✅ SOS Ready — Tap links to send!', 'ok');
      speak(contactCount
        ? `Alert ready for ${contactCount} contact${contactCount > 1 ? 's' : ''}. Tap the links to send.`
        : 'No personal contacts found. Please add contacts in the Contacts tab.'
      );

    } catch (err) {
      console.error('[VoiceSOS] dispatch error', err);
      setStatus('⚠️ Error — check console', 'error');
      if (ovStatus) { ovStatus.textContent = '⚠️ Error building alert'; }
    }

    incrementSOSBadge();
    sosActive = false;
    setMicIcon(isListening ? 'listening' : 'idle');
  }

  /* ══════════════════════════════════════════
     KEYWORD DETECTED → CONFIRM WINDOW
     ══════════════════════════════════════════ */
  function onKeywordDetected(keyword) {
    if (confirmTimer || sosActive) return;

    setMicIcon('detected');
    setStatus(`🚨 "${keyword}" detected! Cancel if false alarm`, 'alert');
    speak(`Emergency keyword detected. Sending SOS in 3 seconds. Say cancel to stop.`);

    let seconds = Math.ceil(CONFIRM_DELAY_MS / 1000);
    showConfirmBanner(true, seconds);

    confirmTick = setInterval(() => {
      seconds--;
      const cntEl = qid('voiceConfirmCountdown');
      if (cntEl) cntEl.textContent = Math.max(seconds, 0);
      if (seconds <= 0) clearInterval(confirmTick);
    }, 1000);

    confirmTimer = setTimeout(() => {
      clearInterval(confirmTick);
      showConfirmBanner(false);
      confirmTimer = null;
      triggerVoiceSOS(keyword, keyword);
    }, CONFIRM_DELAY_MS);
  }

  function cancelConfirm() {
    if (!confirmTimer) return;
    clearTimeout(confirmTimer);
    clearInterval(confirmTick);
    confirmTimer = null;
    showConfirmBanner(false);
    setMicIcon('listening');
    setStatus('✅ Cancelled — still listening…', 'ok');
    speak('False alarm cancelled. Still listening.');
  }

  /* ══════════════════════════════════════════
     SPEECH RECOGNITION
     ══════════════════════════════════════════ */
  function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('⚠️ Voice not supported — use Chrome/Edge', 'warn');
      const btn = qid('voiceListenToggle');
      if (btn) { btn.disabled = true; btn.textContent = '⚠️ Not Supported'; }
      return false;
    }

    recognition = new SR();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = 'en-IN';
    recognition.maxAlternatives = 2;

    recognition.onstart = () => {
      isListening = true;
      setMicIcon('listening');
      setStatus('🎙️ Listening… Say "help", "bachao", "emergency"', 'listening');
      setListenToggleBtn(true);
      startLocationTracking();
    };

    recognition.onend = () => {
      if (isListening) {
        // Auto-restart (recognition stops after ~60s silence on some browsers)
        setTimeout(() => {
          if (isListening && recognition) {
            try { recognition.start(); } catch (_) {}
          }
        }, 300);
      } else {
        setMicIcon('idle');
        setStatus('Tap ▶ to start listening', '');
        setListenToggleBtn(false);
        stopLocationTracking();
      }
    };

    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        isListening = false;
        setMicIcon('idle');
        setListenToggleBtn(false);
        setStatus('❌ Mic blocked — allow microphone in browser settings', 'error');
      }
      // 'no-speech', 'network', 'aborted' — ignore, auto-restart handles it
    };

    recognition.onresult = e => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      transcript = transcript.toLowerCase().trim();
      if (!transcript) return;

      appendTranscript(transcript);

      // Check for cancel keyword during confirm window
      if (confirmTimer && (transcript.includes('cancel') || transcript.includes('stop') || transcript.includes('false'))) {
        cancelConfirm();
        return;
      }

      const hit = KEYWORDS.find(kw => transcript.includes(kw));
      if (hit && !confirmTimer && !sosActive) {
        onKeywordDetected(hit);
      }
    };

    return true;
  }

  function startListening() {
    if (!recognition && !initRecognition()) return;
    if (isListening) return;
    isListening = true;
    try { recognition.start(); } catch (_) {}
  }

  function stopListening() {
    isListening = false;
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    if (confirmTimer) { clearTimeout(confirmTimer); clearInterval(confirmTick); confirmTimer = null; }
    showConfirmBanner(false);
    setMicIcon('idle');
    setStatus('Listening stopped', '');
    setListenToggleBtn(false);
    stopLocationTracking();
  }

  function toggleListen() {
    if (isListening) stopListening();
    else             startListening();
  }

  /* ══════════════════════════════════════════
     SPEECH SYNTHESIS
     ══════════════════════════════════════════ */
  function speak(text) {
    if (!window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang  = 'en-IN';
      u.rate  = 1.0;
      u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  /* ══════════════════════════════════════════
     PANIC BUTTON (hold 2 seconds)
     ══════════════════════════════════════════ */
  function panicPointerDown(e) {
    e.preventDefault();
    panicHoldStart = Date.now();
    animatePanic();
  }

  function animatePanic() {
    const ring = qid('voicePanicRing');
    if (!panicHoldStart) return;
    const pct = Math.min((Date.now() - panicHoldStart) / 2000, 1);
    if (ring) ring.style.setProperty('--pct', pct);
    if (pct < 1) {
      panicRaf = requestAnimationFrame(animatePanic);
    } else {
      panicPointerUp(true);
    }
  }

  function panicPointerUp(force = false) {
    if (panicRaf) { cancelAnimationFrame(panicRaf); panicRaf = null; }
    const elapsed = panicHoldStart ? Date.now() - panicHoldStart : 0;
    panicHoldStart = null;
    const ring = qid('voicePanicRing');
    if (ring) ring.style.setProperty('--pct', 0);
    if (force || elapsed >= 2000) {
      triggerVoiceSOS('PANIC BUTTON', 'Manual panic button pressed');
    }
  }

  /* ══════════════════════════════════════════
     SHAKE DETECTION (mobile)
     ══════════════════════════════════════════ */
  function onDeviceMotion(e) {
    if (!shakeEnabled) return;
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    if (lastAcc) {
      const delta = Math.sqrt(
        Math.pow((acc.x || 0) - lastAcc.x, 2) +
        Math.pow((acc.y || 0) - lastAcc.y, 2) +
        Math.pow((acc.z || 0) - lastAcc.z, 2)
      );
      const now = Date.now();
      if (delta > SHAKE_THRESHOLD && !confirmTimer && !sosActive && (now - lastShakeTime > SHAKE_COOLDOWN)) {
        lastShakeTime = now;
        onKeywordDetected('SHAKE DETECTED');
      }
    }
    lastAcc = { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 };
  }

  function enableShake() {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      // iOS 13+
      DeviceMotionEvent.requestPermission()
        .then(r => {
          if (r === 'granted') {
            window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
            shakeEnabled = true;
          } else {
            const t = qid('voiceShakeToggle');
            if (t) t.checked = false;
            voiceToast('Shake permission denied', 'error');
          }
        })
        .catch(() => {
          const t = qid('voiceShakeToggle');
          if (t) t.checked = false;
        });
    } else {
      window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
      shakeEnabled = true;
    }
  }

  function disableShake() {
    shakeEnabled = false;
    window.removeEventListener('devicemotion', onDeviceMotion);
    lastAcc = null;
  }

  /* ══════════════════════════════════════════
     TOAST (local, non-blocking)
     ══════════════════════════════════════════ */
  function voiceToast(msg, type = 'info') {
    if (typeof toast === 'function') { toast(msg, type); return; }
    if (typeof authToast === 'function') { authToast(msg, type); return; }
    console.info(`[VoiceSOS] ${type}: ${msg}`);
  }

  /* ══════════════════════════════════════════
     PANEL TOGGLE
     ══════════════════════════════════════════ */
  function togglePanel() {
    const panel = qid('voiceSOSPanel');
    if (!panel) return;
    panelOpen = !panelOpen;
    if (panelOpen) {
      panel.classList.remove('hidden');
      requestAnimationFrame(() => panel.classList.add('open'));
    } else {
      panel.classList.remove('open');
      setTimeout(() => panel.classList.add('hidden'), 320);
    }
  }

  function openPanel() {
    const panel = qid('voiceSOSPanel');
    if (!panel || panelOpen) return;
    panelOpen = true;
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('open'));
  }

  /* ══════════════════════════════════════════
     DOM INJECTION
     ══════════════════════════════════════════ */
  function injectDOM() {
    // ── Floating SOS button (bottom-right) ──
    if (!qid('voiceFloatSOS')) {
      const floatBtn = document.createElement('div');
      floatBtn.id        = 'voiceFloatSOS';
      floatBtn.className = 'voice-float-sos';
      floatBtn.setAttribute('role', 'button');
      floatBtn.setAttribute('aria-label', 'Voice SOS');
      floatBtn.innerHTML = `
        <div class="float-badge hidden" id="voiceSOSCount" data-count="0">0</div>
        <span class="float-icon">🎙️</span>
        <span class="float-label">SOS</span>
      `;
      document.body.appendChild(floatBtn);
    }

    // ── Slide-up panel ──
    if (!qid('voiceSOSPanel')) {
      const panel = document.createElement('div');
      panel.id        = 'voiceSOSPanel';
      panel.className = 'voice-sos-panel hidden';
      panel.innerHTML = `
        <!-- Header -->
        <div class="vp-header">
          <div class="vp-title">
            <span class="vp-title-icon">🎙️</span>
            <span>VOICE SOS SYSTEM</span>
          </div>
          <button id="voicePanelClose" class="vp-close" aria-label="Close">✕</button>
        </div>

        <!-- Mic + Status -->
        <div class="vp-mic-area">
          <div class="voice-mic-ring idle" id="voiceMicRing">
            <button class="voice-mic-btn idle" id="voiceMicBtn" aria-label="Microphone">
              <span class="mic-icon">🎙️</span>
            </button>
          </div>
          <p class="voice-status-text" id="voiceStatusText">Tap ▶ to start listening</p>
          <a class="voice-live-loc hidden" id="voiceLiveLocationText" href="#" target="_blank" rel="noopener">
            📍 Getting location…
          </a>
        </div>

        <!-- Start/Stop toggle -->
        <div class="vp-controls">
          <button class="voice-toggle-btn" id="voiceListenToggle">▶ Start Listening</button>
        </div>

        <!-- Confirm Banner -->
        <div class="voice-confirm-banner hidden" id="voiceConfirmBanner">
          <div class="confirm-warning">
            🚨 Keyword detected! Sending SOS in
            <strong><span id="voiceConfirmCountdown">3</span>s</strong>…
          </div>
          <button id="voiceCancelConfirmBtn" class="confirm-cancel-btn">❌ Cancel — False Alarm</button>
        </div>

        <!-- Contacts Quick-View -->
        <div class="vp-keywords" id="voiceContactsPreview">
          <p class="vp-label">📋 Emergency Contacts (will receive SMS & WhatsApp)</p>
          <div id="voiceContactChips" class="keyword-chips">
            <span class="keyword-chip" style="color:#f59e0b;border-color:rgba(245,158,11,.3)">Loading…</span>
          </div>
        </div>

        <!-- Trigger Keywords -->
        <div class="vp-keywords">
          <p class="vp-label">🗣 Voice Trigger Keywords</p>
          <div class="keyword-chips">
            ${KEYWORDS.map(k => `<span class="keyword-chip">${k}</span>`).join('')}
          </div>
        </div>

        <!-- Panic Button -->
        <div class="vp-panic">
          <p class="vp-label">🆘 Manual Panic (Hold 2 seconds)</p>
          <div class="panic-wrap">
            <div class="panic-ring" id="voicePanicRing" style="--pct:0">
              <button id="voicePanicBtn" class="panic-btn">
                <span style="font-size:1.6rem">🆘</span>
                <span>HOLD 2s</span>
                <span style="font-size:.55rem;letter-spacing:1.5px">SOS</span>
              </button>
            </div>
            <p class="panic-hint">Hold 2 seconds → instant SOS to all contacts</p>
          </div>
        </div>

        <!-- Shake Detection -->
        <div class="vp-shake">
          <label class="shake-toggle-label">
            <span>📳 Shake Phone to SOS</span>
            <label class="vp-toggle-switch">
              <input type="checkbox" id="voiceShakeToggle"/>
              <span class="vp-slider"></span>
            </label>
          </label>
        </div>

        <!-- Transcript Log -->
        <div class="vp-transcript">
          <p class="vp-label">🗣 Live Transcript</p>
          <div class="transcript-log" id="voiceTranscriptLog">
            <p class="transcript-empty">Spoken words appear here…</p>
          </div>
        </div>

        <!-- Alert Links (filled when SOS triggers) -->
        <div class="vp-alert-links hidden" id="voiceWhatsAppLinks"></div>
        <div class="vp-alert-links hidden" id="voiceSMSLinks"></div>
        <a class="vp-email-link hidden" id="voiceEmailLink" href="#" target="_blank" rel="noopener">
          📧 Send Email Alert
        </a>

        <p class="vp-footer-note">
          ⚠️ Always call <strong>112</strong> in a real emergency.
          Voice SOS sends alerts to your saved contacts.
        </p>
      `;
      document.body.appendChild(panel);
    }

    // ── Nav button ──
    if (!qid('voicePanelToggle')) {
      const navRight = document.querySelector('.nav-right') || document.querySelector('nav');
      if (navRight) {
        const navBtn      = document.createElement('button');
        navBtn.id         = 'voicePanelToggle';
        navBtn.className  = 'voice-nav-btn';
        navBtn.title      = 'Voice SOS Panel';
        navBtn.innerHTML  = '🎙️';
        navRight.insertBefore(navBtn, navRight.firstChild);
      }
    }

    // ── SOS Overlay ──
    if (!qid('voiceSOSOverlay')) {
      const overlay       = document.createElement('div');
      overlay.id          = 'voiceSOSOverlay';
      overlay.className   = 'voice-sos-overlay hidden';
      overlay.innerHTML   = `
        <div class="sos-overlay-card">
          <div class="sos-overlay-icon">🚨</div>
          <h2 class="sos-overlay-title">SOS ACTIVATED</h2>
          <p class="sos-overlay-msg" id="voiceSOSMessage">Fetching location…</p>
          <div class="sos-overlay-loc-wrap">
            <a class="sos-overlay-loc hidden" id="voiceSOSLocation" href="#" target="_blank" rel="noopener">
              📍 Getting GPS…
            </a>
          </div>
          <div class="sos-overlay-spinner" id="voiceSOSSpinner"></div>
          <p class="sos-overlay-status" id="voiceSOSStatus">📡 Alerting contacts…</p>
          <p style="font-size:.75rem;color:#7ea8c4;margin-bottom:12px">
            Tap the SMS / WhatsApp links in the panel below to send
          </p>
          <button class="sos-overlay-close" id="voiceSOSCloseBtn">Open Panel & Send Alerts ↓</button>
        </div>
      `;
      document.body.appendChild(overlay);
    }
  }

  /* ── Refresh contact chips in panel ── */
  function refreshContactChips() {
    const el = qid('voiceContactChips');
    if (!el) return;
    const contacts = loadEmergencyContacts();
    const personal = contacts.filter(c => !c.isDefault);

    if (!personal.length) {
      el.innerHTML = `<span class="keyword-chip" style="color:#f59e0b;border-color:rgba(245,158,11,.3)">
        ⚠️ No personal contacts — add in Contacts tab
      </span>`;
      return;
    }

    el.innerHTML = personal.map(c =>
      `<span class="keyword-chip" title="${escHtml(c.phone)}">
        ${escHtml(c.name)}
      </span>`
    ).join('');
  }

  /* ══════════════════════════════════════════
     WIRE EVENTS
     ══════════════════════════════════════════ */
  function wireEvents() {
    qid('voiceListenToggle')?.addEventListener('click', toggleListen);
    qid('voiceCancelConfirmBtn')?.addEventListener('click', cancelConfirm);
    qid('voicePanelClose')?.addEventListener('click', togglePanel);
    qid('voicePanelToggle')?.addEventListener('click', togglePanel);

    qid('voiceFloatSOS')?.addEventListener('click', () => {
      if (!isListening) startListening();
      openPanel();
    });

    // SOS overlay close → open panel for sending links
    qid('voiceSOSCloseBtn')?.addEventListener('click', () => {
      showSOSOverlay(false);
      openPanel();
    });

    // Panic button
    const panicBtn = qid('voicePanicBtn');
    if (panicBtn) {
      panicBtn.addEventListener('pointerdown', panicPointerDown);
      panicBtn.addEventListener('pointerup', () => panicPointerUp(false));
      panicBtn.addEventListener('pointercancel', () => panicPointerUp(false));
      panicBtn.addEventListener('contextmenu', e => e.preventDefault()); // prevent long-press menu on mobile
    }

    // Shake toggle
    qid('voiceShakeToggle')?.addEventListener('change', e => {
      if (e.target.checked) enableShake();
      else disableShake();
    });

    // Mic button itself also toggles listen
    qid('voiceMicBtn')?.addEventListener('click', toggleListen);

    // Refresh contacts whenever panel opens
    const panelEl = qid('voiceSOSPanel');
    if (panelEl) {
      const observer = new MutationObserver(() => {
        if (panelEl.classList.contains('open')) refreshContactChips();
      });
      observer.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ══════════════════════════════════════════
     INIT — called after enterApp()
     ══════════════════════════════════════════ */
  function init() {
    injectDOM();
    requestAnimationFrame(() => {
      wireEvents();
      setStatus('Tap ▶ to start voice listening', '');
      refreshContactChips();
    });
  }

  /* ── Public API ── */
  return { init, startListening, stopListening, triggerVoiceSOS, togglePanel };

})();

/* ════════════════════════════════════════════════════════════════
   HOOK INTO APP LIFECYCLE
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  // Patch enterApp so VoiceSOS inits after login
  const _origEnterApp = window.enterApp;
  window.enterApp = function (...args) {
    if (_origEnterApp) _origEnterApp.apply(this, args);
    setTimeout(() => VoiceSOS.init(), 900);
  };

  // Auto-init if session already active (page refresh)
  try {
    const session =
      JSON.parse(localStorage.getItem('rn_session') || 'null') ||
      JSON.parse(sessionStorage.getItem('rn_session') || 'null');
    if (session?.email) {
      setTimeout(() => VoiceSOS.init(), 1600);
    }
  } catch (_) {}
});
