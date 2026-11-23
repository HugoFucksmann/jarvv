/**
 * Acceso solo local. El agente ejecuta comandos en esta PC y la API no tiene autenticación, así que lo único que separa a un sitio web
 * cualquiera de ella es esto:
 * - Se exige un `Host` local: frena el DNS rebinding (un dominio ajeno que resuelve a 127.0.0.1).
 * - Si el request trae `Origin`, también debe ser local, sea cual sea el método (el frontend en otro puerto de localhost sigue funcionando).
 *   Un navegador manda `Origin` en todo POST entre sitios; `null` (iframes aislados, `data:`) tampoco pasa.
 * - Los requests sin `Origin` (mismo origen, curl, otro proceso local) pasan: no hay forma de distinguirlos sin autenticación.
 *
 * Con `HOST=0.0.0.0` este filtro NO es autenticación: un cliente de red puede mandar `Host: localhost`.
 */

import type express from 'express';

export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
export const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function isLoopbackHost(host: string): boolean {
  const clean = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return (
    clean === 'localhost' ||
    clean === 'localhost.' ||
    clean === '::1' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d\d?)){3}$/.test(clean)
  );
}

/** `ALLOW_PROXY_HOST=1` desactiva SOLO el chequeo de `Host` (sandboxes tipo AI Studio Build, cuyo proxy manda un Host no loopback). Por defecto está activo. */
export const proxyHostAllowed = (): boolean => process.env.ALLOW_PROXY_HOST === '1';

function allowedProxyHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const item of (process.env.NG_ALLOWED_HOSTS ?? '').split(',')) {
    const clean = item.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).hostname.toLowerCase());
    } catch {
      // Ignora APP_URL malformada.
    }
  }
  return hosts;
}

function isAllowedProxyHostHeader(hostHeader: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.size === 0 || !hostHeader) return false;
  const clean = hostHeader.trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  return allowed.has(clean);
}

function isAllowedProxyOrigin(origin: string, allowed: ReadonlySet<string>): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return allowed.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function localOnly(): express.RequestHandler {
  return (req, res, next) => {
    const proxyHosts = allowedProxyHosts();
    const hostHeader = req.headers.host ?? '';
    if (!proxyHostAllowed() && !LOCAL_HOST.test(hostHeader) && !isAllowedProxyHostHeader(hostHeader, proxyHosts)) {
      return void res.status(403).json({ error: 'Host no permitido.' });
    }
    const origin = req.headers.origin;
    if (origin) {
      if (!LOCAL_ORIGIN.test(origin) && !isAllowedProxyOrigin(origin, proxyHosts)) {
        return void res.status(403).json({ error: 'Origen no permitido.' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      return void res.sendStatus(200);
    }
    next();
  };
}
