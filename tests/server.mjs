import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('./fixtures', import.meta.url)));
export function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(root, `.${pathname === '/' ? '/playground.html' : pathname}`);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      const body = await fs.readFile(file);
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await startServer();
  console.log('Selector playground: http://127.0.0.1:4173');
  process.on('SIGTERM', () => { server.closeAllConnections(); server.close(); });
}
