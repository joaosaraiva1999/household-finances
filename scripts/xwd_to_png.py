#!/usr/bin/env python3
"""Convert an XWD screenshot dump to PNG (for headless UI verification)."""
import struct
import sys

from PIL import Image


def xwd_to_png(src: str, dst: str) -> None:
    data = open(src, "rb").read()
    (header_size, version, pixmap_format, depth, width, height, xoffset,
     byte_order, bitmap_unit, bitmap_bit_order, bitmap_pad, bits_per_pixel,
     bytes_per_line, visual_class, red_mask, green_mask, blue_mask,
     bits_per_rgb, colormap_entries, ncolors, window_width, window_height,
     window_x, window_y, border) = struct.unpack(">25I", data[:100])
    print(f"xwd: {width}x{height} depth={depth} bpp={bits_per_pixel} format={pixmap_format} ncolors={ncolors}")

    offset = header_size + ncolors * 12
    pixels = data[offset:]

    if bits_per_pixel == 32:
        img = Image.new("RGB", (width, height))
        px = img.load()
        row_len = bytes_per_line
        for y in range(height):
            row = pixels[y * row_len:(y + 1) * row_len]
            for x in range(width):
                b0, b1, b2, _ = row[x * 4:x * 4 + 4]
                if byte_order == 0:  # LSBFirst: BGRA
                    px[x, y] = (b2, b1, b0)
                else:  # MSBFirst: ARGB
                    px[x, y] = (b1, b2, b0)
        img.save(dst)
        print(f"saved {dst}")
    elif bits_per_pixel == 24:
        img = Image.new("RGB", (width, height))
        px = img.load()
        row_len = bytes_per_line
        for y in range(height):
            row = pixels[y * row_len:(y + 1) * row_len]
            for x in range(width):
                b0, b1, b2 = row[x * 3:x * 3 + 3]
                if byte_order == 0:  # LSBFirst: B,G,R
                    px[x, y] = (b2, b1, b0)
                else:  # MSBFirst: R,G,B
                    px[x, y] = (b0, b1, b2)
        img.save(dst)
        print(f"saved {dst}")
    else:
        raise SystemExit(f"unsupported bpp {bits_per_pixel}")


if __name__ == "__main__":
    xwd_to_png(sys.argv[1], sys.argv[2])
