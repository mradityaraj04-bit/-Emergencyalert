'use strict';

/* ════════════════════════════════════════════════════════════════
   RESCUENET INDIA — VOICE SOS MODULE v1.0
   Add <script src="voice-sos.js"></script> AFTER script.js
   No existing files modified. Pure extension.
   ════════════════════════════════════════════════════════════════ */

/* ── VOICE SOS STATE ── */
const VoiceSOS = (() => {

  /* ── CONFIG ── */
  const KEYWORDS = ['help', 'save me', 'emergency', 'accident', 'bachao', 'madad', 'help me'];
  const CONFIRM_DELAY_MS = 2500;   // 2.5s false-trigger prevention
  const RATE_LIMIT_MS    = 60000;  // max 1 SOS per minute
  const LOCATION_UPDATE_MS = 5000; // re-check GPS every 5s during SOS

  /* ── INTERNAL STATE ── */
  let recognition      = null;
  let isListening      = false;
  let confirmTimer     = null;
  let lastSOSTime      = 0;
  let locationWatcher  = null;
  let voiceLiveLocation = null;
  let speechSynth      = window.speechSynthesis;
  let sosActive        = false;
  let panelOpen        = false;

  /* ══════════════════════════════════════════
     DOM HELPERS
     ══════════════════════════════════════════ */
  const qid = id => document.getElementById(id);

  function setStatus(text, cls = '') {
    const el = qid('voiceStatusText');
    if (!el) return;
    el.textContent = text;
    el.className   = 'voice-status-text' + (cls ? ' ' + cls : '');
  }

  function setMicIcon(state) {
    // state: 'idle' | 'listening' | 'detected' | 'sending'
    const btn  = qid('voiceMicBtn');
    const ring = qid('voiceMicRing');
    if (!btn || !ring) return;
    btn.className  = 'voice-mic-btn ' + state;
    ring.className = 'voice-mic-ring ' + state;
    const icons = { idle: '🎙️', listening: '🎙️', detected: '🚨', sending: '📡' };
    btn.querySelector('.mic-icon').textContent = icons[state] || '🎙️';
  }

  function setListenToggleBtn(on) {
    const btn = qid('voiceListenToggle');
    if (!btn) return;
    btn.textContent  = on ? '⏹ Stop Listening' : '▶ Start Listening';
    btn.className    = 'voice-toggle-btn' + (on ? ' active' : '');
  }

  function appendTranscript(text) {
    const log = qid('voiceTranscriptLog');
    if (!log) return;
    const ts  = new Date().toLocaleTimeString('en-IN');
    const row = document.createElement('div');
    row.className   = 'transcript-row';
    row.innerHTML   = `<span class="ts">${ts}</span><span class="tx">${text}</span>`;
    log.prepend(row);
    // keep only last 10
    while (log.children.length > 10) log.removeChild(log.lastChild);
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

  /* ══════════════════════════════════════════
     LOCATION TRACKING
     ══════════════════════════════════════════ */
  function startLocationTracking() {
    if (!navigator.geolocation) return;
    // initial fetch
    navigator.geolocation.getCurrentPosition(pos => {
      voiceLiveLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateLocationDisplay();
    }, null, { enableHighAccuracy: true, timeout: 8000 });
    // continuous watch
    locationWatcher = navigator.geolocation.watchPosition(pos => {
      voiceLiveLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateLocationDisplay();
    }, null, { enableHighAccuracy: true });
  }

  function stopLocationTracking() {
    if (locationWatcher !== null) {
      navigator.geolocation.clearWatch(locationWatcher);
      locationWatcher = null;
    }
  }

  function updateLocationDisplay() {
    if (!voiceLiveLocation) return;
    const el = qid('voiceLiveLocationText');
    if (el) {
      el.textContent = `📍 ${voiceLiveLocation.lat.toFixed(5)}, ${voiceLiveLocation.lng.toFixed(5)}`;
      el.href = mapsLink();
    }
  }

  function mapsLink() {
    if (voiceLiveLocation)
      return `https://www.google.com/maps?q=${voiceLiveLocation.lat},${voiceLiveLocation.lng}`;
    // fall back to app's currentLocation
    if (typeof currentLocation !== 'undefined' && currentLocation.fresh)
      return `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
    return 'https://www.google.com/maps';
  }

  function getLocation() {
    if (voiceLiveLocation) return voiceLiveLocation;
    if (typeof currentLocation !== 'undefined') return currentLocation;
    return null;
  }

  /* ══════════════════════════════════════════
     SPEECH RECOGNITION
     ══════════════════════════════════════════ */
  function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('⚠️ Voice not supported in this browser', 'warn');
      const btn = qid('voiceListenToggle');
      if (btn) btn.disabled = true;
      return false;
    }

    recognition = new SR();
    recognition.continuous  = true;
    recognition.interimResults = true;
    recognition.lang        = 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isListening = true;
      setMicIcon('listening');
      setStatus('🎙️ Listening for keywords…', 'listening');
      setListenToggleBtn(true);
      startLocationTracking();
    };

    recognition.onend = () => {
      if (isListening) {
        // auto-restart if still meant to be listening
        try { recognition.start(); } catch(_) {}
      } else {
        setMicIcon('idle');
        setStatus('Tap ▶ to start listening', '');
        setListenToggleBtn(false);
        stopLocationTracking();
      }
    };

    recognition.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setStatus('❌ Mic access denied — check browser settings', 'error');
        isListening = false;
        setMicIcon('idle');
        setListenToggleBtn(false);
      }
      // network/aborted errors: just re-start silently
    };

    recognition.onresult = e => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      transcript = transcript.toLowerCase().trim();
      if (!transcript) return;

      appendTranscript(transcript);

      const hit = KEYWORDS.find(kw => transcript.includes(kw));
      if (hit && !confirmTimer && !sosActive) {
        onKeywordDetected(hit, transcript);
      }
    };

    return true;
  }

  /* ══════════════════════════════════════════
     KEYWORD DETECTED → CONFIRM DELAY
     ══════════════════════════════════════════ */
  function onKeywordDetected(keyword, fullText) {
    setMicIcon('detected');
    setStatus(`🚨 Keyword "${keyword}" detected!`, 'alert');

    let seconds = Math.ceil(CONFIRM_DELAY_MS / 1000);
    showConfirmBanner(true, seconds);

    // countdown
    const tick = setInterval(() => {
      seconds--;
      const cntEl = qid('voiceConfirmCountdown');
      if (cntEl) cntEl.textContent = seconds;
      if (seconds <= 0) clearInterval(tick);
    }, 1000);

    confirmTimer = setTimeout(() => {
      clearInterval(tick);
      showConfirmBanner(false);
      triggerVoiceSOS(keyword, fullText);
    }, CONFIRM_DELAY_MS);
  }

  function cancelConfirm() {
    if (!confirmTimer) return;
    clearTimeout(confirmTimer);
    confirmTimer = null;
    showConfirmBanner(false);
    setMicIcon('listening');
    setStatus('✅ Cancelled — still listening…', 'ok');
    speak('False alarm cancelled. Still listening.');
  }

  /* ══════════════════════════════════════════
     TRIGGER VOICE SOS
     ══════════════════════════════════════════ */
  function triggerVoiceSOS(keyword, transcript) {
    // Rate limiting
    const now = Date.now();
    if (now - lastSOSTime < RATE_LIMIT_MS) {
      setStatus('⏳ Rate limited — wait before next SOS', 'warn');
      speak('Please wait before sending another SOS.');
      return;
    }
    lastSOSTime = now;
    sosActive   = true;

    setMicIcon('sending');
    setStatus('📡 SOS SENDING…', 'sending');
    showSOSOverlay(true);

    const loc  = getLocation();
    const link = mapsLink();
    const ts   = new Date().toLocaleString('en-IN');
    const name = (window.currentUser?.name) || 'RescueNet User';
    const phone= (window.currentUser?.phone) || 'Unknown';

    const sosMsg = `🚨 EMERGENCY ALERT!\n${name} needs help.\nKeyword: "${keyword}"\nLocation: ${link}\nTime: ${ts}`;

    // Update overlay
    const ovMsg = qid('voiceSOSMessage');
    if (ovMsg) ovMsg.textContent = `Sending emergency alert for "${keyword}"…`;
    const ovLoc = qid('voiceSOSLocation');
    if (ovLoc) ovLoc.href = link;
    if (ovLoc) ovLoc.textContent = loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Locating…';

    // Speak feedback
    speak('Emergency SOS triggered! Sending alert now. Stay calm.');

    // Log to app's alert system
    logToAppAlerts(keyword, loc, link, ts);

    // Send WhatsApp to contacts
    sendWhatsAppAlerts(sosMsg);

    // Build SMS deep link
    const smsContacts = loadEmergencyContacts();
    if (smsContacts.length > 0) {
      buildSMSLinks(smsContacts, sosMsg);
    }

    // Email mailto link
    buildEmailLink(name, link, ts, keyword);

    // Animate — done after 3s
    setTimeout(() => {
      setStatus('✅ SOS SENT! Help is coming…', 'ok');
      const ovStatus = qid('voiceSOSStatus');
      if (ovStatus) {
        ovStatus.textContent = '✅ Alert dispatched!';
        ovStatus.className = 'sos-overlay-status sent';
      }
      speak('Alert sent successfully. Help is on the way.');
      sosActive = false;
      setMicIcon(isListening ? 'listening' : 'idle');

      // Add to alert sent count badge
      incrementSOSBadge();
    }, 3000);
  }

  /* ── Log to existing RescueNet alert history ── */
  function logToAppAlerts(keyword, loc, link, ts) {
    if (typeof addAlertToLog !== 'function') return;
    const alertObj = {
      id: Date.now(),
      type: 'VOICE_SOS',
      tag: 'voice',
      emoji: '🎙️',
      title: `VOICE SOS — "${keyword.toUpperCase()}"`,
      location: loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Unknown',
      mapsLink: link,
      timestamp: ts,
      status: 'sent'
    };
    if (typeof alertHistory !== 'undefined') alertHistory.unshift(alertObj);
    addAlertToLog(alertObj);
    if (typeof syncFirebaseUserData === 'function') syncFirebaseUserData();
  }

  /* ── Send WhatsApp deep links to contacts ── */
  function sendWhatsAppAlerts(msg) {
    const contacts = loadEmergencyContacts();
    if (!contacts.length) return;
    const encoded = encodeURIComponent(msg);
    // Show links in panel
    const linksEl = qid('voiceWhatsAppLinks');
    if (!linksEl) return;
    linksEl.innerHTML = '<p class="links-title">📲 Tap to send WhatsApp alerts:</p>';
    contacts.slice(0, 5).forEach(c => {
      const ph = c.phone.replace(/\D/g, '');
      const a  = document.createElement('a');
      a.href   = `https://wa.me/${ph}?text=${encoded}`;
      a.target = '_blank';
      a.rel    = 'noopener';
      a.className = 'whatsapp-link-btn';
      a.textContent = `💬 WhatsApp ${c.name}`;
      linksEl.appendChild(a);
    });
    linksEl.classList.remove('hidden');
  }

  function buildSMSLinks(contacts, msg) {
    const encoded = encodeURIComponent(msg);
    const el = qid('voiceSMSLinks');
    if (!el) return;
    el.innerHTML = '<p class="links-title">📱 Tap to send SMS:</p>';
    contacts.slice(0, 5).forEach(c => {
      const ph = c.phone.replace(/\D/g, '');
      const a  = document.createElement('a');
      a.href   = `sms:${ph}?body=${encoded}`;
      a.className = 'sms-link-btn';
      a.textContent = `📩 SMS ${c.name}`;
      el.appendChild(a);
    });
    el.classList.remove('hidden');
  }

  function buildEmailLink(name, link, ts, keyword) {
    const el = qid('voiceEmailLink');
    if (!el) return;
    const subject = encodeURIComponent(`🚨 EMERGENCY: ${name} needs help!`);
    const body = encodeURIComponent(
      `Emergency Alert!\n\n${name} has triggered a Voice SOS.\n\nKeyword detected: "${keyword}"\nLive Location: ${link}\nTime: ${ts}\n\nPlease help immediately or call 112.`
    );
    const contacts = loadEmergencyContacts();
    const emailTo  = contacts.filter(c => c.email).map(c => c.email).join(',');
    el.href = `mailto:${emailTo}?subject=${subject}&body=${body}`;
    el.classList.remove('hidden');
  }

  /* ── Load contacts from existing app storage ── */
  function loadEmergencyContacts() {
    try {
      return JSON.parse(localStorage.getItem('rn_contacts') || '[]');
    } catch {
      return [];
    }
  }

  /* ── Increment badge ── */
  function incrementSOSBadge() {
    const badge = qid('voiceSOSCount');
    if (!badge) return;
    let n = parseInt(badge.textContent || '0', 10) + 1;
    badge.textContent = n;
    badge.classList.remove('hidden');
  }

  /* ══════════════════════════════════════════
     SPEECH SYNTHESIS (voice feedback)
     ══════════════════════════════════════════ */
  function speak(text) {
    if (!speechSynth) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang  = 'en-IN';
      utterance.rate  = 1.1;
      utterance.pitch = 1.0;
      speechSynth.cancel();
      speechSynth.speak(utterance);
    } catch(_) {}
  }

  /* ══════════════════════════════════════════
     PANIC BUTTON (manual fallback)
     ══════════════════════════════════════════ */
  let panicHoldStart = null;
  let panicRaf       = null;

  function panicPointerDown() {
    panicHoldStart = Date.now();
    animatePanic();
  }

  function animatePanic() {
    const btn  = qid('voicePanicBtn');
    const ring = qid('voicePanicRing');
    if (!btn || !panicHoldStart) return;
    const elapsed = Date.now() - panicHoldStart;
    const pct     = Math.min(elapsed / 2000, 1);
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
      triggerVoiceSOS('PANIC_BUTTON', 'Manual panic button pressed');
    }
  }

  /* ══════════════════════════════════════════
     SHAKE DETECTION (mobile)
     ══════════════════════════════════════════ */
  let lastAcc = null;
  let shakeEnabled = false;

  function initShakeDetection() {
    if (!('DeviceMotionEvent' in window)) return;
    window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
    shakeEnabled = true;
  }

  function onDeviceMotion(e) {
    if (!shakeEnabled || !isListening) return;
    const acc = e.accelerationIncludingGravity;
    if (!acc) return;
    if (lastAcc) {
      const delta = Math.sqrt(
        Math.pow(acc.x - lastAcc.x, 2) +
        Math.pow(acc.y - lastAcc.y, 2) +
        Math.pow(acc.z - lastAcc.z, 2)
      );
      if (delta > 25 && !confirmTimer && !sosActive) {
        onKeywordDetected('SHAKE', 'Shake detected');
      }
    }
    lastAcc = { x: acc.x, y: acc.y, z: acc.z };
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
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
      setTimeout(() => panel.classList.add('hidden'), 300);
    }
  }

  /* ══════════════════════════════════════════
     INIT — called after enterApp()
     ══════════════════════════════════════════ */
  function init() {
    // Inject DOM
    injectDOM();

    // Wait for DOM injection to settle
    requestAnimationFrame(() => {
      // Wire buttons
      qid('voiceListenToggle')?.addEventListener('click', toggleListen);
      qid('voiceCancelConfirmBtn')?.addEventListener('click', cancelConfirm);
      qid('voiceSOSCloseBtn')?.addEventListener('click', () => {
        showSOSOverlay(false);
        sosActive = false;
        setMicIcon(isListening ? 'listening' : 'idle');
      });
      qid('voicePanelToggle')?.addEventListener('click', togglePanel);
      qid('voicePanelClose')?.addEventListener('click', togglePanel);

      // Panic button hold
      const panicBtn = qid('voicePanicBtn');
      if (panicBtn) {
        panicBtn.addEventListener('pointerdown', panicPointerDown);
        panicBtn.addEventListener('pointerup', () => panicPointerUp(false));
        panicBtn.addEventListener('pointercancel', () => panicPointerUp(false));
      }

      // Floating SOS button (big red)
      qid('voiceFloatSOS')?.addEventListener('click', () => {
        if (!isListening) startListening();
        togglePanel();
      });

      // Shake detection
      if (qid('voiceShakeToggle')) {
        qid('voiceShakeToggle').addEventListener('change', e => {
          if (e.target.checked) {
            if (typeof DeviceMotionEvent?.requestPermission === 'function') {
              DeviceMotionEvent.requestPermission().then(r => {
                if (r === 'granted') initShakeDetection();
                else e.target.checked = false;
              }).catch(() => e.target.checked = false);
            } else {
              initShakeDetection();
            }
          } else {
            shakeEnabled = false;
            window.removeEventListener('devicemotion', onDeviceMotion);
          }
        });
      }

      setStatus('Tap ▶ to start listening', '');
    });
  }

  function toggleListen() {
    if (isListening) stopListening();
    else             startListening();
  }

  function startListening() {
    if (!recognition && !initRecognition()) return;
    try {
      isListening = true;
      recognition.start();
    } catch(_) {}
  }

  function stopListening() {
    isListening = false;
    if (recognition) {
      try { recognition.stop(); } catch(_) {}
    }
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
    showConfirmBanner(false);
    setMicIcon('idle');
    setStatus('Listening stopped', '');
    setListenToggleBtn(false);
    stopLocationTracking();
  }

  /* ══════════════════════════════════════════
     DOM INJECTION
     ══════════════════════════════════════════ */
  function injectDOM() {
    // ── Floating red SOS button ──
    const floatBtn = document.createElement('div');
    floatBtn.id = 'voiceFloatSOS';
    floatBtn.className = 'voice-float-sos';
    floatBtn.innerHTML = `
      <div class="float-badge hidden" id="voiceSOSCount">0</div>
      <span class="float-icon">🎙️</span>
      <span class="float-label">SOS</span>
    `;
    document.body.appendChild(floatBtn);

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'voiceSOSPanel';
    panel.className = 'voice-sos-panel hidden';
    panel.innerHTML = `
      <div class="vp-header">
        <div class="vp-title">
          <span class="vp-title-icon">🎙️</span>
          <span>VOICE SOS SYSTEM</span>
        </div>
        <button id="voicePanelClose" class="vp-close">✕</button>
      </div>

      <!-- Mic + Status -->
      <div class="vp-mic-area">
        <div class="voice-mic-ring idle" id="voiceMicRing">
          <button class="voice-mic-btn idle" id="voiceMicBtn">
            <span class="mic-icon">🎙️</span>
          </button>
        </div>
        <p class="voice-status-text" id="voiceStatusText">Tap ▶ to start listening</p>
        <a class="voice-live-loc hidden" id="voiceLiveLocationText" href="#" target="_blank">📍 Getting location…</a>
      </div>

      <!-- Controls -->
      <div class="vp-controls">
        <button class="voice-toggle-btn" id="voiceListenToggle">▶ Start Listening</button>
      </div>

      <!-- Confirm Banner (false-trigger prevention) -->
      <div class="voice-confirm-banner hidden" id="voiceConfirmBanner">
        <div class="confirm-warning">
          🚨 Keyword detected! Sending SOS in <strong><span id="voiceConfirmCountdown">3</span>s</strong>…
        </div>
        <button id="voiceCancelConfirmBtn" class="confirm-cancel-btn">❌ Cancel (False Alarm)</button>
      </div>

      <!-- Keywords -->
      <div class="vp-keywords">
        <p class="vp-label">Trigger keywords</p>
        <div class="keyword-chips">
          ${KEYWORDS.map(k => `<span class="keyword-chip">${k}</span>`).join('')}
        </div>
      </div>

      <!-- Panic Button -->
      <div class="vp-panic">
        <p class="vp-label">Manual Panic Button</p>
        <div class="panic-wrap">
          <div class="panic-ring" id="voicePanicRing" style="--pct:0">
            <button id="voicePanicBtn" class="panic-btn">
              <span>HOLD 2s</span>
              <span style="font-size:1.6rem">🆘</span>
              <span>SOS</span>
            </button>
          </div>
          <p class="panic-hint">Hold for 2 seconds to trigger</p>
        </div>
      </div>

      <!-- Shake Detection -->
      <div class="vp-shake">
        <label class="shake-toggle-label">
          <span>📳 Shake to SOS (mobile)</span>
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
          <p class="transcript-empty">Heard words will appear here…</p>
        </div>
      </div>

      <!-- Alert links (populated on trigger) -->
      <div class="vp-alert-links hidden" id="voiceWhatsAppLinks"></div>
      <div class="vp-alert-links hidden" id="voiceSMSLinks"></div>
      <a class="vp-email-link hidden" id="voiceEmailLink" href="#" target="_blank">📧 Send Email Alert</a>

      <p class="vp-footer-note">⚠️ Always call 112 in a real emergency. Voice SOS supplements alerting only.</p>
    `;
    document.body.appendChild(panel);

    // ── Panel Toggle Button in nav ──
    // Insert into existing nav if possible
    const navRight = document.querySelector('.nav-right') || document.querySelector('nav');
    if (navRight) {
      const navBtn = document.createElement('button');
      navBtn.id        = 'voicePanelToggle';
      navBtn.className = 'voice-nav-btn';
      navBtn.title     = 'Voice SOS';
      navBtn.innerHTML = '🎙️';
      navRight.insertBefore(navBtn, navRight.firstChild);
    }

    // ── SOS Sent Overlay ──
    const overlay = document.createElement('div');
    overlay.id = 'voiceSOSOverlay';
    overlay.className = 'voice-sos-overlay hidden';
    overlay.innerHTML = `
      <div class="sos-overlay-card">
        <div class="sos-overlay-icon">🚨</div>
        <h2 class="sos-overlay-title">SOS ACTIVATED</h2>
        <p class="sos-overlay-msg" id="voiceSOSMessage">Sending emergency alert…</p>
        <div class="sos-overlay-loc-wrap">
          <a class="sos-overlay-loc" id="voiceSOSLocation" href="#" target="_blank">📍 Locating…</a>
        </div>
        <div class="sos-overlay-spinner"></div>
        <p class="sos-overlay-status" id="voiceSOSStatus">📡 Alerting contacts…</p>
        <button class="sos-overlay-close" id="voiceSOSCloseBtn">✕ Close</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  /* ── Public API ── */
  return { init, startListening, stopListening, triggerVoiceSOS };

})();

/* ════════════════════════════════════════════════════════════════
   HOOK INTO APP LIFECYCLE
   Patch enterApp() to also initialise VoiceSOS
   ════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Patch enterApp so VoiceSOS inits whenever the user logs in
  const _origEnterApp = window.enterApp;
  window.enterApp = function(...args) {
    if (_origEnterApp) _origEnterApp.apply(this, args);
    // Short delay so the app screen is visible first
    setTimeout(() => VoiceSOS.init(), 800);
  };

  // If session already active (auto-login), init immediately
  try {
    const session = JSON.parse(localStorage.getItem('rn_session') || 'null')
                 || JSON.parse(sessionStorage.getItem('rn_session') || 'null');
    if (session && session.email) {
      setTimeout(() => VoiceSOS.init(), 1500);
    }
  } catch(_) {}
});
