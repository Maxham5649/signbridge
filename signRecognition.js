/* ==========================================================
   จดจำภาษามือจากกล้อง (Phase 2) — MediaPipe HandLandmarker + DTW
   ----------------------------------------------------------
   โหมดกด-ค้าง: กดปุ่มค้างขณะทำท่า ปล่อยเมื่อจบท่า (ไม่ใช่ต่อเนื่อง
   อัตโนมัติ — การตัดแบ่งท่าจากวิดีโอต่อเนื่องเองเป็นปัญหายากเกินสโคป)

   ท่าอ้างอิงมาจากคลังกลาง SIGN_GESTURE_VOCAB (signGestureVocab.js) —
   สกัดล่วงหน้าจากคลิปจริงชุดเดียวกับ Phase 1 ด้วย MediaPipE ผ่าน
   tools/gesture-extract/ ทุกคนใช้ชุดเดียวกันทันที ไม่ต้องฝึกเอง
   (ของเดิมเคยให้ผู้ใช้ฝึกเองผ่านกล้อง เก็บใน localStorage — ตัดออก
   แล้วตามที่ตัดสินใจไว้ ดู tools/gesture-extract/README.md)

   กล้องตรงนี้เป็นสตรีมแยกจาก Jitsi เสมอ (Jitsi เป็น cross-origin
   iframe ดึงเฟรมจากมันไม่ได้) เปิด/ปิดอิสระจากกล้องของ Jitsi
   ========================================================== */

'use strict';

const HAND_LANDMARKER_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const HAND_LANDMARKER_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const HAND_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const SAMPLE_INTERVAL_MS = 80;  // จับ landmark ทุก ~80ms ระหว่างกดค้าง ไม่ใช่ทุกเฟรม กันเปลืองซีพียู/แบต
const HAND_SLOTS = ['Left', 'Right']; // ช่องคงที่ ไม่อิงลำดับที่โมเดล detect เจอ
const LANDMARKS_PER_HAND = 21;
const WRIST = 0;
const MIDDLE_MCP = 9;   // โคนนิ้วกลาง — ใช้วัด "ขนาดมือ" เพราะไม่ขยับตามการงอนิ้ว
const Z_WEIGHT = 0.5;   // z ของ MediaPipe เป็นความลึกคร่าว ๆ สัญญาณรบกวนสูงกว่า x/y จึงถ่วงน้ำหนักลง
const PRESENCE_WEIGHT = 1.0; // น้ำหนักของ flag "มีมือข้างนี้ไหม" ในเวกเตอร์
const CARRY_FORWARD_FRAMES = 3; // มือหายชั่วคราวไม่เกิน ~240ms ให้ใช้ค่าเดิมต่อ กันค่ากระโดด

/* เกณฑ์ตัดสิน — ค่าตั้งต้นได้จากการวัดจริง ดู scratchpad/dtw-calibrate.js
   ปรับได้ตอน runtime ผ่าน setMatchConfig() (UI มีสไลเดอร์ให้) */
const DEFAULT_MATCH_CONFIG = {
  // เพดานสูงสุด กันกรณี label ที่ฝึกมาเละจน spread กว้างเกินจนกลืนทุกท่า
  // ท่าที่ไม่เคยฝึกวัดได้ ~2.5 ขึ้นไป จึงตั้งเพดานต่ำกว่านั้น
  acceptCeiling: 2.0,
  // ยอมรับได้ไกลสุด = spread ของ label นั้นเอง x ตัวคูณนี้
  // วัดจริงแล้วท่าที่ทำถูกได้ระยะ ~= spread ของ label พอดี (ก็คือมันเป็น
  // อีกหนึ่งตัวอย่างจากการกระจายเดียวกัน) 1.8 จึงเผื่อไว้พอสมควร
  spreadK: 1.8,
  // best ต้องชนะ label อันดับสองอย่างน้อยเท่านี้ (ratio test)
  // 0.75 = ต้องใกล้กว่าอันดับสองอย่างน้อย 25%
  ratio: 0.75,
  // ถ้า label มีตัวอย่างเดียว วัด spread ไม่ได้ ใช้ค่านี้แทน
  singleSampleRadius: 0.8,
};

