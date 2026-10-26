import json, math, bisect, sys
sys.path.insert(0,'.')
from router import node_pos, node_edges, edges, xy, cum
M=json.load(open('m3.json'))
P=[]
for p in M['paths']:
    a=b=0; pts=[]
    for i in range(0,len(p['p']),2): a+=p['p'][i]; b+=p['p'][i+1]; pts.append(xy(a/1e6,b/1e6))
    P.append((pts,p['d']))
def at(pid,d):
    pts,c=P[pid]; i=max(0,min(bisect.bisect_right(c,d)-1,len(c)-2))
    f=(d-c[i])/(c[i+1]-c[i]) if c[i+1]>c[i] else 0
    return (pts[i][0]+(pts[i+1][0]-pts[i][0])*f, pts[i][1]+(pts[i+1][1]-pts[i][1])*f)
def pos(segs,t):
    last=None
    for s in segs:
        ts,ds=s[3],s[4]
        if ts[0]<=t<=ts[-1]:
            j=max(0,min(bisect.bisect_right(ts,t)-1,len(ts)-2)); sp=ts[j+1]-ts[j]
            return at(s[0], ds[j]+(ds[j+1]-ds[j])*((t-ts[j])/sp if sp>0 else 0))
        if ts[-1]<t: last=at(s[0],s[4][-1])
        else: break
    return last if last else at(segs[0][0],segs[0][4][0])
def tail_track(n, length=160):
    """polyline of the last `length` metres of the dead-end track ending at node n"""
    e=edges[node_edges[n][0]]; pts=e['pts'] if e['b']==n else e['pts'][::-1]
    c=cum(pts); L=c[-1]; return [p for p,d in zip(pts,c) if d>=L-length] or pts[-2:]
def dist_to(poly,p):
    best=1e9
    for (ax,ay),(bx,by) in zip(poly,poly[1:]):
        dx,dy=bx-ax,by-ay; L2=dx*dx+dy*dy; t=0 if L2==0 else max(0,min(1,((p[0]-ax)*dx+(p[1]-ay)*dy)/L2))
        best=min(best,math.hypot(p[0]-ax-t*dx,p[1]-ay-t*dy))
    return best
tails={n:tail_track(n) for n in map(int,sys.argv[1:])}
bad={}
for t in range(3*3600, 27*3600, 10):
    ps=[pos(s,t) for s in M['trains']]
    for n,poly in tails.items():
        inside=[k+1 for k,p in enumerate(ps) if p and dist_to(poly,p)<1.5]
        if len(inside)>1: bad.setdefault(n,[]).append(('%02d:%02d:%02d'%(t//3600%24,t//60%60,t%60),inside))
print({n:len(v) for n,v in bad.items()} or 'no tail ever has two trains', {n:v[:4] for n,v in bad.items()})
