/**
 * JARVIS Core — Entorno del usuario (rutas reales de esta PC)
 *
 * El LLM no conoce el nombre de usuario de Windows ni dónde están sus carpetas: sin este dato inventa rutas como
 * `C:\Users\<user>\Desktop`. Las carpetas conocidas se consultan al sistema (el escritorio y los documentos pueden
 * estar redirigidos, p. ej. a OneDrive) y el resultado se conserva durante todo el proceso.
 */

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const QUERY_TIMEOUT_MS = 8000;

/**
 * Un solo proceso PowerShell devuelve las carpetas como JSON. La salida se fuerza a UTF-8 sin BOM: con la página de
 * códigos por defecto se corromperían los nombres con acentos (p. ej. un usuario "José").
 */
const KNOWN_FOLDERS_SCRIPT = [
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
    "$shell = New-Object -ComObject Shell.Application",
    "[ordered]@{ desktop = [Environment]::GetFolderPath('Desktop'); documents = [Environment]::GetFolderPath('MyDocuments'); downloads = $shell.NameSpace('shell:Downloads').Self.Path } | ConvertTo-Json -Compress",
].join("; ");

const FOLDER_KEYS = ["desktop", "documents", "downloads"] as const;
type FolderKey = (typeof FOLDER_KEYS)[number];

export interface UserEnvironment {
    home: string;
    desktop?: string;
    documents?: string;
    downloads?: string;
}

async function queryKnownFolders(): Promise<Partial<Record<FolderKey, string>>> {
    const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", KNOWN_FOLDERS_SCRIPT],
        { timeout: QUERY_TIMEOUT_MS, windowsHide: true }
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const folders: Partial<Record<FolderKey, string>> = {};
    for (const key of FOLDER_KEYS) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) folders[key] = value.trim();
    }
    return folders;
}

let cached: Promise<UserEnvironment> | undefined;

/**
 * Rutas reales del usuario de esta PC. Se consultan una sola vez por proceso; si la consulta falla (o no hay
 * PowerShell) se informa solo la carpeta personal, que sale del sistema operativo sin consultas externas.
 */
export function getUserEnvironment(): Promise<UserEnvironment> {
    cached ??= (async (): Promise<UserEnvironment> => {
        const home = os.homedir();
        try {
            return { home, ...(await queryKnownFolders()) };
        } catch (err) {
            console.warn(
                `[Environment] No se pudieron consultar las carpetas del usuario; solo se informa la carpeta personal: ${err instanceof Error ? err.message : String(err)}`
            );
            return { home };
        }
    })();
    return cached;
}