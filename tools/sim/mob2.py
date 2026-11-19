# Interactive phone checks: open each full-screen form, fill it, save it, and make sure the page behind updates
from simlib import *
import subprocess
def sql(q): return subprocess.run(["su","postgres","-c",f"psql -At -d zb_sim -c \"{q}\""],capture_output=True,text=True).stdout.strip()
with sync_playwright() as p:
    b,pg,errs=new_page(p, w=390, h=844)
    pg.goto(BASE+"/",wait_until="networkidle"); pg.wait_for_timeout(1000)
    def go(n):
        if n in ("Inventory","Sales","Records","Overview"): pg.locator(".sh-tabbar .sh-tab", has_text=n).first.click()
        else:
            pg.locator(".sh-tabbar .sh-tab", has_text="More").first.click(); pg.wait_for_timeout(300); pg.locator(".sh-sheet li button", has_text=n).first.click()
        pg.wait_for_timeout(900)
    # 1. Customers: open the full-screen form from the floating button, add one, check it shows
    go("Customers"); before=sql("select count(*) from customers")
    pg.locator(".form-disclosure-toggle", has_text="Add customer").first.click(); pg.wait_for_timeout(500)
    pg.screenshot(path="out/mob_form_open.png")
    pg.get_by_label("Full name").fill("Tola Phone Test"); pg.get_by_label("Phone number").fill("08011112222")
    pg.locator(".form-disclosure.open .form-disclosure-body").get_by_role("button", name="Add customer").click(); pg.wait_for_timeout(1500)
    print("customers", before,"->",sql("select count(*) from customers"), "| form still open:", pg.locator(".form-disclosure.open").count(), "| new card visible:", pg.get_by_text("Tola Phone Test").count())
    pg.screenshot(path="out/mob_form_after.png")
    # 2. Inventory: Receive stock (in-flow button) then the Add product full-screen form
    go("Inventory"); pg.locator(".form-disclosure-toggle", has_text="Add product").first.click(); pg.wait_for_timeout(500); pg.screenshot(path="out/mob_addproduct.png")
    print("errs",errs[:3],"fail",failures[:3]); b.close()
