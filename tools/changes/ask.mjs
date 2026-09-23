// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTsLoader } from '../lib/tsload.mjs';
import { buildCatalog, core } from './catalog.mjs';
import { loadLearning, appendLearning, predictContext } from './learning.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const logic = createTsLoader()(path.join(ROOT, 'src/inscription/syllogism.ts'));
export function askChanges(question, catalog = buildCatalog()) {
  if (question.kind === 'text') return core.readChanges(question.text, catalog);
  if (question.kind === 'syllogism') return logic.readSyllogism(question.text, question.policy ?? 'boolean', question.fuel ?? 255);
  if (question.kind === 'judgment') return logic.judgeSyllogism(question.contract, question.fuel ?? 255);
  if (question.kind === 'change') return { status: 'Computed', bits: core.changeLines(question.bits, question.positions) };
  return { status: 'Refused', reason: 'undeclared-question-kind' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, value, ...args] = process.argv.slice(2);
    const catalog = buildCatalog();
    const flag = (n, fallback) => { const i = args.indexOf(n); return i < 0 ? fallback : args[i + 1]; };
    let result;
    if (command === 'text' || command === 'syllogism') {
      result = askChanges({ kind: command, text: value, policy: flag('--policy', 'boolean'), fuel: Number(flag('--fuel', '255')) }, catalog);
    } else if (command === 'learn') {
      const file = flag('--store', null);
      if (!file) throw new Error('learn requires an explicit --store path');
      result = appendLearning(file, JSON.parse(fs.readFileSync(value, 'utf8')), catalog);
    } else if (command === 'predict') {
      const file = flag('--store', null);
      if (!file) throw new Error('predict requires --store');
      result = predictContext(loadLearning(file, catalog), value,
        { bits: flag('--bits', ''), position: Number(flag('--position', '0')) }, catalog, Number(flag('--fuel', '100000')));
    } else throw new Error('usage: text <inquiry> | syllogism <argument> | learn <event.json> --store <log> | predict <profile> --store <log> --bits <six bits> --position <1..6>');
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'Unknown' || result.judgment?.status === 'Unknown') process.exitCode = 3;
    if (result.status === 'Contested') process.exitCode = 5;
    if (result.status === 'Refused') process.exitCode = 4;
  } catch (e) { console.error(JSON.stringify({ status: 'Refused', reason: e.message })); process.exitCode = 4; }
}
