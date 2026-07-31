/* ==========================================================
   SignBridge — วิดีโอคอลไทย: ผู้หูหนวก ⇄ ผู้ได้ยิน
   ----------------------------------------------------------
   ส่วนที่ทำงานจริงแล้ว:
     • วิดีโอคอลข้ามอุปกรณ์ผ่าน Jitsi Meet (meet.jit.si, IFrame API)
     • เสียงพูดไทย → ข้อความ  ด้วย Web Speech API (th-TH)
     • ข้อความ → เสียงพูดไทย  ด้วย SpeechSynthesis (th-TH)
     • ส่งข้อความแปลข้ามอุปกรณ์ด้วย Jitsi endpoint text message
   ส่วนที่ยังเป็น placeholder:
     • ภาษามือ → ข้อความ  (ดู recognizeSignFromVideo() ท้ายไฟล์)
     • ข้อความ → อวาตาร์ภาษามือ (ตอนนี้เป็นอนิเมชันสัญลักษณ์)
   ========================================================== */

'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  jitsiContainer: $('jitsiContainer'),
  videoStageEmpty: $('videoStageEmpty'),
  videoExpandBtn: $('videoExpandBtn'),

  micBtn: $('micBtn'),
  micLabel: $('micLabel'),
  camBtn: $('camBtn'),
  camLabel: $('camLabel'),
  endBtn: $('endBtn'),

  statusDot: $('statusDot'),
  statusText: $('statusText'),
  callTimer: $('callTimer'),

  signToTextList: $('signToTextList'),
  signToTextOutput: $('signToTextOutput'),
  signAvatar: $('signAvatar'),
  signVideo: $('signVideo'),
  signCaption: $('signCaption'),
  signInterim: $('signInterim'),
  sttBadge: $('sttBadge'),
  ttsBadge: $('ttsBadge'),

  signInputPanel: $('signInputPanel'),
  signCamToggleBtn: $('signCamToggleBtn'),
  signInputBody: $('signInputBody'),
  signHandBadge: $('signHandBadge'),
  signTabRecognize: $('signTabRecognize'),
  signTabTrain: $('signTabTrain'),
  signRecognizeMode: $('signRecognizeMode'),
  signTrainMode: $('signTrainMode'),
  signRecognizeBtn: $('signRecognizeBtn'),
  signRecognizeResult: $('signRecognizeResult'),
  signRankList: $('signRankList'),
  signSpeakLocal: $('signSpeakLocal'),
  signTrainLabel: $('signTrainLabel'),
  signTrainBtn: $('signTrainBtn'),
  signTrainedList: $('signTrainedList'),
  signStrictness: $('signStrictness'),
  signStrictnessVal: $('signStrictnessVal'),
  signExportBtn: $('signExportBtn'),
  signImportBtn: $('signImportBtn'),
  signImportFile: $('signImportFile'),

  bridgeBars: $('bridgeBars'),
  roomInput: $('roomInput'),
  roleSelect: $('roleSelect'),
  joinBtn: $('joinBtn'),
  leaveBtn: $('leaveBtn'),

  composer: $('composer'),
  composerLabel: $('composerLabel'),
  composerInput: $('composerInput'),
  composerSend: $('composerSend'),

  toastStack: $('toastStack'),
};

/* ---------- state ---------- */
let jitsiApi = null;           // JitsiMeetExternalAPI instance
let localRole = 'hearing';     // บทบาทของ "อุปกรณ์นี้"
let inCall = false;
let micOn = true;
let camOn = true;
let callSeconds = 0;
let timerHandle = null;
let avatarHandle = null;
let joinTimeoutHandle = null;

let recognition = null;       // Web Speech API
let recognitionWanted = false;
let sttEngine = null;         // 'webspeech' | 'vosk' | null — engine ที่กำลังทำงานอยู่จริง

// Vosk (ทางสำรองบนมือถือ — Web Speech ของ Chrome ชนไมค์กับ Jitsi บน Android
// ดู r.onerror ด้านล่าง: พอ Web Speech error จะสลับมาทางนี้อัตโนมัติ)
const VOSK_CDN_URL = 'https://unpkg.com/vosk-browser@0.0.8/dist/vosk.js';
const VOSK_MODEL_URL = 'https://github.com/Maxham5649/sing/releases/download/1.0.0/vosk-model.zip';
let voskModel = null;
let voskLoadingPromise = null;
let voskRecognizer = null;
let voskAudioContext = null;
let voskSourceNode = null;
let voskProcessorNode = null;
let voskGainNode = null;
let voskMediaStream = null;
let voskFallbackPending = false; // true ระหว่างกำลังสลับมา Vosk (กันโหลดซ้ำ/restart Web Speech ซ้ำ)

/* ==========================================================
   UI helpers
   ========================================================== */

