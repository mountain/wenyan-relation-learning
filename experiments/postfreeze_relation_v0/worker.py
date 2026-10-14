"""External v0.1 wrapper; frozen learner is unchanged. No query labels accepted."""
import json,re,runpy,sys
from pathlib import Path
P=Path(__file__).resolve().parent
frozen=runpy.run_path(str(P.parent/'external_relation_v0/learner.py'))
SLOT=r'「([^「」\r\n]{1,32})」'
RULES=[re.compile('^'+SLOT+'授'+SLOT+SLOT+'。$'),re.compile('^'+SLOT+'把'+SLOT+'交给'+SLOT+'。$'),re.compile('^'+SLOT+'获'+SLOT+'所授'+SLOT+'。$')]
def parse(text):
    if not isinstance(text,str) or len(text)>256:return None
    for i,rule in enumerate(RULES):
        m=rule.fullmatch(text)
        if m:return i,m.groups()
    return None

def execute(req):
    if set(req)!={'schema','task','observer','training','queries','fuel'}:raise ValueError('request fields')
    if req['schema']!='wenyan.external-role-inference.v0.1' or req['task']!='three-controlled-transfer-constructions-v0' or req['observer']!='ordered-agent-recipient-theme-v0':raise ValueError('identity')
    if not isinstance(req['queries'],list) or len(req['queries'])>64:raise ValueError('query budget')
    if any(parse(r['text']) is None for r in req['training']):raise ValueError('training outside profile')
    result=frozen['learn'](dict(training=req['training'],fuel=req['fuel']))
    answers=[]
    for text in req['queries']:
        parsed=parse(text)
        if parsed is None:answers.append(dict(status='Unknown',reason='outside-profile'));continue
        i,slots=parsed
        if result['status']!='Accepted':answers.append(dict(status='Unknown',reason='unaccepted-training'));continue
        candidates=result['state'][i]
        if len(candidates)!=1:answers.append(dict(status='Unknown',reason='ambiguous'));continue
        answers.append(dict(status='KnownFiniteGrammar',roles=[slots[k] for k in candidates[0]]))
    return dict(schema=req['schema'],task=req['task'],observer=req['observer'],training=result,answers=answers,native_admission=False,native_state_write=False)
if __name__=='__main__':
    data=sys.stdin.buffer.read(65537)
    if len(data)>65536:raise ValueError('input budget')
    output=json.dumps(execute(json.loads(data)),ensure_ascii=False)
    if len(output.encode())>65536:raise ValueError('output budget')
    print(output)
