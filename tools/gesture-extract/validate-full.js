/* ทดสอบตรรกะจับคู่แบบเดียวกับ matchSignSequence() จริง (รัศมีตาม spread +
   ratio test ต้องชนะอันดับสองชัดเจน) — reimplement ตรงนี้แทนพึ่งพา
   localStorage/module-cache ของ signRecognition.js (ซึ่งไม่ได้ export
   ฟังก์ชันรีเซ็ต cache ให้เทสจากนอกไฟล์ได้) ใช้ dtwDistance/computeSpreads/
   DEFAULT_MATCH_CONFIG ตัวจริงที่ export ไว้แล้ว ตรรกะเหมือนต้นฉบับ 100% */
const fs = require('fs');
const path = require('path');
const { dtwDistance, computeSpreads, DEFAULT_MATCH_CONFIG } = require(path.resolve(__dirname, '..', '..', 'signRecognition.js'));

const { refs } = JSON.parse(fs.readFileSync(path.join(__dirname, 'gesture-refs.json'), 'utf8'));
const cfg = DEFAULT_MATCH_CONFIG;

function acceptRadiusFor(label, spreads) {
  const spread = spreads[label];
  const radius = spread === null || spread === undefined ? cfg.singleSampleRadius : spread * cfg.spreadK;
  return Math.min(radius, cfg.acceptCeiling);
}

function matchAgainst(liveSeq, pool) {
  const labels = Object.keys(pool);
  if (labels.length === 0) return { accepted: false, reason: 'no-training' };
  const spreads = computeSpreads(pool);
  const ranked = labels.map((label) => ({
    label,
    distance: Math.min(...pool[label].map((refSeq) => dtwDistance(liveSeq, refSeq))),
    radius: acceptRadiusFor(label, spreads),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const runnerUp = ranked[1] || null;
  if (best.distance > best.radius) return { accepted: false, reason: 'too-far', best, runnerUp };
  if (runnerUp && best.distance > runnerUp.distance * cfg.ratio) return { accepted: false, reason: 'ambiguous', best, runnerUp };
  return { accepted: true, label: best.label, best, runnerUp };
}

const items = [];
for (const label of Object.keys(refs)) refs[label].forEach((seq, idx) => items.push({ label, idx, seq }));

let correct = 0, ambiguous = 0, tooFar = 0, wrongLabel = 0;
const details = [];

for (const item of items) {
  const pool = {};
  for (const label of Object.keys(refs)) {
    const seqs = refs[label].filter((_, i) => !(label === item.label && i === item.idx));
    if (seqs.length > 0) pool[label] = seqs;
  }
  const result = matchAgainst(item.seq, pool);
  let verdict;
  if (!result.accepted) {
    verdict = result.reason;
    if (result.reason === 'ambiguous') ambiguous++;
    else tooFar++;
  } else if (result.label === item.label) {
    verdict = 'correct';
    correct++;
  } else {
    verdict = 'wrong:' + result.label;
    wrongLabel++;
  }
  details.push({ label: item.label, idx: item.idx, verdict, dist: result.best ? result.best.distance.toFixed(2) : '-' });
}

console.log('total:', items.length);
console.log('correct:', correct, '| ambiguous (ปฏิเสธเพราะก้ำกึ่ง):', ambiguous, '| too-far (ปฏิเสธเพราะไกลเกิน):', tooFar, '| wrong (ฟันธงผิดคำ):', wrongLabel);
console.log();
details.filter((d) => d.verdict !== 'correct').forEach((d) => console.log(` ${d.label}[${d.idx}] -> ${d.verdict} (dist ${d.dist})`));
