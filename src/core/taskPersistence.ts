/**
 * JARVIS Core — Robust Task Persistence & Memory Lifecycle Management
 * 
 * Implementa:
 * - Escritura atómica mediante archivo temporal (.tmp) y renombrado en disco.
 * - Copia de respaldo de seguridad (.bak) antes de sobrescribir.
 * - Recuperación automática en arranque si el archivo principal está vacío (0 bytes) o corrupto.
 * - Coalescencia / Debounce de persistencia para evitar saturar el disco en ráfagas de eventos.
 * - Flush síncrono forzado para transiciones de estado críticas y apagado limpio (SIGINT/SIGTERM).
 * - Política de retención y desalojo (eviction) para evitar fugas de memoria en taskContexts.
 */

import fs from "node:fs";
import path from "node:path";
import type { Task } from "./types.ts";
import { isTerminalState } from "./types.ts";

export interface TaskPersistenceOptions {
  filePath?: string;
  maxPersistedTasks?: number;
  maxMemoryTasks?: number;
  debounceMs?: number;
}

export class TaskPersistenceManager {
  private readonly filePath: string;
  private readonly bakFilePath: string;
  private readonly tmpFilePath: string;
  private readonly maxPersistedTasks: number;
  private readonly maxMemoryTasks: number;
  private readonly debounceMs: number;

  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingTasksToPersist: Task[] | null = null;
  private isWriting: boolean = false;

  constructor(options: TaskPersistenceOptions = {}) {
    this.filePath = options.filePath || path.resolve(process.cwd(), "jarvis-tasks.json");
    this.bakFilePath = `${this.filePath}.bak`;
    this.tmpFilePath = `${this.filePath}.tmp`;
    this.maxPersistedTasks = options.maxPersistedTasks ?? 20;
    this.maxMemoryTasks = options.maxMemoryTasks ?? 30;
    this.debounceMs = options.debounceMs ?? 100;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getBakFilePath(): string {
    return this.bakFilePath;
  }

  /**
   * Carga tareas persistidas con recuperación automática ante archivo dañado o interrumpido.
   * Orden de búsqueda y resiliencia:
   * 1. Archivo principal (jarvis-tasks.json)
   * 2. Archivo temporal íntegro (.tmp) si el renombrado atómico previo fue bloqueado
   * 3. Archivo de respaldo (.bak) verificado
   */
  loadTasks(): Task[] {
    let rawContent: string | null = null;
    let sourceUsed: "primary" | "temp" | "backup" | "none" = "none";

    // 1. Intentar leer archivo principal
    if (fs.existsSync(this.filePath)) {
      try {
        const content = fs.readFileSync(this.filePath, "utf-8").trim();
        if (content.length > 0) {
          try {
            JSON.parse(content);
            rawContent = content;
            sourceUsed = "primary";
          } catch {
            console.warn("[TaskPersistence] Archivo principal no contiene JSON válido. Buscando alternativas seguras...");
          }
        } else {
          console.warn("[TaskPersistence] Archivo principal 'jarvis-tasks.json' tiene tamaño 0 bytes. Buscando alternativas...");
        }
      } catch (err) {
        console.warn("[TaskPersistence] Error leyendo archivo principal:", err);
      }
    }

    // 2. Si el archivo principal no estaba o estaba dañado/vacío, buscar archivo temporal .tmp íntegro
    if (!rawContent && fs.existsSync(this.tmpFilePath)) {
      try {
        const tmpContent = fs.readFileSync(this.tmpFilePath, "utf-8").trim();
        if (tmpContent.length > 0) {
          try {
            JSON.parse(tmpContent);
            rawContent = tmpContent;
            sourceUsed = "temp";
            console.log("[TaskPersistence] Archivo temporal .tmp íntegro detectado tras fallo de renombrado. Recuperando tareas desde .tmp.");
          } catch {
            // .tmp incompleto o corrupto, continuar a .bak
          }
        }
      } catch (tmpErr) {
        console.warn("[TaskPersistence] Error leyendo archivo temporal .tmp:", tmpErr);
      }
    }

    // 3. Si no hay principal ni .tmp válido, intentar con respaldo .bak verificado
    if (!rawContent && fs.existsSync(this.bakFilePath)) {
      try {
        const bakContent = fs.readFileSync(this.bakFilePath, "utf-8").trim();
        if (bakContent.length > 0) {
          try {
            JSON.parse(bakContent);
            rawContent = bakContent;
            sourceUsed = "backup";
            console.log("[TaskPersistence] Respaldo 'jarvis-tasks.json.bak' detectado. Recuperando tareas desde respaldo.");
          } catch {
            console.warn("[TaskPersistence] Archivo de respaldo .bak no contiene JSON válido.");
          }
        }
      } catch (bakErr) {
        console.warn("[TaskPersistence] Error leyendo archivo de respaldo .bak:", bakErr);
      }
    }

    if (!rawContent) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        if (sourceUsed === "backup" || sourceUsed === "temp") {
          // Restaurar archivo principal de forma segura con el contenido íntegro recuperado
          try {
            this.writeAtomicSync(parsed);
            console.log(`[TaskPersistence] Archivo principal restaurado exitosamente a partir de ${sourceUsed} (${parsed.length} tareas).`);
          } catch (restErr) {
            console.warn(`[TaskPersistence] No se pudo sobrescribir archivo principal tras recuperación desde ${sourceUsed}:`, restErr);
          }
        }
        return parsed;
      }
      console.warn("[TaskPersistence] El contenido del archivo no es un array de tareas válido.");
    } catch (parseErr) {
      console.warn(`[TaskPersistence] Error procesando JSON desde ${sourceUsed}:`, parseErr);
    }