let matchConfig = { ...DEFAULT_MATCH_CONFIG };

function getMatchConfig() { return { ...matchConfig }; }
function setMatchConfig(patch) {
  matchConfig = { ...matchConfig, ...patch };
  return getMatchConfig();
}

let handLandmarkerPromise = null;
let signCamStream = null;
let signCamVideo = null; // <video id="signCamPreview"> จริงใน DOM — โชว์ preview ให้เห็นด้วย ไม่ใช่แค่ feed เข้าโมเดลเฉย ๆ
let detectTimer = null;
let detectTimestamp = 0; // ต้องเพิ่มขึ้นเสมอ ไม่งั้น detectForVideo โยน error
let capturing = false;
let captureBuffer = [];
let lastHandsCount = 0; // จำนวนมือที่เจอในเฟรมล่าสุด — ให้ UI โชว์สถานะ real-time ว่ากล้องเห็นมือไหม
let handsCountListener = null;
let carry = {}; // { Left: {vec, missed}, Right: {...} } — ค่าล่าสุดของแต่ละมือ ใช้ตอนมือหายชั่วคราว

function getLastHandsCount() {
  return lastHandsCount;
}

/* ให้ UI สมัครรับสถานะ "เห็นมือกี่ข้าง" แบบ real-time — ที่ผ่านมา badge
   signHandBadge ใน index.html ไม่เคยถูกอัปเดตเลยเพราะไม่มีช่องทางนี้ */
function setHandsCountListener(fn) {
  handsCountListener = typeof fn === 'function' ? fn : null;
}

function updateHandsCount(n) {
  if (n === lastHandsCount) return;
  lastHandsCount = n;
  if (handsCountListener) handsCountListener(n);
}

/* ---------- โหลด MediaPipe แบบ lazy (โหลดตอนเปิดโหมดนี้ครั้งแรกเท่านั้น) ---------- */
function loadHandLandmarker() {
  if (handLandmarkerPromise) return handLandmarkerPromise;
  handLandmarkerPromise = (async () => {
    const { FilesetResolver, HandLandmarker } = await import(HAND_LANDMARKER_BUNDLE_URL);
    const vision = await FilesetResolver.forVisionTasks(HAND_LANDMARKER_WASM_URL);
    return HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  })().catch((err) => {
    handLandmarkerPromise = null;
    throw err;
  });
  return handLandmarkerPromise;
}

/* ---------- กล้องแยกสำหรับจดจำท่า (คนละสตรีมกับ Jitsi) ---------- */
async function ensureSignCamera() {
  if (signCamStream) return signCamVideo;
  signCamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
  // ใช้ <video id="signCamPreview"> จริงใน DOM (ไม่ใช่ element ลอย ๆ ที่มองไม่เห็น)
  // ผู้ใช้ต้องเห็นว่ากล้องนี้กำลังถ่ายอะไรอยู่ ไม่งั้นเดาไม่ได้เลยว่าทำไมจับท่าไม่ติด
  signCamVideo = document.getElementById('signCamPreview');
  signCamVideo.srcObject = signCamStream;
  signCamVideo.hidden = false;
  await signCamVideo.play();
  return signCamVideo;
}

function stopSignCamera() {
  stopDetectionLoop();
  capturing = false;
  captureBuffer = [];
  if (signCamStream) {
    signCamStream.getTracks().forEach((t) => t.stop());
    signCamStream = null;
  }
  if (signCamVideo) {
    signCamVideo.srcObject = null;
    signCamVideo.hidden = true;
  }
  signCamVideo = null;
  updateHandsCount(0);
}