function toast(message, kind = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  els.toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

function setStatus(text, connected) {
  els.statusText.textContent = text;
  els.statusDot.style.background = connected ? 'var(--success)' : 'var(--danger)';
}

function buildBridgeBars(count = 7) {
  for (let i = 0; i < count; i++) {
    const bar = document.createElement('span');
    bar.style.animationDelay = `${i * 0.09}s`;
    els.bridgeBars.appendChild(bar);
  }
}

function roleLabel(role) {
  return role === 'hearing' ? 'ผู้ได้ยิน' : 'ผู้หูหนวก';
}

function timeLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ==========================================================
   แสดงข้อความแปล
   dir = 'speech' → เสียงพูดจากฝั่งได้ยิน แสดงในกล่องภาษามือ (ขวา)
   dir = 'sign'   → ภาษามือจากฝั่งหูหนวก แสดงในกล่องคำแปล (ซ้าย)
   ========================================================== */

function renderSignToText(text) {
  if (els.signToTextOutput && els.signToTextOutput.isConnected) els.signToTextOutput.remove();
  const li = document.createElement('li');
  li.className = 'msg';
  const t = document.createElement('span');
  t.className = 'msg-time';
  t.textContent = timeLabel();
  const b = document.createElement('span');
  b.className = 'msg-text';
  b.textContent = text;
  li.append(t, b);
  els.signToTextList.appendChild(li);
  els.signToTextList.scrollTop = els.signToTextList.scrollHeight;
}

/* ==========================================================
   จับคู่ข้อความที่ถอดเสียงมากับคลังคำศัพท์ภาษามือ (signVocab.js)
   ลอง exact substring ก่อนเสมอ (เร็ว/แม่นสุด) ไม่เจอค่อย fuzzy
   (ทนคำสะกด/ถอดเสียงเพี้ยนเล็กน้อย — ไม่ใช่เข้าใจ "ความหมาย" จริง
   แค่ทนตัวอักษรคลาดเคลื่อนได้บ้าง) คืนลิสต์ที่ตรง เรียงตามตำแหน่ง
   ========================================================== */

function normalizeThai(s) {
  return (s || '')
    .replace(/[ัิ-ฺ็-๎]/g, '') // ตัดวรรณยุกต์/สระบน-ล่าง/การันต์
    .replace(/\s+/g, '')
    .toLowerCase();
}

function levenshtein(a, b) {
  const dp = [];
  for (let i = 0; i <= a.length; i++) dp.push([i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// คืนตำแหน่งที่เจอ (ประมาณ ๆ หลัง normalize) หรือ -1 ถ้าไม่เจอแม้แบบหลวม
function fuzzyFind(haystack, needle, maxErrorRatio = 0.25) {
  const h = normalizeThai(haystack);
  const n = normalizeThai(needle);
  if (!n) return -1;
  const exactIdx = h.indexOf(n);
  if (exactIdx !== -1) return exactIdx;
  // คำสั้นกว่านี้ (หลังตัดสระ/วรรณยุกต์) ยอมให้ fuzzy ไม่ได้เลย — ผิดแค่
  // 1 ตัวอักษรของคำ 2-3 ตัวคือคลาดเคลื่อน 30-50% เจอ false positive ง่ายมาก
  // (เจอจริงตอนเทส: "หิว" ไปจับกับประโยคที่ไม่เกี่ยวข้องเลย)
  if (n.length < 4) return -1;
  const maxErr = Math.max(1, Math.floor(n.length * maxErrorRatio));
  for (let i = 0; i <= h.length - 1; i++) {
    for (let len = Math.max(1, n.length - maxErr); len <= n.length + maxErr && i + len <= h.length; len++) {
      if (levenshtein(h.substr(i, len), n) <= maxErr) return i;
    }
  }
  return -1;
}

function matchSignVocab(text) {
  if (!text || typeof SIGN_VOCAB === 'undefined') return [];
  const found = [];
  for (const entry of SIGN_VOCAB) {
    let bestIndex = -1;
    let bestLen = 0;
    for (const phrase of entry.match) {
      const idx = fuzzyFind(text, phrase);
      const len = normalizeThai(phrase).length;
      // ตำแหน่งก่อนกว่าชนะเสมอ ถ้าตำแหน่งเท่ากัน (คำหนึ่งซ้อนอยู่ในอีก
      // คำ เช่น "สบายดี" อยู่ใน "สบายดีไหม") เอาคำที่ยาว/เฉพาะเจาะจง
      // กว่าชนะแทน ไม่งั้นจะเจอ 2 คำแมตช์พร้อมกันที่จุดเดียว
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && len > bestLen))) {
        bestIndex = idx;
        bestLen = len;
      }
    }
    if (bestIndex !== -1) found.push({ entry, index: bestIndex, len: bestLen });
  }
  found.sort((a, b) => a.index - b.index || b.len - a.len);

  // กันคำที่ตำแหน่งซ้อนทับกับคำที่เลือกไปแล้ว (เช่นพูด "สบายดีไหม" แล้ว
  // ทั้ง how-are-you กับ im-fine แมตช์ทับกัน) เอาแค่ตัวที่กว้าง/ก่อนสุด
  const deduped = [];
  let lastEnd = -1;
  for (const f of found) {
    if (f.index < lastEnd) continue;
    deduped.push(f);
    lastEnd = f.index + f.len;
  }
  return deduped.map((f) => f.entry);
}

let signVideoQueue = [];
let signVideoLoadPromise = null; // cache: โหลด SIGN_VIDEO_SRC ครั้งเดียวพอ ไม่ต้องโหลดซ้ำทุกคำ
let signVideoPlaying = false; // true ระหว่างกำลังเล่นคลิปช่วงใดช่วงหนึ่งอยู่จริง

function showSignAvatarFallback() {
  signVideoPlaying = false;
  els.signVideo.pause();
  els.signVideo.hidden = true;
  els.signAvatar.hidden = false;
  els.signAvatar.classList.add('is-playing');
  clearTimeout(avatarHandle);
  avatarHandle = setTimeout(() => els.signAvatar.classList.remove('is-playing'), 2400);
}

// ลองโหลดคลิปรวมจาก url เดียว — resolve เมื่อได้ metadata, reject ถ้าโหลดไม่ขึ้น
function tryLoadSignVideoFrom(url) {
  return new Promise((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(url); };
    const onError = () => { cleanup(); reject(new Error('โหลด ' + url + ' ไม่สำเร็จ')); };
    const cleanup = () => {
      els.signVideo.removeEventListener('loadedmetadata', onReady);
      els.signVideo.removeEventListener('error', onError);
    };
    els.signVideo.addEventListener('loadedmetadata', onReady, { once: true });
    els.signVideo.addEventListener('error', onError, { once: true });
    els.signVideo.src = url;
  });
}

// โหลดไฟล์วิดีโอรวมครั้งเดียว แคชผล ไม่ว่าจะเรียกซ้ำกี่ครั้งก็ไม่โหลดไฟล์ซ้ำ
// ลองไฟล์ในเครื่องก่อน (signs/1.mp4 ตอน dev) ถ้าไม่มีค่อยตกไป GitHub Release
// (ดู SIGN_VIDEO_FALLBACK_SRC ใน signVocab.js) — ถ้าไม่ได้ทั้งคู่ promise จะ
// reject ให้ผู้เรียก fallback ไปอวาตาร์เอง
function loadSignVideoSrc() {
  if (signVideoLoadPromise) return signVideoLoadPromise;
  signVideoLoadPromise = tryLoadSignVideoFrom(SIGN_VIDEO_SRC)
    .catch(() => tryLoadSignVideoFrom(SIGN_VIDEO_FALLBACK_SRC))
    .catch((err) => {
      signVideoLoadPromise = null; // โหลดพังรอบนี้ อนุญาตให้ลองใหม่รอบหน้า (เผื่อไฟล์มาทีหลัง)
      throw err;
    });
  return signVideoLoadPromise;
}

