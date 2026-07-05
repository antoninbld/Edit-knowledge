const LOCAL_IMAGE_DB_NAME = 'edit-knowledge-images';
const LOCAL_IMAGE_STORE_NAME = 'images';

const localImagePreviewUrls = new Map<string, string>();

function openLocalImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LOCAL_IMAGE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Ouverture du stockage image local impossible.'));
  });
}

export function rememberLocalImagePreview(outputSrc: string, previewSrc: string): void {
  localImagePreviewUrls.set(outputSrc, previewSrc);
}

export async function storeLocalImage(outputSrc: string, file: File): Promise<void> {
  const database = await openLocalImageDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_IMAGE_STORE_NAME, 'readwrite');
    transaction.objectStore(LOCAL_IMAGE_STORE_NAME).put(file, outputSrc);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Enregistrement local de l’image impossible.'));
  });
  database.close();
}

export async function getLocalImagePreviewSrc(outputSrc: string): Promise<string | null> {
  const existingPreviewSrc = localImagePreviewUrls.get(outputSrc);
  if (existingPreviewSrc) return existingPreviewSrc;

  const database = await openLocalImageDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_IMAGE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(LOCAL_IMAGE_STORE_NAME).get(outputSrc);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('Lecture locale de l’image impossible.'));
  });
  database.close();
  if (!blob) return null;

  const previewSrc = URL.createObjectURL(blob);
  localImagePreviewUrls.set(outputSrc, previewSrc);
  return previewSrc;
}
