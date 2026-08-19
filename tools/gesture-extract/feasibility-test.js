/* เช็คก่อนลงมือจริง: คลิป Phase 1 ที่มีอยู่แล้ว (มุมกล้อง/ระยะเดิม) จะให้
   MediaPipe HandLandmarker detect มือติดจริงไหม ทดสอบกับไฟล์ตัวอย่างไม่กี่
   ไฟล์ก่อน ไม่รันทั้ง 28 คำ กันเสียเวลาถ้าคลิปใช้ไม่ได้ตั้งแต่ต้น */
const { chromium } = require('playwright');
const { startServer } = require('./server');

const PORT = 8934;
const SAMPLES = ['signs/สวัสดี.mp4', 'signs/ขอบคุณ.mp4', 'signs/รัก(1).mp4'];

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => console.log('[page]', msg.text()));
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  await page.goto(`http://localhost:${PORT}/tools/gesture-extract/extract.html`);
  await page.waitForFunction('window.__extractReady === true', { timeout: 15000 });

  for (const rel of SAMPLES) {
    const url = `http://localhost:${PORT}/${encodeURI(rel)}`;
    console.log('---', rel);
    try {
      const result = await page.evaluate((u) => window.extractFromVideo(u), url);
      const pct = ((result.handFrameCount / result.totalSampledFrames) * 100).toFixed(1);
      console.log(`  duration=${result.duration.toFixed(2)}s sampled=${result.totalSampledFrames} handFrames=${result.handFrameCount} (${pct}%) framesKept=${result.frames.length}`);
    } catch (err) {
      console.error('  FAILED:', err.message);
    }
  }

  await browser.close();
  server.close();
})();
