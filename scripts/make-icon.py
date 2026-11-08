"""生成应用图标源文件：深空底色 + 三团色晕 + 唱片环。

与界面视觉方向 A 保持一致。产物是一张 1024x1024 PNG，
再交给 `tauri icon` 生成各平台尺寸。
"""

import numpy as np
from PIL import Image, ImageDraw

SS = 2048  # 超采样尺寸，最终下采样到 1024，保证边缘干净
OUT = 1024

yy, xx = np.mgrid[0:SS, 0:SS].astype(np.float32)
canvas = np.zeros((SS, SS, 3), dtype=np.float32)
canvas[:] = np.array([5.0, 5.0, 7.0], dtype=np.float32)


def add_blob(cx, cy, radius, color, strength):
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / radius
    mask = np.clip(1.0 - dist, 0.0, 1.0) ** 2.4 * strength
    for i in range(3):
        canvas[:, :, i] += color[i] * mask


add_blob(SS * 0.30, SS * 0.24, SS * 0.62, (255.0, 61.0, 129.0), 0.62)
add_blob(SS * 0.76, SS * 0.36, SS * 0.56, (124.0, 77.0, 255.0), 0.55)
add_blob(SS * 0.46, SS * 0.88, SS * 0.64, (0.0, 229.0, 255.0), 0.34)

canvas = np.clip(canvas, 0, 255).astype(np.uint8)
img = Image.fromarray(canvas, mode="RGB").convert("RGBA")

draw = ImageDraw.Draw(img)
center = (SS // 2, SS // 2)
ring_outer = int(SS * 0.265)
ring_width = int(SS * 0.038)
draw.ellipse(
    [center[0] - ring_outer, center[1] - ring_outer, center[0] + ring_outer, center[1] + ring_outer],
    outline=(255, 255, 255, 232),
    width=ring_width,
)
dot = int(SS * 0.058)
draw.ellipse([center[0] - dot, center[1] - dot, center[0] + dot, center[1] + dot], fill=(255, 255, 255, 232))

# macOS 圆角方形
mask = Image.new("L", (SS, SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SS - 1, SS - 1], radius=int(SS * 0.225), fill=255)
img.putalpha(mask)

img.resize((OUT, OUT), Image.LANCZOS).save("assets/icon-source.png")
print("wrote assets/icon-source.png")
