import { extname, join, normalize } from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { config } from './config.js';

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        if (index < 0) {
          return [item, ''];
        }
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

export function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

export function sendError(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

export function methodNotAllowed(res) {
  sendError(res, 405, 'Metodo nao permitido.');
}

export function notFound(res) {
  sendError(res, 404, 'Recurso nao encontrado.');
}

export function getIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

export async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12 * 1024 * 1024) {
      throw new Error('Payload muito grande.');
    }
  }

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

export function setSessionCookie(res, name, token, expires) {
  const cookie = `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(
    expires
  ).toUTCString()}`;
  res.setHeader('set-cookie', cookie);
}

export function clearSessionCookie(res, name) {
  res.setHeader('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

export function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/') {
    res.writeHead(302, { location: '/admin/' });
    res.end();
    return true;
  }

  if (pathname === '/admin') {
    res.writeHead(302, { location: '/admin/' });
    res.end();
    return true;
  }

  if (pathname === '/fiscal') {
    res.writeHead(302, { location: '/fiscal/' });
    res.end();
    return true;
  }

  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(config.publicDir, normalized);

  if (!filePath.startsWith(config.publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  const extension = extname(filePath);
  res.writeHead(200, {
    'content-type': mimeTypes[extension] || 'application/octet-stream',
    'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600'
  });
  createReadStream(filePath).pipe(res);
  return true;
}
