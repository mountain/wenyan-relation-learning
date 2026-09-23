/**
 * Cleaner regressions: one case per bug actually hit while building the corpus.
 *
 *   node tools/corpus/selftest.mjs
 *
 * Every case below corresponds to a real defect found in this project, not a
 * hypothetical. They are kept together because each one was a SILENT failure:
 * the build succeeded, the output looked like coherent text, and the loss was
 * only visible by measuring.
 */
import { cleanWikitext, cleanInline, splitSections, splitPassages, demoteHeadings } from './lib/wikitext.mjs';

const cases = [];
const check = (name, fn) => {
  try { cases.push({ name, ok: true, detail: fn() ?? 'ok' }); }
  catch (e) { cases.push({ name, ok: false, detail: e.message }); }
};
const eq = (got, want, what = 'text') => {
  if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  return JSON.stringify(got);
};
const clean = (raw, opts) => cleanWikitext(raw, opts).text;

check('content templates keep their text (the original 采采芣苢 loss)', () =>
  eq(clean('采采芣{{另|苢|苡}}，薄言采之。'), '采采芣苢，薄言采之。'));

check('{{專}}/{{書}} keep proper nouns and book titles (史記: 1672 專名)', () =>
  eq(clean('{{專|黃帝}}者，{{專|少典}}之子。'), '黃帝者，少典之子。'));

check('{{YL}} keeps the regnal year, drops the editorial conversion', () =>
  eq(clean('{{YL|元年|前722年}}，春，王正月。'), '元年，春，王正月。'));

check('{{*|…}} is KEPT by default (公羊傳: the 傳文 lives there)', () =>
  eq(clean('元年春，王正月。{{*|元年者何？君之始年也。}}'), '元年春，王正月。元年者何？君之始年也。'));

check('{{*|…}} is dropped when the work declares it as annotation (裴注/師古注)', () =>
  eq(clean('太祖武皇帝，沛國譙人也。{{*|〔《曹瞞傳》曰：太祖一名吉利。〕}}', { dropAnnotation: true }),
    '太祖武皇帝，沛國譙人也。'));

check('{{*s}}…{{*e}} drops the whole REGION, not just the delimiters', () =>
  eq(clean('正文{{*s}}《魏書》曰：此為裴注，非正文。{{*e}}續正文。', { dropAnnotation: true }),
    '正文續正文。'));

check('<sub> annotation is dropped when declared (文獻通考: 8531 notes)', () =>
  eq(clean('冀州：厥土白壤<sub>無塊曰壤</sub>，厥田惟中中<sub>田第五</sub>。', { dropElements: ['sub'] }),
    '冀州：厥土白壤，厥田惟中中。'));

check('declared commentary templates are dropped (史記 三家注 via green/deepPink)', () =>
  eq(clean('{{green|【集解】蘇林曰：「音打。」}}正文。', { dropTemplates: ['green'] }), '正文。'));

check('NESTED conversion markers unwrap innermost-first (史記: 爲變-{-{徴}-}-之聲)', () =>
  eq(clean('爲變-{-{徴}-}-之聲'), '爲變徴之聲'));

check('an unbalanced {{ never deletes trailing text (論語 lost 3 passages once)', () => {
  const out = clean('子曰：「學而時習之。」{{header2 | title = 論語');
  if (!out.includes('學而時習之')) throw new Error(`trailing text was deleted: ${JSON.stringify(out)}`);
  return `kept: ${JSON.stringify(out.slice(0, 24))}…`;
});

check('section titles are cleaned of markup (荀子/詩經 titles leaked [[..]] and {{..}})', () => {
  eq(cleanInline('[[勸學篇]]第一'), '勸學篇第一', 'title');
  eq(cleanInline('宥坐篇第二十八{{*|以下皆荀卿及弟子所引}}'), '宥坐篇第二十八', 'title');
  return 'both cleaned';
});

check('heading markup never survives into passage text (=== 註釋 ===)', () => {
  const secs = splitSections('==國風==\n\n正文甲。\n\n===註釋===\n\n注文乙。');
  const titles = secs.map((s) => s.title);
  const body = secs.map((s) => s.body).join('\n');
  if (body.includes('===')) throw new Error('heading markup leaked into the body');
  if (!titles.includes('註釋')) throw new Error(`註釋 was not recognised as a section: ${JSON.stringify(titles)}`);
  return `sections: ${JSON.stringify(titles)}`;
});

