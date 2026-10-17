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
import path from "node:path";
import type { Task } from "./types.ts";

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
        const flushAll = () => TaskStore.instances.forEach((s) => s.flushSync());
        process.on("exit", flushAll);
        for (const sig of ["SIGINT", "SIGTERM"] as const) {
            process.on(sig, () => {
                flushAll();
                // Si nadie más gestiona la señal, se respeta su comportamiento por defecto (terminar).
                if (process.listenerCount(sig) <= 1) process.exit(sig === "SIGINT" ? 130 : 143);
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Migración de tareas persistidas antes de existir la fuente única de trazas
// ---------------------------------------------------------------------------

/**
 * Elimina de una tarea heredada las copias crudas redundantes (`step.rawInput/rawOutput`,
 * `calls[].rawInput/rawOutput`, `memory.rawInteractions`) cuando su texto existe idéntico en `modelIterations`.
 * Es una migración sin pérdida: lo que no coincide exactamente se conserva. Devuelve true si cambió algo.
 */
export function compactLegacyDuplicates(task: Task): boolean {
    const iterations = task.modelIterations;
    if (!iterations || iterations.length === 0) return false;

    const known = new Set<string>();
    for (const it of iterations) {
        if (it.rawInput) known.add(it.rawInput);
        if (it.rawOutput) known.add(it.rawOutput);
    }

    let changed = false;
    const dropDuplicated = (holder: { rawInput?: string; rawOutput?: string }) => {
        if (typeof holder.rawInput === "string" && known.has(holder.rawInput)) {
            delete holder.rawInput;
            changed = true;
        }
        if (typeof holder.rawOutput === "string" && known.has(holder.rawOutput)) {
            delete holder.rawOutput;
            changed = true;
        }
    };

    for (const step of task.steps ?? []) {
        dropDuplicated(step);
        for (const call of step.calls ?? []) dropDuplicated(call);
    }

    const interactions = task.memory?.rawInteractions;
    if (interactions && task.memory) {
        const kept = interactions.filter((r) => !(known.has(r.rawInput) && known.has(r.rawOutput)));
        if (kept.length !== interactions.length) {
            changed = true;
            if (kept.length > 0) task.memory.rawInteractions = kept;
            else delete task.memory.rawInteractions;
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------
// Archivo de referencias (RefStore) de tareas terminadas
// ---------------------------------------------------------------------------

const SAFE_TASK_ID = /^[A-Za-z0-9_-]+$/;
/** Tope por referencia y por tarea en el archivo histórico (caracteres). En memoria, durante la tarea, no hay tope. */
const MAX_ARCHIVED_REF_CHARS = 200_000;
const MAX_ARCHIVED_TASK_CHARS = 2_000_000;

export interface ArchivedRef {
    key: string;
    label: string;
    content: string;
}

/**
 * Archivo en disco (un JSON por tarea) de las referencias de tareas terminadas. El RefStore vive en memoria y se
 * libera al terminar la tarea; sin este archivo, `GET /ref/:key` devolvía 404 para todo el historial (y tras cualquier
 * reinicio). Se escribe de forma atómica, se lee a demanda y se elimina junto con la tarea.
 */
export class RefArchive {
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
    }

    /** Solo identificadores seguros: el id llega por query string y forma parte de una ruta de archivo. */
    private fileFor(taskId: string): string | null {
        return SAFE_TASK_ID.test(taskId) ? path.join(this.dir, `${taskId}.json`) : null;
    }

    /** Archiva (asíncrono, atómico) conservando las referencias más recientes dentro del tope por tarea. */
    save(taskId: string, refs: ArchivedRef[]): void {
        const file = this.fileFor(taskId);
        if (!file || refs.length === 0) return;

        const kept: ArchivedRef[] = [];
        let total = 0;
        for (let i = refs.length - 1; i >= 0; i--) {
            let content = refs[i].content;
            if (content.length > MAX_ARCHIVED_REF_CHARS) {
                const omitted = content.length - MAX_ARCHIVED_REF_CHARS;
                content = `${content.slice(0, MAX_ARCHIVED_REF_CHARS)}\n[… truncado: ${omitted} caracteres omitidos en el archivo histórico]`;
            }
            if (total + content.length > MAX_ARCHIVED_TASK_CHARS) break;
            total += content.length;
            kept.unshift({ key: refs[i].key, label: refs[i].label, content });
        }
        if (kept.length === 0) return;

        const json = JSON.stringify(kept);
        const tmp = `${file}.tmp`;
        fs.promises
            .mkdir(this.dir, { recursive: true })
            .then(() => fs.promises.writeFile(tmp, json, "utf-8"))
            .then(async () => {
                try {
                    await fs.promises.rename(tmp, file);
                } catch {
                    // Windows: destino retenido momentáneamente; el temporal ya está completo.
                    await fs.promises.copyFile(tmp, file);
                    await fs.promises.unlink(tmp).catch(() => undefined);
                }
            })
            .catch((err) => console.warn(`[RefArchive] No se pudo archivar '${taskId}':`, err));
    }

    get(taskId: string, key: string): string | undefined {
        const file = this.fileFor(taskId);
        if (!file) return undefined;
        try {
            const refs = JSON.parse(fs.readFileSync(file, "utf-8")) as ArchivedRef[];
            return refs.find((r) => r.key === key)?.content;
        } catch {
            return undefined;
        }
    }

    remove(taskId: string): void {
        const file = this.fileFor(taskId);
        if (!file) return;
        try {
            fs.rmSync(file, { force: true });
        } catch {
            /* best effort */
        }
    }

    /** Elimina los archivos de tareas que ya no se retienen (expulsadas, o de ejecuciones anteriores). */
    prune(keep: ReadonlySet<string>): void {
        let names: string[];
        try {
            names = fs.readdirSync(this.dir);
        } catch {
            return; // el directorio aún no existe
        }
        for (const name of names) {
            if (!name.endsWith(".json")) continue;
            if (!keep.has(name.slice(0, -".json".length))) {
                try {
                    fs.rmSync(path.join(this.dir, name), { force: true });
                } catch {
                    /* best effort */
                }
            }
        }
    }
}

/** Instancia única compartida por el núcleo y el servidor HTTP (mismo directorio de trabajo que jarvis-tasks.json). */
export const refArchive = new RefArchive(path.resolve(process.cwd(), "jarvis-refs"));