// เล่นท่าคำถัดไปในคิวจากคลิปรวมไฟล์เดียว: seek ไป start แล้วเล่นจน end
// แล้วหยุด ต่อคำถัดไปในคิวเอง — ไม่มีไฟล์จริงหรือโหลดพัง ก็ fallback อวาตาร์
async function playNextSignVideo() {
  const next = signVideoQueue.shift();
  if (!next) {
    signVideoPlaying = false;
    showSignAvatarFallback();
    return;
  }
  signVideoPlaying = true;

  try {
    await loadSignVideoSrc();
  } catch (err) {
    signVideoQueue = [];
    signVideoPlaying = false;
    showSignAvatarFallback();
    return;
  }

  els.signAvatar.hidden = true;
  els.signAvatar.classList.remove('is-playing');
  els.signVideo.hidden = false;

  let advanced = false;
  const onTimeUpdate = () => {
    if (els.signVideo.currentTime >= next.end) {
      els.signVideo.pause();
      advanceOnce();
    }
  };
  const advanceOnce = () => {
    if (advanced) return;
    advanced = true;
    els.signVideo.removeEventListener('timeupdate', onTimeUpdate);
    playNextSignVideo();
  };

  els.signVideo.addEventListener('timeupdate', onTimeUpdate);
  els.signVideo.currentTime = next.start;
  els.signVideo.play().catch(advanceOnce);
}

function playSignAvatar(text) {
  els.signCaption.textContent = text;
  clearTimeout(avatarHandle);

  const matches = matchSignVocab(text);
  if (matches.length === 0) {
    // ไม่มีคำที่รู้จักในประโยคนี้ — ถ้ากำลังเล่น/มีคิวค้างจากประโยคก่อน
    // อยู่ ปล่อยให้เล่นจบตามปกติ ไม่ตัดทิ้งกลางคัน
    if (!signVideoPlaying && signVideoQueue.length === 0) {
      showSignAvatarFallback();
    }
    return;
  }

  // ต่อคำใหม่ท้ายคิวเดิม แทนที่จะล้างคิวทิ้งแล้วเริ่มใหม่ — กันไม่ให้
  // ตัดคลิปที่กำลังเล่นค้างอยู่ตอนพูดประโยคถัดไปแทรกเข้ามาก่อนท่าเดิมจบ
  signVideoQueue = signVideoQueue.concat(matches);
  if (!signVideoPlaying) {
    playNextSignVideo();
  }
}

function deliver(dir, text) {
  if (!text) return;
  if (dir === 'speech') {
    playSignAvatar(text);
    return;
  }
  renderSignToText(text);

  // อ่านออกเสียงทั้งสองฝั่ง:
  // - ฝั่งผู้ได้ยิน อ่านเสมอ เพราะเป็นปลายทางของคำแปล
  // - ฝั่งผู้หูหนวก อ่านด้วยถ้าเปิดสวิตช์ไว้ — ให้คนที่ยืนอยู่ข้าง ๆ
  //   ได้ยินท่าที่เพิ่งทำ โดยไม่ต้องมีสายเลย
  const speakHere = localRole === 'hearing' || (els.signSpeakLocal && els.signSpeakLocal.checked);
  if (speakHere) speakThai(text);
}

function broadcast(dir, text) {
  deliver(dir, text);
  if (jitsiApi && inCall) {
    try {
      jitsiApi.executeCommand('sendEndpointTextMessage', '', JSON.stringify({ k: 'sb', dir, text }));
    } catch (err) {
      console.error('sendEndpointTextMessage failed:', err);
    }
  }
}

/* ==========================================================
   เสียงพูดไทย → ข้อความ  (Web Speech API)
   ========================================================== */

function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast('เบราว์เซอร์นี้ยังไม่รองรับการถอดเสียงพูด ใช้ช่องพิมพ์แทนได้', 'warn', 6000);
    return null;
  }
  const r = new SR();
  r.lang = 'th-TH';
  r.continuous = true;
  r.interimResults = true;

  r.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0].transcript.trim();
      if (res.isFinal) {
        if (text) broadcast('speech', text);
      } else {
        interim += text;
      }
    }
    els.signInterim.textContent = interim;
  };

  r.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      recognitionWanted = false;
      els.sttBadge.hidden = true;
      toast('ไม่ได้รับสิทธิ์ใช้ไมค์สำหรับถอดเสียง ใช้ช่องพิมพ์แทนได้', 'warn', 6000);
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      // เคสอื่น ๆ (เช่น audio-capture — ไมค์ชนกับ WebRTC ของ Jitsi บนมือถือ
      // Android ที่เจอจริง) — สลับไปใช้ Vosk (รันในเบราว์เซอร์เอง ไม่ผ่าน
      // service ของ Google ที่โดนบล็อก) แทนอัตโนมัติ
      console.warn('speech recognition error:', event.error);
      if (recognitionWanted && inCall && sttEngine !== 'vosk' && !voskFallbackPending) {
        toast(`Web Speech ใช้ไม่ได้ (${event.error}) กำลังสลับไปใช้ระบบสำรอง...`, 'warn', 5000);
        startListeningVosk();
      }
    }
  };

  r.onend = () => {
    els.signInterim.textContent = '';
    if (sttEngine === 'vosk' || voskFallbackPending) return; // กำลัง/สลับไป Vosk แล้ว ไม่ต้อง restart Web Speech
    if (recognitionWanted && inCall) {
      try { r.start(); } catch (_) { /* ยังไม่หยุดสนิท ข้ามรอบนี้ */ }
    } else {
      els.sttBadge.hidden = true;
    }
  };

  return r;
}

function startListening() {
  if (localRole !== 'hearing') return;
  if (sttEngine === 'vosk') { startListeningVosk(); return; } // เคย fallback แล้ว ใช้ต่อเลย
  if (!recognition) recognition = initSpeechRecognition();
  if (!recognition) return;
  recognitionWanted = true;
  try {
    recognition.start();
    sttEngine = 'webspeech';
    els.sttBadge.hidden = false;
  } catch (err) {
    // InvalidStateError = กำลังทำงานอยู่แล้ว เป็นเคสปกติ เงียบได้
    // อย่างอื่น (เช่นมือถือบล็อกเพราะไม่ได้เรียกจาก user gesture ตรง ๆ)
    // ต้องเห็น ไม่งั้นจะดูเหมือน "ไม่มีอะไรเกิดขึ้นเลย" แบบเงียบสนิท
    if (err && err.name !== 'InvalidStateError') {
      console.error('recognition.start() failed:', err);
      toast(`เริ่มถอดเสียงพูดไม่สำเร็จ (${err.name || err}) ใช้ช่องพิมพ์แทนได้`, 'warn', 6000);
    }
  }
}

