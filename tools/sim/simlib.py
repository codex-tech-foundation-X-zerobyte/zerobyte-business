import json, re, time, hmac, hashlib, base64, urllib.request
from playwright.sync_api import sync_playwright
BASE="http://127.0.0.1:5199"; SB="http://127.0.0.1:54321"; PGRST="http://127.0.0.1:3000"
SECRET=b"simulation-secret-simulation-secret-1234"
USER="22222222-2222-4222-8222-222222222222"
def b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def jwt(sub=USER, role="authenticated"):
    h=b64(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); p=b64(json.dumps({"sub":sub,"role":role,"aud":"authenticated","exp":int(time.time())+86400,"email":"ada@adaeze.ng"}).encode())
    s=b64(hmac.new(SECRET,f"{h}.{p}".encode(),hashlib.sha256).digest()); return f"{h}.{p}.{s}"
TOKEN=jwt()
def session():
    return json.dumps({"access_token":TOKEN,"refresh_token":"r","expires_in":86400,"expires_at":int(time.time())+86400,"token_type":"bearer","user":{"id":USER,"email":"ada@adaeze.ng","aud":"authenticated","role":"authenticated","user_metadata":{"full_name":"Ada Eze"},"app_metadata":{},"created_at":"2026-10-27T00:00:00Z"}})
CORS={"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"*","access-control-expose-headers":"*"}
failures=[]
def handler(route):
    req=route.request; url=req.url; path=url.split(SB)[-1]
    if req.method=="OPTIONS": return route.fulfill(status=204,headers=CORS)
    if path.startswith("/auth/v1/user"): return route.fulfill(status=200,headers={**CORS,"content-type":"application/json"},body=json.dumps({"id":USER,"email":"ada@adaeze.ng","aud":"authenticated","role":"authenticated","user_metadata":{"full_name":"Ada Eze"},"app_metadata":{}}))
    if path.startswith("/auth/v1/") or path.startswith("/realtime") or path.startswith("/functions/") or path.startswith("/storage/"):
        return route.fulfill(status=200,headers={**CORS,"content-type":"application/json"},body="{}")
    if path.startswith("/rest/v1/"):
        target=PGRST+path[len("/rest/v1"):]
        headers={k:v for k,v in req.headers.items() if k.lower() not in ("host","authorization","apikey","origin","referer","content-length")}
        headers["Authorization"]="Bearer "+TOKEN
        try:
            r=route.fetch(url=target, headers=headers)
        except Exception as e:
            return route.fulfill(status=502,headers=CORS,body=str(e))
        if r.status>=400: failures.append((req.method,path.split("?")[0],r.status,(r.text() or "")[:220]))
        h={**dict(r.headers),**CORS}; h.pop("content-encoding",None); h.pop("content-length",None)
        return route.fulfill(status=r.status,headers=h,body=r.body())
    return route.continue_()
def new_page(p, w=1440, h=900, theme="light"):
    b=p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args=["--no-sandbox"])
    ctx=b.new_context(viewport={"width":w,"height":h})
    ctx.add_init_script(f"localStorage.setItem('sb-127-auth-token', {json.dumps(session())}); localStorage.setItem('zerobyte.theme','{theme}'); localStorage.setItem('zerobyte.tour.done','1'); localStorage.setItem('zerobyte.cookie-consent', JSON.stringify({{necessary:true,analytics:false,decided:true}}));")
    pg=ctx.new_page(); pg.route(re.compile(r"http://127\.0\.0\.1:54321/.*"),handler)
    errs=[]; pg.on("pageerror",lambda e: errs.append("PAGEERROR "+str(e)[:200]))
    pg.on("console",lambda m: errs.append("CONSOLE "+m.text[:200]) if m.type=="error" and "WebSocket" not in m.text and "Failed to load resource" not in m.text else None)
    return b,pg,errs
