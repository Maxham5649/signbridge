# สร้าง APK ของ SignBridge ด้วย Bubblewrap (TWA)

TWA = Trusted Web Activity — APK ที่เปิดเว็บของเราด้วย Chrome engine จริงแบบเต็มจอ
ไม่มีแถบ URL ทำให้ **Web Speech API / Jitsi / MediaPipe ทำงานได้ 100% เหมือนเปิดในเบราว์เซอร์**

---

## สถานะ toolchain — ตั้งค่าเสร็จแล้ว ผ่าน build จริงแล้ว

ทั้งหมดอยู่ที่ `C:\Users\user\.bubblewrap\` ไม่ไปยุ่งกับ Android Studio เดิม

| | path |
|---|---|
| JDK 17.0.11+9 **x64** | `.bubblewrap\jdk-x64\jdk-17.0.11+9` |
| Android SDK | `.bubblewrap\android_sdk` |
| config | `.bubblewrap\config.json` |

ยืนยันแล้ว: `gradlew assembleDebug` → **BUILD SUCCESSFUL**, APK 5.4 MB
package `app.signbridge.twa`, launchUrl `https://maxham5649.github.io/signbridge/`

### ⚠️ 3 กับดักที่เจอตอน setup — ถ้าต้องตั้งเครื่องใหม่ต้องเจอซ้ำ

**1. Bubblewrap ลง JDK 32-bit บน Windows เสมอ** ← ตัวนี้เสียเวลาที่สุด

`JdkInstaller.js` มี Windows แค่ตัวเลือกเดียวคือ `OpenJDK17U-jdk_x86-32_windows`
JVM 32-bit เพดาน heap ~1.5 GB ตายตัว → `:app:mergeExtDexDebug` ตายด้วย
`OutOfMemoryError` และเพิ่ม `-Xmx` ไม่ช่วยเลย (ขึ้น `Could not reserve enough
space for object heap` ตั้งแต่ยังไม่เริ่ม build)

เช็คด้วย: `grep OS_ARCH <jdkPath>/release` — ต้องได้ `x86_64` ไม่ใช่ `x86`

แก้: โหลด x64 เวอร์ชันเดียวกันจาก Adoptium แล้วชี้ `config.json` ไปที่มัน

```bash
cd /c/Users/user/.bubblewrap && curl -sSL -o jdk-x64.zip "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.11_9.zip"
```

แตกไฟล์ด้วย PowerShell (GNU tar ใน git-bash อ่าน zip ไม่ได้):

```bash
powershell -c "Expand-Archive -Path C:\Users\user\.bubblewrap\jdk-x64.zip -DestinationPath C:\Users\user\.bubblewrap\jdk-x64 -Force"
```

**2. SDK ที่ Bubblewrap โหลดมาไม่มี license**

Gradle ต้องโหลด `build-tools;35.0.0` + `platforms;android-36` เพิ่ม แต่ไม่ยอมถ้าไม่มีไฟล์ license
แก้โดยก๊อป license ที่ยอมรับไว้แล้วจาก Android Studio SDK:

```bash
mkdir -p /c/Users/user/.bubblewrap/android_sdk/licenses && cp /c/Users/user/AppData/Local/Android/Sdk/licenses/* /c/Users/user/.bubblewrap/android_sdk/licenses/
```

**3. `-Xmx1536m` ที่ Bubblewrap ใส่มาน้อยไป**

`twa/gradle.properties` ถูกแก้เป็น `-Xmx2g` แล้ว
**ถ้ารัน `bubblewrap init` หรือ `update` ใหม่ ไฟล์นี้จะถูกเขียนทับ ต้องแก้ซ้ำ**

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

## ขั้นตอนที่ 3 — โปรเจกต์ TWA (สร้างไว้ให้แล้ว)

โปรเจกต์ Android อยู่ที่ `C:\Users\user\Desktop\App\twa\` แล้ว
ตั้งค่าไว้ตามนี้ (แก้ได้ที่ `twa/twa-manifest.json`):

| | |
|---|---|
| Package ID | `app.signbridge.twa` |
| Host | `maxham5649.github.io` |
| Launch URL | `/signbridge/` |
| Launcher name | `SignBridge` |
| Theme color | `#1C5DFA` |
| minSdk / targetSdk | 21 / 35 |