function stopListening() {
  recognitionWanted = false;
  voskFallbackPending = false;
  els.sttBadge.hidden = true;
  els.signInterim.textContent = '';
  if (recognition) { try { recognition.stop(); } catch (_) {} }
  stopListeningVosk();
  sttEngine = null;
}

/* ==========================================================
   เสียงพูดไทย → ข้อความ  ทางสำรอง (Vosk, รันในเบราว์เซอร์เอง)
   ใช้ตอน Web Speech API ของ Chrome ใช้ไม่ได้ (ชนไมค์กับ Jitsi บนมือถือ)
   ========================================================== */

function loadVoskLibrary() {
  if (window.Vosk) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = VOSK_CDN_URL;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('โหลด vosk-browser ไม่สำเร็จ'));
    document.head.appendChild(s);
  });
}

function ensureVoskModel() {
  if (voskModel) return Promise.resolve(voskModel);
  if (!voskLoadingPromise) {
    voskLoadingPromise = (async () => {
      await loadVoskLibrary();
      voskModel = await window.Vosk.createModel(VOSK_MODEL_URL);
      return voskModel;
    })().catch((err) => {
      voskLoadingPromise = null; // โหลดพังรอบนี้ อนุญาตให้ลองใหม่รอบหน้า
      throw err;
    });
  }
  return voskLoadingPromise;
}

async function startListeningVosk() {
  if (localRole !== 'hearing') return;
  if (sttEngine === 'vosk' && voskRecognizer) return; // ทำงานอยู่แล้ว
  if (voskFallbackPending) return; // กำลังโหลด/สลับอยู่แล้วจากรอบก่อนหน้า
  recognitionWanted = true;
  voskFallbackPending = true;
  els.sttBadge.hidden = true; // ยังไม่พร้อมฟังจริงจนกว่าจะโหลด/เปิดไมค์เสร็จ
  try {
    toast('กำลังโหลดระบบถอดเสียงสำรอง (~84MB อาจใช้เวลาสักครู่บนมือถือ)', 'info', 6000);
    await ensureVoskModel();
    if (!recognitionWanted || !inCall) return; // ผู้ใช้ปิดไมค์/วางสายระหว่างโหลด

    voskMediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });
    if (!recognitionWanted || !inCall) {
      voskMediaStream.getTracks().forEach((t) => t.stop());
      voskMediaStream = null;
      return;
    }

    voskRecognizer = new voskModel.KaldiRecognizer(16000);
    voskRecognizer.on('result', (message) => {
      const text = ((message.result && message.result.text) || '').trim();
      if (text) broadcast('speech', text);
    });
    voskRecognizer.on('partialresult', (message) => {
      els.signInterim.textContent = (message.result && message.result.partial) || '';
    });

    voskAudioContext = new AudioContext();
    voskSourceNode = voskAudioContext.createMediaStreamSource(voskMediaStream);
    voskProcessorNode = voskAudioContext.createScriptProcessor(4096, 1, 1);
    voskProcessorNode.onaudioprocess = (event) => {
      try { voskRecognizer.acceptWaveform(event.inputBuffer); } catch (_) {}
    };
    // ScriptProcessorNode ต้องต่อไปถึง destination ไม่งั้น onaudioprocess จะไม่ยิง
    // แต่ไม่อยากให้เสียงไมค์ดิบสะท้อนออกลำโพงเครื่องตัวเอง เลยพ่วงผ่าน
    // GainNode ที่ปิดเสียงสนิท (gain 0) แทนต่อตรง
    voskGainNode = voskAudioContext.createGain();
    voskGainNode.gain.value = 0;
    voskSourceNode.connect(voskProcessorNode);
    voskProcessorNode.connect(voskGainNode);
    voskGainNode.connect(voskAudioContext.destination);

    sttEngine = 'vosk';
    els.sttBadge.hidden = false;
  } catch (err) {
    console.error('Vosk fallback failed:', err);
    toast(`ระบบถอดเสียงสำรองใช้ไม่ได้ (${(err && err.message) || err}) ใช้ช่องพิมพ์แทนได้`, 'error', 7000);
    stopListeningVosk();
  } finally {
    voskFallbackPending = false;
  }
}

function stopListeningVosk() {
  if (voskProcessorNode) {
    voskProcessorNode.onaudioprocess = null;
    try { voskProcessorNode.disconnect(); } catch (_) {}
    voskProcessorNode = null;
  }
  if (voskGainNode) { try { voskGainNode.disconnect(); } catch (_) {} voskGainNode = null; }
  if (voskSourceNode) { try { voskSourceNode.disconnect(); } catch (_) {} voskSourceNode = null; }
  if (voskAudioContext) { try { voskAudioContext.close(); } catch (_) {} voskAudioContext = null; }
  if (voskMediaStream) { voskMediaStream.getTracks().forEach((t) => t.stop()); voskMediaStream = null; }
  if (voskRecognizer) { try { voskRecognizer.remove(); } catch (_) {} voskRecognizer = null; }
  if (sttEngine === 'vosk') sttEngine = null;
}

/* ==========================================================
   ข้อความ → เสียงพูดไทย  (SpeechSynthesis)
   ========================================================== */

function speakThai(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH';
  u.rate = 1;
  const thaiVoice = speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('th'));
  if (thaiVoice) u.voice = thaiVoice;
  els.ttsBadge.hidden = false;
  u.onend = () => { els.ttsBadge.hidden = true; };
  u.onerror = () => { els.ttsBadge.hidden = true; };
  speechSynthesis.speak(u);
}

/* ==========================================================
   Jitsi event handlers
   ========================================================== */

function handleJoinedMeeting() {
  inCall = true;
  clearTimeout(joinTimeoutHandle);
  setStatus('เชื่อมต่อสำเร็จ', true);
  startTimer();

  els.micBtn.disabled = false;
  els.camBtn.disabled = false;
  els.endBtn.disabled = false;
  els.leaveBtn.disabled = false;
  els.joinBtn.disabled = true;
  els.roomInput.disabled = true;
  els.roleSelect.disabled = true;

  els.composer.hidden = false;
  els.composerInput.disabled = false;
  els.composerSend.disabled = false;
  els.composerLabel.textContent = localRole === 'deaf'
    ? 'พิมพ์แทนภาษามือ — อีกฝั่งจะได้ยินเป็นเสียงพูด'
    : 'พิมพ์แทนพูด — อีกฝั่งจะเห็นเป็นภาษามือ';

  if (localRole === 'hearing') {
    startListening();
  } else {
    els.signCaption.textContent = 'รอเสียงพูดจากฝั่งผู้ได้ยิน';
  }

  // จดจำท่าภาษามือจากกล้อง (Phase 2) — เฉพาะฝั่งหูหนวกเท่านั้นที่ทำท่าใส่กล้องได้
  syncSignPanelVisibility();
  if (localRole === 'deaf') renderTrainedList();

  toast('เข้าร่วมห้องแล้ว', 'ok');
}

