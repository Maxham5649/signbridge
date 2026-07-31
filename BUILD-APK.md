# สร้าง APK ของ SignBridge ด้วย Bubblewrap (TWA)

TWA = Trusted Web Activity — APK ที่เปิดเว็บของเราด้วย Chrome engine จริงแบบเต็มจอ
ไม่มีแถบ URL ทำให้ **Web Speech API / Jitsi / MediaPipe ทำงานได้ 100% เหมือนเปิดในเบราว์เซอร์**

---

## สถานะ toolchain ในเครื่อง (ตรวจจริงด้วย `bubblewrap doctor` แล้ว)

| ต้องมี | สถานะ |
|---|---|
| Node.js | ✅ v24.18.1 |
| **JDK 17 เป๊ะ ๆ** | ❌ ไม่มี — เครื่องมี JDK 26 กับ 21 (JBR) เท่านั้น |
| **Android SDK + cmdline-tools** | ❌ SDK มี แต่ไม่มี `cmdline-tools/` |

> Bubblewrap เช็คไฟล์ `release` ของ JDK ว่าต้องขึ้นต้นด้วย `JAVA_VERSION="17.0` เท่านั้น
> JDK 21 (JBR ของ Android Studio) และ JDK 26 **ถูกปฏิเสธทั้งคู่**
> และมันเช็ค `androidSdkPath` ว่าต้องมีโฟลเดอร์ `bin/` หรือ `tools/` อยู่ข้างใน
> ซึ่ง SDK ของ Android Studio ไม่มี (มัน layout คนละแบบ)

