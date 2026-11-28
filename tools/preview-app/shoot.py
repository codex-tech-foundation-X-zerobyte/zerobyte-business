import sys, json
from playwright.sync_api import sync_playwright
CHROME='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
base='http://127.0.0.1:5188/'
# usage: shoot.py tag route width height theme [full] [scrollY]
tag, route, w, h, theme = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
import os
extra = os.environ.get('Q', '')
scheme = os.environ.get('SCHEME', 'light')
full = len(sys.argv) > 6 and sys.argv[6] == 'full'
scroll = int(sys.argv[7]) if len(sys.argv) > 7 else 0
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    ctx = b.new_context(color_scheme=scheme, viewport={'width': w, 'height': h}, device_scale_factor=1.5 if w < 500 else 1, is_mobile=w < 500, has_touch=w < 500)
    if theme != 'none':
        ctx.add_init_script(f"localStorage.setItem('zerobyte.theme','{theme}'); localStorage.setItem('zerobyte.onboarding.dismissed','1');")
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(base + '?r=' + route + ('&' + extra if extra else ''))
    pg.wait_for_timeout(1800)
    if scroll: pg.evaluate(f"(document.querySelector('.content-scroll, .app-content, main')||window).scrollTo?.(0,{scroll}); window.scrollTo(0,{scroll})")
    pg.wait_for_timeout(300)
    out = f'/home/claude/shots/{tag}.png'
    pg.screenshot(path=out, full_page=full)
    print(out, 'errors:', errs[:5])
    b.close()
