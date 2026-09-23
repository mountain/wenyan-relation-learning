/**
 * Wikisource wikitext -> plain base text.
 *
 * Scope and honesty: this is a deliberately narrow cleaner for the structures
 * actually present in the core-set pages. It is not a general MediaWiki parser.
 * Every transformation that drops content is counted and reported, so a build
 * can state exactly what it removed (annotations, templates, non-text markup)
 * instead of silently discarding it.
 *
 * Handled structures (verified against sampled pages):
 *   {{header}}/{{header2}}/{{Header}} metadata, {{versions}}, {{Textquality}},
 *   {{PD-old}}, navboxes            -> removed (templates)
 *   {{*|...}}                       -> inline annotation, removed (counted)
 *   {{:Work/Chapter}}               -> transclusion, resolved BEFORE cleaning
 *   <onlyinclude>...</onlyinclude>  -> bounds the base text when present
 *   <poem>/<div>/<span>/<u>/<CENTER>, <templatestyles/>, <references/>,
 *   <section begin/end/>            -> markup removed, inner text kept
 *   [[a|b]] -> b ; [[File:..]]/[[Category:..]] -> removed
 *   -{T|..}- , -{H|..}-             -> removed ; -{乾}- -> 乾
 *   leading ':' '*' '#' ';' markers -> stripped (list/verse depth is flattened)
 *   __NOTOC__ / __NOEDITSECTION__   -> removed
 */
import { createHash } from 'node:crypto';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Remove HTML comments. */
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * If the page wraps its base text in <onlyinclude>, take only that region.
 * Some pages put the poem inside onlyinclude while the 毛詩序 / 註釋 sit outside.
 */
function boundOnlyinclude(text) {
  const m = text.match(/<onlyinclude>([\s\S]*?)<\/onlyinclude>/i);
  return m ? m[1] : text;
}

/** Template names transcluded on a page, e.g. `{{:韓非子/初見秦}}` -> 韓非子/初見秦 */
export function transclusionTargets(text) {
  const out = [];
  for (const m of text.matchAll(/\{\{\s*:\s*([^|}\n]+?)\s*\}\}/g)) out.push(m[1].trim());
  return out;
}

/**
 * Templates whose FIRST parameter is the base text, not metadata. Getting this
 * list wrong silently deletes characters: `采采芣{{另|苢|苡}}` must yield
 * `采采芣苢`, and an earlier build that dropped every template produced
 * `采采芣` (330 `{{另|…}}` occurrences corpus-wide). Each was verified by
 * reading its actual usages:
 *
 *   另 / 另2   variant reading:   {{另|耄|眊、旄}}        -> 耄
 *   參 / 参    text + gloss:      {{參|來格汝說|有學者…}}  -> 來格汝說
 *   ProperNoun display wrapper:   {{ProperNoun|帝堯}}     -> 帝堯
 *   ! / 僻字   rare glyph:        {{!|𱯇|⿰王叕}}           -> 𱯇
 *   + / -      formatting wrapper {{+|國風‧邶}}           -> 國風‧邶
 *   ruby       reading annotation {{ruby|杕|dì}}          -> 杕
 *
 * `？` marks an unidentified glyph given only as an IDS decomposition
 * ({{？|⿰耒殳}}); its parameter is kept so the lacuna stays visible, and counted
 * separately as uncertainGlyphs.
 */
const CONTENT_TEMPLATES = new Map([
  ['另', 0], ['另2', 0], ['參', 0], ['参', 0],
  ['!', 0], ['僻字', 0], ['ProperNoun', 0],
  ['+', 0], ['-', 0], ['ruby', 0],
  // Added after scanning the four history works (tools/corpus/build.mjs covers
  // 史記/漢書/三國志/文獻通考). Each of these wraps BASE TEXT, and dropping it
  // would delete the text inside: 史記 alone carries 1672 {{專}} proper nouns.
  ['專', 0],            // 專名:      {{專|黃帝}}        -> 黃帝
  ['書', 0],            // 書名:      {{書|札記}}        -> 札記
  ['標', 0],            // 標記引文:  {{標|幼而徇齊}}    -> 幼而徇齊
  ['YL', 0],            // 紀年:      {{YL|元年|前722年}} -> 元年
  ['ul', 0],            // 專名下劃線 {{ul|倭人}}       -> 倭人
  ['WavyBookMark', 0],  // 波浪書名號 {{WavyBookMark|傅子}} -> 傅子
  ['別', 0],            // 異文:      {{別|禦|御}}       -> 禦
  ['校', 0],            // 校異:      {{校|歷山|歷陽}}   -> 歷山
  ['quote', 0],         // 引文區塊（正文）
  ['blue', 0], ['red', 0], ['~~', 0], ['PUA', 0],
]);

