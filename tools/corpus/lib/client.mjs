/**
 * Wikisource (MediaWiki) API client for the wenyan.corpus.v1 builder.
 *
 * Wikimedia's User-Agent policy requires a descriptive agent with a contact
 * point, and asks clients to be gentle: we keep a fixed delay between requests,
 * retry with exponential backoff plus jitter, and cache every raw response so a
 * resumed run never re-fetches a page it already has. The cached record pins the
 * exact revision id, so a corpus build is reproducible even after the wiki page
 * changes (the build records which revision each section came from).
 *
 * No third-party dependencies: Node's global fetch only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_USER_AGENT =
  'wenyan-corpus-builder/0.1 (research corpus builder; +https://github.com/mountain/wenyan)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WikiClient {
  /**
   * @param {object} opts
   * @param {string} opts.cacheDir      directory for raw cached responses
   * @param {string} [opts.api]         api.php endpoint
   * @param {string} [opts.userAgent]   descriptive UA (set your contact point!)
   * @param {number} [opts.delayMs]     polite delay between live requests
   * @param {number} [opts.attempts]    attempts per request before giving up
   * @param {number} [opts.timeoutMs]   per-attempt timeout
   */
  constructor({
    cacheDir,
    api = 'https://zh.wikisource.org/w/api.php',
    userAgent = DEFAULT_USER_AGENT,
    delayMs = 350,
    attempts = 6,
    timeoutMs = 25000,
  } = {}) {
    this.cacheDir = cacheDir;
    this.endpoint = api;
    this.userAgent = userAgent;
    this.delayMs = delayMs;
    this.attempts = attempts;
    this.timeoutMs = timeoutMs;
    this.stats = { live: 0, cached: 0, retries: 0, failures: 0 };
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  #cachePath(key) {
    const h = crypto.createHash('sha1').update(key).digest('hex');
    return path.join(this.cacheDir, `${h}.json`);
  }

  async #once(params) {
    const url = new URL(this.endpoint);
    for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Raw API call with retry/backoff. Not cached. */
  async api(params) {
    let lastErr;
    for (let i = 1; i <= this.attempts; i++) {
      try {
        const data = await this.#once(params);
        this.stats.live++;
        await sleep(this.delayMs);
        return data;
      } catch (err) {
        lastErr = err;
        if (i === this.attempts) break;
        this.stats.retries++;
        const wait = Math.min(1000 * 2 ** (i - 1), 15000) + Math.random() * 500;
        await sleep(wait);
      }
    }
    this.stats.failures++;
    throw lastErr;
  }

  /**
   * Fetch one page's wikitext, cached on disk.
   * @returns {Promise<{title:string, resolvedTitle:string|null, missing:boolean,
   *   redirectTo:string|null, revid:number|null, timestamp:string|null,
   *   size:number, content:string, fetchedAt:string}>}
   */
  async wikitext(title, { refresh = false } = {}) {
    const file = this.#cachePath(`wt:${title}`);
    if (!refresh && fs.existsSync(file)) {
      this.stats.cached++;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const data = await this.api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content|size|timestamp|ids',
      rvslots: 'main',
      redirects: '1',
      titles: title,
    });
    const page = data?.query?.pages?.[0];
    const rev = page?.revisions?.[0];
    const record = {
      title,
      resolvedTitle: page && !page.missing ? page.title : null,
      missing: !page || !!page.missing,
      redirectTo: data?.query?.redirects?.[0]?.to ?? null,
      revid: rev?.revid ?? null,
      timestamp: rev?.timestamp ?? null,
      size: rev?.size ?? 0,
      content: rev?.slots?.main?.content ?? '',
      fetchedAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    return record;
  }

  /**
   * Which of these titles actually exist? Batched 50 at a time.
   *
   * A route proposal whose targets do not exist is worse than no proposal:
   * 聊齋誌異's table of contents pointed at 聊齋誌異/第01卷… while the real pages
   * live under its redirect target 聊齋志異 — so the work built EMPTY and the run
   * still reported success.
   *
   * Results are keyed by the title the CALLER passed, never by the title the API
   * echoed back. The two differ routinely and silently: `redirects=0` does not
   * actually suppress redirect following here (the response still carried a
   * `query.redirects` block), so 唐詩三百首's list of 320 poems came back with
   * `送杜少府之任蜀州` reported as `杜少府之任蜀州`, `長干行之一` as
   * `長干曲 (君家何處住)`, `石魚湖上醉歌並序` as `石魚湖上醉歌` and
   * `廬山謠寄盧侍禦虛舟` as `廬山謠寄盧侍御虛舟`. Matching on the echoed name made
   * 25 of the 320 look absent while `missing` stayed empty — a silent 8% loss of
   * the anthology. Normalisation, redirects and (on zh wikis) variant conversion
   * are therefore resolved through the API's own mapping blocks: `query.normalized`
   * and `query.redirects` give requested → actual, and the page lookup uses that.
   * @returns {Promise<{existing:string[], missing:string[], resolvedTo:Record<string,string>, variantResolved:Record<string,string>}>}
   */
  async exists(titles) {
    const existing = [];
    const missing = [];
    const resolvedTo = {};
    const variantResolved = {};
    const pendingMissing = [];
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const data = await this.api({
        action: 'query', prop: 'info', titles: batch.join('|'), redirects: '1',
      });
      // requested -> actual, following the API's own mapping chain (a redirect may
      // itself be renamed first, so apply normalisation, then redirects to fixpoint).
      const map = new Map(batch.map((t) => [t, t]));
      for (const n of data?.query?.normalized ?? []) {
        for (const [k, v] of map) if (v === n.from) map.set(k, n.to);
      }
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const r of data?.query?.redirects ?? []) {
          for (const [k, v] of map) {
            if (v === r.from && v !== r.to) { map.set(k, r.to); changed = true; }
          }
        }
        if (!changed) break;
      }
      const pages = new Map((data?.query?.pages ?? []).map((p) => [p.title, p]));
      for (const t of batch) {
        const actual = map.get(t);
        const page = pages.get(actual);
        if (page && !page.missing) {
          existing.push(t);
          resolvedTo[t] = actual;
        } else {
          // Still missing: it may only be a SIMPLIFIED title for a traditional page.
          // 子部's list contains 关尹子/關尹子, 黄帝四经/黃帝四經, 正统道藏/正統道藏 … and a
          // plain lookup reports them absent, i.e. 20% of the list misread as red links.
          // `converttitles=1` performs the wiki's own variant conversion and reports the
          // mapping in `query.converted`; `variant=zh-hant` does NOT (measured: 0/8 vs 5/8).
          pendingMissing.push(t);
        }
      }
    }
    for (let i = 0; i < pendingMissing.length; i += 50) {
      const batch = pendingMissing.slice(i, i + 50);
      const data = await this.api({
        action: 'query', prop: 'info', titles: batch.join('|'), redirects: '1', converttitles: '1',
      });
      const converted = new Map((data?.query?.converted ?? []).map((x) => [x.from, x.to]));
      const pages = new Map((data?.query?.pages ?? []).map((p) => [p.title, p]));
      const stillMissing = [];
      for (const t of batch) {
        const to = converted.get(t);
        const page = to ? pages.get(to) : null;
        if (to && page && !page.missing) {
          existing.push(t);
          resolvedTo[t] = to;
          variantResolved[t] = to;
        } else {
          stillMissing.push(t);
        }
      }
      missing.push(...stillMissing);
    }
    return { existing, missing, resolvedTo, variantResolved };
  }

  /**
   * List all main-namespace pages under a prefix (paginated).
   *
   * Cached on disk like wikitext(): a prefix listing is a network round-trip per
   * 100 pages, and without caching a single transient failure aborts that work's
   * whole build. With the cache, a resumed run only touches the network for
   * pages it has never seen.
   */
  async allpages(prefix, { refresh = false } = {}) {
    const file = this.#cachePath(`allpages:${prefix}`);
    if (!refresh && fs.existsSync(file)) {
      this.stats.cached++;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const out = [];
    let cont = null;
    do {
      const params = {
        action: 'query',
        list: 'allpages',
        apprefix: prefix,
        aplimit: '100',
        apnamespace: '0',
        ...(cont ? { apcontinue: cont } : {}),
      };
      const data = await this.api(params);
      for (const p of data?.query?.allpages ?? []) out.push(p.title);
      cont = data?.continue?.apcontinue ?? null;
    } while (cont);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    return out;
  }
}
