"""External finite learner. stdin contains training only; no holdout access."""
import itertools,json,re,sys

def learn(request):
    assert set(request)=={'training','fuel'}
    assert isinstance(request['training'],list) and len(request['training'])<=32
    ids=set()
    for row in request['training']:
        assert set(row)=={'id','text','roles'} and isinstance(row['id'],str) and row['id'] not in ids
        ids.add(row['id'])
        assert isinstance(row['text'],str) and len(row['text'])<=256
        assert isinstance(row['roles'],list) and len(row['roles'])==3 and all(isinstance(v,str) and 0<len(v)<=32 for v in row['roles'])
    fuel=request['fuel']; assert type(fuel) is int and 0<=fuel<=18
    rules=[r'^「([^」]+)」授「([^」]+)」「([^」]+)」。$',r'^「([^」]+)」把「([^」]+)」交给「([^」]+)」。$',r'^「([^」]+)」获「([^」]+)」所授「([^」]+)」。$']
    state=[list(itertools.permutations(range(3))) for _ in rules]
    trace=[]; checked=0
    for row in request['training']:
        parsed=[(i,re.fullmatch(r,row['text'])) for i,r in enumerate(rules)]
        parsed=[(i,m) for i,m in parsed if m]
        if len(parsed)!=1:return dict(status='Unknown',state=state,trace=trace,checked=checked,reason='grammar')
        i,m=parsed[0]; slots=m.groups(); survivors=[]
        for order in state[i]:
            if checked==fuel:return dict(status='Unknown',state=state,trace=trace,checked=checked,reason='budget')
            actual=[slots[k] for k in order]; checked+=1
            trace.append(dict(id=row['id'],order=order,actual=actual,matches=actual==row['roles']))
            if actual==row['roles']:survivors.append(order)
        if not survivors:return dict(status='Refuted',state=state,trace=trace,checked=checked,reason='inconsistent-supervision')
        state[i]=survivors
    status='Accepted' if all(len(s)==1 for s in state) else 'Unknown'
    return dict(status=status,state=state,trace=trace,checked=checked,reason='unique-mappings' if status=='Accepted' else 'ambiguous')

if __name__=='__main__':
    data=sys.stdin.buffer.read(65537); assert len(data)<=65536
    print(json.dumps(learn(json.loads(data)),ensure_ascii=False))
