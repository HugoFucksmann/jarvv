/** Conversión del audio de la voz (PCM 16-bit mono 24 kHz) a OGG/Opus, el formato de las notas de voz de Telegram. Usa ffmpeg. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Ejecutable de ffmpeg: `FFMPEG_PATH`, el del PATH o, en Windows, el que instala winget (Gyan.FFmpeg). Esto último evita reiniciar
 * Jarvis desde una terminal nueva tras instalarlo: el proceso en marcha no ve el PATH actualizado.
 */
export function ffmpegBin(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const local = process.platform === "win32" ? process.env.LOCALAPPDATA : undefined;
  if (local) {
    try {
      const packages = path.join(local, "Microsoft", "WinGet", "Packages");
      for (const pkg of fs.readdirSync(packages).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
        for (const build of fs.readdirSync(path.join(packages, pkg)).filter((d) => d.startsWith("ffmpeg-"))) {
          const exe = path.join(packages, pkg, build, "bin", "ffmpeg.exe");
          if (fs.existsSync(exe)) return exe;
        }
      }
    } catch {
      /* sin winget */
    }
  }
  return "ffmpeg";
}

const MISSING = "ffmpeg no está instalado o no está en el PATH (necesario para las notas de voz; winget install Gyan.FFmpeg)";

/** ¿Se puede ejecutar ffmpeg? */
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn(ffmpegBin(), ["-version"], { stdio: "ignore" });
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
}

export function pcmToOggOpus(pcm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegBin(), [
      "-loglevel", "error",
      "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
      "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1",
    ]);
    const out: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ENOENT" ? new Error(MISSING) : e));
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg terminó con código ${code}`))));
    ff.stdin.on("error", () => { /* ffmpeg cerró la entrada antes de tiempo: el error sale por `close` */ });
    ff.stdin.end(pcm);
  });
}
