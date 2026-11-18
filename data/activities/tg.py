import urllib.request,re,html,json,time
out={};before=None
for _ in range(200):
    url='https://t.me/s/gidmyshlen'+(f'?before={before}' if before else '')
    h=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read().decode()
    blocks=re.split(r'<div class="tgme_widget_message_wrap',h)[1:]
    ids=[]
    for b in blocks:
        m=re.search(r'data-post="gidmyshlen/(\d+)"',b)
        if not m: continue
        pid=int(m.group(1));ids.append(pid)
        t=re.search(r'<div class="tgme_widget_message_text[^>]*>(.*?)</div>',b,re.S)
        txt=html.unescape(re.sub(r'<br\s*/?>','\n',t.group(1))) if t else ''
        txt=re.sub(r'<[^>]+>','',txt)
        d=re.search(r'datetime="([^"]+)"',b)
        out[pid]=dict(id=pid,date=d.group(1)[:10] if d else None,text=txt.strip())
    if not ids: break
    mn=min(ids)
    if before and mn>=before: break
    before=mn
    if mn<=1: break
    time.sleep(0.5)
json.dump(sorted(out.values(),key=lambda x:x['id']),open('tg.json','w'),ensure_ascii=False,indent=1)
print(len(out),min(out),max(out))