/* ==========================================================
   แปลง landmark ดิบ → เวกเตอร์เฟรมเดียว

   ต้องคงที่ต่อ 3 อย่างที่เปลี่ยนตลอดในการใช้งานจริง:
   1. ตำแหน่งมือในเฟรม  → ย้ายจุดกำเนิดไปที่ข้อมือ
   2. ระยะห่างจากกล้อง   → หารด้วยขนาดมือ (ข้อมือ→โคนนิ้วกลาง = 1.0)
      ของเดิมลบตำแหน่งข้อมืออย่างเดียว ขยับเข้า-ออกจากกล้องนิดเดียว
      ระยะก็พุ่งสิบเท่า
   3. ลำดับมือที่ detect เจอ → ล็อกเป็นช่อง Left/Right ตาม handedness
      ของเดิมต่อ vector ตามลำดับที่เจอ พอมือสลับ/หายไปเฟรมนึง
      ค่ากระโดดจนเทียบไม่ได้
   ========================================================== */

function handToVector(hand) {
  const wrist = hand[WRIST];
  const mcp = hand[MIDDLE_MCP];
  const span = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y, mcp.z - wrist.z);
  const s = Math.max(span, 1e-4); // มือหันข้างจนสแปนเกือบศูนย์ — กันหารด้วยศูนย์
  const out = [];
  for (const pt of hand) {
    out.push((pt.x - wrist.x) / s, (pt.y - wrist.y) / s, ((pt.z - wrist.z) / s) * Z_WEIGHT);
  }
  return out;
}

const EMPTY_HAND = new Array(LANDMARKS_PER_HAND * 3).fill(0);

/* result ของ MediaPipe → เวกเตอร์ 128 มิติ (2 ช่องมือ x [flag + 63 พิกัด])
   carryState เก็บค่าล่าสุดไว้ ใช้เติมตอนมือหายชั่วคราว */
function landmarksToFrame(result, carryState) {
  const byHand = { Left: null, Right: null };
  const lms = (result && result.landmarks) || [];
  const handed = (result && result.handedness) || [];

  for (let i = 0; i < lms.length; i++) {
    const cat = handed[i] && handed[i][0];
    // ไม่มี handedness (บางเวอร์ชัน/บางเฟรม) — ใส่ช่องที่ยังว่างอยู่
    const name = (cat && cat.categoryName) || (byHand.Left ? 'Right' : 'Left');
    const slot = HAND_SLOTS.includes(name) ? name : 'Left';
    if (!byHand[slot]) byHand[slot] = handToVector(lms[i]);
    else if (!byHand[slot === 'Left' ? 'Right' : 'Left']) byHand[slot === 'Left' ? 'Right' : 'Left'] = handToVector(lms[i]);
  }

  const frame = [];
  for (const slot of HAND_SLOTS) {
    let vec = byHand[slot];
    let present = 1;
    if (vec) {
      carryState[slot] = { vec, missed: 0 };
    } else {
      const held = carryState[slot];
      if (held && held.missed < CARRY_FORWARD_FRAMES) {
        held.missed += 1;
        vec = held.vec;   // มือหายแป๊บเดียว ใช้ค่าเดิมต่อ ไม่ให้ค่ากระโดด
      } else {
        carryState[slot] = null;
        vec = EMPTY_HAND;
        present = 0;
      }
    }
    frame.push(present * PRESENCE_WEIGHT, ...vec);
  }
  return frame;
}

