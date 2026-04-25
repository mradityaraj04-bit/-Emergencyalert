'use strict';

/* ════════════════════════════════════════════
   RESCUENET INDIA — AUTH MODULE v2.0
   Phone Number + OTP Login/Register
   ════════════════════════════════════════════ */

/* ── OTP STATE ── */
let otpState = {
  phone: '',
  otp: '',
  timer: null,
  secondsLeft: 60,
  mode: 'login' // 'login' | 'signup' | 'forgot'
};

/* ── SIMULATED OTP (demo — real app would use Firebase Auth/Twilio) ── */
const OTP_STORE = new Map(); // phone -> otp

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendOTP(phone) {
  const code = generateOTP();
  OTP_STORE.set(phone, code);
  console.info(`[RescueNet OTP] Phone: ${phone} → Code: ${code}`);
  return code; // in prod, this would be sent via SMS/WhatsApp
}

function verifyOTP(phone, entered) {
  const stored = OTP_STORE.get(phone);
  if (!stored) return false;
  if (entered === stored || entered === '000000') return true; // 000000 = bypass for demo
  return false;
}

/* ── PANEL SWITCHING ── */
function switchAuthTab(mode) {
  otpState.mode = mode;

  // Tab buttons
  document.querySelectorAll('.auth-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === mode)
  );

  // Panels
  ['loginPanel','signupPanel','forgotPanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const targetMap = { login: 'loginPanel', signup: 'signupPanel', forgot: 'forgotPanel' };
  const target = document.getElementById(targetMap[mode]);
  if (target) target.classList.remove('hidden');

  // Reset OTP state when switching
  resetOTPState(mode);
}

function switchAuth(mode) { switchAuthTab(mode); }
function showForgot() { switchAuthTab('forgot'); }

/* ── OTP SECTION RESET ── */
function resetOTPState(mode) {
  clearOTPTimer();

  // Reset login OTP
  const loginOtpSection = document.getElementById('loginOtpSection');
  const loginPhoneInput  = document.getElementById('loginPhone');
  const loginSendBtn     = document.getElementById('loginSendOtpBtn');
  const loginOtpDemo     = document.getElementById('loginOtpDemo');

  if (loginOtpSection)  loginOtpSection.classList.remove('visible');
  if (loginPhoneInput)  loginPhoneInput.value = '';
  if (loginSendBtn)     { loginSendBtn.textContent = 'Send OTP'; loginSendBtn.disabled = false; }
  if (loginOtpDemo)     loginOtpDemo.classList.remove('show');
  clearOtpBoxes('loginOtpBoxes');

  // Reset signup OTP
  const signupOtpSection = document.getElementById('signupOtpSection');
  const signupPhoneInput  = document.getElementById('signupPhone');
  const signupSendBtn     = document.getElementById('signupSendOtpBtn');
  const signupOtpDemo     = document.getElementById('signupOtpDemo');

  if (signupOtpSection)  signupOtpSection.classList.remove('visible');
  if (signupPhoneInput)  signupPhoneInput.value = '';
  if (signupSendBtn)     { signupSendBtn.textContent = 'Send OTP'; signupSendBtn.disabled = false; }
  if (signupOtpDemo)     signupOtpDemo.classList.remove('show');
  clearOtpBoxes('signupOtpBoxes');

  // Reset step indicators
  updateSteps('loginSteps', 0);
  updateSteps('signupSteps', 0);
}

function clearOtpBoxes(containerId) {
  const boxes = document.querySelectorAll(`#${containerId} .otp-box`);
  boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
}

/* ── STEP INDICATORS ── */
function updateSteps(stepsId, activeIdx) {
  const dots = document.querySelectorAll(`#${stepsId} .auth-step-dot`);
  dots.forEach((d, i) => {
    d.classList.remove('active', 'done');
    if (i < activeIdx) d.classList.add('done');
    else if (i === activeIdx) d.classList.add('active');
  });
}

/* ── PHONE NORMALIZATION ── */
function normalizePhone(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.length === 10) return '+91' + p;
  if (p.startsWith('91') && p.length === 12) return '+' + p;
  if (p.startsWith('0') && p.length === 11) return '+91' + p.slice(1);
  if (raw.startsWith('+')) return '+' + p;
  return '+91' + p;
}

function isValidPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

/* ── OTP TIMER ── */
function startOTPTimer(timerElId, resendBtnId) {
  clearOTPTimer();
  otpState.secondsLeft = 60;

  const timerEl   = document.getElementById(timerElId);
  const resendBtn = document.getElementById(resendBtnId);
  if (resendBtn) resendBtn.disabled = true;

  function tick() {
    if (timerEl) timerEl.textContent = `${otpState.secondsLeft}s`;
    if (otpState.secondsLeft <= 0) {
      clearOTPTimer();
      if (timerEl) timerEl.textContent = '';
      if (resendBtn) resendBtn.disabled = false;
      return;
    }
    otpState.secondsLeft--;
    otpState.timer = setTimeout(tick, 1000);
  }
  tick();
}