/**
 * Templates that carry COMMENTARY, declared per work because the same wrapper
 * means different things in different works: in 史記 `green`/`deepPink` wrap
 * 【集解】【索隱】 (three-commentary apparatus), while in 漢書 `blue`/`red` wrap
 * the base text (memorials and quoted speech). A global list would be wrong.
 */
const COMMENTARY_TEMPLATE_NAMES = new Set([
  'green', 'deepPink', 'annotate', '註', '註釋',
]);
const GLYPH_PLACEHOLDER_TEMPLATES = new Set(['？']);

/** Split a template body on top-level `|` (brace- and link-aware). */
function splitTemplateParams(inner) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner.startsWith('{{', i)) { depth++; cur += '{{'; i++; continue; }
    if (inner.startsWith('}}', i)) { depth--; cur += '}}'; i++; continue; }
    if (inner.startsWith('[[', i)) { depth++; cur += '[['; i++; continue; }
    if (inner.startsWith(']]', i)) { depth--; cur += ']]'; i++; continue; }
    if (inner[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  parts.push(cur);
  return parts;
}

/**
 * Strip templates with a real brace-matching scanner (handles nesting).
 *
 * Safety properties:
 *  - an unbalanced `{{` never deletes trailing text; the two brace characters
 *    alone are dropped and counted, so a malformed page cannot truncate the run;
 *  - content-bearing templates keep their text parameter (see above) instead of
 *    being deleted as metadata.
 */
function stripTemplates(text, stats, depth = 0, opts = {}) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      let level = 0;
      let j = i;
      let end = -1;
      while (j < text.length - 1) {
        if (text.startsWith('{{', j)) { level++; j += 2; continue; }
        if (text.startsWith('}}', j)) { level--; j += 2; if (level === 0) { end = j; break; } continue; }
        j++;
      }
      if (end < 0) { stats.unbalancedTemplates++; i += 2; continue; }
      const inner = text.slice(i + 2, end - 2);
      const params = splitTemplateParams(inner);
      const name = params[0].trim();
      const keepFirst = (label) => {
        stats[label] = (stats[label] ?? 0) + 1;
        const kept = params.length > 1 ? params[1] : '';
        // Nested templates inside the kept text still need cleaning.
        out += depth < 6 ? stripTemplates(kept, stats, depth + 1, opts) : kept;
      };
      const dropList = opts.dropTemplates ?? [];
      if (dropList.includes(name) || COMMENTARY_TEMPLATE_NAMES.has(name) && opts.declareCommentary) {
        stats.declaredTemplatesDropped = (stats.declaredTemplatesDropped ?? 0) + 1;
      }
      else if (CONTENT_TEMPLATES.has(name)) keepFirst('contentTemplates');
      else if (GLYPH_PLACEHOLDER_TEMPLATES.has(name)) keepFirst('uncertainGlyphs');
      else if (name.startsWith('*')) {
        // {{*|X}} is NOT uniformly commentary. On 老子 and 荀子 it is annotation
        // (王弼注 / 楊倞音義) and must go; on 春秋公羊傳 it is THE TEXT — the
        // 傳文 itself — so dropping it deleted the main body of the work while
        // leaving coherent-looking 經文 behind.
        //
        // The default is therefore KEEP: retaining commentary is a visible,
        // recoverable error, whereas deleting base text is silent and permanent
        // in the artifact. Works whose {{*}} is known to be annotation declare
        // `dropAnnotation: true` and say so in their config note.
        if (opts.dropAnnotation) { stats.annotationsDropped++; }
        else keepFirst('annotationsKept');
      } else stats.templates++;
      i = end;
      continue;
    }
    if (text.startsWith('}}', i)) { stats.unbalancedTemplates++; i += 2; continue; }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Wikisource marks verse/sentence units with `<div id="一之一">'''一之一'''</div>`.
 * That identifier is the wiki's own anchor, not part of the classic text, so it
 * is lifted out into a marker line that splitPassages() turns into the passage's
 * `sourceAnchor` field instead of leaving it inside the text.
 */
