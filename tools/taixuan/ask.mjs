// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, readTaixuan } from './catalog.mjs';
import { decodeAddress, encodeAddress, contextFeatures, nextZan } from './structure.mjs';
import { loadLearning, appendLearning, predictContext } from './learning.mjs';

export function askTaixuan(request, catalog = buildCatalog()) {
  if (request?.kind === 'text' && typeof request.text === 'string') return readTaixuan(request.text, catalog);
  if (request?.kind === 'address') {
    const context = decodeAddress(request.address);
    return { status: 'Address', context, features: contextFeatures(context), address: encodeAddress(context.digits, context.zan) };
  }
  if (request?.kind === 'next') return nextZan(request.context);
  return { status: 'Refused', reason: 'undeclared-request-kind' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, input, ...args] = process.argv.slice(2);
    const opt = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
    const store = opt('--store'), catalog = buildCatalog(); let result;
    if (command === 'learn') {
      if (!store) throw new Error('learn requires an explicit --store');
      result = appendLearning(store, JSON.parse(fs.readFileSync(input, 'utf8')), catalog);
    } else if (command === 'predict') {
      if (!store || !fs.existsSync(store)) throw new Error('predict requires an existing --store');
      const fuel = opt('--fuel') === undefined ? 100000 : Number(opt('--fuel'));
      result = predictContext(loadLearning(store, catalog), input,
        { system: 'taixuan', digits: opt('--digits'), zan: Number(opt('--zan')) }, catalog, fuel);
    } else if (command === 'text') result = askTaixuan({ kind: 'text', text: input }, catalog);
    else if (command === 'address') result = askTaixuan({ kind: 'address', address: input }, catalog);
    else if (command === 'next') result = askTaixuan({ kind: 'next', context: decodeAddress(input) }, catalog);
    else throw new Error('usage: text QUERY | address SIX_TRITS | next SIX_TRITS | predict PROFILE --store FILE --digits FOUR_TRITS --zan N | learn INPUT_JSON --store FILE');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = { Unknown: 3, Refused: 4, Contested: 5 }[result.status] ?? 0;
  } catch (error) {
    console.error(JSON.stringify({ status: 'Refused', reason: error.message })); process.exitCode = 4;
  }
}
