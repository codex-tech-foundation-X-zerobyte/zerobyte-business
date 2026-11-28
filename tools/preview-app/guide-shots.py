# Regenerates public/guide/*.png from the live app screens (light mode, 1320x820) using the preview mock.
import sys
from playwright.sync_api import sync_playwright
CHROME = '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
OUT = sys.argv[1]
SHOTS = [
    ('01-overview', '/app/overview', None),
    ('02-sales', '/app/sales', None),
    ('03-inventory', '/app/inventory', None),
    ('04-customers', '/app/customers', None),
    ('05-receipts', '/app/receipts', None),
    ('06-expenses', '/app/expenses', None),
    ('07-reports', '/app/reports', None),
    ('08-settings-business', '/app/settings/business', None),
    ('09-settings-billing', '/app/settings/billing', None),
    ('10-notifications', '/app/overview', 'bell'),
    ('11-records', '/app/records', None),
    ('12-import', '/app/inventory', 'import'),
]
HIDE = '.support-launcher,.notice-banner{display:none!important}'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    ctx = b.new_context(color_scheme='light', viewport={'width': 1320, 'height': 820})
    ctx.add_init_script("localStorage.setItem('zerobyte.theme','light'); localStorage.setItem('zerobyte.onboarding.dismissed','1');")
    for name, route, action in SHOTS:
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:5188/?r=' + route)
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(1500)
        if action == 'bell':
            pg.get_by_role('button', name='Notifications', exact=False).first.click()
            pg.wait_for_timeout(500)
        if action == 'import':
            pg.get_by_role('button', name='Import from CSV').first.click()
            pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}.png')
        print(name, errs[:2])
        pg.close()
    b.close()
