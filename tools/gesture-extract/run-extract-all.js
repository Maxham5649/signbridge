/* รันสกัด landmarks จากทุกคลิปในชุดนำร่อง (pilot-list.json) แล้ว export
   เป็นไฟล์อ้างอิงกลาง (signGestureVocab.js) — โครงสร้างข้อมูลต่อคำเดียวกับ
   ที่ signRecognition.js เก็บใน localStorage (refs[label] = [seq, seq, ...])
   เพื่อให้ matchSignSequence() ใช้ตรง ๆ ได้โดยไม่ต้องแก้ logic เทียบเลย */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('./server');

const PORT = 8934;
const OUT_JSON = path.join(__dirname, 'gesture-refs.json');
const OUT_JS = path.resolve(__dirname, '..', '..', 'signGestureVocab.js');

(async () => {
  const pilot = JSON.parse(fs.readFileSync(path.join(__dirname, 'pilot-list.json'), 'utf8'));
  const server = await startServer(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  await page.goto(`http://localhost:${PORT}/tools/gesture-extract/extract.html`);
  await page.waitForFunction('window.__extractReady === true', { timeout: 15000 });

  const refs = {}; // id -> [seq, seq, ...]
  const report = [];

  for (const entry of pilot) {
    refs[entry.id] = [];
    for (const relPath of entry.videos) {
      const url = `http://localhost:${PORT}/${encodeURI(relPath)}`;
      process.stdout.write(`${entry.label} <- ${relPath} ... `);
      try {
        const result = await page.evaluate((u) => window.extractFromVideo(u), url);
        const pct = result.totalSampledFrames ? (result.handFrameCount / result.totalSampledFrames) * 100 : 0;
        console.log(`${result.frames.length} frames kept (${pct.toFixed(0)}% had hands)`);
        if (result.frames.length >= 5) {
          refs[entry.id].push(result.frames);
        } else {
          console.log(`  SKIPPED (too few frames with hands detected)`);
        }
        report.push({ id: entry.id, label: entry.label, clip: relPath, framesKept: result.frames.length, handPct: pct });
      } catch (err) {
        console.log('FAILED:', err.message.split('\n')[0]);
        report.push({ id: entry.id, label: entry.label, clip: relPath, error: err.message.split('\n')[0] });
      }
    }
  }

  await browser.close();
  server.close();

  fs.writeFileSync(OUT_JSON, JSON.stringify({ refs, report }, null, 2));

  const weak = report.filter((r) => r.error || (r.handPct !== undefined && r.handPct < 30));
  console.log('\n=== สรุป ===');
  console.log('ทั้งหมด:', report.length, 'คลิป | ปัญหา (error หรือ detect <30%):', weak.length);
  weak.forEach((w) => console.log('  -', w.label, w.clip, w.error || `${w.handPct.toFixed(0)}%`));

  const noRef = Object.entries(refs).filter(([, seqs]) => seqs.length === 0);
  if (noRef.length) {
    console.log('คำที่ไม่เหลือ reference เลย (ทุกคลิปพัง/เฟรมน้อยไป):', noRef.map(([id]) => id).join(', '));
  }

  // เขียน signGestureVocab.js เฉพาะตอนไม่มีคำไหนไม่มี reference เลย —
  // กันดีพลอยเมนต์ข้อมูลที่รู้อยู่แล้วว่าไม่สมบูรณ์
  const jsBody = `/* ==========================================================
   คลังท่าอ้างอิงกลาง ภาษามือ -> ข้อความ (Phase 2)
   ----------------------------------------------------------
   สกัดจากคลิปจริงชุดเดียวกับ Phase 1 (signVocab.js) ด้วย MediaPipe
   HandLandmarker ผ่าน tools/gesture-extract/ (ดูโฟลเดอร์นั้นถ้าจะรันใหม่/
   เพิ่มคำ) — โครงสร้างตรงกับที่ signRecognition.js เก็บใน localStorage เดิม
   (label -> [sequence, sequence, ...]) ใช้กับ matchSignSequence() ได้ตรง ๆ
   สร้างเมื่อ ${new Date().toISOString()}
   ========================================================== */

const SIGN_GESTURE_VOCAB = ${JSON.stringify(refs)};
`;
  fs.writeFileSync(OUT_JS, jsBody);
  console.log('\nเขียน', OUT_JS);
  console.log('เขียน', OUT_JSON, '(ไฟล์ debug ดูรายละเอียดทุกคลิป)');
})();
