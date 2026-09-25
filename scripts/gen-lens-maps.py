# 生成液态玻璃「凸透镜位移图」：供 index.html 里的 SVG feDisplacementMap 引用。
# R 通道 = X 方向位移，G 通道 = Y 方向位移，128 为不位移。
# 中心 core 半径内保持中性灰（内容清晰），越靠边缘越把背景向内弯折，模拟真实透镜边缘折射。
#
# 用法：py scripts/gen-lens-maps.py   → 输出 public/icons/lens-full.png / lens-edge.png
import math
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'


def make_map(core: float, size: int = 256) -> Image.Image:
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            u = (x + 0.5) / size * 2 - 1
            v = (y + 0.5) / size * 2 - 1
            r = math.hypot(u, v)
            if r <= core or r == 0:
                f = 0.0
            else:
                t = min(1.0, (r - core) / (1 - core))
                f = t * t * (3 - 2 * t)  # smoothstep
                f *= f  # 透镜曲率：越靠边越急
            dx = -(u / max(r, 1e-6)) * f
            dy = -(v / max(r, 1e-6)) * f
            px[x, y] = (int(round(128 + dx * 127)), int(round(128 + dy * 127)), 128)
    return img


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    make_map(0.55).save(OUT / 'lens-full.png', optimize=True)
    make_map(0.84).save(OUT / 'lens-edge.png', optimize=True)
    print('lens maps written to', OUT)
