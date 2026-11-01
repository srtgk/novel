import zlib
import struct
import os

def create_png(width, height, r, g, b, filename):
    """標準モジュールのみで単色/グラデーション風の有効なPNG画像を生成"""
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)  # Filter type None
        # 上から下へグラデーション
        factor = 0.8 + 0.4 * (y / height)
        curr_r = min(255, int(r * factor))
        curr_g = min(255, int(g * factor))
        curr_b = min(255, int(b * factor))
        for x in range(width):
            raw_data.extend((curr_r, curr_g, curr_b, 255))

    def make_chunk(chunk_type, data):
        length = len(data)
        crc = zlib.crc32(chunk_type + data) & 0xffffffff
        return struct.pack('>I', length) + chunk_type + data + struct.pack('>I', crc)

    png_bytes = bytearray(b'\x89PNG\r\n\x1a\n')
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png_bytes.extend(make_chunk(b'IHDR', ihdr_data))
    # IDAT
    compressed = zlib.compress(bytes(raw_data))
    png_bytes.extend(make_chunk(b'IDAT', compressed))
    # IEND
    png_bytes.extend(make_chunk(b'IEND', b''))

    with open(filename, 'wb') as f:
        f.write(png_bytes)
    print(f"Generated {filename}")

if __name__ == '__main__':
    icons_dir = os.path.join(os.path.dirname(__file__), 'icons')
    create_png(192, 192, 43, 112, 224, os.path.join(icons_dir, 'icon-192.png'))
    create_png(512, 512, 43, 112, 224, os.path.join(icons_dir, 'icon-512.png'))
