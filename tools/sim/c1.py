from simlib import *
import sys
PAGES=["Overview","Sales","Inventory","Purchase Orders","Customers","Receipts","Invoices","Expenses","Records","Reports","Branches","Workforce","User Accounts","Settings"]
tag=sys.argv[1] if len(sys.argv)>1 else "live"
with sync_playwright() as p:
    b,pg,errs=new_page(p, w=1280, h=800)
    pg.goto(BASE+"/",wait_until="networkidle"); pg.wait_for_timeout(1200)
    for n in PAGES:
        pg.locator(".sh-sidebar .sh-nav-item", has_text=re.compile(rf"^\s*{n}\s*$")).first.click(); pg.wait_for_timeout(1100)
        pg.screenshot(path=f"out/{tag}_{n.replace(' ','_')}_d.png")
    print("desktop errs:",errs[:5],"fail:",failures[:4]); b.close()
    b,pg,errs=new_page(p, w=390, h=844)
    pg.goto(BASE+"/",wait_until="networkidle"); pg.wait_for_timeout(1200)
    tabs=["Overview","Sales","Inventory","Records"]
    for n in PAGES:
        if n in tabs: pg.locator(".sh-tabbar .sh-tab", has_text=re.compile(rf"^\s*{n}\s*$")).first.click()
        else:
            pg.locator(".sh-tabbar .sh-tab", has_text="More").first.click(); pg.wait_for_timeout(350)
            pg.locator(".sh-sheet li button", has_text=re.compile(rf"^\s*{n}\s*$")).first.click()
        pg.wait_for_timeout(1000); pg.screenshot(path=f"out/{tag}_{n.replace(' ','_')}_m.png")
    print("phone errs:",errs[:5]); b.close()