function frameDistance(a, b) {
  const len = Math.max(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/* ---------- DTW: เทียบ sequence สองชุดที่ยาวไม่เท่ากันได้ ทนความเร็ว
   การทำท่าที่ต่างกันแต่ละครั้ง

   หารด้วยความยาว path จริง (ไม่ใช่ n+m แบบเดิม) ผลลัพธ์จึงเป็น
   "ระยะเฉลี่ยต่อเฟรม" ตรง ๆ เทียบข้ามคู่ที่ยาวไม่เท่ากันได้จริง ---------- */
function dtwDistance(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return Infinity;

  const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  const steps = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  cost[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = frameDistance(seqA[i - 1], seqB[j - 1]);
      let best = cost[i - 1][j - 1], bi = i - 1, bj = j - 1;
      if (cost[i - 1][j] < best) { best = cost[i - 1][j]; bi = i - 1; bj = j; }
      if (cost[i][j - 1] < best) { best = cost[i][j - 1]; bi = i; bj = j - 1; }
      cost[i][j] = d + best;
      steps[i][j] = steps[bi][bj] + 1;
    }
  }
  const len = steps[n][m] || 1;
  return cost[n][m] / len;
}

/* ---------- ท่าอ้างอิง: มาจากคลังกลาง (pre-computed) เท่านั้น ---------- */
// รูปแบบเดียวกับที่ localStorage เคยเก็บ (label -> [sequence, ...]) —
// matchSignSequence/computeSpreads ใช้ต่อได้เลยไม่ต้องแก้ logic เทียบ
function loadSignReferences() {
  return (typeof SIGN_GESTURE_VOCAB !== 'undefined' && SIGN_GESTURE_VOCAB) ? SIGN_GESTURE_VOCAB : {};
}

// คลังกลางคงที่ตลอดอายุหน้า (ไม่มีใครเขียนทับระหว่างใช้งาน) จึง cache
// รายชื่อคำ + จำนวนตัวอย่างได้เลยโดยไม่ต้อง invalidate
function getAvailableLabelCounts() {
  const refs = loadSignReferences();
  return Object.keys(refs).map((label) => ({ label, count: refs[label].length }));
}

/* ==========================================================
   จับคู่ท่า

   ของเดิมใช้ค่าคงที่ตัวเดียว (0.35) ตัดสินว่า "ใช่/ไม่ใช่" ซึ่งวัดจริง
   แล้วหลวมกว่าระยะระหว่างท่าคนละท่าเสียอีก ผลคือทุกท่าที่ทำจะไป
   เกาะ label ที่ใกล้สุดเสมอ ต่อให้ไม่เคยฝึกท่านั้น

   ของใหม่ตัดสินจาก 2 เงื่อนไข ต้องผ่านทั้งคู่:
   1. ระยะต้องอยู่ในรัศมีของ label นั้นเอง — รัศมีคำนวณจากความ
      กระจายของตัวอย่างที่ฝึกไว้ของ label นั้น (คำที่ทำท่าไม่ค่อย
      เหมือนเดิมจะได้รัศมีกว้างขึ้นเอง ไม่ต้องจูนมือ)
   2. ต้องชนะ label อันดับสองชัดเจน (ratio test) — กันกรณีท่าคลุมเครือ
      ที่ใกล้หลาย label พอ ๆ กัน ซึ่งเดาไปก็ผิดความหมาย
   ========================================================== */

let spreadCache = null;

/* ความกระจายภายใน label = ระยะ DTW เฉลี่ยระหว่างตัวอย่างของมันเอง */
function computeSpreads(refs) {
  const spreads = {};
  for (const label of Object.keys(refs)) {
    const seqs = refs[label];
    if (seqs.length < 2) { spreads[label] = null; continue; }
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < seqs.length; i++) {
      for (let j = i + 1; j < seqs.length; j++) {
        sum += dtwDistance(seqs[i], seqs[j]);
        pairs++;
      }
    }
    spreads[label] = pairs > 0 ? sum / pairs : null;
  }
  return spreads;
}

function getSpreads() {
  if (!spreadCache) spreadCache = computeSpreads(loadSignReferences());
  return spreadCache;
}

function acceptRadiusFor(label, spreads) {
  const spread = spreads[label];
  const radius = spread === null || spread === undefined
    ? matchConfig.singleSampleRadius
    : spread * matchConfig.spreadK;
  return Math.min(radius, matchConfig.acceptCeiling);
}