**สถานะ:** ติดตั้งเรียบร้อยแล้วที่ `C:\Users\user\.bubblewrap\`
(JDK `17.0.11+9` จาก Adoptium + cmdline-tools จาก dl.google.com — ไม่ไปยุ่งกับ Android Studio เดิม)
`bubblewrap doctor` ผ่านแล้ว: *"Your jdkpath and androidSdkPath are valid."*

---

## ขั้นตอนที่ 0 — อัปคลิปภาษามือเป็น GitHub Release asset

`signs/*.mp4` **ไม่ได้ commit ลง repo โดยตั้งใจ** (ดู `signs/README.md` ว่าทำไม)
เว็บที่ deploy แล้วจะโหลดคลิปจาก `SIGN_VIDEO_FALLBACK_SRC` ใน `signVocab.js` แทน:

```
https://github.com/Maxham5649/signbridge/releases/download/v1/1.mp4
```

ทำครั้งเดียว: เปิด repo → **Releases → Create a new release**
→ Tag = `v1` → ลาก `signs/1.mp4` เข้าช่อง attach → **Publish release**

> ชื่อ tag (`v1`) และชื่อไฟล์ (`1.mp4`) ต้องตรงกับ URL ข้างบนเป๊ะ ๆ
> ถ้าอยากใช้ชื่ออื่น แก้ `SIGN_VIDEO_FALLBACK_SRC` ให้ตรงกัน

ถ้ายังไม่อัป เว็บจะไม่พัง — แค่ fallback ไปเล่นอวาตาร์ + ข้อความแทนวิดีโอ

---

## ขั้นตอนที่ 1 — Deploy เว็บขึ้น HTTPS

TWA **บังคับ** ให้เว็บอยู่บน HTTPS จริง (localhost ใช้สร้าง APK ไม่ได้)

### ทางเลือก A — GitHub Pages (ฟรี ถาวร) ← ที่เลือกใช้

repo ถูก `git init` + commit ไว้ให้แล้ว เหลือแค่ push:

```bash
cd /c/Users/user/Desktop/App && git remote add origin https://github.com/Maxham5649/signbridge.git && git push -u origin main
```

เปิด repo → **Settings → Pages** → Source = `Deploy from a branch` → Branch = `main` / `(root)` → Save

จะได้ URL: `https://maxham5649.github.io/signbridge/`

> ไฟล์ `.nojekyll` มีอยู่แล้วในโปรเจกต์ — จำเป็น เพราะไม่งั้น GitHub Pages
> จะไม่ยอมเสิร์ฟโฟลเดอร์ `.well-known/` ที่ต้องใช้ในขั้นตอนที่ 4

### ทางเลือก B — Netlify Drop (เร็วสุด ไม่ต้องใช้ git)

เปิด https://app.netlify.com/drop แล้วลากโฟลเดอร์ `App` (ลบ `vosk-model/` ออกก่อน) เข้าไป
ได้ URL ทันทีแบบ `https://xxxx.netlify.app`

---

## ขั้นตอนที่ 2 — ตรวจ toolchain (ทำไว้ให้แล้ว)

```bash
npx --yes @bubblewrap/cli@latest doctor
```

ต้องขึ้น `Your jdkpath and androidSdkPath are valid.`

ถ้าวันไหนขึ้น error ให้ตั้งค่ากลับด้วย:

```bash
npx --yes @bubblewrap/cli@latest updateConfig --jdkPath "C:\Users\user\.bubblewrap\jdk\jdk-17.0.11+9" --androidSdkPath "C:\Users\user\.bubblewrap\android_sdk"
```

---

## ขั้นตอนที่ 3 — สร้างโปรเจกต์ TWA แล้ว build APK

แทน `<URL>` ด้วย URL จริงจากขั้นตอนที่ 1

```bash
mkdir -p /c/Users/user/Desktop/App/twa && cd /c/Users/user/Desktop/App/twa && npx --yes @bubblewrap/cli init --manifest="<URL>/manifest.webmanifest"
```

Bubblewrap จะถามทีละข้อ — ค่าที่ควรตอบ:

| คำถาม | ตอบ |
|---|---|
| Application name | `SignBridge` |
| Short name | `SignBridge` |
| Application ID (package) | `app.signbridge.twa` |
| Display mode | `standalone` |
| Status bar color | `#1C5DFA` |
| Include support for Play Billing | `No` |
| Request geolocation permission | `No` |
| **Key store / password** | ตั้งรหัสผ่านเอง แล้ว **จดเก็บไว้ให้ดี** — ถ้าหายจะอัปเดตแอพเดิมไม่ได้อีกเลย |

จากนั้น build:

```bash
cd /c/Users/user/Desktop/App/twa && npx --yes @bubblewrap/cli build
```

ได้ไฟล์:
- `app-release-signed.apk` ← **ตัวนี้คือ APK ที่เอาไปลงมือถือได้เลย**
- `app-release-bundle.aab` ← สำหรับอัปขึ้น Google Play เท่านั้น

---

## ขั้นตอนที่ 4 — Digital Asset Links (ลบแถบ URL ออก)

ถ้าข้ามขั้นนี้ แอพจะเปิดได้แต่โผล่แถบ URL ของ Chrome ด้านบน

Bubblewrap สร้างไฟล์ `twa/assetlinks.json` ให้แล้ว — เอาไปวางบนเว็บที่ path นี้:

```
<URL>/.well-known/assetlinks.json
```

คือสร้างโฟลเดอร์ `.well-known/` ในโปรเจกต์ แล้วก๊อป `assetlinks.json` เข้าไป → push ใหม่

ถ้าหาไฟล์ไม่เจอ สร้าง fingerprint เองได้ด้วย:

```bash
cd /c/Users/user/Desktop/App/twa && npx --yes @bubblewrap/cli fingerprint generateAssetLinks
```

ตรวจว่าใช้ได้จริง: เปิด `<URL>/.well-known/assetlinks.json` ในเบราว์เซอร์ ต้องเห็น JSON (ไม่ใช่ 404)

---

## ขั้นตอนที่ 5 — ลงมือถือ

ต่อสาย USB เปิด USB debugging แล้ว:

```bash
"/c/Users/user/AppData/Local/Android/Sdk/platform-tools/adb.exe" install -r /c/Users/user/Desktop/App/twa/app-release-signed.apk
```

หรือส่งไฟล์ `.apk` เข้ามือถือแล้วกดติดตั้ง (ต้องเปิด "ติดตั้งจากแหล่งที่ไม่รู้จัก")

---

## เรื่องที่ต้องรู้หลังติดตั้ง

**สิทธิ์กล้อง/ไมค์** — TWA ใช้สิทธิ์ของ Chrome ไม่ใช่ของ APK ตัวเอง
ครั้งแรกที่เข้าห้อง Chrome จะถามสิทธิ์ ต้องกดอนุญาต และเครื่องต้องมี **Chrome ติดตั้งอยู่**
(ถ้าไม่มี Chrome แอพจะ fallback ไป Custom Tabs ของเบราว์เซอร์อื่นแทน)

**เสียงพูด → ข้อความ** — ใช้ Web Speech API ของ Chrome ต้องต่อเน็ต
ถ้าชนไมค์กับ Jitsi โค้ดจะสลับไป Vosk อัตโนมัติ (`script.js:396`) ซึ่งโหลดโมเดล ~88MB
จาก GitHub Release ครั้งแรกครั้งเดียว

**เสียงไทย (TTS)** — ต้องมี Google Text-to-Speech + ชุดเสียงไทยในเครื่อง
ถ้าไม่มี `speechSynthesis` จะเงียบ — ติดตั้งจาก Play Store ได้

**อัปเดตแอพ** — แก้โค้ดแล้ว push ขึ้น host ใหม่ แอพจะได้ของใหม่ทันที **ไม่ต้อง build APK ใหม่**
build ใหม่เฉพาะตอนเปลี่ยนชื่อ/ไอคอน/สี/URL เท่านั้น
