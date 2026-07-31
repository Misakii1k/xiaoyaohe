// @vitest-environment happy-dom
//
// 防回归：药盒照片解码缩边时若把 resizeWidth 和 resizeHeight 同时钉死成 MAX_EDGE，
// 每一张非正方形照片都会被拉伸成正方形。规范规定只给一个维度时，另一个会按原图
// 宽高比自动推导——这正是保持比例的唯一正确写法。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressBoxPhoto } from '../src/features/medPhotos';

function fakeBitmap(width: number, height: number): ImageBitmap {
  return { width, height, close() {} } as unknown as ImageBitmap;
}

describe('药盒照片压缩', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('解码缩边时只钉住一个维度，另一维按原图比例推导', async () => {
    const optionsSeen: (ImageBitmapOptions | undefined)[] = [];
    vi.stubGlobal('createImageBitmap', async (_blob: Blob, options?: ImageBitmapOptions) => {
      optionsSeen.push(options);
      return fakeBitmap(1440, 1080);
    });

    // 体积超过 TARGET_BYTES，跳过「小图直接放行」的快速路径，进入真正的解码缩放
    const oversized = new Blob([new Uint8Array(400_000)], { type: 'image/jpeg' });
    await compressBoxPhoto(oversized);

    const resizing = optionsSeen.filter(
      (o) => o != null && (o.resizeWidth != null || o.resizeHeight != null),
    );
    expect(resizing.length).toBeGreaterThan(0);
    for (const options of resizing) {
      const pinsBothAxes = options!.resizeWidth != null && options!.resizeHeight != null;
      expect(pinsBothAxes).toBe(false);
    }
  });

  it('判断原图是否已经够小时，按原始尺寸解码而非缩放后的尺寸', async () => {
    const optionsSeen: (ImageBitmapOptions | undefined)[] = [];
    vi.stubGlobal('createImageBitmap', async (_blob: Blob, options?: ImageBitmapOptions) => {
      optionsSeen.push(options);
      return fakeBitmap(400, 300);
    });

    // 小体积 JPEG 会走快速路径：必须拿原始尺寸判断，否则宽度恒等于 MAX_EDGE，判断失去意义
    const small = new Blob([new Uint8Array(1_000)], { type: 'image/jpeg' });
    const result = await compressBoxPhoto(small);

    expect(optionsSeen[0]).toBeUndefined();
    // 长边 400 < 720，原图已经够小，应原样返回
    expect(result).toBe(small);
  });
});
