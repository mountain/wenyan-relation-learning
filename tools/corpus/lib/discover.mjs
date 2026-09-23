/**
 * Chapter-list discovery for wenyan.corpus.v1.
 *
 * The chapter list of every work is derived from the wiki itself and the route
 * taken is recorded per work, so each section can be traced to a page (and, via
 * the raw cache, to an exact revision). Three routes:
 *
 *   index     an index page ("全覽") of `==篇名==` headings each followed by a
 *             `{{:Work/篇名}}` transclusion -> canonical order + exact page name
 *   nextChain walk the header template's `next=` link from a start page until it
 *             ends -> canonical order for works without an index page
 *   allpages  enumerate `<work>/` -> always available; ordering may not be the
 *             canonical reading order, which is reported as a limitation
 */

/** Split a template body into top-level `|`-separated parameters, brace-aware. */
function splitParams(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (body.startsWith('{{', i)) { depth++; cur += '{{'; i++; continue; }
    if (body.startsWith('}}', i)) { depth--; cur += '}}'; i++; continue; }
    if (body.startsWith('[[', i)) { depth++; cur += '[['; i++; continue; }
    if (body.startsWith(']]', i)) { depth--; cur += ']]'; i++; continue; }
    if (c === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

import { cleanInline } from './wikitext.mjs';

/**
 * The section title must contain the page's UNIT name.
 *
 * Source pages are not consistent about where they put the unit: most 詩經 pages carry
 * `|title = [[詩經]]` with `|section = 關雎`, but three invert it — `|title = 漢廣` with
 * `|section = 國風‧周南`, and `{{Header2|title=擊鼓|section={{+|國風‧邶}}}}` — so a title
 * taken from `section` alone named the CHAPTER and lost the poem (`國風‧周南` instead of
 * 漢廣, and `國風‧邶` twice). Those three sections were the only place a unit name went
 * missing, and the symptom was a duplicated title plus a poem that appeared absent from
 * the corpus even though its text was present.
 *
 * The test is CONTAINMENT of the cleaned title, not equality of a `‧`-separated
 * component. Measured necessity: 莊子's sections are titled `逍遙遊第一` against the page
 * `莊子/逍遙遊`, so a component test appends and yields `逍遙遊第一‧逍遙遊` — it would have
 * changed 97 of the 432 chapters reached by this route instead of 3.
 *
 * The unit comes from the PAGE, not from the header, because the page name is the one
 * field that is consistent: a trailing `(邶風)`-style disambiguator is stripped so that
 * `詩經/谷風 (邶風)` yields `谷風`, which its title already contains.
 */
export function unitOfPage(pageTitle) {
  return String(pageTitle).split('/').pop().replace(/\s*[（(][^）)]*[）)]\s*$/, '');
}

export function ensureUnitInTitle(title, pageTitle) {
  const unit = unitOfPage(pageTitle);
  if (!unit) return title;
  if (cleanInline(title).includes(unit)) return title;
  return title ? `${title}‧${unit}` : unit;
}

/** Read the first header-ish template of a page into a field map. */
export function parseHeaderFields(wikitext) {
  // Any template whose NAME ends in `header` carries these fields, not just `{{header}}`.
  // Measured necessity: 戰國策's volumes and the whole 士禮居 edition use `{{album header}}`,
  // and 四庫 scans use `{{SKQS header}}`. The original pattern matched neither, so `next=`
  // came back undefined and a nextChain walk over 戰國策 stopped after ONE page while
  // reporting the innocuous stop reason "chain end" — a silent 1-of-33 build.
  const m = wikitext.match(/\{\{\s*([A-Za-z0-9_. ]*header[A-Za-z0-9_. ]*)\s*[|}]/i);
  if (!m) return {};
  const start = m.index + 2;
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext.startsWith('{{', i)) { depth++; i++; continue; }
    if (wikitext.startsWith('}}', i)) {
      if (depth === 0) { end = i; break; }
      depth--; i++; continue;
    }
  }
  if (end < 0) return {};
  const body = wikitext.slice(start, end);
  const fields = {};
  for (const part of splitParams(body)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    if (key) fields[key] = part.slice(eq + 1).trim();
  }
  return fields;
}

/** Extract a wiki link target from a header field value like `[[../下泉|下泉]]`. */
export function linkTarget(value, currentPage) {
  if (!value) return null;
  const m = value.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/);
  if (!m) return null;
  let target = m[1].trim();
  if (!target) return null;
  if (target.startsWith('../')) {
    const parent = currentPage.includes('/') ? currentPage.slice(0, currentPage.lastIndexOf('/')) : '';
    target = target.replace(/^\.\.\//, parent ? parent + '/' : '');
  }
  return target;
}

