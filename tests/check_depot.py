"""Never two trains on one depot track at the same time (checked from the animated positions)."""
import json, math, bisect, sys, os, collections
sys.path.insert(0,'.')
os.environ['TRACKS']='osm_m3.txt'
from router import *
auto_links((45.4285, 45.4335, 9.2515, 9.2585),(201,))
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
# depot storage tracks: each through track (a-m-b) and each dead-end track counts as one track
tracks={}
for a,b,m in LINKS:
    tracks['through %d'%m]=[e for e in node_edges[m]]
for n in node_pos:
    if len(node_edges[n])==1:
        la,lo=ll(*node_pos[n])
        if 45.4285<la<45.4335 and 9.2515<lo<9.2585: tracks['dead-end %d'%n]=node_edges[n][:]
def on_edge(p, ei):
    pts=edges[ei]['pts']; best=1e9
    for (ax,ay),(bx,by) in zip(pts,pts[1:]):
        dx,dy=bx-ax,by-ay; L2=dx*dx+dy*dy; u=0 if L2==0 else max(0,min(1,((p[0]-ax)*dx+(p[1]-ay)*dy)/L2))
        best=min(best,math.hypot(p[0]-ax-u*dx,p[1]-ay-u*dy))
    return best<1.5
bad=collections.Counter(); ex={}
for t in range(3*3600, 27*3600, 60):
    ps=[pos(s,t) for s in M['trains']]
    for name,eds in tracks.items():
        on=[k+1 for k,p in enumerate(ps) if any(on_edge(p,e) for e in eds)]
        if len(on)>1: bad[name]+=1; ex.setdefault(name,('%02d:%02d'%(t//3600%24,t//60%60),on))
print('depot tracks checked:',len(tracks),'| tracks ever holding two trains:',len(bad), dict(list(ex.items())[:6]))
