"""Independent integration audit: live producer, all JSON field types, frozen bytes."""
import copy
import hashlib
import itertools
import json
from pathlib import Path
import subprocess
import sys
import check
import strict_check
import worker

P = Path(__file__).resolve().parent
OLD = P.parent / 'external_relation_v0'
train = json.loads((OLD / 'train.json').read_text())
cohort = json.loads((P / 'cohort.json').read_text())
req = dict(schema='wenyan.external-role-inference.v0.1',
           task='three-controlled-transfer-constructions-v0',
           observer='ordered-agent-recipient-theme-v0', training=train,
           queries=[r['text'] for r in cohort], fuel=18)

def live(request):
    raw = subprocess.check_output([sys.executable, '-I', str(P / 'worker.py')],
                                  input=json.dumps(request), text=True, timeout=5)
    return json.loads(raw)

out = live(req)
strict_check.verify(req, out)
if out['answers'] != [row['expected'] for row in cohort]:
    raise AssertionError('cohort labels disagree')
# Independently inspect the entire 2 x 6 x 3 factorial cohort, not just its score.
maps = [(0, 1, 2), (0, 2, 1), (1, 0, 2)]
groups = {}
for row, answer in zip(cohort, out['answers']):
    if row['category'] == 'new-entity-role-permutation':
        i, slots = check.parse(row['text'])
        expected = [slots[k] for k in maps[i]]
        if answer != dict(status='KnownFiniteGrammar', roles=expected):
            raise AssertionError('independent role oracle')
        key = tuple(sorted(slots))
        groups.setdefault(key, set()).add((i, tuple(slots)))
    elif answer != dict(status='Unknown', reason='outside-profile'):
        raise AssertionError('boundary answer')
if len(groups) != 2 or any(rows != {(i, p) for i in range(3) for p in itertools.permutations(key)} for key, rows in groups.items()):
    raise AssertionError('factorial coverage')
old_entities = {v for name in ('train.json', 'holdout.json')
                for row in json.loads((OLD / name).read_text()) for v in check.parse(row['text'])[1]}
if not old_entities.isdisjoint({v for key in groups for v in key}):
    raise AssertionError('entity isolation')
# Check every partial-fuel verdict and Refuted/ambiguous transcripts positively.
positive = 1
for fuel in range(19):
    q = copy.deepcopy(req); q['fuel'] = fuel
    strict_check.verify(q, live(q)); positive += 1
for training in ([], [train[0], dict(id='conflict', text=train[0]['text'], roles=['乙', '甲', '书'])]):
    q = copy.deepcopy(req); q['training'] = training
    strict_check.verify(q, live(q)); positive += 1
# The frozen verifier actually accepts bool, float ordinal/count and integer flag.
legacy = []
for name, path, value in [('bool-ordinal', ('state', 0, 0, 0), False),
                          ('float-ordinal', ('state', 0, 0, 1), 1.0),
                          ('float-count', ('checked',), 18.0),
                          ('integer-match', ('trace', 0, 'matches'), int(out['training']['trace'][0]['matches']))]:
    bad = copy.deepcopy(out['training']); parent = bad
    for part in path[:-1]: parent = parent[part]
    parent[path[-1]] = value
    check.old['verify'](train, 18, bad)
    wrapped = copy.deepcopy(out); wrapped['training'] = bad
    try: strict_check.verify(req, wrapped)
    except ValueError: legacy.append(name)
    else: raise AssertionError('legacy forgery accepted by strict boundary')

def paths(value, path=()):
    yield path, value
    if type(value) is dict:
        for key, item in value.items(): yield from paths(item, path + (key,))
    elif type(value) is list:
        for key, item in enumerate(value): yield from paths(item, path + (key,))

rejected = 0
for side, original in (('request', req), ('output', out)):
    for path, value in paths(original):
        alternatives = [None, False, True, 0, 1, 0.0, 1.0, '', [], {}, [False], {'nested': [True]}]
        for replacement in alternatives:
            if type(replacement) is type(value): continue
            bad = copy.deepcopy(original)
            if not path: bad = copy.deepcopy(replacement)
            else:
                parent = bad
                for part in path[:-1]: parent = parent[part]
                parent[path[-1]] = copy.deepcopy(replacement)
            try: strict_check.verify(bad if side == 'request' else req, bad if side == 'output' else out)
            except ValueError: rejected += 1
            else: raise AssertionError(('type substitution accepted', side, path, replacement))