function liftAnchors(text, anchors) {
  let out = text.replace(
    /<div[^>]*\bid="([^"]+)"[^>]*>\s*'{2,3}\s*\1\s*'{2,3}\s*<\/div>/g,
    (_m, id) => { anchors.push(id); return `\n\u0000A:${id}\u0000\n`; });
  out = out.replace(/<div[^>]*\bid="([^"]+)"[^>]*>/g, (_m, id) => {
    anchors.push(id);
    return `\n\u0000A:${id}\u0000\n`;
  });
  return out;
}

/**
 * Drop elements whose CONTENT is commentary, declared per work.
 *
 * 文獻通考 puts its notes in <sub>…</sub> («冀州：厥土白壤<sub>無塊曰壤</sub>»), and
 * stripHtml() removes tags while KEEPING inner text — which would merge the note
 * into the base text and produce «厥土白壤無塊曰壤». Whether a given element
 * carries commentary is a per-work fact, so it is declared, never assumed.
 */
function dropDeclaredElements(text, stats, tags = []) {
  let out = text;
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    out = out.replace(re, () => { stats.declaredElementsDropped = (stats.declaredElementsDropped ?? 0) + 1; return ''; });
    const selfRe = new RegExp(`<${tag}\\b[^>]*/>`, 'gi');
    out = out.replace(selfRe, '');
  }
  return out;
}

function stripHtml(text, stats) {
  let out = text;
  // Footnotes are citation apparatus: the whole element goes, text included.
  // Unwrapping them instead would leak glosses into the base text (observed as
  // <ref>今文多作「假」…</ref> inside 尚書/堯典).
  out = out.replace(/<ref[^>]*\/>/gi, '');
  out = out.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, () => {
    stats.refFootnotes = (stats.refFootnotes ?? 0) + 1;
    return '';
  });
  out = out.replace(/<templatestyles[^>]*\/?>/gi, '');
  out = out.replace(/<references[^>]*\/?>/gi, '');
  out = out.replace(/<section\s+(?:begin|end)[^>]*\/?>/gi, '');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/?poem[^>]*>/gi, '\n');
  out = out.replace(/<\/?(?:div|span|u|b|i|small|big|center|onlyinclude|noinclude|includeonly)[^>]*>/gi, '');
  const before = out.length;
  out = out.replace(/<[^>]+>/g, '');
  if (out.length !== before) stats.htmlTags++;
  return out;
}

function stripLinks(text, stats) {
  // Files, categories and interwiki prefixes carry no base text.
  text = text.replace(/\[\[(?:File|Image|Category|分類|文件)\s*:[^\]]*\]\]/gi, () => {
    stats.files++;
    return '';
  });
  text = text.replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, (_m, _t, disp) => disp);
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_m, t) => t.replace(/^[^:]*:/, ''));
  // External links [http://x label] -> label
  text = text.replace(/\[(?:https?|ftp):\/\/\S+\s+([^\]]+)\]/g, '$1');
  text = text.replace(/\[(?:https?|ftp):\/\/\S+\]/g, () => {
    stats.externalLinks++;
    return '';
  });
  return text;
}

/**
 * MediaWiki language-conversion markers: -{T|..}- , -{H|..}- , -{乾}-.
 *
 * Markers NEST: 史記 contains `爲變-{-{徴}-}-之聲`. A single non-greedy pass
 * matches `-{-{徴}-` (up to the FIRST `}-`), so the "restored" text came out as
 * `-{徴}-` — a leftover fragment that the residue check then flagged. The marker
 * is therefore unwrapped INNERMOST-FIRST, repeatedly, until none remain.
 */
