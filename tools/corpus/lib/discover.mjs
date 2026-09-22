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

/** Read the first header-ish template of a page into a field map. */
export function parseHeaderFields(wikitext) {
  const m = wikitext.match(/\{\{\s*(header2?|Header2?|Header)\b/i);
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
    // Excluded pages are skipped as chapters but the chain must still pass
    // through them, otherwise one exclusion would truncate the whole work.
    if (exclude.some((re) => re.test(resolved) || re.test(page))) {
      excluded.push(resolved);
    } else {
      chapters.push({ title, pageTitle: resolved, revid: rec.revid });
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
  const prefix = `${work.zh}/`;
  const seen = new Set();
  const chapters = [];
  for (const m of rec.content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    let target = m[1].trim();
    if (target.startsWith('../')) target = prefix + target.slice(3);
    if (!target.startsWith(prefix)) continue;
    if (seen.has(target)) continue;
    if ((work.exclude ?? []).some((re) => re.test(target))) continue;
    seen.add(target);
    chapters.push({ title: target.slice(prefix.length), pageTitle: target, revid: null });
  }
  return { chapters, route: 'mainPageLinks', mainPage: page, mainRevid: rec.revid, error: null };
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
  else if (d.kind === 'containerChain') result = await discoverByContainerChain(client, d.startPage, work);
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