function handleLeftMeeting() {
  inCall = false;
  stopListening();
  if ('speechSynthesis' in window) speechSynthesis.cancel();

  setStatus('วางสายแล้ว', false);
  clearInterval(timerHandle);
  clearTimeout(avatarHandle);
  clearTimeout(joinTimeoutHandle);

  els.videoStageEmpty.hidden = false;

  els.signCaption.textContent = 'สายสิ้นสุดแล้ว';
  els.signInterim.textContent = '';
  signVideoQueue = [];
  signVideoPlaying = false;
  els.signVideo.pause();
  els.signVideo.hidden = true;
  // ไม่ removeAttribute('src') อีกต่อไป — SIGN_VIDEO_SRC เป็นไฟล์เดียว
  // แคชไว้ใช้ข้ามคอลได้ ไม่ต้องโหลดซ้ำทุกครั้งที่เข้าห้องใหม่
  els.signAvatar.hidden = false;
  els.signAvatar.classList.remove('is-playing');

  els.micBtn.disabled = true;
  els.camBtn.disabled = true;
  els.endBtn.disabled = true;
  els.leaveBtn.disabled = true;
  els.joinBtn.disabled = false;
  els.roomInput.disabled = false;
  els.roleSelect.disabled = false;

  els.composerInput.disabled = true;
  els.composerSend.disabled = true;

  document.body.classList.remove('video-expanded');
  els.videoExpandBtn.setAttribute('aria-pressed', 'false');
  els.videoExpandBtn.textContent = '⤢';
  els.videoExpandBtn.setAttribute('aria-label', 'ขยายวิดีโอให้ใหญ่ขึ้น');

  // จดจำท่าภาษามือ (Phase 2) — ปิดกล้องแยกด้วย ไม่ปล่อยค้างหลังวางสาย
  stopSignCamera();
  els.signInputBody.hidden = true;
  els.signCamToggleBtn.textContent = 'เปิดกล้อง';
  els.signCamToggleBtn.setAttribute('aria-pressed', 'false');
  syncSignPanelVisibility(); // ยังโชว์ต่อได้ถ้าบทบาทที่เลือกไว้คือผู้หูหนวก

  destroyJitsi();
}

function handleAudioMuteStatusChanged(ev) {
  micOn = !ev.muted;
  els.micBtn.setAttribute('aria-pressed', String(micOn));
  els.micLabel.textContent = micOn ? 'ปิดไมค์' : 'เปิดไมค์';
  if (localRole === 'hearing') {
    if (micOn && inCall) startListening(); else stopListening();
  }
}

function handleVideoMuteStatusChanged(ev) {
  camOn = !ev.muted;
  els.camBtn.setAttribute('aria-pressed', String(camOn));
  els.camLabel.textContent = camOn ? 'ปิดกล้อง' : 'เปิดกล้อง';
}

function handleEndpointTextMessage(ev) {
  try {
    const raw = ev && ev.eventData && ev.eventData.text;
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || d.k !== 'sb') return;
    deliver(d.dir, d.text);
  } catch (err) {
    console.warn('bad endpoint text message:', err);
  }
}

function resetJoinControls() {
  els.joinBtn.disabled = false;
  els.roomInput.disabled = false;
  els.roleSelect.disabled = false;
  els.leaveBtn.disabled = true;
}

/* ==========================================================
   ชื่อห้อง: รับได้ทั้งชื่อห้องเปล่า ๆ หรือลิงก์ meet.jit.si
   ========================================================== */

function parseRoomName(raw) {
  let s = (raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s) && /jit\.si\//i.test(s)) {
    s = 'https://' + s.replace(/^\/+/, '');
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : '';
    } catch (_) {
      /* ไม่ใช่ URL ที่ parse ได้ ใช้ข้อความเดิมเป็นชื่อห้องแทน */
    }
  }
  return s.replace(/^\/+|\/+$/g, '');
}

function sanitizeRoomName(name) {
  return name.replace(/\s+/g, '-');
}

function isValidRoomName(name) {
  return !!name && name.length <= 100;
}

/* ==========================================================
   เข้าร่วม / ออกจากห้อง
   ========================================================== */

function joinRoom(rawInput, role) {
  const roomName = sanitizeRoomName(parseRoomName(rawInput));

  if (!isValidRoomName(roomName)) {
    setStatus('ยังไม่ได้ใส่ชื่อห้อง', false);
    toast('พิมพ์ชื่อห้อง หรือวางลิงก์ meet.jit.si ก่อน', 'warn');
    els.roomInput.focus();
    return;
  }
  if (typeof window.JitsiMeetExternalAPI === 'undefined') {
    setStatus('โหลด Jitsi SDK ไม่สำเร็จ', false);
    toast('โหลด Jitsi Meet SDK ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรช', 'error', 7000);
    return;
  }
  if (!window.isSecureContext) {
    toast('ต้องเปิดผ่าน https หรือ localhost เท่านั้น กล้อง/ไมค์จึงจะทำงาน', 'error', 8000);
    return;
  }

  localRole = role;
  micOn = true;
  camOn = true;
  els.micBtn.setAttribute('aria-pressed', 'true');
  els.camBtn.setAttribute('aria-pressed', 'true');
  els.micLabel.textContent = 'ปิดไมค์';
  els.camLabel.textContent = 'ปิดกล้อง';

  setStatus('กำลังเชื่อมต่อ…', false);
  els.joinBtn.disabled = true;

  try {
    jitsiApi = new window.JitsiMeetExternalAPI('meet.jit.si', {
      roomName,
      parentNode: els.jitsiContainer,
      width: '100%',
      height: '100%',
      userInfo: { displayName: `${roleLabel(role)} · SignBridge` },
      configOverwrite: {
        p2p: { enabled: false }, // ต้องปิด P2P ไม่งั้น sendEndpointTextMessage จะส่งไม่ถึงตอนคุยกัน 2 คน
        disableDeepLinking: true,
        // หมายเหตุ: เคยลองบังคับปิดหน้า prejoin ("Join meeting") ของ Jitsi
        // แต่บน meet.jit.si สาธารณะทำให้ conference join พังด้วย
        // "connectionError.membersOnly" (เข้าไม่ได้เพราะติด lobby) — ปล่อยให้
        // แสดงหน้า prejoin ตามปกติแล้วให้ผู้ใช้กด "Join meeting" อีกครั้งจะเสถียรกว่า
      },
    });
  } catch (err) {
    console.error(err);
    toast('สร้างห้องวิดีโอไม่สำเร็จ ลองรีเฟรชหน้า', 'error');
    resetJoinControls();
    return;
  }

  els.videoStageEmpty.hidden = true;

  jitsiApi.addEventListener('videoConferenceJoined', handleJoinedMeeting);
  jitsiApi.addEventListener('videoConferenceLeft', handleLeftMeeting);
  jitsiApi.addEventListener('readyToClose', destroyJitsi);
  jitsiApi.addEventListener('audioMuteStatusChanged', handleAudioMuteStatusChanged);
  jitsiApi.addEventListener('videoMuteStatusChanged', handleVideoMuteStatusChanged);
  jitsiApi.addEventListener('endpointTextMessageReceived', handleEndpointTextMessage);

  clearTimeout(joinTimeoutHandle);
  joinTimeoutHandle = setTimeout(() => {
    if (!inCall) {
      console.warn('Jitsi join timed out');
      setStatus('เข้าร่วมห้องไม่สำเร็จ', false);
      toast('เข้าร่วมห้องไม่สำเร็จ — ตรวจสอบชื่อห้องและอินเทอร์เน็ต', 'error', 7000);
      destroyJitsi();
      resetJoinControls();
    }
  }, 20000);
}