/* คืนผลแบบละเอียดเสมอ (ไม่ใช่ null เฉย ๆ) เพื่อให้ UI บอกได้ว่า
   "ไม่รับเพราะไกลเกิน" หรือ "ไม่รับเพราะก้ำกึ่งกับอีกคำ" ซึ่งผู้ใช้
   แก้ต่างกัน (ฝึกเพิ่ม vs เปลี่ยนคำให้ต่างกว่านี้) */
function matchSignSequence(liveSeq) {
  const refs = loadSignReferences();
  const labels = Object.keys(refs);
  if (labels.length === 0) {
    return { accepted: false, reason: 'no-training', ranked: [] };
  }

  const spreads = getSpreads();
  const ranked = labels
    .map((label) => ({
      label,
      distance: Math.min(...refs[label].map((refSeq) => dtwDistance(liveSeq, refSeq))),
      radius: acceptRadiusFor(label, spreads),
      samples: refs[label].length,
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  const runnerUp = ranked[1] || null;

  if (best.distance > best.radius) {
    return { accepted: false, reason: 'too-far', ranked, best, runnerUp };
  }
  if (runnerUp && best.distance > runnerUp.distance * matchConfig.ratio) {
    return { accepted: false, reason: 'ambiguous', ranked, best, runnerUp };
  }
  return {
    accepted: true,
    reason: 'ok',
    label: best.label,
    distance: best.distance,
    ranked,
    best,
    runnerUp,
  };
}

/* ==========================================================
   ลูปตรวจจับ — ลูปเดียวทำทั้ง preview badge และการอัดท่า

   ของเดิมมีลูปเฉพาะตอนกดค้าง ทำให้ badge "เห็นมือไหม" อัปเดตไม่ได้
   เลยตอนยังไม่กด และถ้ามีสองลูปพร้อมกัน timestamp ที่ส่งให้
   detectForVideo จะไม่เรียงกัน (MediaPipe โยน error ทันที)
   ========================================================== */

async function startDetectionLoop() {
  if (detectTimer) return;
  await ensureSignCamera();
  const landmarker = await loadHandLandmarker();
  const previewCarry = {};

  detectTimer = setInterval(() => {
    if (!signCamVideo || signCamVideo.readyState < 2) return;
    detectTimestamp += SAMPLE_INTERVAL_MS; // ต้องเพิ่มขึ้นเสมอ ห้ามใช้ performance.now() ที่อาจซ้ำ
    let result;
    try {
      result = landmarker.detectForVideo(signCamVideo, detectTimestamp);
    } catch (err) {
      console.warn('detectForVideo failed:', err);
      return;
    }
    const count = (result.landmarks && result.landmarks.length) || 0;
    updateHandsCount(count);
    if (capturing) {
      if (count > 0 || Object.keys(carry).some((k) => carry[k])) {
        captureBuffer.push(landmarksToFrame(result, carry));
      }
    } else {
      landmarksToFrame(result, previewCarry); // อุ่นเครื่อง/กัน state ค้าง ไม่เก็บผล
    }
  }, SAMPLE_INTERVAL_MS);
}

function stopDetectionLoop() {
  clearInterval(detectTimer);
  detectTimer = null;
}

/* ---------- กด-ค้าง เริ่ม/หยุดอัดท่า ---------- */
async function startSignCapture() {
  await startDetectionLoop(); // ปกติลูปเปิดอยู่แล้วตั้งแต่เปิดกล้อง
  captureBuffer = [];
  carry = {};
  capturing = true;
}

function stopCapture() {
  capturing = false;
  carry = {};
  const seq = captureBuffer.slice();
  captureBuffer = [];
  return seq;
}

/* export สำหรับเทสต์ใน Node (ไม่มีผลกับเบราว์เซอร์) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    handToVector, landmarksToFrame, frameDistance, dtwDistance,
    computeSpreads, matchSignSequence, DEFAULT_MATCH_CONFIG,
    LANDMARKS_PER_HAND, HAND_SLOTS, Z_WEIGHT, PRESENCE_WEIGHT,
  };
}
