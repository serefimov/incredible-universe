// SPDX-License-Identifier: GPL-3.0-or-later
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = await realpath(process.cwd());
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405); response.end(); return;
    }
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const parts = path.split('/').filter(Boolean);
    if (parts.some(part => part.startsWith('.') || part === 'node_modules')) throw new Error('Private path');
    const file = await realpath(resolve(root, `.${path.endsWith('/') ? path + 'index.html' : path}`));
    if (!file.startsWith(root + sep)) throw new Error('Outside root');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Файл не найден');
  }
}).listen(port, host, () => console.log(`The Incredible Universe: http://${host}:${port}/`));