โฟลเดอร์ `twa/` อยู่ใน `.gitignore` — สร้างใหม่ได้เสมอ และ **ห้าม commit keystore**

---

## ขั้นตอนที่ 3.5 — build APK (ต้องรันเอง เพราะต้องตั้งรหัส keystore)

### สร้าง keystore ก่อน — `bubblewrap build` ไม่สร้างให้

`createSigningKey()` อยู่ใน `init.js` เท่านั้น ส่วน `build` แค่ถามรหัสแล้วเรียก
apksigner เลย ถ้ายังไม่มีไฟล์ keystore จะพังท้ายสุดด้วย
`java.io.FileNotFoundException: ...android.keystore`

```bash
& "C:\Users\user\.bubblewrap\jdk-x64\jdk-17.0.11+9\bin\keytool.exe" -genkeypair -v -keystore "C:\Users\user\Desktop\App\twa\android.keystore" -alias android -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` **ไม่โชว์อะไรเลยตอนพิมพ์รหัส** ไม่มีแม้แต่ `*` — พิมพ์ต่อแล้วกด Enter ได้เลย
Country code ตอบ `TH`, ยืนยันตอบ `yes`, ถามรหัส key ให้กด Enter เฉย ๆ (ใช้รหัสเดียวกับ keystore)

### แล้วค่อย build

```bash
cd /c/Users/user/Desktop/App/twa && npx --yes @bubblewrap/cli@latest build
```

ถามรหัส 2 ครั้ง ใส่รหัสเดียวกันทั้งคู่

> 🔑 **จดรหัสไว้ และก๊อป `twa/android.keystore` ไปเก็บที่อื่นด้วย**
> ถ้าหาย = อัปเดตแอพตัวเดิมไม่ได้อีกเลย ต้องเปลี่ยน package ID เป็นแอพใหม่
> `.gitignore` กัน keystore ไว้แล้ว
>
> ⚠️ `bubblewrap build` ส่งรหัสผ่านเป็น plaintext บน command line ของ apksigner
> (`--ks-pass pass:"..."`) รหัสจะค้างใน terminal scrollback — ปิดหน้าต่างทิ้งหลัง build เสร็จ

ได้ไฟล์:
- `app-release-signed.apk` ← **ตัวนี้คือ APK ที่เอาไปลงมือถือได้เลย**
- `app-release-bundle.aab` ← สำหรับอัปขึ้น Google Play เท่านั้น

---

## ขั้นตอนที่ 4 — Digital Asset Links (ลบแถบ URL ออก)

ถ้าข้ามขั้นนี้ แอพจะเปิดได้แต่โผล่แถบ URL ของ Chrome ด้านบน

`build` จะสร้าง `twa/assetlinks.json` ให้ (ถ้าไม่เจอ สร้างเองได้ด้วย):

```bash
cd /c/Users/user/Desktop/App/twa && npx --yes @bubblewrap/cli@latest fingerprint generateAssetLinks
```

ไฟล์นั้นต้องไปโผล่ที่ URL นี้:

```
https://maxham5649.github.io/signbridge/.well-known/assetlinks.json
```

**บอกผมตอน build เสร็จ ผมก๊อปเข้า `.well-known/` + commit + push ให้** หรือทำเองก็ได้:

```bash
mkdir -p /c/Users/user/Desktop/App/.well-known && cp /c/Users/user/Desktop/App/twa/assetlinks.json /c/Users/user/Desktop/App/.well-known/
```

ตรวจว่าใช้ได้จริง: เปิด URL ข้างบนในเบราว์เซอร์ ต้องเห็น JSON (ไม่ใช่ 404)
GitHub Pages ใช้เวลา build ~1 นาทีหลัง push

> ไฟล์นี้มีแค่ SHA-256 fingerprint ของ certificate — **ไม่ใช่ความลับ** เอาขึ้น public ได้ปกติ
> (ต่างจาก `android.keystore` ที่ห้ามหลุด)

---

## ขั้นตอนที่ 5 — ลงมือถือ

ต่อสาย USB เปิด USB debugging แล้ว:

```bash
"/c/Users/user/AppData/Local/Android/Sdk/platform-tools/adb.exe" install -r /c/Users/user/Desktop/App/twa/app-release-signed.apk
```

(`adb` ไม่ได้อยู่บน PATH ต้องเรียกด้วย path เต็มแบบข้างบน)

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
