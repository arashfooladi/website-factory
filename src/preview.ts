import { createServer, request as upstreamRequest, type IncomingHttpHeaders } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function pinPreviewSocket(path: string) {
  // Linux O_PATH pins the socket inode without opening its contents.
  // O_NOFOLLOW also lets us reject a replaced symlink without following it.
  const socket = await open(path, 0x200000 | constants.O_NOFOLLOW);
  try {
    if (!(await socket.stat()).isSocket()) throw new Error('preview_socket_required');
    return socket;
  } catch (error) { await socket.close(); throw error; }
}

const digest = (value: string) => createHash('sha256').update(value).digest();
const hop = new Set(['connection','proxy-connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
export function createPreview(port: number, id: string, token: string, socketPath: string) {
  const host = `127.0.0.1:${port}`;
  const name = 'factory_preview_' + id.replaceAll('-', '');
  const cookieHash = createHash('md5').update(`http://${host}`).digest('hex');
  const allowedCookie = (key: string) => ['wordpress_test_cookie','woocommerce_cart_hash','woocommerce_items_in_cart'].includes(key)
    || [`wordpress_${cookieHash}`, `wordpress_sec_${cookieHash}`, `wordpress_logged_in_${cookieHash}`,
      `wp_woocommerce_session_${cookieHash}`, `wp-postpass_${cookieHash}`].includes(key) || /^wp-settings(-time)?-\d+$/.test(key);
  const server = createServer((req, res) => {
    // Same-origin form submissions need their real Origin for the check below.
    // Suppress referrers to other sites without making local POST origins null.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reject = (status: number, message: string) => { res.writeHead(status); res.end(message); };
    if (req.headers.host !== host || !req.url?.startsWith('/') || req.url.length > 4096) return reject(400, 'Invalid preview request');
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return reject(403, 'Origin denied');
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/__factory_auth') {
      if (req.method !== 'GET' || !timingSafeEqual(digest(url.searchParams.get('token') ?? ''), digest(token))) return reject(401, 'Preview access required');
      res.setHeader('Set-Cookie', `${name}=${token}; HttpOnly; SameSite=Lax; Path=/`);
      res.writeHead(302, { Location: '/' }); res.end(); return;
    }
    const cookies = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(Boolean);
    const supplied = req.headers.authorization === `Bearer ${token}` ? token :
      cookies.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? '';
    if (!timingSafeEqual(digest(supplied), digest(token))) return reject(401, 'Preview access required');
    if (req.headers['transfer-encoding']) return reject(411, 'Content length required');
    if (Number(req.headers['content-length'] ?? 0) > 16 * 1024 * 1024) return reject(413, 'Preview upload too large');
    const headers: IncomingHttpHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!hop.has(key) && !['authorization','cookie'].includes(key) && !key.startsWith('x-factory-')) headers[key] = value;
    }
    headers.host = host;
    headers.connection = 'close';
    const siteCookies = cookies.filter(value => allowedCookie(value.split('=')[0] ?? ''));
    if (siteCookies.length) headers.cookie = siteCookies.join('; ');
    const upstream = upstreamRequest({ socketPath, path: req.url, method: req.method, headers, timeout: 30_000 }, response => {
      for (const [key, value] of Object.entries(response.headers)) {
        if (!hop.has(key) && !['set-cookie','cache-control','referrer-policy','x-content-type-options'].includes(key) && value !== undefined) res.setHeader(key, value);
      }
      const setCookies = response.headers['set-cookie']?.filter(value => allowedCookie(value.split('=')[0] ?? ''));
      if (setCookies?.length) res.setHeader('Set-Cookie', setCookies);
      res.statusCode = response.statusCode ?? 502;
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) reject(502, 'Preview temporarily unavailable'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;
  server.on('upgrade', (_req, socket) => socket.destroy());
  return server;
}
