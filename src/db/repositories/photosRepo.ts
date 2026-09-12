import { openMedboxDatabase as db } from '../connection';
import { notifyDataChanged } from '../databaseEvents';
import type { PhotoBlob } from '../schema';

/** 药盒原图（仅本地） */
export async function putPhoto(photo: PhotoBlob): Promise<void> {
  await (await db()).put('photos', photo);
  notifyDataChanged('photos');
}

export async function getPhotosByMed(medId: string): Promise<PhotoBlob[]> {
  return (await db()).getAllFromIndex('photos', 'byMed', medId);
}

/** 删除某药的全部本地药盒照片（换图/覆盖时调用，避免历史大图占满磁盘和内存） */
export async function deletePhotosByMed(medId: string): Promise<void> {
  const d = await db();
  const photos = await d.getAllFromIndex('photos', 'byMed', medId);
  if (photos.length === 0) return;
  const tx = d.transaction('photos', 'readwrite');
  await Promise.all(photos.map((photo) => tx.store.delete(photo.id)));
  await tx.done;
  notifyDataChanged('photos');
}

/** 取全部药盒照片（局域网同步可选传输用） */
export async function listAllPhotos(): Promise<PhotoBlob[]> {
  return (await db()).getAll('photos');
}
