/* ==========================================================
   SignBridge — Service Worker
   หน้าที่: ทำให้เปิดแอพได้เร็ว/ออฟไลน์ได้บางส่วน และทำให้ผ่านเกณฑ์
   PWA ที่ Bubblewrap ใช้ห่อเป็น APK (TWA)

   หลักการ:
   - แคชเฉพาะไฟล์ของเราเอง (same-origin) เท่านั้น
   - ของนอก (Jitsi, MediaPipe, Vosk, Google Fonts) ปล่อยผ่านไปเน็ตตรง ๆ
     เพราะเป็น opaque response + ต้องสดเสมอ
   - คลิปภาษามือบน production อยู่ที่ GitHub Release (คนละ origin) จึงไม่ถูก
     แคชที่นี่ ปล่อยให้ browser cache จัดการเอง — กฎ .mp4 ด้านล่างมีไว้เผื่อ
     ตอน dev ที่ยังมี signs/1.mp4 อยู่ในเครื่อง
   ========================================================== */

const VERSION = 'signbridge-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const MEDIA_CACHE = `${VERSION}-media`;

// ไฟล์แกนของแอพ — โหลดพร้อมกันตอนติดตั้ง
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './signVocab.js',
  './signRecognition.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/* ---------- install: ดึง shell เข้าแคช ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll ล้มทั้งชุดถ้าไฟล์ใดไฟล์หนึ่งพัง — ใส่ทีละไฟล์แทนเพื่อให้ทนกว่า
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

/* ---------- activate: ลบแคชเวอร์ชันเก่า ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ของนอกโดเมน (Jitsi / MediaPipe / Vosk / fonts) — ไม่แตะ ปล่อยไปเน็ต
  if (url.origin !== self.location.origin) return;

  // range request (วิดีโอ seek) — service worker จัดการไม่ได้ดี ปล่อยผ่าน
  if (req.headers.has('range')) return;

  // เปิดหน้า: เอาของสดก่อน ถ้าเน็ตล่มค่อยดึงจากแคช
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('./index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // วิดีโอภาษามือ: แคชก่อน (ไฟล์ใหญ่ ไม่เปลี่ยนบ่อย)
  if (url.pathname.endsWith('.mp4')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok && res.status === 200) {
          const cache = await caches.open(MEDIA_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      })()
    );
    return;
  }

  // ไอคอน/รูป: แคชก่อน (ไม่เปลี่ยนบ่อย และไม่พังถ้าเก่าไปหนึ่งรอบ)
  if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok && res.status === 200 && res.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      })()
    );
    return;
  }

  // js/css/manifest: เอาของสดก่อนเสมอ แคชไว้เผื่อเน็ตล่มเท่านั้น
  //
  // ห้ามใช้แคชก่อนตรงนี้ — แอพอัปเดตด้วยการ push เว็บใหม่ (APK ไม่ได้ build ใหม่)
  // ถ้าเสิร์ฟของเก่าก่อน ผู้ใช้จะได้ script.js เก่าคู่กับ signVocab.js ใหม่
  // (หรือกลับกัน) ซึ่งพังได้จริง — ไฟล์พวกนี้เล็ก ยอมรอเน็ตคุ้มกว่า
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok && res.status === 200 && res.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })()
  );
});
