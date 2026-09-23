// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTsLoader } from '../lib/tsload.mjs';
export function checkCore(root) {
  const load = createTsLoader();
  const c = load(path.join(root, 'src/inscription/changes.ts'));
  const l = load(path.join(root, 'src/inscription/syllogism.ts'));
  const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const words = c.hexagrams();
  assert.equal(new Set(words).size, 64);
  let maskRoundtrips = 0;
  for (const bits of words) {
    assert.equal(l.encodeMood(l.decodeMood(bits)), bits);
    for (const mask of words) {
      const positions = [...mask].flatMap((b, i) => b === '1' ? [i + 1] : []);
      const next = c.changeLines(bits, positions);
      assert.equal([...bits].filter((b, i) => b !== next[i]).length, positions.length);
      assert.equal(c.changeLines(next, positions), bits); maskRoundtrips++;
    }
    for (const kind of ['complement', 'reverse', 'exchange-trigrams'])
      assert.equal(c.transformHexagram(c.transformHexagram(bits, kind), kind), bits);
  }
  const p = c.positionPairings();
  const mate = (pairs, v) => pairs.find(pair => pair.includes(v)).find(x => x !== v);
  let v = 1; const route = [v];
  for (let i = 0; i < 6; i++) { v = mate(i % 2 ? p.correspondence : p.strata, v); route.push(v); }
  same(route, [1, 2, 5, 6, 3, 4, 1]);
  assert.equal(new Set(route.slice(0, 6)).size, 6);
  p.strata[0][0] = 99; assert.equal(c.positionPairings().strata[0][0], 1);

  // Independent oracle uses explicit sets, differences and intersections.
  // D = {0..7}; each occupied Venn atom is represented by one individual.
  function oracle(mood, figure, policy) {
    const figures = [
      [['M', 'P'], ['S', 'M']], [['P', 'M'], ['S', 'M']],
      [['M', 'P'], ['M', 'S']], [['P', 'M'], ['M', 'S']],
    ];
    for (let occupancy = 1; occupancy < 256; occupancy++) {
      const D = Array.from({ length: 8 }, (_, i) => i).filter(i => occupancy & 2 ** i);
      const sets = Object.fromEntries(['S', 'M', 'P'].map((name, j) => [name, new Set(D.filter(i => i & 2 ** j))]));
      if (policy === 'terms-nonempty' && Object.values(sets).some(s => !s.size)) continue;
      const holds = (kind, a, b) => {
        const intersection = [...sets[a]].filter(x => sets[b].has(x));
        const difference = [...sets[a]].filter(x => !sets[b].has(x));
        return ({ A: difference.length === 0, E: intersection.length === 0,
          I: intersection.length > 0, O: difference.length > 0 })[kind];
      };
      if (holds(mood[0], ...figures[figure - 1][0]) && holds(mood[1], ...figures[figure - 1][1])
          && !holds(mood[2], 'S', 'P')) return false;
    }
    return true;
  }
  const counts = {}; let classifications = 0, countermodels = 0;
  for (const policy of ['boolean', 'terms-nonempty']) {
    counts[policy] = [];
    for (let figure = 1; figure <= 4; figure++) {
      let valid = 0;
      for (const mood of l.moods()) {
        const contract = { mood, figure, policy }, result = l.judgeSyllogism(contract);
        assert.equal(result.status === 'Valid', oracle(mood, figure, policy));
        if (result.status === 'Valid') { valid++; assert.equal(result.checked, 255); }
        else {
          assert.equal(result.status, 'Refuted');
          assert.ok(l.checkCountermodel(contract, result.countermodel.mask)); countermodels++;
        }
        classifications++;
      }
      counts[policy].push(valid);
    }
  }
  same(counts, { boolean: [4, 4, 4, 3], 'terms-nonempty': [6, 6, 6, 6] });
  const valid = { mood: 'AAA', figure: 1, policy: 'boolean' };
  assert.equal(l.judgeSyllogism(valid, 0).status, 'Unknown');
  assert.equal(l.judgeSyllogism(valid, 254).status, 'Unknown');
  assert.equal(l.judgeSyllogism({ ...valid, figure: 2 }).status, 'Refuted');
  assert.equal(l.judgeSyllogism({ ...valid, mood: 'AAI' }).status, 'Refuted');
  assert.equal(l.judgeSyllogism({ ...valid, mood: 'AAI', policy: 'terms-nonempty' }).status, 'Valid');
  // All forms survive controlled text parsing with exact occurrence spans.
  const wires = [[['乙', '丙'], ['甲', '乙']], [['丙', '乙'], ['甲', '乙']], [['乙', '丙'], ['乙', '甲']], [['丙', '乙'], ['乙', '甲']]];
  const clause = (kind, [s, p]) => ({ A: `凡「${s}」皆「${p}」`, E: `凡「${s}」皆非「${p}」`,
    I: `有「${s}」為「${p}」`, O: `有「${s}」非「${p}」` })[kind];
  let parsed = 0;
  for (let figure = 1; figure <= 4; figure++) for (const mood of l.moods()) {
    const text = `${clause(mood[0], wires[figure - 1][0])}。${clause(mood[1], wires[figure - 1][1])}。故${clause(mood[2], ['甲', '丙'])}。`;
    const result = l.parseSyllogism(text);
    assert.equal(result.status, 'Parsed'); same(result.contract, { mood, figure, policy: 'boolean' });
    for (const clause of result.clauses) for (const o of clause.occurrences) assert.equal(text.slice(o.start, o.end), o.value);
    parsed++;
  }
  for (const bad of ['', '11111', '222222', null, ['1', '1', '1', '1', '1', '1']]) assert.throws(() => c.checkBits(bad));
  for (const bad of [[1, 1], [0], [7], [1.5], ['1']]) assert.throws(() => c.changeLines('111111', bad));
  for (const bad of [-1, 256, Infinity, 1.5]) assert.throws(() => l.judgeSyllogism(valid, bad));
  assert.throws(() => l.judgeSyllogism({ ...valid, figure: 0 }));
  assert.throws(() => l.judgeSyllogism({ ...valid, policy: 'traditional-unspecified' }));
  for (const text of ['猫都是动物，所以狗都是猫。', '凡「甲」皆「乙」。凡「乙」皆「甲」。故凡「甲」皆「甲」。',
    '凡「甲」皆「乙」。凡「丙」皆「丁」。故凡「甲」皆「丁」。']) assert.equal(l.parseSyllogism(text).status, 'Unknown');
  return { encodings: 64, maskRoundtrips, pairings: route, classifications, countermodels, parsed, validCounts: counts };
}
