"""Independent strict profile and transcript/inference checker; no worker imports."""
import json,runpy
from pathlib import Path
P=Path(__file__).resolve().parent
old=runpy.run_path(str(P.parent/'external_relation_v0/verify.py'))
canonical=lambda x:json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def parse(text):
    if not isinstance(text,str) or len(text)>256:return None
    parts=text.split('「')
    if len(parts)!=4 or parts[0]!='':return None
    slots=[];tails=[]
    for part in parts[1:]:
        pieces=part.split('」')
        if len(pieces)!=2:return None
        v,tail=pieces
        if not 1<=len(v)<=32 or '\r' in v or '\n' in v:return None
        slots.append(v);tails.append(tail)
    endings=[['授','','。'],['把','交给','。'],['获','所授','。']]
    if tails not in endings:return None
    return endings.index(tails),slots

def verify(req,out):
    if set(req)!={'schema','task','observer','training','queries','fuel'}:raise ValueError('request fields')
    if req['schema']!='wenyan.external-role-inference.v0.1' or req['task']!='three-controlled-transfer-constructions-v0' or req['observer']!='ordered-agent-recipient-theme-v0':raise ValueError('request identity')
    if type(req['fuel']) is not int or not 0<=req['fuel']<=18:raise ValueError('fuel')
    if not isinstance(req['training'],list) or len(req['training'])>32:raise ValueError('training bound')
    if not isinstance(req['queries'],list) or len(req['queries'])>64 or any(not isinstance(x,str) or len(x)>256 for x in req['queries']):raise ValueError('query bound')
    ids=set()
    for row in req['training']:
        if set(row)!={'id','text','roles'} or not isinstance(row['id'],str) or row['id'] in ids or parse(row['text']) is None:raise ValueError('training schema')
        ids.add(row['id'])
        if not isinstance(row['roles'],list) or len(row['roles'])!=3 or any(not isinstance(v,str) or not 0<len(v)<=32 for v in row['roles']):raise ValueError('supervision schema')
    if set(out)!={'schema','task','observer','training','answers','native_admission','native_state_write'}:raise ValueError('output fields')
    for name in ['schema','task','observer']:
        if out[name]!=req[name]:raise ValueError('identity drift')
    if out['native_admission'] is not False or out['native_state_write'] is not False:raise ValueError('authority escalation')
    # Frozen verifier uses Python equality (True == 1). Require exact JSON types
    # for its integer counts, ordinals and boolean match flags before invoking it.
    r=out['training']
    if type(r['checked']) is not int:raise ValueError('count type')
    if any(type(k) is not int for s in r['state'] for o in s for k in o):raise ValueError('ordinal type')
    for row in r['trace']:
        if type(row['matches']) is not bool or any(type(k) is not int for k in row['order']):raise ValueError('trace type')
    old['verify'](req['training'],req['fuel'],r)
    answers=[]
    for text in req['queries']:
        parsed=parse(text)
        if parsed is None:answers.append(dict(status='Unknown',reason='outside-profile'));continue
        i,slots=parsed
        if r['status']!='Accepted':answers.append(dict(status='Unknown',reason='unaccepted-training'));continue
        candidates=r['state'][i]
        if len(candidates)!=1:answers.append(dict(status='Unknown',reason='ambiguous'));continue
        # Role-wise lookup is independent of the worker's comprehension.
        o=candidates[0];answers.append(dict(status='KnownFiniteGrammar',roles=[slots[o[0]],slots[o[1]],slots[o[2]]]))
    if canonical(out['answers'])!=canonical(answers):raise ValueError('inference mismatch')
    return out
