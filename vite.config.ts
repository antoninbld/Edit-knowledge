import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function cleanImageName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'image';
}

function parseMultipartImage(body: Buffer, contentType = '') {
  const boundary = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i)?.[1] ?? contentType.match(/boundary=([^;]+)/i)?.[1];
  if (!boundary) throw new Error('Requête image invalide : boundary multipart absent.');

  const boundaryText = `--${boundary}`;
  const bodyBinary = body.toString('binary');
  const part = bodyBinary.split(boundaryText).find((chunk) => chunk.includes('name="image"'));
  if (!part) throw new Error('Aucun champ image trouvé dans la requête.');

  const headerEnd = part.indexOf('\r\n\r\n');
  if (headerEnd < 0) throw new Error('Partie multipart image invalide.');

  const rawHeaders = part.slice(0, headerEnd);
  const fileName = rawHeaders.match(/filename="([^"]*)"/i)?.[1] ?? 'image';
  const mimeType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() ?? '';
  const contentStart = headerEnd + 4;
  let contentEnd = part.lastIndexOf('\r\n');
  if (contentEnd < contentStart) contentEnd = part.length;

  return {
    fileName,
    mimeType,
    buffer: Buffer.from(part.slice(contentStart, contentEnd), 'binary'),
  };
}

function handleImageUpload(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) {
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Allow', 'POST');
    response.end('Method not allowed');
    return;
  }

  const chunks: Buffer[] = [];
  request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  request.on('error', (error) => {
    response.statusCode = 500;
    response.end(error.message);
  });
  request.on('end', async () => {
    try {
      const image = parseMultipartImage(Buffer.concat(chunks), request.headers['content-type']);
      const extension = IMAGE_MIME_TO_EXTENSION[image.mimeType] ?? path.extname(image.fileName).replace('.', '').toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
        response.statusCode = 415;
        response.end('Format image non supporté.');
        return;
      }

      // Sauvegarde physique : les images insérées sont écrites dans public/images,
      // ce qui les rend servies par Vite sous le chemin relatif court images/<fichier>.
      const imagesDirectory = path.resolve(__dirname, 'public/images');
      await mkdir(imagesDirectory, { recursive: true });
      const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension;
      const fileName = `${cleanImageName(image.fileName)}-${Date.now().toString(36)}.${normalizedExtension}`;
      await writeFile(path.join(imagesDirectory, fileName), image.buffer);

      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ src: `images/${fileName}` }));
    } catch (error) {
      response.statusCode = 400;
      response.end(error instanceof Error ? error.message : 'Sauvegarde image impossible.');
    }
  });
}

function localImageStoragePlugin(): Plugin {
  return {
    name: 'edit-knowledge-local-image-storage',
    configureServer(server) {
      server.middlewares.use('/api/images', handleImageUpload);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/images', handleImageUpload);
    },
  };
}

export default defineConfig({
  base: '/Edit-knowledge/',
  plugins: [react(), localImageStoragePlugin()],
});