function destroyJitsi() {
  if (!jitsiApi) return;
  try { jitsiApi.dispose(); } catch (_) {}
  jitsiApi = null;
}

function leaveRoom() {
  if (!jitsiApi) return;
  els.leaveBtn.disabled = true;
  els.endBtn.disabled = true;
  try { jitsiApi.executeCommand('hangup'); } catch (err) { console.error(err); }
  // handleLeftMeeting() จะทำงานจาก event 'videoConferenceLeft' — กันไว้เผื่อ event ไม่มาถึง
  setTimeout(() => { if (jitsiApi) handleLeftMeeting(); }, 4000);
}

/* ==========================================================
   ปุ่มต่าง ๆ
   ========================================================== */

els.joinBtn.addEventListener('click', () => {
  joinRoom(els.roomInput.value.trim(), els.roleSelect.value);
});

els.roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !els.joinBtn.disabled) els.joinBtn.click();
});

els.leaveBtn.addEventListener('click', leaveRoom);
els.endBtn.addEventListener('click', leaveRoom);

els.micBtn.addEventListener('click', () => {
  if (!jitsiApi) return;
  jitsiApi.executeCommand('toggleAudio');
  // เรียก start/stopListening() ตรงจาก click handler นี้ (user gesture จริง)
  // เป็นอีกเส้นทางเสริมจาก handleAudioMuteStatusChanged — เบราว์เซอร์มือถือ
  // บางตัวบล็อก SpeechRecognition.start() ถ้าไม่ได้เรียกจาก user gesture
  // โดยตรง (event จาก postMessage ของ Jitsi ไม่นับ) เรียกซ้ำสองทางไม่พัง
  // เพราะ startListening()/stopListening() ทนต่อการเรียกซ้ำอยู่แล้ว
  if (localRole === 'hearing') {
    if (micOn) stopListening(); else startListening();
  }
});

els.camBtn.addEventListener('click', () => {
  if (!jitsiApi) return;
  jitsiApi.executeCommand('toggleVideo');
});

// โหมดขยายวิดีโอ (มือถือเท่านั้น — ปุ่มนี้ถูกซ่อนด้วย CSS บนจอเดสก์ท็อป)
els.videoExpandBtn.addEventListener('click', () => {
  const expanded = document.body.classList.toggle('video-expanded');
  els.videoExpandBtn.setAttribute('aria-pressed', String(expanded));
  els.videoExpandBtn.textContent = expanded ? '⤡' : '⤢';
  els.videoExpandBtn.setAttribute('aria-label', expanded ? 'ย่อวิดีโอกลับปกติ' : 'ขยายวิดีโอให้ใหญ่ขึ้น');
});

function sendComposed() {
  const text = els.composerInput.value.trim();
  if (!text) return;
  broadcast(localRole === 'deaf' ? 'sign' : 'speech', text);
  els.composerInput.value = '';
}

els.composerSend.addEventListener('click', sendComposed);
els.composerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendComposed(); }
});

/* ==========================================================
   จดจำท่าภาษามือจากกล้อง (Phase 2) — UI wiring
   ต่อกับ signRecognition.js (ensureSignCamera/stopSignCamera/
   loadHandLandmarker/startSignCapture/stopCapture/matchSignSequence/
   addSignReference/removeSignLabel/getTrainedLabelCounts)
   ========================================================== */

/* โชว์แผงจดจำท่าเมื่อบทบาทเป็น "ผู้หูหนวก" — ไม่ต้องรอเข้าห้องก่อน
   เพราะการฝึกท่าต้องทำล่วงหน้า และการอ่านออกเสียงที่เครื่องตัวเอง
   ก็ใช้ได้โดยไม่ต้องมีสาย */
function syncSignPanelVisibility() {
  const role = inCall ? localRole : els.roleSelect.value;
  els.signInputPanel.hidden = role !== 'deaf';
}

els.roleSelect.addEventListener('change', () => {
  syncSignPanelVisibility();
  if (els.roleSelect.value === 'deaf') renderTrainedList();
});

function renderTrainedList() {
  const items = getTrainedLabelCounts();
  els.signTrainedList.innerHTML = '';
  const thin = items.filter((i) => i.count < 2).length;
  els.signRecognizeResult.textContent = items.length === 0
    ? 'ยังไม่ได้ฝึกสอนท่าไหนเลย — ไปแท็บ "ฝึกสอน" ก่อน'
    : thin > 0
      ? `ฝึกไว้ ${items.length} คำ — มี ${thin} คำที่มีตัวอย่างเดียว ควรอัดเพิ่มให้ครบ 3-5 ครั้ง`
      : `ฝึกไว้แล้ว ${items.length} คำ — กดปุ่มด้านล่างแล้วทำท่า`;
  for (const { label, count } of items) {
    const li = document.createElement('li');
    li.className = 'sign-trained-item';
    const span = document.createElement('span');
    span.textContent = `${label} (${count} ตัวอย่าง)`;
    if (count < 2) span.classList.add('is-thin');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'ลบ';
    btn.addEventListener('click', () => {
      removeSignLabel(label);
      renderTrainedList();
    });
    li.append(span, btn);
    els.signTrainedList.appendChild(li);
  }
}

