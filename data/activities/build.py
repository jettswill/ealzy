import json,collections
ch={r['post'].rsplit('/',1)[1]:r for r in json.load(open('channel.json'))}
rows=[];names=set();bad=[]
for l in open('catalog_data.txt',encoding='utf-8'):
    if l.startswith('#') or not l.strip(): continue
    f=l.rstrip('\n').split('|'); assert len(f)==14,l
    n,cat,em,a,e,p,h,s,io,ppl,kids,q,posts,geo=f
    assert n not in names,n; names.add(n)
    ps=[x for x in posts.split(',') if x]
    bad+=[(x,n) for x in ps if x not in ch]
    rows.append(dict(name=n,category=cat,emoji=em,activity=int(a),emotion=int(e),price_level=int(p),duration_h=float(h),season=s,
      indoor_outdoor={'in':'в помещении','out':'на улице','both':'и так, и так'}[io],min_people=int(ppl),kids=kids=='y',
      search_query=q,geo=geo or 'любой крупный город',we_were_there=bool(ps),channel_posts=['https://t.me/gidmyshlen/'+x for x in ps]))
print('bad refs',bad)
used={x.rsplit('/',1)[1] for r in rows for x in r['channel_posts']}
print(len(rows),'types;',sum(r['we_were_there'] for r in rows),'visited')
print(collections.Counter(r['category'] for r in rows))
print('unmapped:',[(k,v['activity']) for k,v in ch.items() if k not in used])
json.dump(rows,open('catalog.json','w'),ensure_ascii=False,indent=1)
