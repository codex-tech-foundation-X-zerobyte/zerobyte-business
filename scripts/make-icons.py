"""Builds every logo and icon file from the brand source image (assets/brand/zerobyte-logo-source.png).
Run:  python3 scripts/make-icons.py      (needs Pillow and numpy)
The source is the logo on a black background; the background is removed (made transparent) first."""
import base64, io, struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = 'assets/brand/zerobyte-logo-source.png'
OUT = 'public'
BG = (5, 10, 7)  # the near-black of the logo, used behind the icons

img = Image.open(SRC).convert('RGB')
a = np.asarray(img).astype(np.float32)
m = a.max(axis=2)
alpha = np.clip((m - 16.0) / 54.0, 0, 1)  # black (and its faint noise) becomes see-through
safe = np.maximum(alpha, 1e-3)[..., None]
rgb = np.clip(a / safe, 0, 255)  # un-premultiply so edges keep their true colour
rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
full = Image.fromarray(rgba, 'RGBA')

def tight(region):
    box = Image.fromarray((np.asarray(region)[..., 3] > 8).astype(np.uint8) * 255).getbbox()
    return region.crop(box)

H = full.height
mark = tight(full.crop((0, 0, full.width, int(H * 0.56))))       # the Z-B symbol (with its pixel squares)
lockup = tight(full.crop((0, 0, full.width, int(H * 0.77))))     # symbol + ZERØBYTE wordmark
print('mark', mark.size, 'lockup', lockup.size)

def fit(im, max_w, max_h):
    s = min(max_w / im.width, max_h / im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)

def on_square(size, mark_width_fraction, background=BG, radius=0):
    canvas = Image.new('RGBA', (size, size), background + (255,) if background else (0, 0, 0, 0))
    m_ = fit(mark, size * mark_width_fraction, size * 0.8)
    canvas.alpha_composite(m_, ((size - m_.width) // 2, (size - m_.height) // 2))
    if radius:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
        canvas.putalpha(mask)
    return canvas

# transparent logo files for the interface and the landing page
fit(mark, 320, 320).save(f'{OUT}/logo-mark.png', optimize=True)
fit(lockup, 800, 800).save(f'{OUT}/logo-full.png', optimize=True)

# app icons: dark square, mark fills ~74% (PWA "any"), ~58% inside the safe zone (maskable)
on_square(512, 0.74).convert('RGB').save(f'{OUT}/icon-512.png', optimize=True)
on_square(192, 0.74).convert('RGB').save(f'{OUT}/icon-192.png', optimize=True)
on_square(512, 0.58).convert('RGB').save(f'{OUT}/icon-maskable-512.png', optimize=True)
on_square(180, 0.78).convert('RGB').save(f'{OUT}/apple-touch-icon.png', optimize=True)

# favicons: rounded dark square so the mark stays readable on light and dark browser tabs
fav = {s: on_square(s * 4, 0.9, radius=s * 4 // 5).resize((s, s), Image.LANCZOS) for s in (16, 32, 48)}
fav[32].save(f'{OUT}/favicon-32.png', optimize=True)
fav[16].save(f'{OUT}/favicon-16.png', optimize=True)
ico = io.BytesIO()
fav[48].save(ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[fav[16], fav[32]])
open(f'{OUT}/favicon.ico', 'wb').write(ico.getvalue())
# an SVG favicon (modern browsers pick it first): the same picture, embedded
buf = io.BytesIO(); on_square(128, 0.9, radius=26).save(buf, format='PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
open(f'{OUT}/favicon.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 128 128" width="128" height="128"><image width="128" height="128" xlink:href="data:image/png;base64,{b64}"/></svg>\n')

# social preview (1200x630): the full logo on the dark brand background with a soft green glow
W, Hh = 1200, 630
bg = Image.new('RGB', (W, Hh), BG)
glow = Image.new('RGB', (W, Hh), (0, 0, 0))
ImageDraw.Draw(glow).ellipse((W * 0.18, Hh * -0.25, W * 0.82, Hh * 0.75), fill=(14, 90, 52))
bg = Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(150)), 0.55).convert('RGBA')
logo = fit(lockup, 640, 330)
bg.alpha_composite(logo, ((W - logo.width) // 2, 118))
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34)
except OSError:
    font = ImageFont.load_default()
text = 'Sales, stock and customers in naira'
d = ImageDraw.Draw(bg)
tw = d.textlength(text, font=font)
d.text(((W - tw) / 2, 500), text, font=font, fill=(214, 232, 221))
bg.convert('RGB').save(f'{OUT}/og-image.png', optimize=True)
print('icons written')
