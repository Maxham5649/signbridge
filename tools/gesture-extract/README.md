# gesture-extract

สคริปต์ประมวลผลครั้งเดียว (offline) ที่สกัดจุดมือ (landmarks) จากคลิป
ภาษามือจริงใน `signs/` ด้วย MediaPipe HandLandmarker แล้ว export เป็น
`signGestureVocab.js` — คลังท่าอ้างอิงกลางของ Phase 2 (ภาษามือ→ภาษาพูด)
ที่ทุกคนใช้ร่วมกันทันที ไม่ต้องฝึกเอง

ไม่ใช่ส่วนหนึ่งของแอพที่ deploy จริง (ไม่มี `<script>` อ้างถึงไฟล์ในนี้เลย)
รันเฉพาะตอนจะเพิ่ม/แก้คำในคลัง Phase 2

## ติดตั้ง (ครั้งแรกเท่านั้น)

```
cd tools/gesture-extract
npm install
npx playwright install chromium
```

## รันใหม่ทั้งชุด

1. แก้ `pilot-list.json` ให้มีคำที่ต้องการ (แต่ละ entry ต้องมี `id`,
   `label`, `videos: [...]` — path relative จาก root โปรเจกต์ ตรงกับ
   `signVocab.js`) หรือ regenerate จาก `signVocab.js` ด้วย:
   ```
   node -e "const fs=require('fs');const v=new Function(fs.readFileSync('../../signVocab.js','utf8')+';return SIGN_VOCAB;')();fs.writeFileSync('pilot-list.json',JSON.stringify(v.filter(e=>[...]).includes(e.label)),null,2))"
   ```
   (แก้ filter ให้ตรงกับคำที่ต้องการ)

2. รัน:
   ```
   node run-extract-all.js
   ```
   จะเขียนทับ `../../signGestureVocab.js` (ไฟล์จริงที่แอพโหลด) และ
   `gesture-refs.json` (debug — เก็บ raw sequences + รายงานต่อคลิป)

3. ตรวจคุณภาพก่อนเชื่อ:
   ```
   node validate-full.js
   ```
   leave-one-out cross-validation ผ่าน `matchSignSequence()` ตัวจริง
   (รัศมี + ratio test) — ดูว่ามี `wrong` (ฟันธงผิดคำ) กี่ตัว ควรเป็น 0
   เสมอ ส่วน `too-far`/`ambiguous` คือระบบ "ไม่มั่นใจ" ซึ่งปลอดภัยกว่า
   ฟันธงผิด แต่มากไปก็แปลว่าใช้งานไม่ค่อยติด — คำที่มีคลิปเดียวจะโดน
   `too-far` เสมอด้วยวิธีทดสอบนี้ (ไม่มีคู่เทียบ ไม่ใช่ตัวชี้วัดคุณภาพจริง)

## ข้อจำกัดที่รู้อยู่แล้ว

- **seek ใช้ไม่ได้ใน headless Chromium** — `extract.html` เล่นคลิปผ่าน
  ต่อเนื่องแล้วสุ่มตัวอย่างระหว่างเล่นแทน (ดู comment ในไฟล์)
- **ทดสอบคลิป-เทียบ-คลิป ≠ คน-เทียบ-คลิป** — validate-full.js เทียบ
  reference กับ reference (ถ่ายในสภาพแวดล้อมเดียวกัน) ยังไม่พิสูจน์ว่า
  คนทำท่าสดผ่านกล้องมือถือคนละสภาพแวดล้อมจะแม่นเท่านี้ ต้องทดสอบจริง
- คำที่ความหมายเหมือนกันเป๊ะ (เช่น "ทำยังไง"/"ทำอย่างไร") อาจท่าเดียวกัน
  จริงในภาษามือไทย — ระบบจะแยกไม่ออก ไม่ใช่บั๊ก
