import json
def load(path='osm_m3.txt'):
    ways=[]
    for i,line in enumerate(open(path).read().strip().split('\n')):
        tags,data=line.split('#')
        svc,name,tun,ref=tags.split('|')
        v=list(map(int,data.split(',')))
        pts=[];a=b=0
        for k in range(0,len(v),3):
            a+=v[k];b+=v[k+1];pts.append((a/1e6,b/1e6,v[k+2]))
        ways.append(dict(i=i,svc=svc,name=name,tunnel=tun=='T',pts=pts))
    return ways