check('list/verse markers are stripped, line breaks kept', () => {
  // Must go through cleanWikitext: normalizeLines() is what strips the markers,
  // and calling splitPassages() on raw wikitext (as an earlier version of this
  // case did) tests nothing about the real path.
  const cleaned = clean('*甲。\n:乙。\n\n#丙。');
  const p = splitPassages(cleaned);
  eq(p.length, 2, 'passage count');
  eq(p[0].text, '甲。\n乙。');
  return `${p.length} passage(s): ${JSON.stringify(p.map((x) => x.text))}`;
});

check('an EMPTY heading does not yield an untitled section (廣異記 == ==)', () => {
  // `??` does not fall back on an empty string, so a literal `== ==` in the source
  // produced a section with title "" that only the format validator noticed.
  const secs = splitSections('==甲==\n\n正文甲。\n\n== ==\n\n正文乙。');
  const titles = secs.map((x) => x.title);
  if (titles.some((x) => x === '')) throw new Error(`empty string title survived: ${JSON.stringify(titles)}`);
  if (titles[1] !== null) throw new Error(`blank heading should normalise to null, got ${JSON.stringify(titles[1])}`);
  return `titles: ${JSON.stringify(titles)} — blank normalised to null, never ''`;
});

check('every behaviour switch is removed, not just the three that were listed (文選 __FORCETOC__)', () => {
  // The cleaner named __NOTOC__/__NOEDITSECTION__/__TOC__ literally, so the fourth
  // and commonest one shipped as base text: 66 passages across 文選/漢書/史記/三國志
  // contained the literal string "__FORCETOC__".
  const r = cleanWikitext('__FORCETOC__\n\n賦甲者，舊題甲乙。\n__NEWSECTIONLINK__');
  eq(/__[A-Z]+__/.test(r.text), false, 'no switch survives');
  eq(r.text, '賦甲者，舊題甲乙。');
  return `removed ${r.stats.behaviourSwitches} switch(es) and reported the count`;
});

check('navigation breadcrumbs are dropped (周禮/春秋穀梁傳 「上一篇　回目录　下一篇」)', () => {
  // Relative links on their own line are read back by stripLinks() as ordinary
  // text, so 周禮's 地官司徒 opened with 「上一篇　回目录　下一篇」 as its first passage.
  const r = cleanWikitext('[[../天官冢宰|上一篇]]　[[../|回目录]]　[[../春官宗伯|下一篇]]\n\n惟王建國，辨方正位。');
  eq(r.text, '惟王建國，辨方正位。');
  eq(r.stats.navigationLines, 1, 'navigation line count');
  // The same rule must catch the absolute form and leave real text alone.
  eq(clean('[[周禮/天官冢宰|上一篇]]　[[周禮/春官宗伯|下一篇]]\n\n惟王建國。'), '惟王建國。');
  eq(clean('《周禮》有上一篇之說，此非導航。'), '《周禮》有上一篇之說，此非導航。');
  return 'relative and absolute forms dropped; prose containing the same words kept';
});

check('a glossed reading-aid line is dropped (四書章句集註 全覽)', () => {
  const r = cleanWikitext('*[[論語/全覽|全覽]]（將全篇放在同一頁中閱讀，無註）\n\n子曰：「學而時習之。」');
  eq(r.text, '子曰：「學而時習之。」');
  eq(r.stats.navigationLines, 1, 'navigation line count');
  return 'the 全覽 line went; the 論語 text stayed';
});

check('unsplit heading levels are DEMOTED, not left as markup (文選 =賦甲=, 漢書 =薛宣=)', () => {
  // splitSections() splits levels 2-4 by design and leaves level 1 in the body as a
  // part marker — but leaving the MARKUP there put `=` into 154 passages. The label
  // is kept as plain text rather than deleted, so 薛宣 still marks the 傳 that follows.
  const d = demoteHeadings('=賦甲=\n賦甲者，舊題甲乙。\n\n==甲==\n\n正文甲。\n\n=====註=====\n注文乙。');
  eq(d.demoted, 2, 'demoted count');
  if (d.text.includes('=賦甲=')) throw new Error('level-1 markup survived');
  if (d.text.includes('=====註=====')) throw new Error('level-5 markup survived');
  if (!d.text.includes('==甲==')) throw new Error('a level-2 heading was demoted as well');
  eq(d.text.split('\n')[0], '賦甲', 'level-1 label kept as text');
  eq(d.text.trim().endsWith('註\n注文乙。'), true, 'level-5 label kept as text');
  return `demoted ${d.demoted} heading line(s); labels preserved, delimiters removed`;
});

let failed = 0;
for (const c of cases) {
  if (!c.ok) failed++;
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
  console.log(`       ${c.detail}`);
}
console.log(`\n[corpus-selftest] ${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