# Extra/missing fields at every object boundary; wrong-length list containers.
shape_rejections = 0
for side, original in (('request', req), ('output', out)):
    for path, value in paths(original):
        changes = []
        if type(value) is dict:
            extra = copy.deepcopy(value); extra['unexpected'] = False; changes.append(extra)
            for key in value:
                missing = copy.deepcopy(value); del missing[key]; changes.append(missing)
        if type(value) is list and side == 'output':
            # Candidate-set cardinality is algorithm-checked; all deletions alter this accepted trace.
            if value: changes.append(value[:-1])
        for replacement in changes:
            bad = copy.deepcopy(original)
            if not path: bad = replacement
            else:
                parent = bad
                for part in path[:-1]: parent = parent[part]
                parent[path[-1]] = replacement
            try: strict_check.verify(bad if side == 'request' else req, bad if side == 'output' else out)
            except (ValueError, AssertionError): shape_rejections += 1
            else: raise AssertionError(('shape mutation accepted', side, path))
# Prevent authority coercion, valid integer bounds/indices and labels in request.
for flag in ('native_admission', 'native_state_write'):
    for value in (True, 0, 1, 0.0, None, [], {}):
        bad = copy.deepcopy(out); bad[flag] = value
        try: strict_check.verify(req, bad)
        except ValueError: rejected += 1
        else: raise AssertionError('authority coercion')
for value in (-1, 19):
    bad = copy.deepcopy(req); bad['fuel'] = value
    try: strict_check.verify(bad, out)
    except ValueError: rejected += 1
    else: raise AssertionError('fuel range')
bad = copy.deepcopy(req); bad['expected'] = [row['expected'] for row in cohort]
try: strict_check.verify(bad, out)
except ValueError: rejected += 1
else: raise AssertionError('label injection')
# Well-typed but false verdicts/transcripts must fail even under Python -O.
for path, value in [(('training', 'status'), 'Refuted'), (('training', 'checked'), 17),
                    (('training', 'trace', 0, 'matches'), not out['training']['trace'][0]['matches']),
                    (('answers', 0, 'roles'), ['伪', '造', '值'])]:
    bad = copy.deepcopy(out); parent = bad
    for part in path[:-1]: parent = parent[part]
    parent[path[-1]] = value
    try: strict_check.verify(req, bad)
    except ValueError: rejected += 1
    else: raise AssertionError('well-typed forgery')
# Worker/checker share no parsing implementation. Probe all quote/length boundaries.
for entity in ('甲', 'a'*32, 'a'*33, '', '甲\n乙', '甲\r乙', '甲「乙', '甲」乙', '🙂'):
    for tails in (('授', '', '。'), ('把', '交给', '。'), ('获', '所授', '。')):
        text = '「'+entity+'」'+tails[0]+'「乙」'+tails[1]+'「书」'+tails[2]
        for query in (text, text+'。', text+'\n', text+'附', text[:-1]):
            a, b = check.parse(query), worker.parse(query)
            if (None if a is None else (a[0], tuple(a[1]))) != b:
                raise AssertionError(('parser disagreement', query))
# Audit the actual train-only call, without relying on answer accuracy.
real_learn = worker.frozen['learn']; calls = []
def spy(request):
    if set(request) != {'training', 'fuel'} or request['training'] != train:
        raise AssertionError('training interface leakage')
    calls.append(copy.deepcopy(request)); return real_learn(request)
worker.frozen['learn'] = spy
if json.loads(json.dumps(worker.execute(req))) != out or len(calls) != 1: raise AssertionError('producer interface')
worker.frozen['learn'] = real_learn
contract = json.loads((P / 'contract.json').read_text())
for name, digest in contract['frozen_files'].items():
    if hashlib.sha256((OLD / name).read_bytes()).hexdigest() != digest:
        raise AssertionError('historical source/evidence changed')
print(json.dumps(dict(status='StrictReceivingAuditPassed', positive_transcripts=positive,
                     legacy_forgery_reproductions=legacy, type_rejections=rejected,
                     shape_rejections=shape_rejections, known_correct=36, boundary_unknown=8,
                     native_admission=False, native_state_write=False), indent=2))
