import cv2
import numpy as np
from PIL import Image
from pathlib import Path

SHEET_PATH = r"C:\Users\87850\.gemini\antigravity\brain\50e2149f-e684-4a36-b1d8-06ad794265fa\family_avatars_3d_sheet_1788333148036.jpg"
OUT_DIR = Path(r"d:\Desktop_Archive\日常工具箱手机端网页端\medbox\src\ui\assets\avatars")
OUT_DIR.mkdir(parents=True, exist_ok=True)

AVATAR_NAMES = [
    "avatar_01_grandma",
    "avatar_02_grandpa",
    "avatar_03_doctor_male",
    "avatar_04_doctor_female",
    "avatar_05_father",
    "avatar_06_mother",
    "avatar_07_boy",
    "avatar_08_girl",
    "avatar_09_teen",
    "avatar_10_lady",
    "avatar_11_uncle",
    "avatar_12_caregiver",
    "avatar_13_toddler",
    "avatar_14_dog",
    "avatar_15_cat",
    "avatar_16_robot",
]

# 对应 16 款角色的专属柔和氛围底色
BG_COLORS = [
    (238, 242, 255), # grandma: soft indigo
    (240, 253, 244), # grandpa: soft green
    (236, 254, 255), # doctor_male: soft cyan
    (253, 242, 248), # doctor_female: soft pink
    (239, 246, 255), # father: soft blue
    (255, 247, 237), # mother: soft warm orange
    (254, 252, 232), # boy: soft amber
    (250, 245, 255), # girl: soft purple
    (241, 245, 249), # teen: soft slate
    (253, 244, 255), # lady: soft fuchsia
    (254, 243, 199), # uncle: soft amber
    (236, 253, 245), # caregiver: soft emerald
    (254, 249, 195), # toddler: soft yellow
    (254, 243, 199), # dog: warm yellow
    (250, 232, 255), # cat: warm lavender
    (224, 231, 255), # robot: tech indigo
]

from scipy import ndimage

def clean_alpha(alpha):
    mask = alpha > 30
    if not mask.any():
        return alpha
    labels, n = ndimage.label(mask)
    if n <= 1:
        return alpha
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    h, w = mask.shape
    cx, cy = w / 2.0, h / 2.0
    coms = ndimage.center_of_mass(mask, labels, range(1, n + 1))
    
    cand = [l for l in range(1, n + 1)
            if abs(coms[l - 1][1] - cx) < 0.36 * w and abs(coms[l - 1][0] - cy) < 0.36 * h]
    if not cand:
        cand = [int(np.argmax(sizes))]
    main = max(cand, key=lambda l: sizes[l])
    slices = ndimage.find_objects(labels)
    mb = slices[main - 1]
    link = 0.08 * max(h, w)
    min_area = 0.01 * sizes[main]
    keep = {main}
    for l in range(1, n + 1):
        if l == main:
            continue
        b = slices[l - 1]
        # 如果组件贴到上边界而主体顶部还有空隙，说明是上格溢出
        if b[0].start == 0 and mb[0].start > 10:
            continue
        # 如果组件贴到下边界而主体底部还有空隙，说明是下格溢出
        if b[0].stop == h and mb[0].stop < h - 10:
            continue
        # 如果组件贴到左右边界而主体左右还有空隙，说明是左右格溢出
        if b[1].start == 0 and mb[1].start > 10:
            continue
        if b[1].stop == w and mb[1].stop < w - 10:
            continue
            
        dy = max(0, b[0].start - mb[0].stop, mb[0].start - b[0].stop)
        dx = max(0, b[1].start - mb[1].stop, mb[1].start - b[1].stop)
        if dy <= 6 and dx <= 6 and sizes[l] >= min_area:
            keep.add(l)
    out = alpha.copy()
    out[~np.isin(labels, list(keep))] = 0
    return out

def slice_and_process():
    sheet = Image.open(SHEET_PATH).convert("RGB")
    W, H = sheet.size
    cell_w, cell_h = W // 4, H // 4

    print(f"Sheet size: {W}x{H}, Cell size: {cell_w}x{cell_h}")

    idx = 0
    for r in range(4):
        for c in range(4):
            name = AVATAR_NAMES[idx]
            idx += 1

            # 切出当前格
            x0 = c * cell_w
            y0 = r * cell_h
            x1 = x0 + cell_w
            y1 = y0 + cell_h

            crop = sheet.crop((x0, y0, x1, y1))
            np_crop = np.array(crop)

            h, w, _ = np_crop.shape
            gray_diff = np.max(np.abs(np_crop.astype(float) - np.array([125.0, 125.0, 124.0])), axis=2)

            # 平滑边缘过渡（8 到 16 之间线性渐变抗锯齿）
            alpha_f = np.clip((gray_diff - 8.0) / (16.0 - 8.0), 0.0, 1.0)
            alpha_uint8 = (alpha_f * 255.0).astype(np.uint8)
            
            # 清除相邻格漂进来的多余像素碎片
            alpha_cleaned = clean_alpha(alpha_uint8)
            alpha_clean = cv2.GaussianBlur(alpha_cleaned, (3, 3), 0.4)

            # 透明 PNG
            transparent_rgba = np.dstack((np_crop, alpha_clean))

            # 保存透明抠图版
            trans_path = OUT_DIR / f"{name}.png"
            Image.fromarray(transparent_rgba).save(trans_path, "PNG")

            print(f"Saved: {trans_path.name}")

if __name__ == "__main__":
    slice_and_process()
