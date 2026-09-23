/**
 * THE QUESTION LIST FOR A SPECIALIST.
 *
 * 罗小虎 ruled on nine variant pairs on 2026-09-23 and his ruling cut the table's claimed gain from
 * +44 to +12. That was not a setback: it was the first time this project had a criterion instead of
 * a guess, and it showed the questions are answerable CHEAPLY — one word per pair — provided the
 * specialist is shown the witnesses rather than asked to recall a dictionary.
 *
 * So this tool builds the list it wishes it had had: every pair the corpus actually proposes, with
 * the count of citations it would explain and the two texts side by side, and with the pairs already
 * ruled on REMOVED (asking twice wastes a specialist's time and suggests we did not record the
 * first answer).
 *
 * It also states, for each question, what the answer will DO. A question whose consequence is not
 * stated invites "看情况", which is how 普→溥 and 緡→緜 were left unresolved in the first place.
 *
 *   node tools/questions/for-expert.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const variants = read('knowledge/intertext/variants.json');
const cand = read('knowledge/intertext/variant-candidates.json');

const ruledOn = new Set();
for (const e of [...variants.accepted, ...variants.measuredNotAdmitted.measured]) {
  const c = e.relation ?? e.relationClass;
  if (c && c !== '未判定') ruledOn.add(e.from + e.to);
}
const projectCalls = new Set(variants.accepted.map((e) => e.from + e.to));

/** The candidate count and the gain in variants.json answer DIFFERENT questions: the candidate
 *  count is how many citations this pair would explain in the one-character-difference scan, while the
 *  gain is the marginal increase in matched citations after normalising globally. 惟/維 reads 8 and 17.
 *  Both are reported so a specialist is not asked to reconcile two numbers that look contradictory. */
const measuredGain = new Map([...variants.accepted, ...variants.measuredNotAdmitted.measured]
  .map((e) => [e.from + e.to, e.gain ?? e.measuredGain ?? null]));
const open = cand.candidates
  .filter((c) => !ruledOn.has(c.hostChar + c.sourceChar))
  .sort((a, b) => b.count - a.count);
const closed = cand.candidates.filter((c) => ruledOn.has(c.hostChar + c.sourceChar));

const cls = Object.entries(variants.relationClasses)
  .filter(([k]) => !k.startsWith('_'))
  .map(([k, v]) => `| ${k} | ${v.countsAsOrthographicGain ? '可' : '不可'} | ${v.definition} |`);

const lines = [];
lines.push('# 问 罗小虎：文字关系与版本（第 1 轮）', '');
lines.push(`生成于 ${new Date().toISOString().slice(0, 10)}，由 \`tools/questions/for-expert.mjs\` 从语料实测生成，不是手写的。`, '');
lines.push('## 怎么答最省事', '');
lines.push('每条只要**一个词**：异体字 / 异写 / 古今字 / 通用字 / 通假字 / 异文 / 不同字 / 存疑。', '');
lines.push('不确定就写「存疑」——我们记成**未判定**，且**不计收益**。不答比错答安全得多：', '');
lines.push('上次 +44 里有 +32 是不能计的（不同字 10、通假 2、未判定 20），当时表里却写着「attested variant」。', '');
lines.push('', '## 类别表（按您 2026-09-23 的口径）', '');
lines.push('| 类别 | 可否据此改写文本 | 定义 |', '|---|---|---|');
lines.push(...cls, '');
lines.push('总原则（您的话）：**异体、异文、通假等这么说比较准确，但其实要看具体文章**。', '');
lines.push('## 一、已经按您的话记下的（请否决或确认，不必重答）', '');
for (const t of variants.expertTestimony) {
  const pairs = t.appliesTo.map(([a, b]) => a + '/' + b).join('、');
  lines.push(`- ${t.statement}${pairs ? `　→ 记为 ${pairs}` : ''}`);
}
lines.push('');
lines.push(`已判定的候选对 ${closed.length} 组，已从下面的问题里剔除（不重复问）：`
  + closed.map((c) => c.hostChar + '/' + c.sourceChar).join('、') + '。', '');
