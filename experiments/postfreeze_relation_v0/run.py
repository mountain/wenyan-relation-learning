"""Post-freeze campaign; source and cohort committed before execution."""
from pathlib import Path
import copy,hashlib,json,resource,subprocess,sys
from check import parse,verify,canonical
P=Path(__file__).resolve().parent; OLD=P.parent/'external_relation_v0'; ROOT=P.parent.parent
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
JOURNAL=[]
def limits():
    resource.setrlimit(resource.RLIMIT_AS,(134217728,134217728))
    resource.setrlimit(resource.RLIMIT_CPU,(4,4))
def request(training,queries,fuel=18):
    return dict(schema='wenyan.external-role-inference.v0.1',task='three-controlled-transfer-constructions-v0',observer='ordered-agent-recipient-theme-v0',training=training,queries=queries,fuel=fuel)
def invoke(req):
    encoded=canonical(req)
    if len(encoded.encode())>65536:raise ValueError('input budget')
    r=subprocess.run([sys.executable,'-I',str(P/'worker.py')],input=encoded,text=True,capture_output=True,timeout=5,preexec_fn=limits)
    if r.returncode:raise ValueError('worker failure: '+r.stderr[-512:])
    if len(r.stdout.encode())>65536:raise ValueError('output budget')
    out=verify(req,json.loads(r.stdout));JOURNAL.append(out)
    return out

def campaign():
    c=json.loads((P/'contract.json').read_text())
    if c['frozen_commit']!='452cc20718d689f9af151baede060085608d9648':raise ValueError('pin drift')
    if c['authority']!=dict(native_admission=False,native_state_write=False):raise ValueError('authority drift')
    for n,h in c['frozen_files'].items():
        if sha(OLD/n)!=h:raise ValueError('frozen source drift')
    if sha(P/'cohort.json')!=c['cohort_sha256']:raise ValueError('cohort drift')
    # Re-run unchanged historical campaign: provenance receipt and budget precondition.
    prior=json.loads(subprocess.check_output([sys.executable,str(OLD/'run.py')],cwd=ROOT,timeout=10,text=True))
    if canonical(prior)!=canonical(json.loads((OLD/'evidence.json').read_text())):raise ValueError('historical replay drift')
    cohort=json.loads((P/'cohort.json').read_text());train=json.loads((OLD/'train.json').read_text())
    old_entities={v for name in ['train.json','holdout.json'] for r in json.loads((OLD/name).read_text()) for v in parse(r['text'])[1]}
    new_entities={v for r in cohort if r['category']=='new-entity-role-permutation' for v in parse(r['text'])[1]}
    if not old_entities.isdisjoint(new_entities):raise ValueError('entity leakage')
    req=request(train,[r['text'] for r in cohort]);out=invoke(req)
    if out['answers']!=[r['expected'] for r in cohort]:raise ValueError('cohort mismatch')
    no_training=invoke(request([],req['queries']))
    wrong=copy.deepcopy(train)
    for r in wrong:r['roles'][0],r['roles'][1]=r['roles'][1],r['roles'][0]
    wrong_out=invoke(request(wrong,req['queries']))
    ambiguous=copy.deepcopy(train)
    for r in ambiguous:r['text']=r['text'].replace('乙','甲');r['roles']=['甲','甲','书']
    ambiguity=invoke(request(ambiguous,req['queries']))
    score=lambda result:sum(a==r['expected'] for a,r in zip(result['answers'],cohort) if r['category']=='new-entity-role-permutation')
    if score(out)!=36 or score(no_training)!=0 or score(wrong_out)!=0 or score(ambiguity)!=0:raise ValueError('control failed')
    if ambiguity['training']['status']!='Unknown':raise ValueError('ambiguity falsely closed')
    negative=[]
    mutations=[('authority',lambda o:o.update(native_admission=True)),('task',lambda o:o.update(task='other')),('answer',lambda o:o['answers'][0].update(roles=['fixed'])),('ordinal-bool',lambda o:o['training']['state'][0][0].__setitem__(0,False)),('match-int',lambda o:o['training']['trace'][0].update(matches=1)),('missing-answer',lambda o:o['answers'].pop())]
    for name,mutate in mutations:
        bad=copy.deepcopy(out);mutate(bad)
        try:verify(req,bad)
        except (ValueError,AssertionError):negative.append(name)
        else:raise ValueError('negative accepted '+name)
    for name,mutate in [('request-task',lambda q:q.update(task='other')),('holdout-label-injection',lambda q:q.update(expected=['fixed'])),('fuel-bool',lambda q:q.update(fuel=True)),('query-limit',lambda q:q.update(queries=['x']*65))]:
        bad_req=copy.deepcopy(req);mutate(bad_req)
        try:verify(bad_req,out)
        except (ValueError,AssertionError):negative.append(name)
        else:raise ValueError('request negative accepted '+name)
    # Demonstrate the old type-equality issue without altering frozen source.
    from check import old
    bad=copy.deepcopy(out['training']);bad['state'][0][0][0]=False
    old['verify'](train,18,bad)
    rows=[dict(id=r['id'],category=r['category'],actual=a,expected=r['expected']) for r,a in zip(cohort,out['answers'])]
    return dict(schema=c['schema'],status='PostFreezeFiniteEvaluationPassed',frozen_commit=c['frozen_commit'],contract_sha256=sha(P/'contract.json'),source_sha256={n:sha(P/n) for n in ['worker.py','check.py','run.py']},cohort_sha256=c['cohort_sha256'],native_admission=False,native_state_write=False,known_correct=36,boundary_unknown=8,no_training_correct=0,wrong_supervision_correct=0,ambiguous_training_status=ambiguity['training']['status'],negative_controls=negative,legacy_bool_ordinal_accepted=True,rows=rows,training_transcript=out['training'])
if __name__=='__main__':
    try:print(json.dumps(campaign(),ensure_ascii=False,indent=2))
    except Exception as error:
        print(json.dumps(dict(status='Unknown',reason=type(error).__name__,detail=str(error)[:512],completed_runs=JOURNAL,native_admission=False,native_state_write=False),ensure_ascii=False));raise SystemExit(1)
