/* ==========================================================
   จดจำภาษามือจากกล้อง (Phase 2) — MediaPipe HandLandmarker + DTW
   ----------------------------------------------------------
   โหมดกด-ค้าง: กดปุ่มค้างขณะทำท่า ปล่อยเมื่อจบท่า (ไม่ใช่ต่อเนื่อง
   อัตโนมัติ — การตัดแบ่งท่าจากวิดีโอต่อเนื่องเองเป็นปัญหายากเกินสโคป)

   ไม่มีท่าอ้างอิงมาให้ล่วงหน้า — ต้อง "ฝึกสอน" ในแอปนี้เองก่อนถึงจะ
   จดจำท่าได้ (อัดท่าตัวอย่าง 3-5 ครั้ง/คำ จากคนที่ใช้ภาษามือไทยได้จริง)
   เก็บไว้ใน localStorage ของเครื่อง/เบราว์เซอร์นั้น ๆ

   กล้องตรงนี้เป็นสตรีมแยกจาก Jitsi เสมอ (Jitsi เป็น cross-origin
   iframe ดึงเฟรมจากมันไม่ได้) เปิด/ปิดอิสระจากกล้องของ Jitsi
   ========================================================== */

'use strict';

const HAND_LANDMARKER_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const HAND_LANDMARKER_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const HAND_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const SIGN_REF_STORAGE_KEY = 'signbridge-sign-references-v1';
const SAMPLE_INTERVAL_MS = 100; // จับ landmark ทุก ~100ms ระหว่างกดค้าง ไม่ใช่ทุกเฟรม กันเปลืองซีพียู/แบต
const DTW_MATCH_THRESHOLD = 0.35; // ยิ่งน้อยยิ่งเข้มงวด — เข้มไว้ก่อนกันแปลผิดความหมาย ปรับได้ตามผลทดสอบจริง

let handLandmarkerPromise = null;
let signCamStream = null;
let signCamVideo = null; // <video id="signCamPreview"> จริงใน DOM — โชว์ preview ให้เห็นด้วย ไม่ใช่แค่ feed เข้าโมเดลเฉย ๆ
let capturing = false;
let captureBuffer = [];
let captureTimer = null;
let lastHandsCount = 0; // จำนวนมือที่เจอในเฟรมล่าสุด — ให้ UI โชว์สถานะ real-time ว่ากล้องเห็นมือไหม

function getLastHandsCount() {
  return lastHandsCount;
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
  if (capturing) stopCapture();
  if (signCamStream) {
    signCamStream.getTracks().forEach((t) => t.stop());
    signCamStream = null;
  }
  if (signCamVideo) {
    signCamVideo.srcObject = null;
    signCamVideo.hidden = true;
  }
  signCamVideo = null;
  lastHandsCount = 0;
}

/* ---------- Normalize landmark: เทียบตำแหน่งข้อมือ (จุด 0) กันปัญหา
   ระยะห่างจากกล้อง/ตำแหน่งมือในเฟรมต่างกันทำให้ตัวเลขเพี้ยน ---------- */
function normalizeLandmarks(handsLandmarks) {
  const vec = [];
  for (const hand of handsLandmarks) {
    const wrist = hand[0];
    for (const pt of hand) {
      vec.push(pt.x - wrist.x, pt.y - wrist.y, pt.z - wrist.z);
    }
  }
  return vec;
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
   การทำท่าที่ต่างกันแต่ละครั้ง ---------- */
function dtwDistance(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return Infinity;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = frameDistance(seqA[i - 1], seqB[j - 1]);
      dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[n][m] / (n + m); // หารด้วยความยาวรวมคร่าว ๆ กันท่ายาวเสียเปรียบท่าสั้น
}

/* ---------- เก็บ/โหลดท่าอ้างอิงจาก localStorage ---------- */
function loadSignReferences() {
  try {
    return JSON.parse(localStorage.getItem(SIGN_REF_STORAGE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function saveSignReferences(refs) {
  try {
    localStorage.setItem(SIGN_REF_STORAGE_KEY, JSON.stringify(refs));
  } catch (err) {
    console.error('บันทึกท่าอ้างอิงไม่สำเร็จ:', err);
  }
}

function addSignReference(label, sequence) {
  const refs = loadSignReferences();
  if (!refs[label]) refs[label] = [];
  refs[label].push(sequence);
  saveSignReferences(refs);
  return refs[label].length;
}

function removeSignLabel(label) {
  const refs = loadSignReferences();
  delete refs[label];
  saveSignReferences(refs);
}

function getTrainedLabelCounts() {
  const refs = loadSignReferences();
  return Object.keys(refs).map((label) => ({ label, count: refs[label].length }));
}

/* ---------- จับคู่ sequence สดกับท่าอ้างอิงทั้งหมด — เข้มงวดไว้ก่อน
   ไม่มั่นใจคืน null ดีกว่าเดาแล้วแปลผิดความหมาย ---------- */
function matchSignSequence(liveSeq) {
  const refs = loadSignReferences();
  let bestLabel = null;
  let bestDist = Infinity;
  for (const label of Object.keys(refs)) {
    for (const refSeq of refs[label]) {
      const dist = dtwDistance(liveSeq, refSeq);
      if (dist < bestDist) {
        bestDist = dist;
        bestLabel = label;
      }
    }
  }
  if (bestLabel !== null && bestDist <= DTW_MATCH_THRESHOLD) {
    return { label: bestLabel, distance: bestDist };
  }
  return null;
}

/* ---------- กด-ค้าง เริ่ม/หยุดจับภาพ ---------- */
async function startSignCapture() {
  if (capturing) return;
  await ensureSignCamera();
  const landmarker = await loadHandLandmarker();
  capturing = true;
  captureBuffer = [];
  lastHandsCount = 0;
  captureTimer = setInterval(() => {
    if (!capturing || !signCamVideo) return;
    const result = landmarker.detectForVideo(signCamVideo, performance.now());
    lastHandsCount = (result.landmarks && result.landmarks.length) || 0;
    if (lastHandsCount > 0) {
      captureBuffer.push(normalizeLandmarks(result.landmarks));
    }
  }, SAMPLE_INTERVAL_MS);
}

function stopCapture() {
  capturing = false;
  clearInterval(captureTimer);
  captureTimer = null;
  lastHandsCount = 0;
  return captureBuffer.slice();
}
