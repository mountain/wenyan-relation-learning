/**
 * Content fixtures for wenyan.corpus.v1.
 *
 *   node tools/corpus/check-fixtures.mjs
 *
 * Two kinds of assertion, both derived from reading the actual source pages
 * (not from memory of the classics):
 *
 *   PRESENT  a sentence that exists verbatim on the Wikisource page must survive
 *            into the corpus. This catches silent text deletion — the failure
 *            mode that actually occurred here: `{{另|苢|苡}}` was dropped whole,
 *            turning 采采芣苢 into 采采芣.
 *
 *   ABSENT   editorial apparatus that the build deliberately removes must NOT
 *            appear. This catches the opposite failure: commentary leaking in,
 *            e.g. 王弼注, 楊倞-style 夾注, <ref> footnotes, 毛詩序.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../../data/corpus');

const PRESENT = [
  ['analects', '學而 opening', '子曰：「學而時習之，不亦說乎？'],
  ['analects', '爲政 引書', '孝乎惟孝，友於兄弟'],
  ['mencius', '梁惠王上 opening', '孟子見梁惠王'],
  ['mencius', '梁惠王上 仁義', '亦有仁義而已矣'],
  ['great-learning', 'opening', '大學之道，在明明德'],
  ['doctrine-of-the-mean', 'opening', '天命之謂性'],
  ['classic-of-poetry', '七月', '七月流火，九月授衣'],
  ['classic-of-poetry', '芣苢 (variant-template regression)', '采采芣苢'],
  ['classic-of-poetry', '芣苢 末章 (rare glyph survived)', '薄言襭之'],
  ['classic-of-poetry', '關雎', '關關雎鳩'],
  ['book-of-documents', '堯典 opening', '曰若稽古'],
  ['zhouyi', '乾 卦辭', '元亨。利貞'],
  ['zhouyi', '乾 彖', '大哉乾元，萬物資始'],
  ['book-of-rites', '曲禮上', '毋不敬，儼若思'],
  ['laozi', '一章', '道可道，非常道'],
  ['laozi', '一章 下句', '名可名，非常名'],
  ['zhuangzi', '逍遙遊 opening', '北冥有魚，其名爲鯤'],
  ['xunzi', '勸學 opening', '君子曰：學不可以已'],
  ['xunzi', '勸學 青出於藍', '取之於藍而靑於藍'],
  ['hanfeizi', '初見秦 opening', '不知而言，不智；知而不言，不忠'],
  ['mozi', '親士 opening', '入國而不存其士，則亡國矣'],
  ['guanzi', '牧民 opening', '凡有地牧民者，務在四時，守在倉廩'],
  ['liezi', '天瑞篇 opening', '子列子居鄭圃'],
  ['sunzi', '始計 opening', '兵者，國之大事，死生之地'],
];

const ABSENT = [
  ['laozi', '王弼注 must be removed', '可道之道，可名之名，指事造形'],
  ['laozi', '音義 appendix must be removed', '老子道經音義'],
  ['xunzi', 'inline 夾注 must be removed', '以喩學則才過其本性也'],
  ['classic-of-poetry', '毛詩序 must be removed', '毛詩序'],
  ['classic-of-poetry', '章句 note must be removed', '章四句'],
  ['classic-of-poetry', '三家詩說 must be removed', '齊詩說'],
  ['book-of-documents', 'ref footnote must be removed', '實用甲骨文字典'],
  ['zhouyi', 'conversion marker must be removed', '-{'],
  ['analects', 'header template must be removed', '{{header'],
  ['sunzi', '答話 appendix must be removed', '吳王問孫武曰'],
];

function loadCorpus() {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('manifest.json not found — run tools/corpus/build.mjs first');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const texts = new Map();
  for (const w of manifest.works ?? []) {
    if (!w.file) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, w.file), 'utf8'));
    texts.set(w.id, {
      doc,
      title: doc.title.zh,
      all: doc.sections.map((s) =>
        `${s.title}\n` + s.passages.map((p) => p.text).join('\n')).join('\n'),
      anchors: new Set(doc.sections.flatMap((s) => s.passages.map((p) => p.sourceAnchor)).filter(Boolean)),
      sections: new Set(doc.sections.map((s) => s.title)),
    });
  }
  return { manifest, texts };
}

const { texts } = loadCorpus();
let pass = 0;
const failures = [];

for (const [id, label, needle] of PRESENT) {
  const t = texts.get(id);
  if (!t) { failures.push(`PRESENT ${id}: work missing`); continue; }
  if (t.all.includes(needle)) pass++;
  else failures.push(`PRESENT ${id} [${label}]: NOT FOUND ${JSON.stringify(needle)}`);
}

for (const [id, label, needle] of ABSENT) {
  const t = texts.get(id);
  if (!t) { failures.push(`ABSENT ${id}: work missing`); continue; }
  if (!t.all.includes(needle)) pass++;
  else failures.push(`ABSENT ${id} [${label}]: STILL PRESENT ${JSON.stringify(needle)}`);
}

// structural spot-checks
const checks = [];
const a = texts.get('analects');
checks.push(['analects anchors lifted', a.anchors.size >= 400, `${a.anchors.size} anchors`]);
checks.push(['analects 學而第一 section', a.sections.has('學而第一'), [...a.sections].slice(0, 3).join(',')]);
const p = texts.get('classic-of-poetry');
checks.push(['poetry 305 poems', p.doc.sections.length === 305, String(p.doc.sections.length)]);
const z = texts.get('zhouyi');
checks.push(['zhouyi 64 hexagrams', z.doc.sections.length === 64, String(z.doc.sections.length)]);
const l = texts.get('laozi');
checks.push(['laozi 81 chapters', l.doc.sections.length === 81, String(l.doc.sections.length)]);
for (const [label, ok, detail] of checks) {
  if (ok) pass++;
  else failures.push(`STRUCT ${label}: ${detail}`);
}

console.log(`[fixtures] ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log('  !', f);
process.exit(failures.length ? 1 : 0);
