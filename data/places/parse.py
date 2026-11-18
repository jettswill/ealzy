import sys,json,struct,re,csv
src=sys.argv[1]
lines=open(src,encoding='utf-8').read().split('\n')
tables={}
i=0
while i<len(lines):
    m=re.match(r'COPY public\.(\w+) \((.*)\) FROM stdin;',lines[i])
    if m:
        name,cols=m.group(1),[c.strip() for c in m.group(2).split(',')]
        rows=[];i+=1
        while lines[i]!='\\.':
            vals=lines[i].split('\t')
            def un(v):
                if v=='\\N':return None
                return v.encode('latin1','ignore').decode('latin1') if False else v.replace('\\n','\n').replace('\\t','\t').replace('\\\\','\\')
            rows.append(dict(zip(cols,[un(v) for v in vals])));i+=1
        tables[name]=rows
    i+=1
def ewkb(h):
    if not h:return None,None
    b=bytes.fromhex(h);le=b[0]==1;e='<' if le else '>'
    t=struct.unpack(e+'I',b[1:5])[0];off=5
    if t&0x20000000:off+=4
    x,y=struct.unpack(e+'dd',b[off:off+16]);return y,x
cats={c['id']:c['name'] for c in tables['categories']}
types={t['id']:t for t in tables['place_types']}
out=[]
for p in tables['places']:
    t=types.get(p['place_type_id'],{})
    lat,lon=ewkb(p['coordinates'])
    out.append(dict(id=p['id'],name=p['name'],category=cats.get(t.get('category_id')),place_type=t.get('name'),emoji=t.get('emoji'),
      city=p['city'],address=p['address'],lat=lat,lon=lon,hours=p['hours'],price_from=p['price_from'],
      service_rating=p['service_rating'],is_good_place=p['is_good_place'],is_visible=p['is_visible'],likes=p['likes'],dislikes=p['dislikes'],
      description=p['description'],photos=p['photos'],video_url=p['video_url'],
      type_activity=t.get('activity_rating'),type_emotion=t.get('emotion_rating'),type_age_from=t.get('age_from'),type_participants=f"{t.get('participants_from')}-{t.get('participants_to')}"))
json.dump(dict(categories=tables['categories'],place_types=tables['place_types'],places=out),open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
from collections import Counter
print(len(out),'places;',len(types),'types;',len(cats),'cats')
print(Counter(o['city'] for o in out).most_common(10))
print(Counter(o['category'] for o in out).most_common(15))
print(Counter(o['place_type'] for o in out).most_common(40))
print(json.dumps(out[0],ensure_ascii=False)[:800])
