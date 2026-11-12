#!/usr/bin/env python3
"""Generate the desktop app icon: sage rounded square + white euro glyph
with soft clay/ochre accents, matching the app's natural earth-tone design."""
from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded-square background: vertical sage gradient
top = (122, 168, 137)     # sage-500-ish
bottom = (69, 105, 84)    # sage-700-ish
grad = Image.new("RGBA", (SIZE, SIZE))
gd = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / SIZE
    r = int(top[0] + (bottom[0] - top[0]) * t)
    g = int(top[1] + (bottom[1] - top[1]) * t)
    b = int(top[2] + (bottom[2] - top[2]) * t)
    gd.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# Apply rounded-corner mask
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
RADIUS = 220
md.rounded_rectangle([0, 0, SIZE, SIZE], radius=RADIUS, fill=255)
img.paste(grad, (0, 0), mask)

# Subtle clay circle accent (top-right)
accent = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ad = ImageDraw.Draw(accent)
ad.ellipse([640, -180, 1180, 360], fill=(191, 138, 58, 60))
img.paste(accent, (0, 0), mask)

# Soft ochre circle accent (bottom-left)
accent2 = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ad2 = ImageDraw.Draw(accent2)
ad2.ellipse([-160, 700, 380, 1240], fill=(220, 188, 138, 55))
img.paste(accent2, (0, 0), mask)

# Euro glyph, white, centered
def find_font(size):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

font = find_font(620)
text = "€"
bbox = d.textbbox((0, 0), text, font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
x = (SIZE - w) / 2 - bbox[0]
y = (SIZE - h) / 2 - bbox[1]
# Soft shadow
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.text((x + 6, y + 10), text, font=font, fill=(30, 50, 38, 90))
img.paste(shadow, (0, 0), mask)
d.text((x, y), text, font=font, fill=(255, 255, 255, 255))

# Thin inner stroke for a finished look
stroke = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
std = ImageDraw.Draw(stroke)
std.rounded_rectangle([10, 10, SIZE - 10, SIZE - 10], radius=RADIUS - 10, outline=(255, 255, 255, 55), width=8)
img.paste(stroke, (0, 0), mask)

img.save("/home/z/my-project/desktop/icon-source.png")
print("icon written: desktop/icon-source.png")