function clearOTPTimer() {
  if (otpState.timer) { clearTimeout(otpState.timer); otpState.timer = null; }
}

/* ── OTP BOXES LOGIC ── */
function initOtpBoxes(containerId, onComplete) {
  const boxes = document.querySelectorAll(`#${containerId} .otp-box`);
  if (!boxes.length) return;

  boxes.forEach((box, i) => {
    // Input event
    box.addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '');
      // Handle paste of full code
      if (v.length > 1) {
        const digits = v.slice(0, 6);
        boxes.forEach((b, j) => {
          b.value = digits[j] || '';
          b.classList.toggle('filled', !!b.value);
        });
        const lastFilled = Math.min(digits.length - 1, boxes.length - 1);
        if (boxes[lastFilled]) boxes[lastFilled].focus();
        const full = [...boxes].map(b => b.value).join('');
        if (full.length === 6 && onComplete) onComplete(full);
        return;
      }
      box.value = v;
      box.classList.toggle('filled', !!v);
      if (v && i < boxes.length - 1) boxes[i + 1].focus();
      const full = [...boxes].map(b => b.value).join('');
      if (full.length === 6 && onComplete) onComplete(full);
    });

    // Keydown backspace
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].value = '';
        boxes[i - 1].classList.remove('filled');
      }
    });

    // Paste
    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
      const digits = pasted.slice(0, 6);
      boxes.forEach((b, j) => {
        b.value = digits[j] || '';
        b.classList.toggle('filled', !!b.value);
      });
      const lastFilled = Math.min(digits.length - 1, boxes.length - 1);
      if (boxes[lastFilled]) boxes[lastFilled].focus();
      const full = [...boxes].map(b => b.value).join('');
      if (full.length === 6 && onComplete) onComplete(full);
    });
  });
}

/* ── AUTH TOAST ── */
function authToast(msg, type = 'info') {
  let el = document.getElementById('authToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'authToast';
    el.style.cssText = `
      position:fixed;bottom:80px;left:50%;
      transform:translateX(-50%) translateY(10px);
      padding:10px 20px;border-radius:30px;
      font-size:.82rem;font-weight:600;z-index:99999;
      max-width:90vw;text-align:center;
      font-family:'Rajdhani',sans-serif;
      transition:opacity .3s,transform .3s;
      pointer-events:none;opacity:0;
      background:#071524;
    `;
    document.body.appendChild(el);
  }

  const colors = {
    error:   { border: '#ff1744', color: '#ff8a9a' },
    success: { border: '#00e676', color: '#80ffc8' },
    info:    { border: '#00e5ff', color: '#00e5ff' },
    warning: { border: '#ffab00', color: '#ffab00' }
  };
  const c = colors[type] || colors.info;
  el.style.border = `1px solid ${c.border}`;
  el.style.color  = c.color;
  el.textContent  = msg;

  // Show
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(10px)';
  }, 3500);
}

/* ── TOGGLE PASSWORD ── */
function togglePass(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
  else { el.type = 'password'; btn.textContent = '👁'; }
}

/* ── USER STORE ── */
function getUsers() {
  try { return JSON.parse(localStorage.getItem('rn_users') || '{}'); } catch { return {}; }
}

function saveUsers(u) {
  try { localStorage.setItem('rn_users', JSON.stringify(u)); } catch(_) {}
}

/* ── SEND OTP (LOGIN) ── */
function loginSendOTP() {
  const raw = (document.getElementById('loginPhone')?.value || '').trim();
  if (!raw) return authToast('Enter your phone number', 'error');
  if (!isValidPhone(raw)) return authToast('Enter a valid 10-digit phone number', 'error');

  const phone = normalizePhone(raw);
  const users = getUsers();

  // Find user by phone
  const found = Object.values(users).find(u => normalizePhone(u.phone || '') === phone);
  if (!found) return authToast('No account found. Please register first.', 'error');

  otpState.phone = phone;

  const btn  = document.getElementById('loginSendOtpBtn');
  if (btn) { btn.textContent = '⏳ Sending…'; btn.disabled = true; }

  // Simulate SMS delay
  setTimeout(() => {
    const code = sendOTP(phone);
    if (btn) { btn.textContent = '✓ Sent'; }

    const section = document.getElementById('loginOtpSection');
    if (section) section.classList.add('visible');

    // Show demo hint
    const demoHint = document.getElementById('loginOtpDemo');
    if (demoHint) {
      demoHint.textContent = `Demo OTP: ${code} (or use 000000)`;
      demoHint.classList.add('show');
    }

    const phoneDisp = document.getElementById('loginPhoneDisplay');
    if (phoneDisp) phoneDisp.textContent = phone;

    startOTPTimer('loginOtpTimer', 'loginResendBtn');
    updateSteps('loginSteps', 1);
    authToast(`OTP sent to ${phone}`, 'success');

    // Focus first box
    const firstBox = document.querySelector('#loginOtpBoxes .otp-box');
    if (firstBox) firstBox.focus();
  }, 800);
}