/* แสดงอันดับความใกล้เคียง — ที่ผ่านมาบอกแค่ "จับท่าไม่ได้" ซึ่งไม่พอ
   ให้ผู้ใช้รู้ว่าควรฝึกเพิ่ม หรือควรเปลี่ยนท่าให้ต่างจากคำอื่นมากขึ้น */
function renderRank(ranked, acceptedLabel) {
  els.signRankList.innerHTML = '';
  if (!ranked || ranked.length === 0) { els.signRankList.hidden = true; return; }
  for (const r of ranked.slice(0, 3)) {
    const li = document.createElement('li');
    li.className = 'sign-rank-item';
    if (r.label === acceptedLabel) li.classList.add('is-match');
    const name = document.createElement('span');
    name.textContent = r.label;
    const num = document.createElement('span');
    num.className = 'sign-rank-num';
    // ระยะ / รัศมีที่ยอมรับของคำนั้น — ต่ำกว่า 1.00 คือเข้าเกณฑ์
    num.textContent = `${r.distance.toFixed(2)} / ${r.radius.toFixed(2)}`;
    li.append(name, num);
    els.signRankList.appendChild(li);
  }
  els.signRankList.hidden = false;
}

els.signCamToggleBtn.addEventListener('click', async () => {
  const isOn = els.signCamToggleBtn.getAttribute('aria-pressed') === 'true';
  if (isOn) {
    stopSignCamera();
    els.signCamToggleBtn.textContent = 'เปิดกล้อง';
    els.signCamToggleBtn.setAttribute('aria-pressed', 'false');
    els.signInputBody.hidden = true;
    return;
  }
  els.signCamToggleBtn.disabled = true;
  els.signCamToggleBtn.textContent = 'กำลังเปิด…';
  try {
    await ensureSignCamera();
    await loadHandLandmarker(); // โหลดโมเดลรอไว้เลย กันหน่วงตอนกดปุ่มกด-ค้างครั้งแรก
    await startDetectionLoop(); // ให้ badge บอกสถานะ "เห็นมือไหม" ตั้งแต่ยังไม่กดปุ่ม
    els.signCamToggleBtn.textContent = 'ปิดกล้อง';
    els.signCamToggleBtn.setAttribute('aria-pressed', 'true');
    els.signInputBody.hidden = false;
    renderTrainedList();
  } catch (err) {
    console.error('เปิดกล้องจดจำท่าไม่สำเร็จ:', err);
    toast(`เปิดกล้องจดจำท่าไม่สำเร็จ (${(err && err.message) || err})`, 'error', 6000);
    els.signCamToggleBtn.textContent = 'เปิดกล้อง';
  } finally {
    els.signCamToggleBtn.disabled = false;
  }
});

function setSignInputMode(mode) {
  const isTrain = mode === 'train';
  els.signTabTrain.classList.toggle('is-active', isTrain);
  els.signTabRecognize.classList.toggle('is-active', !isTrain);
  els.signTrainMode.hidden = !isTrain;
  els.signRecognizeMode.hidden = isTrain;
}

els.signTabRecognize.addEventListener('click', () => setSignInputMode('recognize'));
els.signTabTrain.addEventListener('click', () => setSignInputMode('train'));

/* badge "เห็นมือไหม" — เดิม element นี้มีใน HTML แต่ไม่มีโค้ดอัปเดตเลย
   ผู้ใช้จึงไม่มีทางรู้ว่ากล้องเห็นมืออยู่หรือเปล่าตอนทำท่า */
setHandsCountListener((count) => {
  const badge = els.signHandBadge;
  if (!badge) return;
  badge.hidden = false;
  badge.textContent = count === 0 ? 'ไม่เจอมือ' : count === 1 ? 'เจอมือ 1 ข้าง' : 'เจอมือ 2 ข้าง';
  badge.classList.toggle('is-ok', count > 0);
});

/* สไลเดอร์ความเข้มงวด — เก็บเป็นจำนวนเต็ม 1..30 แล้วหาร 10 เป็น spreadK */
function applyStrictness(raw) {
  const k = Number(raw) / 10;
  setMatchConfig({ spreadK: k });
  els.signStrictnessVal.textContent = k.toFixed(1);
  try { localStorage.setItem('signbridge-strictness', String(raw)); } catch (_) { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
}
els.signStrictness.addEventListener('input', (e) => applyStrictness(e.target.value));
try {
  const saved = localStorage.getItem('signbridge-strictness');
  if (saved) els.signStrictness.value = saved;
} catch (_) { /* ไม่มีก็ใช้ค่า default ใน HTML */ }
applyStrictness(els.signStrictness.value);

/* ---------- ย้ายท่าที่ฝึกไว้ข้ามเครื่อง ---------- */
els.signExportBtn.addEventListener('click', () => {
  const items = getTrainedLabelCounts();
  if (items.length === 0) { toast('ยังไม่มีท่าให้บันทึก', 'warn'); return; }
  const blob = new Blob([exportReferences()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signbridge-signs-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`บันทึก ${items.length} คำเป็นไฟล์แล้ว`, 'ok');
});

els.signImportBtn.addEventListener('click', () => els.signImportFile.click());

els.signImportFile.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const { labels, samples } = importReferences(await file.text(), { merge: true });
    toast(`โหลดเข้ามา ${labels} คำ (${samples} ตัวอย่าง)`, 'ok', 5000);
    renderTrainedList();
  } catch (err) {
    toast(`โหลดไฟล์ไม่สำเร็จ: ${(err && err.message) || err}`, 'error', 6000);
  } finally {
    e.target.value = ''; // ให้เลือกไฟล์เดิมซ้ำได้
  }
});

// ปุ่มกด-ค้าง: เริ่มจับตอนกด หยุดตอนปล่อย (mouse + touch)
function bindHoldButton(btn, onStart, onEnd) {
  let holding = false;
  const start = (e) => {
    e.preventDefault();
    if (holding) return;
    holding = true;
    btn.classList.add('is-holding');
    onStart();
  };
  const end = () => {
    if (!holding) return;
    holding = false;
    btn.classList.remove('is-holding');
    onEnd();
  };
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('mouseup', end);
  btn.addEventListener('mouseleave', end);
  btn.addEventListener('touchend', end);
  btn.addEventListener('touchcancel', end);
}

