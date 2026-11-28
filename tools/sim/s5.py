from simlib import *
import subprocess, time
def sql(q): return subprocess.run(["su","postgres","-c",f"psql -At -d zb_sim -c \"{q}\""],capture_output=True,text=True).stdout.strip()
sql(f"insert into auth.users(id,email) values ('{USER}','ada@adaeze.ng') on conflict do nothing")
LOG=[]
with sync_playwright() as p:
    b,pg,errs=new_page(p)
    pg.goto(BASE+"/",wait_until="networkidle"); pg.wait_for_timeout(800)
    pass
    def go(n): pg.locator(".sh-sidebar .sh-nav-item", has_text=re.compile(rf"^\s*{n}\s*$")).first.click(); pg.wait_for_timeout(700)
    def rows(): return pg.locator(".sh-content tbody tr:visible").count()
    def feedback(): 
        t=[x.strip() for x in pg.locator(".sh-content .form-error:visible, .sh-content .form-success:visible").all_inner_texts() if x.strip()]
        return " / ".join(t)[:140]
    def add(page, table, btn, fills, submit, tag):
        go(page)
        before_db=sql(f"select count(*) from {table}")
        if not pg.get_by_label(next(iter(fills))).first.is_visible(): pg.get_by_role("button",name=btn).first.click(); pg.wait_for_timeout(500)
        for label,val in fills.items():
            el=pg.get_by_label(label).first
            tag_name=el.evaluate("e=>e.tagName")
            if tag_name=="SELECT": el.select_option(label=val) if val else None
            else: el.fill(str(val))
        t0=time.time(); pg.get_by_role("button",name=submit).first.click(); pg.wait_for_timeout(1500); ms=int((time.time()-t0)*1000)
        after_db=sql(f"select count(*) from {table}")
        first_field=pg.get_by_label(next(iter(fills))).first
        still_open=first_field.is_visible(); cleared=(first_field.input_value()=="") if still_open else None
        LOG.append((page,tag,f"db {before_db}->{after_db} | rows shown {rows()} | form open={still_open} cleared={cleared} | msg='{feedback()}'"))
        pg.screenshot(path=f"out/sim_{page.replace(' ','_')}_{tag}.png")
    A=[("Inventory","products","Add product",{"Product name":"Peak Milk 400g","SKU":"PK-400","Category":"Groceries","Cost price":"2300","Selling price":"2800","Opening stock":"20"},"Add product"),
       ("Customers","customers","Add customer",{"Full name":"Mama Ngozi","Email":"ngozi@mail.ng","Phone number":"08031234567","Address":"12 Allen Ave, Ikeja"},"Add customer"),
       ("Expenses","expenses","Record expense",{"Expense title":"Shop rent","Category":"Rent","Amount":"50000"},"Add expense"),
       ("Branches","branches","Add branch",{"Branch name":"Ikeja Branch","Branch code":"IKJ","Address":"Allen Ave","Phone":"08031234567"},"Add branch"),
       ("Invoices","invoices","New invoice",{"Invoice number":"INV-001","Total amount":"15000"},"Create draft"),
       ("Purchase Orders","suppliers","Add supplier",{"Supplier name":"Sule Wholesale","Phone":"08099887766"},"Add supplier")]
    B=[("Inventory","products","Add product",{"Product name":"Indomie Carton","SKU":"IND-01","Category":"Groceries","Cost price":"6900","Selling price":"7800","Opening stock":"10"},"Add product"),
       ("Customers","customers","Add customer",{"Full name":"Chidi Okafor","Email":"chidi@mail.ng","Phone number":"07055443322","Address":"Lekki"},"Add customer"),
       ("Expenses","expenses","Record expense",{"Expense title":"Generator fuel","Category":"Fuel","Amount":"12000"},"Add expense"),
       ("Branches","branches","Add branch",{"Branch name":"Lekki Branch","Branch code":"LKI","Address":"Lekki","Phone":"08031112222"},"Add branch"),
       ("Invoices","invoices","New invoice",{"Invoice number":"INV-002","Total amount":"20000"},"Create draft"),
       ("Purchase Orders","suppliers","Add supplier",{"Supplier name":"Bola Distributors","Phone":"08077665544"},"Add supplier")]
    C=[("Inventory","products","Add product",{"Product name":"Peak Milk DUPLICATE","SKU":"PK-400","Category":"Groceries","Cost price":"1","Selling price":"2","Opening stock":"1"},"Add product")]
    for rnd,items in (("1st",A),("2nd",B),("dup-SKU",C)):
        for it in items: add(*it[:5], tag=rnd)
    for l in LOG: print(f"{l[0]:<16} {l[1]:<8} {l[2]}")
    print("failures:", failures[:6]); print("errs:", errs[:6])
    b.close()
