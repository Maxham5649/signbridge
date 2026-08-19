/* เช็คว่า seek ได้เฟรมจริงหรือเปล่า ก่อนจะสงสัยว่า MediaPipe detect พัง —
   capture เฟรมกลางคลิปเป็น PNG ออกมาดูด้วยตา */
const { chromium } = require('playwright');
const { startServer } = require('./server');
const fs = require('fs');

const PORT = 8935;

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  page.on('console', (msg) => console.log('[page]', msg.text()));
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));

  await page.setContent(`
    <video id="v" playsinline muted style="width:320px;height:240px;background:red"></video>
  `);
  const url = `http://localhost:${PORT}/signs/${encodeURIComponent('สวัสดี.mp4')}`;

  const info = await page.evaluate(async (u) => {
    const v = document.getElementById('v');
    await new Promise((resolve, reject) => {
      v.addEventListener('loadedmetadata', resolve, { once: true });
      v.addEventListener('error', () => reject(new Error('load failed')), { once: true });
      v.src = u;
    });
    await v.play();
    await new Promise((r) => setTimeout(r, 300));
    v.pause();
    v.currentTime = v.duration / 2;
    await new Promise((resolve) => { v.addEventListener('seeked', resolve, { once: true }); });
    await new Promise((r) => requestAnimationFrame(r));
    return { duration: v.duration, w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, currentTime: v.currentTime };
  }, url);
  console.log('video info:', info);

  await page.locator('#v').screenshot({ path: 'debug-frame.png' });
  console.log('saved debug-frame.png');

  await browser.close();
  server.close();
})();
