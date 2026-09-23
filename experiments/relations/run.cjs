// SPDX-License-Identifier: MIT
// Node 24/26 runtime-only harness for the pinned TypeScript subset.
// Does not replace the repository TypeScript/Jest gates.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const original = fs.readFileSync(file, 'utf8');
  // 'strip' is accepted by Node 24 and 26; 'transform' was removed in Node 26.
  let code = stripTypeScriptTypes(original, {mode: 'strip'});
  const bindings = {};
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*["'](.+?)["'];?/g, (_, names, relative) => {
    const dep = load(path.resolve(path.dirname(file), relative + '.ts'));
    // TS 4.2's ordinary imports include type-only names; no runtime binding exists.
    for (const name of names.split(',').map(x => x.trim()).filter(Boolean)) {
      if (Object.hasOwn(dep, name)) bindings[name] = dep[name];
    }
    return '';
  });
  const exported = Array.from(code.matchAll(/export\s+(?:function|const)\s+(\w+)/g), m => m[1]);
  code = code.replace(/export\s+(?=function|const)/g, '');
  const script = new vm.Script(`(function(){${code}\nreturn {${exported.join(',')}};})()`, {filename:file});
  const out = script.runInNewContext(bindings, {timeout:1000});
  cache.set(file, out);
  return out;
}
const r = load(path.join(root,'src/inscription/relations.ts'));
const {runInscriptionPipeline: pipeline} = load(path.join(root,'src/inscription/pipeline.ts'));
const canonical = x => JSON.parse(JSON.stringify(x));
const same = (a,b) => assert.deepEqual(canonical(a),canonical(b));
const forms = (a,b,t) => [
  `「${a}」授「${b}」「${t}」。`,
  `「${a}」把「${t}」交给「${b}」。`,
  `「${b}」获「${a}」所授「${t}」。`
];
const expected = {agent:'甲',recipient:'乙',theme:'书'};
const training = forms('甲','乙','书').map((text,i)=>({id:`train-${i}`,text,expected}));
const empty = r.emptyRelationModel();
let model = empty;
const updates = [];
for (const e of training) {
  const before = JSON.stringify(model);
  const result = r.learnRelations(model,e,6);
  assert.equal(JSON.stringify(model),before);
  assert.equal(result.status,'Updated');
  assert.equal(result.remainingMappings,1);
  assert.equal(result.refutations.length,5);
  updates.push(result);
  model = result.model;
}
model = canonical(model); // saved/reloaded evidence is sufficient to rebuild constraints
const receipts = [];
let baselineCollisions = 0;
for (const [a,b,t] of [['丙','丁','帛'],['戊','己','玉'],['庚','辛','简']]) {
  const texts = forms(a,b,t), reversed = forms(b,a,t);
  for(let i=0;i<3;i++) {
    const target = {agent:a,recipient:b,theme:t};
    const out = pipeline(texts[i],{steps:3,relationModel:model});
    assert.equal(out.blocked,false);
    assert.equal(out.relation.status,'KnownFiniteGrammar');
    same(out.relation.candidates,[target]);
    const baseline = pipeline(texts[i],{steps:3});
    const withoutRelation = {...out}; delete withoutRelation.relation;
    same(withoutRelation,baseline); // opt-in leaves legacy result unchanged
    for(const occ of out.relation.occurrences)
      assert.equal(texts[i].slice(occ.start,occ.end),occ.value);
    const positive = r.compareRelations(texts[i],texts[(i+1)%3],model);
    const negative = r.compareRelations(texts[i],reversed[i],model);
    assert.equal(positive.status,'SameRelation');
    assert.equal(negative.status,'RoleReversal');
    assert.equal(r.compareRelations(texts[i],reversed[i],empty).status,'Unknown');
    if (baseline.reverse.hypothesis === pipeline(reversed[i],{steps:3}).reverse.hypothesis)
      baselineCollisions++;
    receipts.push({source:texts[i],paraphrase:texts[(i+1)%3],reversed:reversed[i],
      positive:positive.status,negative:negative.status,reading:out.relation});
  }
}
assert.equal(baselineCollisions,9);
const zero = r.learnRelations(empty,training[0],0);
assert.equal(zero.status,'Unknown'); assert.equal(zero.checked,0); same(zero.model,empty);
const partial = r.learnRelations(empty,training[0],2);
assert.equal(partial.status,'Unknown'); same(partial.model,empty);
const conflict = r.learnRelations(model,{...training[0],id:'conflict',expected:
  {agent:'乙',recipient:'甲',theme:'书'}},6);
assert.equal(conflict.status,'Conflict'); same(conflict.model,model);
for(const text of ['「甲」未授「乙」「书」。','甲给乙一本书。','「甲」把「书」交给「乙」，然后离开。'])
  assert.equal(r.readRelation(text,model).status,'Unknown');
const stale = {...model,schema:'wenyan.relations.v0'};
assert.throws(()=>r.readRelation(training[0].text,stale));
assert.throws(()=>r.readRelation(training[0].text,{...model,examples:[...model.examples,model.examples[0]]}));
assert.throws(()=>r.learnRelations(model,{...training[0],id:'new'},Infinity));
const poisoned = canonical(model); poisoned.examples.push({...training[0],id:'poison',expected:{agent:'乙',recipient:'甲',theme:'书'}});
assert.throws(()=>r.readRelation(training[0].text,poisoned));
const blocked = pipeline(training[0].text,{relationModel:stale,safety:{requireAcknowledgement:true}});
assert.equal(blocked.blocked,true); // existing gate still executes first
// Equal values never merge two source occurrences.
const repeat = r.readRelation(forms('甲','甲','书')[0],model);
assert.equal(repeat.occurrences.length,3);
assert.notEqual(repeat.occurrences[0].start,repeat.occurrences[1].start);
// Learning one construction grants no permission to another construction.
const oneRule = r.learnRelations(empty,training[0],6).model;
assert.equal(r.readRelation(training[1].text,oneRule).status,'Unknown');
const files=['src/inscription/analysis.ts','src/inscription/reverse.ts','src/inscription/pipeline.ts','src/inscription/relations.ts','experiments/relations/run.cjs'];
const evidence = {schema:'wenyan.relation-calibration.evidence.v1',
  baseline:'mountain/wenyan@6143e22ca8319a8ebca89b59a29f20158812b63f',
  adva_reference:'mountain/adva@79f6353511d736ae743b109f1c573b652eff170a/research-0131',
  status:'PassedFiniteScope',training:3,heldOutEntities:9,positivePairs:9,roleReversals:9,
  legacyHypothesisCollisions:baselineCollisions,updates,model,receipts,
  controls:['zero-fuel','partial-fuel','conflicting-label','unseen-construction','negation','out-of-grammar',
    'stale-version','duplicate-evidence-id','nonfinite-fuel','inconsistent-replay','existing-ack-gate','distinct-occurrences'],
  limitations:['controlled grammar','supervised labels','external Adva-policy adapter, not native learn',
    'runtime transpilation only; full TypeScript/Jest and CI not run','no speedup claim against ordinary role parsing'],
  runtime:process.version,sha256:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))};
fs.writeFileSync(path.join(__dirname,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({status:evidence.status,training:3,positivePairs:9,roleReversals:9,
  legacyHypothesisCollisions:baselineCollisions,controls:evidence.controls.length}));