/** Route: index page (`全覽`) — pairs of heading + transclusion target. */
export async function discoverByIndex(client, indexPage) {
  const rec = await client.wikitext(indexPage);
  if (rec.missing) return { chapters: [], route: 'index', error: `index page ${indexPage} missing` };
  const lines = rec.content.split('\n');
  const chapters = [];
  let pendingTitle = null;
  for (const line of lines) {
    const h = line.match(/^==\s*([^=][\s\S]*?)\s*==\s*$/);
    if (h) { pendingTitle = h[1].trim(); continue; }
    const t = line.match(/\{\{\s*:\s*([^|}\n]+?)\s*\}\}/);
    if (t) {
      const pageTitle = t[1].trim();
      chapters.push({ title: pendingTitle || pageTitle, pageTitle, revid: null });
      pendingTitle = null;
    }
  }
  return { chapters, route: 'index', indexPage, indexRevid: rec.revid, error: null };
}

/** Route: follow `next=` from a start page. */
export async function discoverByNextChain(client, startPage, { max = 400, stopPrefix = null, nextFix = {}, exclude = [] } = {}) {
  const chapters = [];
  const excluded = [];
  const seen = new Set();
  let page = startPage;
  let brokenAt = null;
  let stopReason = null;
  const substituted = [];
  while (page && !seen.has(page) && chapters.length < max) {
    seen.add(page);
    let rec = await client.wikitext(page);
    if (rec.missing && nextFix[page]) {
      // A variant-character page name (e.g. 周易/恆 -> 周易/恒) breaks the chain.
      substituted.push({ missing: page, used: nextFix[page] });
      page = nextFix[page];
      rec = await client.wikitext(page);
    }
    if (rec.missing) { brokenAt = page; stopReason = 'next target missing'; break; }
    const resolved = rec.resolvedTitle || page;
    const fields = parseHeaderFields(rec.content);
    const title = (fields.section || '').replace(/'''/g, '').trim() || page.split('/').pop();
    const withUnit = ensureUnitInTitle(title, resolved);
    // Excluded pages are skipped as chapters but the chain must still pass
    // through them, otherwise one exclusion would truncate the whole work.
    if (exclude.some((re) => re.test(resolved) || re.test(page))) {
      excluded.push(resolved);
    } else {
      chapters.push({ title: withUnit, pageTitle: resolved, revid: rec.revid });
    }
    const next = linkTarget(fields.next, page);
    if (!next) { stopReason = 'chain end'; break; }
    if (seen.has(next)) { stopReason = 'chain loop'; break; }
    if (stopPrefix && !next.startsWith(stopPrefix)) {
      // The chain left the work (e.g. 荀子/堯問篇 -> 荀卿新書十二卷三十二篇).
      stopReason = `chain left work prefix (${next})`;
      break;
    }
    page = next;
  }
  return {
    chapters, route: 'nextChain', startPage, stopReason, substituted, excluded,
    error: brokenAt ? `page ${brokenAt} missing` : null,
  };
}

/**
 * Route: links on a work's main page, in document order. Several works list
 * their canonical 篇目 as a plain link list on the main page, which gives
 * canonical order directly.
 */
export async function discoverByMainPageLinks(client, page, work = {}) {
  const rec = await client.wikitext(page);
  if (rec.missing) return { chapters: [], route: 'mainPageLinks', error: `main page ${page} missing` };
  // Use the RESOLVED title, not the configured one: 聊齋誌異 redirects to 聊齋志異,
  // and building prefixes from the requested title produced 14 links to
  // 聊齋誌異/第01卷… — pages that do not exist — so the work built with 0 sections
  // and the run still reported success.
  const base = rec.resolvedTitle || work.zh;
  const prefix = `${base}/`;
  const seen = new Set();
  const chapters = [];
  for (const m of rec.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    let target = m[1].trim();
    if (target.startsWith('../')) target = prefix + target.slice(3);
    // 文獻通考's main page links its volumes RELATIVELY, as `/卷一`. Treating
    // only `../` left a 398-link table of contents reading as zero chapters.
    else if (target.startsWith('/')) target = base + target;
    if (!target.startsWith(prefix)) continue;
    if (seen.has(target)) continue;
    if ((work.exclude ?? []).some((re) => re.test(target))) continue;
    seen.add(target);
    chapters.push({ title: target.slice(prefix.length), pageTitle: target, revid: null });
  }
  return { chapters, route: 'mainPageLinks', mainPage: page, mainPageResolved: base,
    mainRevid: rec.revid, error: null };
}

/**
 * Route: an anthology whose main page is a LIST of links to per-item pages.
 *
 * 唐詩三百首 is the case that forced this route. Its main page is not the text and
 * not a table of contents into subpages: it is `# 元結 [[賊退示官吏]]` lines
 * pointing at anthology member pages at the TOP level, so the prefix-based
 * mainPageLinks route found zero chapters and the `single` route "succeeded" by
 * capturing the 3,188-character index as if it were the work.
 *
 * Only links on list-item lines (`#`/`*`) are taken. That is what separates the 320
 * poems from the one prose link on the same page (`[[千家詩]]`, mentioned inside
 * 蘅塘退士's preface), which a whole-page link scan would have collected too.
 *
 * Every candidate is then checked with `client.exists`, because a red link in a
 * list is indistinguishable from a poem by pattern alone.
 */
export async function discoverByListLinks(client, page, work = {}) {
  const rec = await client.wikitext(page);
  if (rec.missing) return { chapters: [], route: 'listLinks', error: `main page ${page} missing` };
  const base = rec.resolvedTitle || work.zh;
  const prefix = `${base}/`;
  const seen = new Set();
  const candidates = [];
  const notListed = [];
  for (const line of rec.content.split('\n')) {
    const isItem = /^\s*[#*]/.test(line);
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      let target = m[1].trim();
      if (target.startsWith('../')) target = prefix + target.slice(3);
      else if (target.startsWith('/')) target = base + target;
      // `[[category:唐詩]]`, `[[File:…]]` and interwiki links are not anthology items.
      if (/^[^:]*:/.test(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      if (!isItem) { notListed.push(target); continue; }
      if ((work.exclude ?? []).some((re) => re.test(target))) continue;
      candidates.push(target);
    }
  }
  const { existing, missing, resolvedTo } = await client.exists(candidates);
  const ok = new Set(existing);
  const chapters = candidates
    .filter((t) => ok.has(t))
    .map((t) => ({ title: t, pageTitle: t, revid: null }));
  // 25 of the 320 anthology entries are redirects (`長干行之一` → `長干曲 (君家何處住)`).
  // They are kept: the LIST label is the anthology's own name for the poem and is the
  // right section title, while pageText() records the resolved page in `sources` for
  // attribution. The redirect map is returned so that fact is auditable, not folklore.
  const redirected = Object.entries(resolvedTo).filter(([from, to]) => from !== to);
  return {
    chapters,
    route: 'listLinks',
    mainPage: page,
    mainPageResolved: base,
    mainRevid: rec.revid,
    listLinksSkipped: { missingPages: missing, proseLinks: notListed },
    listLinksRedirected: redirected,
    error: null,
  };
}

/**
 * Route: container pages (卷) whose `{{:Work/篇}}` transclusions are the real
 * chapters. Walking the container chain gives canonical 篇 order while the text
 * still comes from the leaf pages.
 */
export async function discoverByContainerChain(client, startPage, work = {}) {
  const chain = await discoverByNextChain(client, startPage, {
    stopPrefix: `${work.zh}/`,
    nextFix: work.nextFix ?? {},
  });
  const prefix = `${work.zh}/`;
  const chapters = [];
  const seen = new Set();
  for (const container of chain.chapters) {
    const rec = await client.wikitext(container.pageTitle);
    if (rec.missing) continue;
    let pending = null;
    for (const line of rec.content.split('\n')) {
      const h = line.match(/^==\s*([^=][\s\S]*?)\s*==\s*$/);
      if (h) { pending = h[1].trim(); continue; }
      const t = line.match(/\{\{\s*:\s*([^|}\n]+?)\s*\}\}/);
      if (t) {
        const pageTitle = t[1].trim();
        if (seen.has(pageTitle)) continue;
        if ((work.exclude ?? []).some((re) => re.test(pageTitle))) continue;
        seen.add(pageTitle);
        chapters.push({
          title: pending || pageTitle.slice(prefix.length),
          pageTitle,
          revid: null,
          container: container.pageTitle,
        });
        pending = null;
      }
    }
  }
  return { chapters, route: 'containerChain', startPage, containers: chain.chapters.length, error: null };
}

/**
 * Route: the ordered link list inside a TABLE-OF-CONTENTS section.
 *
 * Some works list their chapters as top-level pages rather than subpages — 楚辭's
 * 目錄 reads `#[[離騷|楚辭卷第一]]`, `#[[九歌|楚辭卷第二]]` … — so a prefix filter
 * (discoverByMainPageLinks) rejects every chapter but one, and an allpages scan
 * finds nothing because the pages carry no prefix at all. Taking the links from
 * the 目錄 section specifically avoids both problems and avoids swallowing the
 * unrelated cross-references that dot the prose elsewhere on the page.
 */
export async function discoverByTocSection(client, page, work = {}) {
  const rec = await client.wikitext(page);
  if (rec.missing) return { chapters: [], route: 'tocSection', error: `main page ${page} missing` };
  const lines = rec.content.split('\n');
  const tocRe = work.tocHeading ?? /目[錄录次]/;
  let inToc = false;
  const chapters = [];
  const seen = new Set();
  for (const line of lines) {
    const h = line.match(/^={2,4}\s*([^=]+?)\s*={2,4}\s*$/);
    if (h) { inToc = tocRe.test(h[1]); continue; }
    if (!inToc) continue;
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g)) {
      const target = m[1].trim();
      if (/^(Portal|Category|分類|作者|wikipedia|s|w):/i.test(target)) continue;
      if (seen.has(target)) continue;
      seen.add(target);
      chapters.push({ title: (m[2] ?? target).trim(), pageTitle: target, revid: null });
    }
  }
  return { chapters, route: 'tocSection', mainPage: page, mainRevid: rec.revid, error: null };
}

/** Route: enumerate the prefix. Order is the wiki's sort order. */
export async function discoverByPrefix(client, prefix, work = {}) {
  const all = await client.allpages(prefix);
  let pages = all;
  if (work.preferPattern) {
    const preferred = all.filter((t) => work.preferPattern.test(t));
    if (preferred.length) pages = preferred;
  }
  for (const re of work.exclude ?? []) pages = pages.filter((t) => !re.test(t));
  const chapters = pages.map((t) => ({
    title: t.slice(prefix.length),
    pageTitle: t,
    revid: null,
  }));
  return {
    chapters,
    route: 'allpages',
    prefix,
    allCount: all.length,
    usedCount: chapters.length,
    error: null,
  };
}

/**
 * Resolve the ordered chapter list for a work, plus the non-canonical-order
 * cross-check when a nextChain walk is available alongside a prefix listing.
 */
export async function discoverChapters(client, work) {
  const d = work.discovery;
  let result;
  if (d.kind === 'index') result = await discoverByIndex(client, d.index);
  else if (d.kind === 'nextChain') {
    result = await discoverByNextChain(client, d.startPage, {
      stopPrefix: d.stopPrefix ?? `${work.zh}/`,
      nextFix: work.nextFix ?? {},
      exclude: work.exclude ?? [],
    });
  }
  else if (d.kind === 'mainPageLinks') result = await discoverByMainPageLinks(client, d.mainPage, work);
  else if (d.kind === 'listLinks') result = await discoverByListLinks(client, d.mainPage, work);
  else if (d.kind === 'containerChain') result = await discoverByContainerChain(client, d.startPage, work);
  else if (d.kind === 'tocSection') result = await discoverByTocSection(client, d.mainPage, work);
  else if (d.kind === 'prefixChain' || (d.kind === 'allpages' && d.startPage)) {
    const chain = await discoverByNextChain(client, d.startPage);
    const listing = await discoverByPrefix(client, d.prefix, work);
    const chainSet = new Set(chain.chapters.map((c) => c.pageTitle));
    const listSet = new Set(listing.chapters.map((c) => c.pageTitle));
    const missedByChain = listing.chapters.filter((c) => !chainSet.has(c.pageTitle)).map((c) => c.pageTitle);
    const reached = chain.chapters.length;
    // Trust the chain only if it covers the listing (within the filters applied).
    const useChain = reached >= listing.chapters.length;
    result = useChain ? chain : listing;
    result.route = useChain ? 'nextChain' : 'allpages';
    result.chainLength = reached;
    result.listingLength = listing.chapters.length;
    result.notReachedByChain = missedByChain;
  } else if (d.kind === 'allpages') result = await discoverByPrefix(client, d.prefix, work);
  else if (d.kind === 'single') {
    result = { chapters: [{ title: work.zh, pageTitle: d.page, revid: null }], route: 'single', error: null };
  } else {
    result = { chapters: [], route: d.kind, error: `unsupported discovery kind: ${d.kind}` };
  }
  return result;
}
