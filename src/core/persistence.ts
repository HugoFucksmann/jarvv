/**
 * JARVIS Core — Persistencia de tareas
 *
 * - Escritura atómica: se escribe un archivo temporal y se renombra sobre el definitivo. Un corte a mitad de
 *   escritura nunca deja un JSON truncado.
 * - Escrituras agrupadas: muchas solicitudes seguidas producen una sola escritura (debounce con espera máxima).
 *   Las transiciones críticas (esperando al usuario, estados terminales) piden escritura inmediata.
 * - Un solo vuelo: nunca hay dos escrituras simultáneas; si llega otra solicitud durante una escritura, se repite
 *   una vez al terminar.
 * - Carga tolerante: si el archivo principal está dañado, se pone en cuarentena y se recupera la última copia
 *   buena (`.bak`, refrescada en cada carga exitosa).
 * - Al salir del proceso (exit, SIGINT, SIGTERM) se vuelca de forma síncrona lo pendiente.
 */

import fs from "node:fs";

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_MAX_WAIT_MS = 2000;
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface TaskStoreOptions {
    debounceMs?: number;
    maxWaitMs?: number;
}

export class TaskStore {
    private static readonly instances = new Set<TaskStore>();
    private static hooksInstalled = false;

    private readonly filePath: string;
    private readonly snapshot: () => unknown;
    private readonly backupPath: string;
    private readonly debounceMs: number;
    private readonly maxWaitMs: number;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** Instante de la primera solicitud aún no escrita (null = nada pendiente). */
    private dirtySince: number | null = null;
    private writing = false;
    private rerun = false;

    constructor(filePath: string, snapshot: () => unknown, options: TaskStoreOptions = {}) {
        this.filePath = filePath;
        this.snapshot = snapshot;
        this.backupPath = `${filePath}.bak`;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
        TaskStore.instances.add(this);
        TaskStore.installExitHooks();
    }

    // ---------------- Carga ----------------

    /** Lee las tareas persistidas. Nunca lanza: ante archivos dañados recupera la copia o devuelve []. */
    load(): unknown[] {
        for (const candidate of [this.filePath, this.backupPath]) {
            if (!fs.existsSync(candidate)) continue;
            try {
                const raw = fs.readFileSync(candidate, "utf-8");
                if (!raw.trim()) continue;
                const parsed: unknown = JSON.parse(raw);
                if (!Array.isArray(parsed)) throw new Error("el contenido no es un arreglo de tareas");

                if (candidate === this.backupPath) {
                    console.warn(`[TaskStore] Archivo principal ilegible: se recuperaron ${parsed.length} tareas desde '${this.backupPath}'.`);
                } else {
                    this.refreshBackup(raw);
                }
                return parsed;
            } catch (err) {
                console.warn(`[TaskStore] No se pudo leer '${candidate}':`, err instanceof Error ? err.message : err);
                if (candidate === this.filePath) this.quarantine();
            }
        }
        return [];
    }

    private refreshBackup(raw: string): void {
        try {
            fs.writeFileSync(this.backupPath, raw, "utf-8");
        } catch (err) {
            console.warn("[TaskStore] No se pudo actualizar la copia de seguridad:", err);
        }
    }

    /** Aparta el archivo dañado (sin borrarlo) para que la próxima escritura no lo pise. */
    private quarantine(): void {
        try {
            const target = `${this.filePath}.corrupt-${Date.now()}`;
            fs.renameSync(this.filePath, target);
            console.warn(`[TaskStore] Archivo dañado movido a '${target}'.`);
        } catch (err) {
            console.warn("[TaskStore] No se pudo poner en cuarentena el archivo dañado:", err);
        }
    }

    // ---------------- Escritura ----------------

    /** Solicita una escritura agrupada. */
    schedule(): void {
        const now = Date.now();
        if (this.dirtySince === null) this.dirtySince = now;
        if (this.timer) clearTimeout(this.timer);
        const wait = Math.max(0, Math.min(this.debounceMs, this.dirtySince + this.maxWaitMs - now));
        this.timer = setTimeout(() => {
            this.timer = null;
            this.pump();
        }, wait);
        this.timer.unref?.();
    }

    /** Solicita una escritura inmediata (asíncrona). */
    saveNow(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.dirtySince === null) this.dirtySince = Date.now();
        this.pump();
    }

    private pump(): void {
        if (this.writing) {
            this.rerun = true;
            return;
        }
        this.writing = true;
        this.dirtySince = null;
        this.write()
            .catch((err) => console.warn("[TaskStore] Error al persistir tareas:", err))
            .finally(() => {
                this.writing = false;
                if (this.rerun) {
                    this.rerun = false;
                    this.pump();
                }
            });
    }

    private async write(): Promise<void> {
        // La serialización es síncrona y ocurre aquí: captura el estado en este instante.
        const json = JSON.stringify(this.snapshot());
        const tmp = `${this.filePath}.tmp`;
        await fs.promises.writeFile(tmp, json, "utf-8");
        await this.replace(tmp);
    }

    private async replace(tmp: string): Promise<void> {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await fs.promises.rename(tmp, this.filePath);
                return;
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code ?? "";
                if (!RENAME_RETRY_CODES.has(code)) throw err;
                // Windows: antivirus/indexador pueden retener el destino unos milisegundos.
                await sleep(40 * (attempt + 1));
            }
        }
        // Último recurso: copiar sobre el destino (no atómico, pero el temporal ya está completo en disco).
        await fs.promises.copyFile(tmp, this.filePath);
        await fs.promises.unlink(tmp).catch(() => undefined);
    }

    /** Volcado síncrono de lo pendiente (salida del proceso). */
    flushSync(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.dirtySince === null && !this.writing && !this.rerun) return;
        try {
            const tmp = `${this.filePath}.tmp-sync`;
            fs.writeFileSync(tmp, JSON.stringify(this.snapshot()), "utf-8");
            fs.renameSync(tmp, this.filePath);
            this.dirtySince = null;
            this.rerun = false;
        } catch (err) {
            console.warn("[TaskStore] Error en el volcado final:", err);
        }
    }

    // ---------------- Salida del proceso ----------------

    private static installExitHooks(): void {
        if (TaskStore.hooksInstalled) return;
        TaskStore.hooksInstalled = true;
        // El hook "exit" es suficiente: server.ts gestiona SIGINT/SIGTERM llamando a
        // flushPersistence() + process.exit(0), que dispara "exit" antes de terminar.
        // Registrar handlers propios para las señales era redundante en producción y
        // su rama process.exit() nunca se activaba (listenerCount siempre > 1).
        process.on("exit", () => TaskStore.instances.forEach((s) => s.flushSync()));
    }
}