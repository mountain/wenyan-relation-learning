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
function stripTemplates(text, stats, depth = 0) {
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
        out += depth < 6 ? stripTemplates(kept, stats, depth + 1) : kept;
      };
      if (CONTENT_TEMPLATES.has(name)) keepFirst('contentTemplates');
      else if (GLYPH_PLACEHOLDER_TEMPLATES.has(name)) keepFirst('uncertainGlyphs');
      else if (name.startsWith('*')) stats.annotations++;
      else stats.templates++;
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

/** MediaWiki language-conversion markers: -{T|..}- , -{H|..}- , -{乾}- */
function stripConversionMarkers(text, stats) {
  return text.replace(/-\{([\s\S]*?)\}-/g, (_m, inner) => {
    stats.conversionMarkers++;
    const trimmed = inner.trim();
    if (/^[A-Za-z]\s*\|/.test(trimmed)) return ''; // -{T|..}-, -{H|..}-
    if (trimmed.includes('|')) return trimmed.slice(trimmed.lastIndexOf('|') + 1);
    if (trimmed.includes(':')) return trimmed.slice(trimmed.lastIndexOf(':') + 1);
    return trimmed;
  });
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

function normalizeLines(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/__NOTOC__|__NOEDITSECTION__|__TOC__/g, '')
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
    annotations: 0,
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
  };
  const anchors = [];
  let out = stripComments(raw);
  out = boundOnlyinclude(out);
  out = liftAnchors(out, anchors);
  stats.anchorsLifted = anchors.length;
  out = stripTemplates(out, stats);
  out = stripHtml(out, stats);
  out = stripLinks(out, stats);
  out = stripConversionMarkers(out, stats);
  out = decodeEntities(out);
  out = normalizeLines(out);
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
      title: marks[i].title,
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
    annotations: 0, templates: 0, contentTemplates: 0, uncertainGlyphs: 0,
    refFootnotes: 0, unbalancedTemplates: 0, htmlTags: 0,
    files: 0, externalLinks: 0, conversionMarkers: 0,
  };
  let out = stripComments(text ?? '');
  out = stripTemplates(out, stats);
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
