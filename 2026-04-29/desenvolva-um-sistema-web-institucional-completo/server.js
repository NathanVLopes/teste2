import { createServer } from 'node:http';
import { config } from './src/config.js';
import './src/db.js';
import { handleAdminApi } from './src/routes-admin.js';
import { handleFiscalApi } from './src/routes-fiscal.js';
import { notFound, serveStatic } from './src/http-utils.js';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/admin')) {
    await handleAdminApi(req, res, url);
    return;
  }

  if (url.pathname.startsWith('/api/fiscal')) {
    await handleFiscalApi(req, res, url);
    return;
  }

  if (serveStatic(req, res)) {
    return;
  }

  notFound(res);
});

server.listen(config.port, () => {
  console.log(`NAVETRAN online em http://localhost:${config.port}`);
  console.log(`Administrativo: http://localhost:${config.port}/admin/`);
  console.log(`Fiscalizacao:  http://localhost:${config.port}/fiscal/`);
});
