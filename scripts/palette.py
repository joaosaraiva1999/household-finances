"""OKLCH -> sRGB hex converter for the natural palette design."""

def oklch_to_srgb(L, C, H):
    import math
    h = math.radians(H)
    a = C * math.cos(h)
    b = C * math.sin(h)
    # OKLab -> linear sRGB (Björn Ottosson)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def gamma(u):
        if u <= 0.0031308:
            return 12.92 * u
        return 1.055 * (u ** (1 / 2.4)) - 0.055
    rgb = [gamma(r), gamma(g), gamma(bb)]
    out = []
    for u in rgb:
        u = min(1.0, max(0.0, u))
        out.append(round(u * 255))
    return "#{:02x}{:02x}{:02x}".format(*out)

def scale(name, stops):
    print(f"-- {name} --")
    shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
    for shade, (L, C, H) in zip(shades, stops):
        print(f"{shade}: {oklch_to_srgb(L, C, H)}  (oklch({L} {C} {H}))")

# sage — muted natural green (hue 150)
sage = [
    (0.965, 0.010, 150), (0.935, 0.020, 150), (0.875, 0.038, 150),
    (0.795, 0.052, 150), (0.705, 0.060, 150), (0.615, 0.065, 150),
    (0.535, 0.065, 150), (0.450, 0.058, 150), (0.370, 0.048, 150),
    (0.300, 0.038, 150), (0.205, 0.026, 150),
]
# clay — soft terracotta (hue 35)
clay = [
    (0.965, 0.008, 35), (0.930, 0.018, 35), (0.865, 0.038, 35),
    (0.785, 0.062, 35), (0.700, 0.088, 35), (0.615, 0.105, 35),
    (0.535, 0.098, 35), (0.450, 0.082, 35), (0.370, 0.066, 35),
    (0.300, 0.052, 35), (0.205, 0.035, 35),
]
# ochre — warm sand (hue 78)
ochre = [
    (0.970, 0.010, 78), (0.940, 0.024, 78), (0.885, 0.048, 78),
    (0.810, 0.075, 78), (0.735, 0.098, 78), (0.665, 0.112, 78),
    (0.575, 0.100, 78), (0.475, 0.083, 78), (0.385, 0.065, 78),
    (0.310, 0.050, 78), (0.215, 0.034, 78),
]

scale("sage", sage)
scale("clay", clay)
scale("ochre", ochre)

print("\n-- neutrals & extras --")
print("bg light   oklch(0.973 0.004 90):", oklch_to_srgb(0.973, 0.004, 90))
print("bg dark    oklch(0.185 0.006 90):", oklch_to_srgb(0.185, 0.006, 90))
print("moss       oklch(0.58 0.060 115):", oklch_to_srgb(0.58, 0.060, 115))
print("sand       oklch(0.500 0.045 95):", oklch_to_srgb(0.500, 0.045, 95))
print("taupe      oklch(0.580 0.018 80):", oklch_to_srgb(0.580, 0.018, 80))
print("forest     oklch(0.420 0.050 155):", oklch_to_srgb(0.420, 0.050, 155))
print("warmgray   oklch(0.650 0.010 80):", oklch_to_srgb(0.650, 0.010, 80))
print("darkbg2    oklch(0.230 0.007 90):", oklch_to_srgb(0.230, 0.007, 90))
print("sage-700dk oklch(0.620 0.070 150):", oklch_to_srgb(0.620, 0.070, 150))
print("sage-dark-primary oklch(0.750 0.060 148):", oklch_to_srgb(0.750, 0.060, 148))