/* ── RESEND OTP (LOGIN) ── */
function loginResendOTP() {
  if (!otpState.phone) return;
  const code = sendOTP(otpState.phone);
  const demoHint = document.getElementById('loginOtpDemo');
  if (demoHint) { demoHint.textContent = `Demo OTP: ${code} (or use 000000)`; demoHint.classList.add('show'); }
  startOTPTimer('loginOtpTimer', 'loginResendBtn');
  authToast('New OTP sent!', 'success');
}

/* ── VERIFY OTP + LOGIN ── */
function loginVerifyOTP(otp) {
  if (!otpState.phone) return authToast('Please send OTP first', 'error');

  const btn = document.getElementById('loginVerifyBtn');
  if (btn) { btn.textContent = '⏳ Verifying…'; btn.disabled = true; }

  setTimeout(() => {
    if (btn) { btn.textContent = '🔐 VERIFY & LOGIN'; btn.disabled = false; }

    if (!verifyOTP(otpState.phone, otp)) {
      authToast('Incorrect OTP. Try again.', 'error');
      clearOtpBoxes('loginOtpBoxes');
      const firstBox = document.querySelector('#loginOtpBoxes .otp-box');
      if (firstBox) firstBox.focus();
      return;
    }

    // Find user
    const users = getUsers();
    const user = Object.values(users).find(u => normalizePhone(u.phone || '') === otpState.phone);
    if (!user) return authToast('User not found', 'error');

    clearOTPTimer();
    updateSteps('loginSteps', 2);
    authToast('✅ Login successful!', 'success');

    const remember = document.getElementById('rememberMe')?.checked;
    window.currentUser = { email: user.email, name: user.name, phone: user.phone };
    try {
      if (remember) localStorage.setItem('rn_session', JSON.stringify(window.currentUser));
      else sessionStorage.setItem('rn_session', JSON.stringify(window.currentUser));
    } catch(_) {}

    setTimeout(enterApp, 700);
  }, 600);
}

/* ── SEND OTP (SIGNUP) ── */
function signupSendOTP() {
  const raw   = (document.getElementById('signupPhone')?.value || '').trim();
  const first = (document.getElementById('signupFirst')?.value || '').trim();
  const last  = (document.getElementById('signupLast')?.value || '').trim();

  if (!first || !last) return authToast('Enter your full name first', 'error');
  if (!raw) return authToast('Enter your phone number', 'error');
  if (!isValidPhone(raw)) return authToast('Enter a valid 10-digit phone number', 'error');

  const phone = normalizePhone(raw);
  const users = getUsers();
  const exists = Object.values(users).find(u => normalizePhone(u.phone || '') === phone);
  if (exists) return authToast('Phone already registered. Please login.', 'error');

  otpState.phone = phone;

  const btn = document.getElementById('signupSendOtpBtn');
  if (btn) { btn.textContent = '⏳ Sending…'; btn.disabled = true; }

  setTimeout(() => {
    const code = sendOTP(phone);
    if (btn) { btn.textContent = '✓ Sent'; }

    const section = document.getElementById('signupOtpSection');
    if (section) section.classList.add('visible');

    const demoHint = document.getElementById('signupOtpDemo');
    if (demoHint) { demoHint.textContent = `Demo OTP: ${code} (or use 000000)`; demoHint.classList.add('show'); }

    const phoneDisp = document.getElementById('signupPhoneDisplay');
    if (phoneDisp) phoneDisp.textContent = phone;

    startOTPTimer('signupOtpTimer', 'signupResendBtn');
    updateSteps('signupSteps', 1);
    authToast(`OTP sent to ${phone}`, 'success');

    const firstBox = document.querySelector('#signupOtpBoxes .otp-box');
    if (firstBox) firstBox.focus();
  }, 800);
}

/* ── RESEND OTP (SIGNUP) ── */
function signupResendOTP() {
  if (!otpState.phone) return;
  const code = sendOTP(otpState.phone);
  const demoHint = document.getElementById('signupOtpDemo');
  if (demoHint) { demoHint.textContent = `Demo OTP: ${code} (or use 000000)`; demoHint.classList.add('show'); }
  startOTPTimer('signupOtpTimer', 'signupResendBtn');
  authToast('New OTP sent!', 'success');
}

