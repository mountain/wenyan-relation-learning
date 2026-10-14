"""Receipt-bound external supervisor and reproducible campaign."""
from pathlib import Path
import copy,hashlib,json,resource,subprocess,sys
from verify import verify,predict,parse
P=Path(__file__).resolve().parent; ROOT=P.parent.parent
JOURNAL=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
def worker_limit():
    resource.setrlimit(resource.RLIMIT_AS,(134217728,134217728))
    resource.setrlimit(resource.RLIMIT_CPU,(4,4))
def invoke(training,fuel):
    r=subprocess.run([sys.executable,str(P/'learner.py')],input=json.dumps(dict(training=training,fuel=fuel)),capture_output=True,text=True,timeout=5,preexec_fn=worker_limit)
    assert r.returncode==0,r.stderr
    assert len(r.stdout.encode())<=65536
    checked=verify(training,fuel,json.loads(r.stdout))
    JOURNAL.append(checked)
    return checked
def campaign():
    c=json.loads((P/'contract.json').read_text())
    assert c['version']=='external-wenyan-role-permutations-v0'
    assert c['task']=='three-controlled-transfer-constructions-v0'
    assert c['observer']=='ordered-agent-recipient-theme-v0'
    assert c['budget']==dict(candidate_checks=18,wall_seconds=5,memory_bytes=134217728,evidence_bytes=65536)
    assert c['source_commit']=='86c5295d01d126dec02f12f009f4cf3fbab0db17'
    assert c['authority']==dict(external_invocation=True,native_admission=False,native_state_write=False)
    for name,digest in c['receipt_files'].items():assert sha((ROOT/name).read_bytes())==digest
    receipt=json.loads(subprocess.check_output(['node','tools/relations/check-receiving-contract.mjs'],cwd=ROOT,text=True,timeout=5))
    assert receipt['status']=='DocumentaryAccepted' and receipt['authority']['native_admission'] is False
    assert receipt['source_commit']==json.loads((ROOT/'experiments/relations/receiving-contract-v0.1.json').read_text())['input']['source_commit']
    for n,d in c['split'].items():assert sha((P/n).read_bytes())==d
    train=json.loads((P/'train.json').read_text()); hold=json.loads((P/'holdout.json').read_text())
    assert {r['text'] for r in train}.isdisjoint({r['text'] for r in hold})
    assert {v for r in train for v in parse(r['text'])[1]}.isdisjoint({v for r in hold for v in parse(r['text'])[1]})
    learned=invoke(train,18)
    score=lambda s:sum(predict(s,r['text'])==r['roles'] for r in hold)
    baseline=invoke([],18); partial=invoke(train,2)
    wrong=copy.deepcopy(train)
    for r in wrong:r['roles'][0],r['roles'][1]=r['roles'][1],r['roles'][0]
    wrong_result=invoke(wrong,18)
    conflict=invoke(train+[dict(id='conflict',text=train[0]['text'],roles=['乙','甲','书'])],18)
    assert learned['status']=='Accepted' and score(learned['state'])==18
    assert score(baseline['state'])==0 and score(wrong_result['state'])==0
    assert partial['status']=='Unknown' and partial['checked']==2
    assert conflict['status']=='Unknown' # budget exhausted before contradictory label
    conflict=invoke([train[0],dict(id='conflict',text=train[0]['text'],roles=['乙','甲','书'])],18)
    assert conflict['status']=='Refuted'
    negatives=0
    for key,value in [('status','Accepted'),('checked',0),('state',[[[0,1,2]]]*3),('trace',[])]:
        bad=copy.deepcopy(partial);bad[key]=value
        try:verify(train,2,bad)
        except AssertionError:negatives+=1
        else:raise AssertionError('forged output accepted')
    assert invoke([dict(id='outside',text='甲授乙书',roles=['甲','乙','书'])],18)['reason']=='grammar'
    return dict(version=c['version'],task=c['task'],observer=c['observer'],contract_sha256=sha((P/'contract.json').read_bytes()),receipt=receipt,source_sha256={n:sha((P/n).read_bytes()) for n in ['learner.py','verify.py','run.py']},status='ExternalFiniteCalibrationAccepted',native_admission=False,native_state_write=False,holdout_correct=18,holdout_total=18,no_training_correct=score(baseline['state']),swapped_supervision_correct=score(wrong_result['state']),fixed_identity_rule_correct=score([[[0,1,2]]]*3),lookup_correct=sum(any(t['text']==r['text'] for t in train) for r in hold),negative_output_controls=negatives,runs=dict(learned=learned,no_training=baseline,swapped_supervision=wrong_result,partial=partial,conflict=conflict))
if __name__=='__main__':
    try:
        result=campaign()
        encoded=json.dumps(result,ensure_ascii=False,indent=2)
        assert len(encoded.encode())<=65536
        print(encoded)
    except Exception as error:
        print(json.dumps(dict(status='Unknown',reason=type(error).__name__,detail=str(error)[:512],completed_runs=JOURNAL,native_admission=False,native_state_write=False)))
        raise SystemExit(1)
