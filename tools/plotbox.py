import sys; sys.path.insert(0,'.')
from osmparse import load
import collections
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
import os
W=load(os.environ.get('TRACKS','osm_m3.txt'))
deg=collections.Counter()
for w in W:
    for k,(a,b,n) in enumerate(w['pts']):
        if n: deg[n]+= 1 if k in (0,len(w['pts'])-1) else 2
col={'':'black','yard':'tab:blue','siding':'tab:green','crossover':'tab:red'}
def plot(box,name,extra=()):
    fig,ax=plt.subplots(figsize=(14,10))
    for w in W:
        la=[p[0] for p in w['pts']];lo=[p[1] for p in w['pts']]
        ins=[k for k,(x,y) in enumerate(zip(la,lo)) if box[0]<=x<=box[1] and box[2]<=y<=box[3]]
        if not ins: continue
        c='magenta' if 'anello' in w['name'] else col[w['svc']]
        ax.plot(lo,la,color=c,lw=1.2)
        mid=ins[len(ins)//2]; ax.text(lo[mid],la[mid],'w%d'%w['i'],fontsize=9,color=c,fontweight='bold',clip_on=True)
        for x,y,n in w['pts']:
            if n:
                ax.plot(y,x,'o',ms=5 if deg[n]==1 else 2,color='red' if deg[n]==1 else 'k')
                if deg[n]==1 or deg[n]>=3: ax.text(y,x,' n%d'%n,fontsize=7,color='gray',clip_on=True)
    for la,lo in extra: ax.plot(lo,la,'*',ms=12,color='orange')
    ax.set_xlim(box[2],box[3]); ax.set_ylim(box[0],box[1]); ax.set_aspect(1/0.7)
    fig.savefig(name,dpi=80,bbox_inches='tight')
if __name__=='__main__':
    b=list(map(float,sys.argv[1:5])); plot(b,sys.argv[5])
