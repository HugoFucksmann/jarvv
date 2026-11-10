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

export function localOnly(): express.RequestHandler {
  return (req, res, next) => {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      return void res.status(403).json({ error: 'Host no permitido.' });
    }
    const origin = req.headers.origin;
    if (origin) {
      if (!LOCAL_ORIGIN.test(origin)) {
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
