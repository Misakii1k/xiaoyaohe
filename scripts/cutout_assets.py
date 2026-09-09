#!/usr/bin/env python3
"""
使用 rembg (U2-Net) 执行专业工作室级 3D 资产透明抠图与居中裁切输出。
完美保留玻璃高光、亚克力通透质感，并彻底清除地面阴影与白色背景。
"""
import sys
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

def process_image(session, input_path: str, output_path: str):
    print(f"[Processing] {Path(input_path).name} ...")
    inp = Image.open(input_path)
    
    # 1. rembg 抠图
    out = remove(inp, session=session, alpha_matting=True, alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10)
    
    # 2. 紧凑透明边缘裁剪并居中放置在 512x512 正方形画布中
    bbox = out.getbbox()
    if bbox:
        cropped = out.crop(bbox)
        max_dim = max(cropped.width, cropped.height)
        padded_dim = int(max_dim * 1.08)
        square = Image.new("RGBA", (padded_dim, padded_dim), (0, 0, 0, 0))
        offset_x = (padded_dim - cropped.width) // 2
        offset_y = (padded_dim - cropped.height) // 2
        square.paste(cropped, (offset_x, offset_y))
        final_img = square.resize((512, 512), Image.Resampling.LANCZOS)
    else:
        final_img = out.resize((512, 512), Image.Resampling.LANCZOS)
        
    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    final_img.save(out_file, "PNG", optimize=True)
    print(f"[Cutout Done] -> {output_path} (512x512 PNG)")

BATCH_MAP = {
    "stat-pillbox.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\stat_pillbox_1788880108261.jpg",
    "stat-notebook.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\stat_notebook_1788880126751.jpg",
    "stat-target.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\stat_target_1788880143441.jpg",
    "purple-bottle.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\purple_bottle_1788880157012.jpg",
    "clock-pill.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\clock_pill_1788880199580.jpg",
    "aid-bag.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\aid_bag_1788880221342.jpg",
    "floating-pill.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\floating_pill_1788880239627.jpg",
    "pillbox-banner.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\pillbox_banner_1788880352731.jpg",
    "user-avatar.png": r"C:\Users\87850\.gemini\antigravity\brain\59b00488-60ae-4703-8654-8e0446552a76\user_avatar_1788880370349.jpg",
}

if __name__ == '__main__':
    session = new_session("u2net")
    if len(sys.argv) == 3:
        process_image(session, sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == '--all':
        target_dir = Path("src/assets/images3d")
        for filename, src in BATCH_MAP.items():
            dst = target_dir / filename
            process_image(session, src, dst)
    else:
        print("Usage: cutout_assets.py <input> <output> | --all")