// โหมดใช้งานจริง: กดค้างทำท่า → ปล่อย → จับคู่กับท่าที่ฝึกไว้ → broadcast('sign', ...)
const MIN_CAPTURE_FRAMES = 3; // สั้นกว่านี้ (~240ms) คือกดพลาด ไม่ใช่ท่าจริง

bindHoldButton(
  els.signRecognizeBtn,
  () => {
    els.signRecognizeResult.textContent = 'กำลังจับท่า...';
    els.signRankList.hidden = true;
    startSignCapture().catch((err) => {
      console.error('จับภาพท่าไม่สำเร็จ:', err);
      els.signRecognizeResult.textContent = `จับภาพไม่สำเร็จ (${(err && err.message) || err})`;
    });
  },
  () => {
    const seq = stopCapture();
    if (seq.length === 0) {
      els.signRecognizeResult.textContent = 'ไม่เห็นมือเลย — ขยับมือเข้ามาในกรอบให้เห็นชัด ๆ แล้วลองใหม่';
      return;
    }
    if (seq.length < MIN_CAPTURE_FRAMES) {
      els.signRecognizeResult.textContent = 'กดค้างสั้นไป — กดค้างไว้ตลอดจนทำท่าจบแล้วค่อยปล่อย';
      return;
    }

    const m = matchSignSequence(seq);
    renderRank(m.ranked, m.accepted ? m.label : null);

    if (m.accepted) {
      els.signRecognizeResult.textContent = `จับได้: "${m.label}" — ส่งแล้ว`;
      broadcast('sign', m.label);
      return;
    }

    // บอกเหตุผลให้ตรงจุด เพราะแต่ละกรณีผู้ใช้ต้องแก้คนละแบบ
    if (m.reason === 'no-training') {
      els.signRecognizeResult.textContent = 'ยังไม่ได้ฝึกท่าไหนเลย — ไปแท็บ "ฝึกสอน" ก่อน';
    } else if (m.reason === 'ambiguous') {
      els.signRecognizeResult.textContent =
        `ก้ำกึ่งระหว่าง "${m.best.label}" กับ "${m.runnerUp.label}" — สองท่านี้คล้ายกันเกินไป ` +
        'อัดตัวอย่างเพิ่มให้ต่างกันชัดขึ้น';
    } else {
      els.signRecognizeResult.textContent =
        `ไม่ตรงกับท่าไหนเลย (ใกล้สุดคือ "${m.best.label}") — ` +
        'ถ้าท่านี้ถูกแล้ว ให้อัดเพิ่มในแท็บ "ฝึกสอน" อีกสัก 2-3 ครั้ง';
    }
  }
);

// โหมดฝึกสอน: พิมพ์ชื่อคำ → กดค้างทำท่า → ปล่อย → บันทึกเป็นท่าอ้างอิง
bindHoldButton(
  els.signTrainBtn,
  () => {
    const label = els.signTrainLabel.value.trim();
    if (!label) {
      toast('พิมพ์ชื่อคำก่อนกดปุ่มอัดท่า', 'warn');
      return;
    }
    startSignCapture().catch((err) => {
      console.error('จับภาพท่าไม่สำเร็จ:', err);
      toast(`จับภาพไม่สำเร็จ (${(err && err.message) || err})`, 'error');
    });
  },
  () => {
    const label = els.signTrainLabel.value.trim();
    const seq = stopCapture();
    if (!label) return;
    if (seq.length === 0) {
      toast('ไม่เห็นมือเลย — ขยับมือเข้ามาในกรอบแล้วอัดใหม่', 'warn', 5000);
      return;
    }
    if (seq.length < MIN_CAPTURE_FRAMES) {
      toast('กดค้างสั้นไป — ตัวอย่างนี้ไม่ถูกบันทึก', 'warn', 5000);
      return;
    }
    const count = addSignReference(label, seq);
    toast(
      count < 3
        ? `บันทึกท่า "${label}" แล้ว (${count} ตัวอย่าง — ควรอัดให้ครบ 3-5 ครั้ง)`
        : `บันทึกท่า "${label}" แล้ว (${count} ตัวอย่าง)`,
      'ok'
    );
    renderTrainedList();
  }
);

window.addEventListener('beforeunload', () => { if (jitsiApi) jitsiApi.dispose(); });

/* ---------- ตัวจับเวลาสาย ---------- */
function startTimer() {
  clearInterval(timerHandle);
  callSeconds = 0;
  els.callTimer.textContent = '00:00';
  timerHandle = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    els.callTimer.textContent = `${m}:${s}`;
  }, 1000);
}

/* ==========================================================
   จุดต่อโมเดล AI จริง — ยังไม่ถูกเรียกใช้
   ----------------------------------------------------------
   แผนที่แนะนำ:
   1) ดึง landmark จาก <video> ของฝั่งหูหนวกด้วย MediaPipe Holistic
      (@mediapipe/tasks-vision) ทีละเฟรม เก็บเป็น sequence
   2) ส่ง sequence เข้าโมเดลที่เทรนไว้ (TF.js ในเบราว์เซอร์
      หรือยิงไป backend) → ได้ gloss ภาษามือ
   3) เรียบเรียง gloss เป็นประโยคไทย แล้วเรียก:
        broadcast('sign', ประโยคไทย)
      อีกฝั่งจะเห็นข้อความ + ได้ยินเสียงอ่านอัตโนมัติ

   ทิศกลับกัน (ข้อความ → ภาษามือ) ให้แทน playSignAvatar()
   ด้วยการเล่นคลิปหรือขยับอวาตาร์ 3D ตาม gloss ที่แมปไว้

   หมายเหตุ: Jitsi IFrame API ไม่ให้ raw MediaStreamTrack ของแต่ละฝั่ง
   ถ้าจะทำ sign→text จริงต้องดึงภาพจากกล้องฝั่งนี้เอง (ก่อนส่งเข้า Jitsi)
   ไม่ใช่จากวิดีโอใน iframe
   ========================================================== */
async function recognizeSignFromVideo(/* videoEl */) {
  throw new Error('ยังไม่ได้ต่อโมเดลรู้จำภาษามือ');
}
void recognizeSignFromVideo;

/* ---------- เริ่มทำงาน ---------- */
buildBridgeBars();
setStatus('ยังไม่เชื่อมต่อ', false);

if (!window.isSecureContext) {
  toast('หน้านี้เปิดแบบไม่ปลอดภัย — ใช้ http://localhost หรือ https เท่านั้น', 'warn', 8000);
}
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices(); // อุ่นรายการเสียงไว้ล่วงหน้า
}
