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
        o=candidates[0];answers.append(dict(status='KnownFiniteGrammar',roles=[slots[o[0]],slots[o[1]],slots[o[2]]))
    if canonical(out['answers'])!=canonical(answers):raise ValueError('inference mismatch')
    return out
