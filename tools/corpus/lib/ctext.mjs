/**
 * Chinese Text Project (ctext.org) official JSON API client.
 *
 * WHY THIS EXISTS
 * ctext.org's website refuses automated access: robots.txt disallows crawlers,
 * every page is served behind an anti-scraping notice that states automated
 * processes are not authorized, and api.ctext.org returns
 * ERR_REQUIRES_AUTHENTICATION without a subscription. The sanctioned path is a
 * subscription (registered IP or API key) — see https://ctext.org/tools/subscribe.
 * This module implements ONLY that sanctioned path and deliberately has no
 * fallback: without a configured credential it refuses to make content calls.
 *
 * OBSERVATION WORTH REPORTING TO CTP (do not rely on it)
 * During development, `gettext?urn=...&apikey=TEST` (a dummy key) returned text
 * for ctp:analects/xue-er. That looks like an authentication-bypass defect in
 * the endpoint, not authorization. No content obtained that way was stored or
 * used anywhere in this repository, and nothing here should be built on it:
 * using it would be exactly the circumvention the site prohibits. Report it to
 * CTP rather than depend on it.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CtextAuthError extends Error {}

export class CtextClient {
  /**
   * @param {object} opts
   * @param {string} [opts.apiKey]   CTP API key; REQUIRED for content calls
   * @param {string} [opts.api]      API base (override for a registered-IP proxy)
   * @param {string} [opts.userAgent]
   * @param {string} [opts.cacheDir] optional on-disk cache
   * @param {number} [opts.delayMs]  CTP asks clients to be gentle
   */
  constructor({
    apiKey = process.env.CTEXT_API_KEY,
    api = process.env.CTEXT_API_URL || 'https://api.ctext.org',
    userAgent = 'wenyan-corpus-builder/0.1 (research corpus builder; +https://github.com/mountain/wenyan)',
    cacheDir = null,
    delayMs = 1000,
    attempts = 5,
    timeoutMs = 30000,
  } = {}) {
    this.apiKey = apiKey;
    this.api = api;
    this.userAgent = userAgent;
    this.cacheDir = cacheDir;
    this.delayMs = delayMs;
    this.attempts = attempts;
    this.timeoutMs = timeoutMs;
    this.stats = { live: 0, cached: 0, retries: 0, failures: 0 };
  }

  get hasCredential() {
    return typeof this.apiKey === 'string' && this.apiKey.trim().length > 0;
  }

  /** Refuse loudly instead of silently degrading to unauthenticated access. */
  #requireCredential(fn) {
    if (!this.hasCredential) {
      throw new CtextAuthError(
        `CTEXT_API_KEY is not set; refusing to call ${fn}.\n` +
        'The Chinese Text Project authorizes API use through a subscription ' +
        '(https://ctext.org/tools/subscribe) that provides an API key or a ' +
        'registered IP. Set CTEXT_API_KEY (or CTEXT_API_URL for a registered ' +
        'proxy) and re-run. This tool will not attempt any unauthenticated or ' +
        'bypass route.');
    }
  }

  /**
   * @param {string} fn      API function, e.g. 'gettext'
   * @param {object} params
   */
  async call(fn, params = {}) {
    this.#requireCredential(fn);
    const cacheFile = this.cacheDir && fn !== 'getcapabilities'
      ? await this.#cachePath(fn, params)
      : null;
    if (cacheFile) {
      const fs = await import('node:fs');
      if (fs.existsSync(cacheFile)) {
        this.stats.cached++;
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      }
    }
    let lastErr;
    for (let i = 1; i <= this.attempts; i++) {
      try {
        const url = new URL(`${this.api}/${fn}`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        url.searchParams.set('apikey', this.apiKey);
        const res = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.error) {
          // Surface CTP's own error verbatim; never work around it.
          throw new CtextAuthError(`CTP API error ${data.error.code}: ${data.error.description}`);
        }
        this.stats.live++;
        if (cacheFile) {
          const fs = await import('node:fs');
          const path = await import('node:path');
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        }
        await sleep(this.delayMs);
        return data;
      } catch (err) {
        lastErr = err;
        if (err instanceof CtextAuthError) throw err; // do not retry a refusal
        if (i === this.attempts) break;
        this.stats.retries++;
        await sleep(Math.min(1000 * 2 ** (i - 1), 20000) + Math.random() * 500);
      }
    }
    this.stats.failures++;
    throw lastErr;
  }

  async #cachePath(fn, params) {
    const crypto = await import('node:crypto');
    const path = await import('node:path');
    const key = fn + ':' + JSON.stringify(params);
    const h = crypto.createHash('sha1').update(key).digest('hex');
    return path.join(this.cacheDir, `${fn}-${h}.json`);
  }

  /** Text of one URN, as an array of passage strings. */
  async getText(urn) {
    const d = await this.call('gettext', { urn });
    return { urn, title: d.title ?? null, fulltext: d.fulltext ?? [], subsections: d.subsections ?? [] };
  }

  /** Metadata (title, subsections) for one URN. */
  async getTextInfo(urn) {
    return this.call('gettextinfo', { urn });
  }

  /** List API functions and their parameters. */
  async getCapabilities() {
    return this.call('getcapabilities');
  }

  /**
   * Verify that the configured credential actually works before a long run.
   * Uses a documented, cheap call and reports CTP's error verbatim on failure.
   */
  async checkAccess(probeUrn = 'ctp:analects/xue-er') {
    this.#requireCredential('checkAccess');
    const info = await this.getTextInfo(probeUrn);
    return { ok: true, probeUrn, title: info?.title ?? null };
  }
}
