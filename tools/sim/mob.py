from simlib import *
import sys
W=int(sys.argv[1]) if len(sys.argv)>1 else 390
PAGES=["Overview","Sales","Inventory","Purchase Orders","Customers","Receipts","Invoices","Expenses","Records","Reports","Branches","Workforce","User Accounts","Settings"]
TABS=["Overview","Sales","Inventory","Records"]
CHECK="""()=>{const vw=innerWidth; const out=[]; 
 if(document.documentElement.scrollWidth>vw+1) out.push('PAGE SCROLLS SIDEWAYS '+document.documentElement.scrollWidth+'>'+vw);
 const root=document.querySelector('.sh-content'); 
 root.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect(); if(r.width===0||r.height===0) return; const cs=getComputedStyle(e); if(cs.position==='fixed') return;
   if(r.right>vw+1 && !e.closest('.settings-tabs, .filter-row, .chip-row, [data-scroll]')) out.push('OVERFLOW-R '+e.tagName.toLowerCase()+'.'+String(e.className).slice(0,40)+' right='+Math.round(r.right));
   if(r.left<-1) out.push('OVERFLOW-L '+e.tagName.toLowerCase()+'.'+String(e.className).slice(0,40));});
 const small=[...root.querySelectorAll('button,a,select,input:not([type=hidden]):not([type=radio]):not([type=checkbox])')].filter(e=>{const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return r.width>0&&r.height>0&&(r.height<36)&&cs.visibility!=='hidden'&&cs.opacity!=='0'}).map(e=>(e.innerText||e.getAttribute('aria-label')||e.className||e.tagName).toString().trim().slice(0,28)+'('+Math.round(e.getBoundingClientRect().height)+'px)');
 if(small.length) out.push('SMALL TAP TARGETS: '+[...new Set(small)].slice(0,8).join(' | '));
 return out}"""
with sync_playwright() as p:
    THEME=sys.argv[2] if len(sys.argv)>2 else 'light'
    b,pg,errs=new_page(p, w=W, h=844, theme=THEME)
    pg.goto(BASE+"/",wait_until="networkidle"); pg.wait_for_timeout(1200)
    for n in PAGES:
        if n in TABS: pg.locator(".sh-tabbar .sh-tab", has_text=re.compile(rf"^\s*{n}\s*$")).first.click()
        else:
            pg.locator(".sh-tabbar .sh-tab", has_text="More").first.click(); pg.wait_for_timeout(350)
            pg.locator(".sh-sheet li button", has_text=re.compile(rf"^\s*{n}\s*$")).first.click()
        pg.wait_for_timeout(1100); pg.screenshot(path=f"out/mob{W}{THEME[0]}_{n.replace(' ','_')}.png")
        issues=pg.evaluate(CHECK); print(f"## {n}:", issues if issues else "ok")
    print("errs",errs[:3],"fail",failures[:3]); b.close()
