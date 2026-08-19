/* ทดสอบ end-to-end แบบเบา ๆ ผ่านหน้าเว็บจริง (ไม่ใช่แค่ unit) — เปิด
   index.html จริง, เลือกบทบาทหูหนวก, เปิดกล้อง (mock ด้วย fake device),
   เช็คว่าคลังกลางโหลดสำเร็จและ UI ขึ้น "พร้อมใช้งาน N คำ" ไม่มี error */
const { chromium } = require('playwright');
const { startServer } = require('./server');

const PORT = 8936;

(async () => {
  const server = await startServer(PORT);
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.selectOption('#roleSelect', 'deaf');

  const panelHidden = await page.getAttribute('#signInputPanel', 'hidden');
  console.log('signInputPanel hidden attr:', panelHidden);

  await page.click('#signCamToggleBtn');
  // รอจนข้อความมีตัวเลข (แสดงว่า renderAvailableWordCount() รันจริงแล้ว
  // ไม่ใช่แค่ placeholder เดิมใน HTML ที่ก็มีคำว่า "พร้อมใช้งาน" อยู่ก่อน)
  await page.waitForFunction(
    () => /\d/.test(document.getElementById('signRecognizeResult').textContent) ||
          document.getElementById('signRecognizeResult').textContent.includes('ไม่พร้อม'),
    { timeout: 20000 }
  );
  const resultText = await page.textContent('#signRecognizeResult');
  console.log('signRecognizeResult:', resultText);

  await new Promise((r) => setTimeout(r, 500));
  console.log('\nconsole/page errors:', errors.length);
  errors.forEach((e) => console.log(' -', e));

  await browser.close();
  server.close();
})();
