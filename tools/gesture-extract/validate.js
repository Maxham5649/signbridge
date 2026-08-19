/* Leave-one-out cross-validation: สำหรับทุกคลิปที่มี ลบตัวเองออกจาก
   reference pool ชั่วคราว แล้วดูว่า nearest-neighbor (DTW) จาก pool ที่
   เหลือ เป็นคำเดียวกันไหม — เช็คว่าข้อมูลที่สกัดมาแยกคำออกจากกันได้จริง
   ก่อนเอาไปใช้งานจริง ไม่ใช่แค่ "detect มือติด" เฉย ๆ */
const fs = require('fs');
const path = require('path');
const { dtwDistance } = require(path.resolve(__dirname, '..', '..', 'signRecognition.js'));

const { refs } = JSON.parse(fs.readFileSync(path.join(__dirname, 'gesture-refs.json'), 'utf8'));

// แตกเป็น list เดี่ยว ๆ ของ {label, seq}
const items = [];
for (const label of Object.keys(refs)) {
  for (const seq of refs[label]) items.push({ label, seq });
}
console.log('total sequences:', items.length, 'labels:', Object.keys(refs).length);

let correct = 0;
let wrong = [];
for (let i = 0; i < items.length; i++) {
  const query = items[i];
  let best = null;
  let bestDist = Infinity;
  for (let j = 0; j < items.length; j++) {
    if (i === j) continue;
    const d = dtwDistance(query.seq, items[j].seq);
    if (d < bestDist) { bestDist = d; best = items[j]; }
  }
  if (best && best.label === query.label) {
    correct++;
  } else {
    wrong.push({ query: query.label, matchedTo: best ? best.label : '(none)', dist: bestDist.toFixed(3) });
  }
}

console.log(`\nnearest-neighbor accuracy: ${correct}/${items.length} (${((correct/items.length)*100).toFixed(1)}%)`);
if (wrong.length) {
  console.log('\nผิด (nearest neighbor เป็นคำอื่น):');
  wrong.forEach((w) => console.log(`  ${w.query} -> nearest คือ "${w.matchedTo}" (dist ${w.dist})`));
}
