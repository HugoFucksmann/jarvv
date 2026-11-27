/**
 * Supervisor del servidor de voz local (`scripts/phonon_server.py`).
 *
 * Con la voz encendida (`voiceEnabled` o `telegramVoice`) arranca el servidor desde `.venv-tts` y con ambas apagadas lo cierra, así el interruptor de
 * la interfaz alcanza y no hay que levantar Python a mano. Solo maneja uno local (loopback) y que no esté ya corriendo: si el puerto responde, lo
 * da por de otro y no lo toca.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ConfigSource } from '../core/config.ts';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface TtsSupervisor {
  /** Alinea el proceso con la configuración vigente (se llama al arrancar y en cada cambio de voz). */
  sync(): Promise<void>;
  /** Cierra el proceso si es nuestro. */
  stop(): void;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
  else child.kill();
}

export function createTtsSupervisor(root: string, getConfig: ConfigSource): TtsSupervisor {
  let child: ChildProcess | undefined;
  let starting = false;
  let warnedMissing = false;

  const python = process.platform === 'win32'
    ? path.join(root, '.venv-tts', 'Scripts', 'python.exe')
    : path.join(root, '.venv-tts', 'bin', 'python');

  const stop = (): void => {
    const current = child;
    child = undefined;
    if (current) killTree(current);
  };

  const sync = async (): Promise<void> => {
    const cfg = getConfig();
    const wanted = cfg.voiceEnabled || cfg.telegramVoice;
    if (!wanted) return stop();
    if (child || starting) return;

    let url: URL;
    try {
      url = new URL(cfg.voiceUrl);
    } catch {
      return;
    }
    if (!LOOPBACK.has(url.hostname)) return; // un servidor de voz remoto no es nuestro
    const port = Number(url.port) || 80;

    starting = true;
    try {
      if (await portOpen(port)) return; // ya hay uno corriendo
      if (!fs.existsSync(python)) {
        if (!warnedMissing) console.warn(`[Voz] No se encuentra ${python}: la voz necesita el servidor TTS (ver docs/operacion/TELEGRAM_Y_VOZ.md).`);
        warnedMissing = true;
        return;
      }
      const log = fs.openSync(path.join(os.tmpdir(), 'jarvis-tts.log'), 'w');
      const proc = spawn(python, [path.join(root, 'scripts', 'phonon_server.py')], {
        cwd: root,
        env: { ...process.env, PTTS_PORT: String(port) },
        stdio: ['ignore', log, log],
        windowsHide: true,
      });
      fs.closeSync(log);
      proc.once('exit', (code) => {
        if (child !== proc) return; // lo cerramos nosotros
        child = undefined;
        if (code) console.warn(`[Voz] El servidor de voz terminó con código ${code} (ver ${path.join(os.tmpdir(), 'jarvis-tts.log')}).`);
      });
      child = proc;
      console.log(`[Voz] Servidor de voz iniciado en el puerto ${port}.`);
    } finally {
      starting = false;
    }
  };

  return { sync, stop };
}
