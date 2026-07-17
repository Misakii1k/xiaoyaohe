import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  putPhoto: vi.fn(async () => undefined),
  deletePhotosByMed: vi.fn(async () => undefined),
  getPhotosByMed: vi.fn(async () => [] as Array<{ id: string; medId: string; blob: Blob; at: number }>),
  uid: vi.fn(() => 'photo-id'),
  listMeds: vi.fn(async () => [] as Array<{ id: string }>),
}));

vi.mock('../src/db/local', () => ({
  putPhoto: mocks.putPhoto,
  deletePhotosByMed: mocks.deletePhotosByMed,
  getPhotosByMed: mocks.getPhotosByMed,
  uid: mocks.uid,
  listMeds: mocks.listMeds,
}));

import { compressBoxPhoto, prepareBoxPhoto, saveMedPhoto } from '../src/features/medPhotos';

function fakeJpeg(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

describe('medPhotos compression + save', () => {
  beforeEach(() => {
    mocks.putPhoto.mockClear();
    mocks.deletePhotosByMed.mockClear();
    mocks.getPhotosByMed.mockClear();
    mocks.uid.mockClear();
    mocks.listMeds.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips re-encoding small jpeg already within size/edge budget', async () => {
    const small = fakeJpeg(120_000);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 640,
      height: 480,
      close: vi.fn(),
    })));

    const out = await compressBoxPhoto(small);
    expect(out).toBe(small);
    expect(createImageBitmap).toHaveBeenCalled();
  });

  it('downscales large photos through canvas and picks a smaller jpeg', async () => {
    const huge = fakeJpeg(4_000_000);
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 4000,
      height: 3000,
      close,
    })));

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: (cb: (blob: Blob | null) => void, _type?: string, quality?: number) => {
        const bytes = quality != null && quality <= 0.48 ? 150_000 : 400_000;
        cb(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
      },
    };
    vi.stubGlobal('document', {
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return canvas;
        throw new Error(`unexpected element ${tag}`);
      }),
    });

    const out = await compressBoxPhoto(huge);
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBeLessThanOrEqual(220_000);
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(540);
    expect(close).toHaveBeenCalled();
  });

  it('saveMedPhoto deletes old photos before writing the compressed blob', async () => {
    const source = fakeJpeg(80_000);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 320,
      height: 240,
      close: vi.fn(),
    })));

    await saveMedPhoto('med-1', source);

    expect(mocks.deletePhotosByMed).toHaveBeenCalledWith('med-1');
    expect(mocks.putPhoto).toHaveBeenCalledTimes(1);
    const saved = mocks.putPhoto.mock.calls[0][0];
    expect(saved.medId).toBe('med-1');
    expect(saved.id).toBe('photo-id');
    expect(saved.blob).toBeInstanceOf(Blob);
  });

  it('prepareBoxPhoto is an alias of compressBoxPhoto for call sites', async () => {
    const small = fakeJpeg(50_000);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 200,
      height: 200,
      close: vi.fn(),
    })));
    await expect(prepareBoxPhoto(small)).resolves.toBe(small);
  });
});