    return [];
  }

  /**
   * Programa una persistencia asíncrona mediante debounce.
   * Agrupa ráfagas de micro-eventos sucesivos para proteger el rendimiento.
   */
  schedulePersist(tasks: Task[]): void {
    this.pendingTasksToPersist = tasks;

    if (this.debounceTimer) {
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingTasksToPersist) {
        const toSave = this.pendingTasksToPersist;
        this.pendingTasksToPersist = null;
        this.writeAtomic(toSave);
      }
    }, this.debounceMs);
  }

  /**
   * Flush forzado e inmediato de forma síncrona.
   * Obligatorio en cierres de servidor (SIGINT/SIGTERM) y estados terminales de tarea.
   */
  flushSync(tasks?: Task[]): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    const toSave = tasks || this.pendingTasksToPersist;
    this.pendingTasksToPersist = null;

    if (toSave) {
      this.writeAtomicSync(toSave);
    }
  }

  /**
   * Escritura atómica a disco:
   * 1. Limita a las últimas N tareas (maxPersistedTasks).
   * 2. Serializa a archivo temporal (.tmp).
   * 3. Crea o actualiza copia de seguridad (.bak) únicamente si el archivo actual es JSON válido.
   * 4. Renombra atómicamente el archivo temporal sobre el destino con reintentos para locks en Windows.
   * 5. Si renameSync no puede completar por lock persistente, PRESERVA el .tmp y el .bak íntegros sin destruirlos.
   */
  private writeAtomicSync(tasks: Task[]): void {
    try {
      this.isWriting = true;
      const sliceToPersist = tasks.slice(-this.maxPersistedTasks);
      const jsonContent = JSON.stringify(sliceToPersist, null, 2);

      // 1. Escribir primero en archivo temporal
      fs.writeFileSync(this.tmpFilePath, jsonContent, "utf-8");

      // 2. Si el archivo principal ya existe y tiene JSON válido, asegurar backup
      if (fs.existsSync(this.filePath)) {
        try {
          const currentContent = fs.readFileSync(this.filePath, "utf-8").trim();
          if (currentContent.length > 0) {
            try {
              JSON.parse(currentContent);
              fs.copyFileSync(this.filePath, this.bakFilePath);
            } catch {
              console.warn("[TaskPersistence] Archivo actual no es JSON válido; se preserva el .bak existente sin sobrescribir.");
            }
          }
        } catch (copyErr) {
          console.warn("[TaskPersistence] Advertencia verificando copia .bak:", copyErr);
        }
      }

      // 3. Renombrado atómico sobre el archivo de tareas con reintentos para Windows
      const maxRetries = 3;
      let renameSuccess = false;
      let lastRenameError: any = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          fs.renameSync(this.tmpFilePath, this.filePath);
          renameSuccess = true;
          break;
        } catch (renameErr: any) {
          lastRenameError = renameErr;
          if ((renameErr.code === "EPERM" || renameErr.code === "EBUSY") && attempt < maxRetries) {
            // Pausa síncrona corta (20ms, 40ms, 60ms) para permitir que el lock de lectura transitorio en Windows se libere
            const waitMs = (attempt + 1) * 20;
            const start = Date.now();
            while (Date.now() - start < waitMs) { /* spin-wait corta */ }
            continue;
          }
        }
      }

      if (!renameSuccess) {
        console.warn(
          `[TaskPersistence] No se pudo renombrar atómicamente en Windows (${lastRenameError?.code}). ` +
          `Se preserva el archivo temporal .tmp y el respaldo .bak sin truncar el archivo principal.`
        );
      }
    } catch (err) {
      console.error("[TaskPersistence] Error en escritura atómica síncrona:", err);
    } finally {
      this.isWriting = false;
    }
  }

  private writeAtomic(tasks: Task[]): void {
    this.writeAtomicSync(tasks);
  }

  /**
   * Aplica la política de retención en memoria (RAM):
   * Si el total de tareas en memoria supera maxMemoryTasks, desaloja las tareas
   * terminales más antiguas. NUNCA desaloja tareas activas (RUNNING) ni en espera (WAITING_INPUT).
   * 
   * Devuelve la lista de taskIds desalojados para permitir la limpieza de RefStore u otros recursos.
   */
  pruneMemoryTasks<T extends { task: Task }>(taskContexts: Map<string, T>): string[] {
    if (taskContexts.size <= this.maxMemoryTasks) {
      return [];
    }

    const evictedIds: string[] = [];
    const entries = Array.from(taskContexts.entries());

    // Identificar tareas terminales candidatas a desalojo ordenadas por antigüedad (FIFO)
    for (const [taskId, ctx] of entries) {
      if (taskContexts.size <= this.maxMemoryTasks) {
        break;
      }
      if (isTerminalState(ctx.task.state)) {
        taskContexts.delete(taskId);
        evictedIds.push(taskId);
      }
    }

    if (evictedIds.length > 0) {
      console.log(`[TaskPersistence] Desalojadas ${evictedIds.length} tareas inactivas de memoria RAM (límite: ${this.maxMemoryTasks}).`);
    }

    return evictedIds;
  }
}