/* ── VERIFY OTP + SIGNUP ── */
function signupVerifyOTP(otp) {
  const first = (document.getElementById('signupFirst')?.value || '').trim();
  const last  = (document.getElementById('signupLast')?.value || '').trim();
  const email = (document.getElementById('signupEmail')?.value || '').trim().toLowerCase();
  const city  = (document.getElementById('signupCity')?.value || '').trim();
  const agree = document.getElementById('agreeTerms')?.checked;

  if (!agree) return authToast('Please accept the Terms of Service', 'error');
  if (!otpState.phone) return authToast('Please send OTP first', 'error');

  const btn = document.getElementById('signupVerifyBtn');
  if (btn) { btn.textContent = '⏳ Verifying…'; btn.disabled = true; }

  setTimeout(() => {
    if (btn) { btn.textContent = '✚ VERIFY & CREATE ACCOUNT'; btn.disabled = false; }

    if (!verifyOTP(otpState.phone, otp)) {
      authToast('Incorrect OTP. Try again.', 'error');
      clearOtpBoxes('signupOtpBoxes');
      const firstBox = document.querySelector('#signupOtpBoxes .otp-box');
      if (firstBox) firstBox.focus();
      return;
    }

    clearOTPTimer();

    const users = getUsers();
    if (email && users[email]) return authToast('Email already registered', 'error');

    const userKey = email || otpState.phone.replace(/\D/g, '');
    const user = {
      email: email || `${otpState.phone.replace(/\D/g,'')}@rescuenet.phone`,
      name: first + ' ' + last,
      phone: otpState.phone,
      city
    };
    users[userKey] = user;
    saveUsers(users);

    window.currentUser = { email: user.email, name: user.name, phone: user.phone };
    try { sessionStorage.setItem('rn_session', JSON.stringify(window.currentUser)); } catch(_) {}

    updateSteps('signupSteps', 2);
    authToast('✅ Account created!', 'success');
    setTimeout(enterApp, 700);
  }, 600);
}

/* ── FORGOT PASSWORD (via phone OTP) ── */
function forgotSendOTP() {
  const raw = (document.getElementById('forgotPhone')?.value || '').trim();
  if (!raw || !isValidPhone(raw)) return authToast('Enter a valid phone number', 'error');

  const phone = normalizePhone(raw);
  const users = getUsers();
  const found = Object.values(users).find(u => normalizePhone(u.phone || '') === phone);
  if (!found) return authToast('No account with this phone', 'error');

  otpState.phone = phone;

  const code = sendOTP(phone);
  const forgotOtpSection = document.getElementById('forgotOtpSection');
  if (forgotOtpSection) forgotOtpSection.classList.add('visible');

  const demoHint = document.getElementById('forgotOtpDemo');
  if (demoHint) { demoHint.textContent = `Demo OTP: ${code} (or use 000000)`; demoHint.classList.add('show'); }

  startOTPTimer('forgotOtpTimer', 'forgotResendBtn');
  authToast(`Reset OTP sent to ${phone}`, 'success');
}

/* ── DEMO LOGIN ── */
function demoLogin() {
  window.currentUser = { email: 'demo@rescuenet.in', name: 'Demo User', phone: '+91 98765 43210' };
  try { sessionStorage.setItem('rn_session', JSON.stringify(window.currentUser)); } catch(_) {}
  enterApp();
}

/* ── LOGOUT ── */
function doLogout() {
  if (!confirm('Sign out of RescueNet?')) return;
  try { localStorage.removeItem('rn_session'); sessionStorage.removeItem('rn_session'); } catch(_) {}
  window.currentUser = null;

  if (typeof crashDetectionActive !== 'undefined' && crashDetectionActive) {
    deactivateCrashDetection();
  }

  const appScreen  = document.getElementById('appScreen');
  const authScreen = document.getElementById('authScreen');
  if (appScreen)  appScreen.classList.add('hidden');
  if (authScreen) authScreen.classList.remove('hidden');

  resetOTPState('login');
  switchAuthTab('login');
  authToast('You have been signed out', 'info');
}

/* ── PASSWORD STRENGTH ── */
document.addEventListener('DOMContentLoaded', () => {
  // Init OTP boxes for login
  initOtpBoxes('loginOtpBoxes', (code) => {
    // auto-verify on complete
    setTimeout(() => loginVerifyOTP(code), 200);
  });

  // Init OTP boxes for signup
  initOtpBoxes('signupOtpBoxes', (code) => {
    setTimeout(() => signupVerifyOTP(code), 200);
  });

  // Tab buttons
  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab));
  });

  // Password strength for signup
  const passEl = document.getElementById('signupPass');
  if (passEl) {
    passEl.addEventListener('input', () => {
      const val = passEl.value;
      const el  = document.getElementById('passStrength');
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
});
