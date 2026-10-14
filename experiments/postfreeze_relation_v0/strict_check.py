"""Untrusted JSON receiving boundary. Frozen checker/evidence remain reproducible."""
import itertools
import json
from check import parse


def _json(value, depth=0, budget=None):
    if budget is None:
        budget = [4096]
    budget[0] -= 1
    if depth > 32 or budget[0] < 0:
        raise ValueError('JSON structure budget')
    if type(value) in (str, int, bool) or value is None:
        return
    if type(value) is list:
        for item in value:
            _json(item, depth + 1, budget)
        return
    if type(value) is dict and all(type(k) is str for k in value):
        for item in value.values():
            _json(item, depth + 1, budget)
        return
    raise ValueError('exact JSON type (floats are outside this profile)')


def _object(value, fields):
    if type(value) is not dict or set(value) != set(fields.split()):
        raise ValueError('exact object fields')


def _list(value, maximum, length=None):
    if type(value) is not list or len(value) > maximum or (length is not None and len(value) != length):
        raise ValueError('exact list shape')


def _strings(value):
    _list(value, 3, 3)
    if any(type(x) is not str or not 1 <= len(x) <= 32 for x in value):
        raise ValueError('role string type/bound')


def _order(value):
    _list(value, 3, 3)
    if any(type(x) is not int for x in value) or sorted(value) != [0, 1, 2]:
        raise ValueError('integer role permutation')


def verify(req, out):
    for value in (req, out):
        _json(value)
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > 65536:
            raise ValueError('JSON byte budget')
    _object(req, 'schema task observer training queries fuel')
    _object(out, 'schema task observer training answers native_admission native_state_write')
    for key in ('schema', 'task', 'observer'):
        if type(req[key]) is not str or type(out[key]) is not str:
            raise ValueError('identity string type')
    if type(req['fuel']) is not int or not 0 <= req['fuel'] <= 18:
        raise ValueError('integer fuel')
    _list(req['training'], 32)
    _list(req['queries'], 64)
    for row in req['training']:
        _object(row, 'id text roles')
        if type(row['id']) is not str or type(row['text']) is not str:
            raise ValueError('training strings')
        _strings(row['roles'])
    if any(type(x) is not str for x in req['queries']):
        raise ValueError('query string')
    if out['native_admission'] is not False or out['native_state_write'] is not False:
        raise ValueError('authority escalation')
    r = out['training']
    _object(r, 'status state trace checked reason')
    if type(r['status']) is not str or type(r['reason']) is not str:
        raise ValueError('verdict strings')
    if type(r['checked']) is not int or not 0 <= r['checked'] <= 18:
        raise ValueError('integer count')
    _list(r['state'], 3, 3)
    for candidates in r['state']:
        _list(candidates, 6)
        for order in candidates:
            _order(order)
    _list(r['trace'], 18)
    for row in r['trace']:
        _object(row, 'id order actual matches')
        if type(row['id']) is not str or type(row['matches']) is not bool:
            raise ValueError('trace string/boolean')
        _order(row['order'])
        _strings(row['actual'])
    _list(out['answers'], 64, len(req['queries']))
    for answer in out['answers']:
        if type(answer) is not dict or type(answer.get('status')) is not str:
            raise ValueError('answer object/status')
        if answer['status'] == 'KnownFiniteGrammar':
            _object(answer, 'status roles')
            _strings(answer['roles'])
        elif answer['status'] == 'Unknown':
            _object(answer, 'status reason')
            if type(answer['reason']) is not str:
                raise ValueError('unknown reason string')
        else:
            raise ValueError('answer status')
    identities = dict(schema='wenyan.external-role-inference.v0.1',
                      task='three-controlled-transfer-constructions-v0',
                      observer='ordered-agent-recipient-theme-v0')
    if any(req[k] != v or out[k] != v for k, v in identities.items()):
        raise ValueError('identity mismatch')
    if len({row['id'] for row in req['training']}) != len(req['training']):
        raise ValueError('duplicate training identity')
    if any(parse(row['text']) is None for row in req['training']):
        raise ValueError('training outside profile')
    if any(len(text) > 256 for text in req['queries']):
        raise ValueError('query bound')
    # Explicit comparison, independent of worker and of frozen assert statements.
    # Remains effective under Python -O; no trust in a supplied transcript.
    state = [[list(order) for order in itertools.permutations(range(3))] for _ in range(3)]
    trace = []
    stopped = False
    status, reason = 'Unknown', 'ambiguous'
    for row in req['training']:
        construction, slots = parse(row['text'])
        survivors = []
        for order in state[construction]:
            if len(trace) == req['fuel']:
                reason, stopped = 'budget', True
                break
            actual = [slots[index] for index in order]
            matches = actual == row['roles']
            trace.append(dict(id=row['id'], order=order, actual=actual, matches=matches))
            if matches:
                survivors.append(order)
        if stopped:
            break
        if not survivors:
            status, reason, stopped = 'Refuted', 'inconsistent-supervision', True
            break
        state[construction] = survivors
    if not stopped and all(len(candidates) == 1 for candidates in state):
        status, reason = 'Accepted', 'unique-mappings'
    expected_training = dict(status=status, reason=reason, state=state, trace=trace, checked=len(trace))
    if r != expected_training:
        raise ValueError('reconstructed training mismatch')
    expected_answers = []
    for text in req['queries']:
        parsed = parse(text)
        if parsed is None:
            answer = dict(status='Unknown', reason='outside-profile')
        elif status != 'Accepted':
            answer = dict(status='Unknown', reason='unaccepted-training')
        else:
            construction, slots = parsed
            role_by_name = dict(zip(('agent', 'recipient', 'theme'), state[construction][0]))
            answer = dict(status='KnownFiniteGrammar', roles=[slots[role_by_name[name]]
                          for name in ('agent', 'recipient', 'theme')])
        expected_answers.append(answer)
    if out['answers'] != expected_answers:
        raise ValueError('reconstructed inference mismatch')
    return out
