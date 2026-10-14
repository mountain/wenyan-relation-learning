"""Independent checker: quoted-token splitting, exhaustive truth tables; no learner import."""
import itertools

def parse(text):
    pieces=text.split('「'); assert len(pieces)==4 and pieces[0]==''
    values=[]; tails=[]
    for piece in pieces[1:]:
        value,tail=piece.split('」'); assert value and len(value)<=32
        values.append(value); tails.append(tail)
    signatures=[['授','','。'],['把','交给','。'],['获','所授','。']]
    return signatures.index(tails),values

def verify(training,fuel,result):
    state=[list(itertools.permutations(range(3))) for _ in range(3)]
    trace=[]; count=0; status='Unknown'; reason='ambiguous'; stopped=False
    for row in training:
        try:i,slots=parse(row['text'])
        except (ValueError,AssertionError):reason='grammar';stopped=True;break
        survivors=[]
        for order in state[i]:
            if count==fuel:reason='budget';stopped=True;break
            actual=list(map(slots.__getitem__,order)); count+=1
            trace.append(dict(id=row['id'],order=list(order),actual=actual,matches=actual==row['roles']))
            if actual==row['roles']:survivors.append(order)
        if stopped:break
        if not survivors:status='Refuted';reason='inconsistent-supervision';stopped=True;break
        state[i]=survivors
    if not stopped and all(len(s)==1 for s in state):status='Accepted';reason='unique-mappings'
    expected=dict(status=status,state=[[list(o) for o in s] for s in state],trace=trace,checked=count,reason=reason)
    assert result==expected,'invalid transcript/state/verdict'
    return result

def predict(state,text):
    i,slots=parse(text)
    return [slots[k] for k in state[i][0]] if len(state[i])==1 else None