function stripConversionMarkers(text, stats) {
  let out = text;
  // content that contains no further '-{' is the innermost level
  const innermost = /-\{((?:(?!-\{)[\s\S])*?)\}-/g;
  for (let pass = 0; pass < 20; pass++) {
    if (!out.includes('-{')) break;
    let replaced = false;
    out = out.replace(innermost, (_m, inner) => {
      replaced = true;
      stats.conversionMarkers++;
      const trimmed = inner.trim();
      if (/^[A-Za-z]\s*\|/.test(trimmed)) return ''; // -{T|..}-, -{H|..}-
      if (trimmed.includes('|')) return trimmed.slice(trimmed.lastIndexOf('|') + 1);
      if (trimmed.includes(':')) return trimmed.slice(trimmed.lastIndexOf(':') + 1);
      return trimmed;
    });
    if (!replaced) break;
  }
  if (out.includes('-{')) stats.unresolvedConversionMarkers = (out.match(/-\{/g) ?? []).length;
  return out;
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * MediaWiki behaviour switches: `__FORCETOC__`, `__NOTOC__`, `__NOEDITSECTION__`,
 * `__TOC__`, `__NEWSECTIONLINK__`, …
 *
 * The cleaner previously listed three of these literally, so every OTHER switch
 * survived into the base text: 文選 shipped 12 passages containing the literal
 * string `__FORCETOC__`, and 漢書/史記/三國志 54 more (66 in total). A switch is
 * renderer instruction, never transcribed text, so the whole `__[A-Z]+__` form is
 * removed and the count is reported rather than assumed to be zero.
 */
function stripBehaviourSwitches(text, stats) {
  return text.replace(/__[A-Z]+__/g, () => {
    stats.behaviourSwitches++;
    return '';
  });
}

/**
 * Wikisource navigation furniture that sits in the page body as ordinary text.
 *
 * Two shapes occur in practice, both inside the base-text region and therefore
 * invisible to a template allowlist:
 *   - a breadcrumb line: `[[../天官冢宰|上一篇]]　[[../|回目录]]　[[../春官宗伯|下一篇]]`
 *     (周禮, 春秋穀梁傳 — read back as 「上一篇　回目录　下一篇」)
 *   - a reading-aid line: `[[論語/全覽|全覽]]（將全篇放在同一頁中閱讀，無註）`
 *     (四書章句集註)
 * Both are dropped only when the line consists of nothing but navigation words
 * plus separators, or one navigation word plus one parenthetical gloss; a line
 * carrying any other text is left untouched.
 */
const NAV_WORD = '(?:上一篇|下一篇|上一頁|下一頁|上一页|下一页|回目录|回目錄|返回目录|返回目錄|卷首|上卷|下卷)';
const NAV_BREADCRUMB = new RegExp(`^[\\s　]*${NAV_WORD}(?:[\\s　|·、,，。\\-—]*${NAV_WORD})*[\\s　]*$`);
// A reading aid, not a movement word: it is only furniture when GLOSSED, since on
// its own 「全覽」/「全文」/「目錄」 can legitimately be a section title.
const AID_WORD = '(?:全覽|全文|目錄|目录|回目錄|回目录)';
const NAV_GLOSSED = new RegExp(`^[\\s　]*${AID_WORD}[（(][^）)]{0,80}[）)][\\s　]*$`);

function dropNavigationLines(text, stats) {
  const lines = text.split('\n');
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    if (NAV_BREADCRUMB.test(t) || NAV_GLOSSED.test(t)) {
      stats.navigationLines++;
      return false;
    }
    return true;
  });
  return kept.join('\n');
}

function normalizeLines(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/'''?/g, '')
    .split('\n')
    .map((line) => line.replace(/^[\s:;*#]+/, '').replace(/[ \t\u00a0]+$/g, '').trim())
    .join('\n');
}

/**
 * Clean one page's wikitext into base text.
 * @param {string} raw
 * @param {{dropAnnotation?:boolean}} [opts]
 * @returns {{text:string, stats:object}}
 */
export function cleanWikitext(raw, opts = {}) {
  const stats = {
    annotationsDropped: 0,
    annotationsKept: 0,
    declaredElementsDropped: 0,
    declaredTemplatesDropped: 0,
    annotationRegionsDropped: 0,
    templates: 0,
    contentTemplates: 0,
    uncertainGlyphs: 0,
    refFootnotes: 0,
    unbalancedTemplates: 0,
    htmlTags: 0,
    files: 0,
    externalLinks: 0,
    conversionMarkers: 0,
    anchorsLifted: 0,
    behaviourSwitches: 0,
    navigationLines: 0,
  };
  const anchors = [];
  let out = stripComments(raw);
  out = boundOnlyinclude(out);
  out = liftAnchors(out, anchors);
  stats.anchorsLifted = anchors.length;
  // {{*s}}…{{*e}} delimit an annotation REGION: dropping only the delimiters would
  // leave the annotation itself inline as if it were base text.
  if (opts.dropAnnotation === true) {
    out = out.replace(/\{\{\s*\*s\s*\}\}[\s\S]*?\{\{\s*\*e\s*\}\}/g, () => {
      stats.annotationRegionsDropped = (stats.annotationRegionsDropped ?? 0) + 1;
      return '';
    });
  }
  out = stripTemplates(out, stats, 0, {
    dropAnnotation: opts.dropAnnotation === true,
    dropTemplates: opts.dropTemplates ?? [],
    declareCommentary: true,
  });
  out = dropDeclaredElements(out, stats, opts.dropElements ?? []);
  out = stripHtml(out, stats);
  out = stripLinks(out, stats);
  out = stripConversionMarkers(out, stats);
  out = decodeEntities(out);
  out = stripBehaviourSwitches(out, stats);
  out = normalizeLines(out);
  // Navigation lines are matched AFTER link stripping, so the same rule catches
  // both the relative (`[[../X|下一篇]]`) and the absolute (`[[W/X|下一篇]]`) forms.
  out = dropNavigationLines(out, stats);
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  const leftover = out.match(/\u0000A:[^\u0000]*\u0000/g)?.length ?? 0;
  if (leftover) stats.anchorsUnmatched = leftover;
  return { text: out, stats, anchors };
}

/**
 * Split cleaned text into sections at headings, consuming the heading lines
 * themselves so heading markup can never leak into passage text.
 *
 * Levels 2–4 are split: Wikisource uses `===X===` for sub-sections such as
 * `===註釋===` and, on the 六笙詩 pages, for the unit marker itself. Heading at
 * level 1 (`=X=`) is a part/volume marker and is left in the body.
 * @returns {{title:string|null, level:number, body:string}[]}
 */
/**
 * Remove heading markup from lines whose level is NOT split into a section.
 *
 * `splitSections` splits levels 2–4 and, by design, leaves level 1 (`=X=`) in the
 * body because it is usually a part/volume marker. Leaving the MARKUP there,
 * however, pushes `=` characters into the base text: measurement over the 69-work
 * corpus found 154 passages carrying a literal level-1 heading line
 * (`=賦甲=`/`=詩乙=` in 文選, `=贊=`/`=薛宣=` in 漢書/史記, `=禮官之屬=` in 周禮).
 * Level 5–6 headings are likewise never split.
 *
 * The fix is to demote rather than delete: the heading's TEXT stays where it was,
 * only the `=` delimiters go — so a label the model may need (`薛宣`) is preserved
 * as an ordinary line instead of being silently dropped with its markup removed.
 * @returns {{text:string, demoted:number}}
 */
export function demoteHeadings(text, { levels = [2, 3, 4] } = {}) {
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const HEADING = /^(={1,6})\s*([^=\n][\s\S]*?)\s*\1$/;
  let demoted = 0;
  const out = text
    .split('\n')
    .map((line) => {
      const m = HEADING.exec(line.trim());
      if (!m) return line;
      const level = m[1].length;
      if (level >= min && level <= max) return line;
      demoted++;
      return m[2].trim();
    })
    .join('\n');
  return { text: out, demoted };
}

export function splitSections(text, { levels = [2, 3, 4] } = {}) {
  const max = Math.max(...levels);
  const min = Math.min(...levels);
  const marks = [];
  for (const m of text.matchAll(/^(={1,6})\s*([^=\n][\s\S]*?)\s*\1\s*$/gm)) {
    const level = m[1].length;
    if (level < min || level > max) continue;
    marks.push({ index: m.index, length: m[0].length, title: m[2].trim(), level });
  }
  if (!marks.length) return [{ title: null, level: 0, body: text.trim() }];

  const sections = [];
  const head = text.slice(0, marks[0].index).trim();
  if (head) sections.push({ title: null, level: 0, body: head });
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    sections.push({
      // A heading may be EMPTY in the source (廣異記 contains a literal `== ==`).
      // Normalise it to null here so "no title" is a single, unambiguous value and
      // callers' fallbacks work: `'' ?? x` is `''`, which produced an untitled work.
      title: marks[i].title || null,
      level: marks[i].level,
      body: text.slice(start, end).trim(),
    });
  }
  return sections.filter((s) => s.body.length > 0 || s.title);
}

/**
 * Split a section body into passages on blank lines, preserving inner newlines
 * (verse line breaks survive; the project's own analysis treats text as
 * whitespace-insensitive, so this is lossless for its purposes).
 *
 * Anchor markers lifted by liftAnchors() are removed from the text and returned
 * as `anchor`, so a passage can still be traced to the wiki's own unit id.
 * @returns {{text:string, anchor:string|null}[]}
 */
export function splitPassages(body) {
  const blocks = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const out = [];
  let carry = null;
  for (const block of blocks) {
    const markers = [...block.matchAll(/\u0000A:([^\u0000]*)\u0000/g)].map((m) => m[1]);
    const anchor = markers.length ? markers[0] : carry;
    const text = block.replace(/\u0000A:[^\u0000]*\u0000/g, '').trim();
    if (!text) { carry = anchor; continue; }
    out.push({ text, anchor: anchor ?? null });
    carry = null;
  }
  return out;
}

/** Drop whole sections by title (e.g. 註釋 commentary blocks). */
export function dropSections(sections, titles) {
  if (!titles?.length) return { sections, dropped: [] };
  const set = new Set(titles);
  const dropped = sections.filter((s) => s.title && set.has(s.title.trim())).map((s) => s.title);
  return { sections: sections.filter((s) => !(s.title && set.has(s.title.trim()))), dropped };
}

/**
 * Clean a single inline string such as a section title taken from a header
 * template's `section=` field. Titles are NOT passed through the full cleaner,
 * so without this they can carry live markup into the corpus — observed in
 * practice as `[[勸學篇]]第一`, `宥坐篇第二十八{{*|…}}`, `{{+|國風‧邶}}`,
 * `野有死-{麕}-` and `-{丰}-`.
 */
export function cleanInline(text) {
  const stats = {
    annotationsDropped: 0, annotationsKept: 0, templates: 0, contentTemplates: 0, uncertainGlyphs: 0,
    refFootnotes: 0, unbalancedTemplates: 0, htmlTags: 0,
    files: 0, externalLinks: 0, conversionMarkers: 0,
  };
  let out = stripComments(text ?? '');
  // Titles are metadata, not corpus text: annotation template content is dropped
  // there regardless of the work's setting.
  out = stripTemplates(out, stats, 0, { dropAnnotation: true });
  out = stripHtml(out, stats);
  out = stripLinks(out, stats);
  out = stripConversionMarkers(out, stats);
  out = decodeEntities(out);
  return out.replace(/'''?/g, '').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Remove lines matching the given patterns (e.g. 毛詩序 editorial prefaces). */
export function dropLines(text, patterns) {
  if (!patterns?.length) return { text, dropped: 0 };
  const lines = text.split('\n');
  const kept = lines.filter((line) => !patterns.some((re) => re.test(line.trim())));
  return { text: kept.join('\n'), dropped: lines.length - kept.length };
}
