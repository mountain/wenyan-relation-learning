// SPDX-License-Identifier: MIT
// Fetch only the already declared revision; never silently refresh the corpus.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sha256 } from './catalog.mjs';
import { WikiClient } from '../corpus/lib/client.mjs';
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/taixuan/source.json'), 'utf8'));
const client = new WikiClient({ cacheDir: path.join(ROOT, 'data/corpus/.cache/taixuan'), attempts: 2 });
const response = await client.api({ action: 'query', prop: 'revisions', revids: String(metadata.revision),
  rvprop: 'ids|timestamp|content', rvslots: 'main' });
const page = response.query?.pages?.[0], revision = page?.revisions?.[0];
const raw = revision?.slots?.main?.content;
if (page?.pageid !== metadata.pageId || revision?.revid !== metadata.revision
    || typeof raw !== 'string' || sha256(raw) !== metadata.sha256) throw new Error('upstream does not match pinned snapshot');
if (process.argv.includes('--write')) fs.writeFileSync(path.join(ROOT, metadata.file), raw);
console.log(JSON.stringify({ status: 'MatchedPinnedRevision', revision: revision.revid, sha256: metadata.sha256,
  written: process.argv.includes('--write') }));