lines.push('## 二、待判定（按**可解引用条数**排序，共 ' + open.length + ' 组，下面列前 15 组）', '');
lines.push('「可解」= 若判为**同一个字的两种写法**，这些引用就能自动匹配上；判为不同字则一条都不解，我们也不会去解。', '');
for (const c of open.slice(0, 15)) {
  lines.push('', `### ${c.hostChar} / ${c.sourceChar}　可解 ${c.count} 条`
    + (projectCalls.has(c.hostChar + c.sourceChar) ? '　**（本项目暂用类别，待您裁定）**' : ''));
  for (const w of c.witnesses.slice(0, 2)) {
    lines.push(`- ${w.host} 引 ${w.cited}：\`${w.quote}\``);
    lines.push(`  - 出处 ${w.sourceAt.section}#${w.sourceAt.passageId} 作：\`${w.sourceWindow}\``);
  }
  const g = measuredGain.get(c.hostChar + c.sourceChar);
  lines.push(`- 影响：判为同字写法 → 解 ${c.count} 条（本表口径；`
    + (g !== null && g !== undefined ? `variants.json 的实测边际收益是 +${g}，口径不同、不必对上` : '尚无实测边际收益')
    + `）；判为不同字 → 0 条，且此对永久移出候选（不再提议）。`);
}
lines.push('', `其余 ${Math.max(0, open.length - 15)} 组在 \`knowledge/questions/expert-round-1.json\` 里，格式一样，可直接在文件里填 \`relation\` 字段。`, '');
lines.push('## 三、口径问题（4 条）', '');
lines.push('1. **年代范围怎么记**：您说 緡/緜「要看年代，在先秦或早期应该是两个字」。我们想记成「对 + 适用范围」，'
  + '范围由谁定？(a) 我们按先秦／汉以后粗分并标出处 (b) 您给一份清单 (c) 只记「先秦为两字」这一条。');
lines.push('2. **於/于**：本项目暂归「通用字」，18 条引用依赖它。若您判为两个字或异文，这 18 条要撤——'
  + '撤得掉，所以请您直接判，不要客气。');
lines.push('3. **版本**：您此前说「先依照公认的好的版本来推进，保留后来修改的口子」。现在每部书记的是维基文库页面 + 页面版本号'
  + '（可回溯到具体 revision）。能否给一份公认善本清单，或至少指出底本明显不对的书？');
lines.push('4. **同名篇目**：詩經 揚之水 ×3、羔裘 ×3 等，同一部书里出现同名篇目（怀疑是同题异篇）。'
  + '要不要在标题上加首句区分？加会改标题（记录会跟着变），所以先问。');
lines.push('', '## 四、您的判定之后会发生什么', '');
lines.push('- 每对必须声明类别，**代码强制**：没类别或类别不可计的，`tools/intertext/extract.mjs` 直接报错，不会悄悄用来改写文本。');
lines.push('- **未判定 = 不计收益**，也不会被当成异体字用。');
lines.push('- 判定带**范围**（篇目／时代），因为您说类别随文章与年代而变，我们不把它当全局常量。');
lines.push('- 引用的匹配数会**重新测量**，涨跌都照实报——上次 +44 → +12 就是照实报的。');

const md = lines.join('\n') + '\n';
const form = {
  schema: 'wenyan.questions.expert-fill-in.v1',
  generatedAt: new Date().toISOString(),
  instructions: '每对填 relation（异体字／异写／古今字／通用字／通假字／异文／不同字／存疑），可加 basis 与 scope（篇目或时代）。存疑按未判定处理，不计收益。',
  classes: Object.fromEntries(Object.entries(variants.relationClasses).filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [k, { countsAsOrthographicGain: v.countsAsOrthographicGain, definition: v.definition }])),
  alreadyRuled: closed.map((c) => ({
    pair: c.hostChar + '/' + c.sourceChar, count: c.count,
    relation: [...variants.accepted, ...variants.measuredNotAdmitted.measured]
      .find((e) => e.from === c.hostChar && e.to === c.sourceChar)?.relation ?? null,
  })),
  open: open.map((c) => ({
    from: c.hostChar, to: c.sourceChar, citationsExplained: c.count, relation: null, basis: null, scope: null,
    witness: c.witnesses[0] ? `${c.witnesses[0].host} 引 ${c.witnesses[0].cited}：${c.witnesses[0].quote}`
      + ` ／ 出处作：${c.witnesses[0].sourceWindow}` : null,
  })),
};

console.log(`[for-expert] 待判定 ${open.length} 组，已判定（不再问） ${closed.length} 组`);
console.log('  前 8 组：' + open.slice(0, 8).map((c) => `${c.hostChar}/${c.sourceChar}(${c.count})`).join(' '));
if (argv.includes('--write')) {
  const d = path.join(ROOT, 'knowledge/questions');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'expert-round-1.md'), md);
  fs.writeFileSync(path.join(d, 'expert-round-1.json'), JSON.stringify(form, null, 2) + '\n');
  console.log('[written] knowledge/questions/expert-round-1.md, expert-round-1.json');
}
