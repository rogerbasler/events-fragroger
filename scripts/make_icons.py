"""Erzeugt Favicons, App-Icons und das Social-Media-Bild für events.fragroger.ai.
Aufruf: python3 scripts/make_icons.py  (braucht Pillow und die Schrift Inter)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "assets"
BLACK, WHITE, BLUE, PINK, NAVY = "#000000", "#ffffff", "#4a7fa1", "#ff1490", "#0d1b3a"
S = 1024  # Arbeitsgrösse, wird herunterskaliert


def icon(size, maskable=False):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, S, S], fill=BLACK)
        pad = 0.22
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BLACK)
        pad = 0.18
    x0, y0, x1, y1 = S * pad, S * (pad + 0.06), S * (1 - pad), S * (1 - pad + 0.02)
    w = int(S * 0.06)
    d.rounded_rectangle([x0, y0, x1, y1], radius=int(S * 0.08), outline=WHITE, width=w)
    band = y0 + (y1 - y0) * 0.30
    d.rectangle([x0 + w / 2, band - w / 2, x1 - w / 2, band + w / 2], fill=BLUE)
    for fx in (0.32, 0.68):
        cx = x0 + (x1 - x0) * fx
        d.rounded_rectangle([cx - w / 2, y0 - S * 0.07, cx + w / 2, y0 + S * 0.07], radius=w // 2, fill=WHITE)
    # drei Termin-Punkte, einer pink
    gy = band + (y1 - band) * 0.48
    for i, fx in enumerate((0.30, 0.5, 0.70)):
        cx = x0 + (x1 - x0) * fx
        r = S * 0.045
        d.ellipse([cx - r, gy - r, cx + r, gy + r], fill=PINK if i == 2 else WHITE)
    return im.resize((size, size), Image.LANCZOS)


def svg():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#000"/><rect x="13.5" y="16.5" width="37" height="34" rx="5" fill="none" stroke="#fff" stroke-width="3.8"/><path d="M15.5 27h33" stroke="#4a7fa1" stroke-width="3.8"/><path d="M24.5 12v8M39.5 12v8" stroke="#fff" stroke-width="3.8" stroke-linecap="round"/><circle cx="22.5" cy="38.5" r="2.9" fill="#fff"/><circle cx="32" cy="38.5" r="2.9" fill="#fff"/><circle cx="41.5" cy="38.5" r="2.9" fill="#ff1490"/></svg>
"""


def font(weight, size):
    for p in [f"/usr/share/fonts/opentype/inter/Inter-{weight}.otf", f"/usr/share/fonts/truetype/inter/Inter-{weight}.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def og():
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), BLACK)
    glow = Image.new("RGB", (W, H), BLACK)
    gd = ImageDraw.Draw(glow)
    for i in range(60):  # sanfter blauer Schein oben rechts
        r = 700 - i * 10
        c = int(13 + i * 0.9)
        gd.ellipse([W - 300 - r, -250 - r, W - 300 + r, -250 + r], fill=(c // 3, c // 2, c))
    im = Image.blend(im, glow, 0.6)
    d = ImageDraw.Draw(im)
    x = 80
    f_mark, f_sub, f_h, f_url = font("Black", 64), font("Bold", 26), font("ExtraBold", 58), font("SemiBold", 30)
    d.text((x, 80), "#", font=f_mark, fill=PINK)
    hx = x + d.textlength("#", font=f_mark)
    d.text((hx, 80), "frag", font=f_mark, fill=WHITE)
    hx += d.textlength("frag", font=f_mark)
    d.text((hx, 80), "Roger", font=f_mark, fill=BLUE)
    d.text((x, 160), "EVENTS", font=f_sub, fill="#9aa7bd")
    lines = ["Wo Roger Basler de Roca", "als Nächstes über KI spricht"]
    for i, ln in enumerate(lines):
        d.text((x, 262 + i * 74), ln, font=f_h, fill=WHITE)
    d.text((x, 470), "Keynotes, Impulsreferate und Workshops", font=f_url, fill="#bcd4e6")
    d.text((x, 530), "events.fragroger.ai", font=f_url, fill=PINK)
    ic = icon(170)
    im.paste(ic, (W - 250, 70), ic)
    return im


if __name__ == "__main__":
    (A / "favicon.svg").write_text(svg())
    icon(180).save(A / "apple-touch-icon.png")
    icon(192).save(A / "icon-192.png")
    icon(512).save(A / "icon-512.png")
    icon(512, maskable=True).save(A / "icon-maskable-512.png")
    icon(48).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    og().save(A / "og-image.png", optimize=True)
    print("Icons und og-image.png erzeugt")
