import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalTierOf } from "../src/core/policy/tiers.ts";

const ENV = { platform: "windows" as const, home: "C:\\Users\\Ana", desktop: "C:\\Users\\Ana\\Desktop", documents: "C:\\Users\\Ana\\Documents", downloads: "C:\\Users\\Ana\\Downloads" };
const FOLDERS = ["C:\\Users\\Ana", "C:\\Users\\Ana\\Documents", "C:\\Users\\Ana\\Desktop", "C:\\Users\\Ana\\Downloads"];
const disk = (existing: string[]) => ({ exists: (p: string) => existing.includes(p) || FOLDERS.includes(p) });

test("verde: crear carpetas y archivos que no existen, o mover a un destino que no existe, dentro de las carpetas del usuario", () => {
  assert.equal(approvalTierOf("create_directory", { path: "C:\\Users\\Ana\\Documents\\Proyectos" }, ENV, disk([])), "green");
  assert.equal(approvalTierOf("create_directory", { path: "C:\\Users\\Ana\\Documents\\Proyectos" }, ENV, disk(["C:\\Users\\Ana\\Documents\\Proyectos"])), "green", "asegurar que existe no pisa nada");
  assert.equal(approvalTierOf("write_file", { path: "C:\\Users\\Ana\\Desktop\\nota.md", content: "x" }, ENV, disk([])), "green");
  assert.equal(approvalTierOf("move_file", { source: "C:\\Users\\Ana\\Downloads\\a.pdf", destination: "C:\\Users\\Ana\\Documents\\a.pdf" }, ENV, disk(["C:\\Users\\Ana\\Downloads\\a.pdf"])), "green");
});

test("rojo: sobrescribir un archivo que existe, pisar un destino, ejecutar comandos que modifican y cortar procesos", () => {
  const file = "C:\\Users\\Ana\\Desktop\\nota.md";
  assert.equal(approvalTierOf("write_file", { path: file, content: "x" }, ENV, disk([file])), "red", "reescribir lo que existe");
  assert.equal(approvalTierOf("write_file", { path: file, content: "x", mode: "rewrite" }, ENV, disk([file])), "red");
  const dest = "C:\\Users\\Ana\\Documents\\a.pdf";
  assert.equal(approvalTierOf("move_file", { source: "C:\\Users\\Ana\\Downloads\\a.pdf", destination: dest }, ENV, disk([dest])), "red", "el destino ya existe");
  assert.equal(approvalTierOf("run_command", { command: "Remove-Item x" }, ENV, disk([])), "red");
  assert.equal(approvalTierOf("stop_process", { pid: 4 }, ENV, disk([])), "red");
});

test("amarillo: agregar a un archivo, fuera de las carpetas del usuario, rutas relativas o sin ruta, y herramientas no clasificadas", () => {
  const file = "C:\\Users\\Ana\\Desktop\\nota.md";
  assert.equal(approvalTierOf("write_file", { path: file, content: "x", mode: "append" }, ENV, disk([file])), "yellow");
  assert.equal(approvalTierOf("write_file", { path: "D:\\datos\\nota.md", content: "x" }, ENV, disk([])), "yellow", "fuera de las carpetas del usuario");
  assert.equal(approvalTierOf("create_directory", { path: "relativa" }, ENV, disk([])), "yellow");
  assert.equal(approvalTierOf("create_directory", {}, ENV, disk([])), "yellow");
  assert.equal(approvalTierOf("write_file", { path: "C:\\Users\\Ana\\Desktop\\{{ref:r1}}" }, ENV, disk([])), "yellow", "referencia sin resolver");
  assert.equal(approvalTierOf("alguna_herramienta", {}, ENV, disk([])), "yellow");
  assert.equal(approvalTierOf("move_file", { source: "D:\\a.txt", destination: "C:\\Users\\Ana\\Desktop\\a.txt" }, ENV, disk([])), "yellow", "el origen está fuera");
});

test("una ruta que solo se parece a una carpeta del usuario no es verde (C:\\Users\\AnaOtra)", () => {
  assert.equal(approvalTierOf("create_directory", { path: "C:\\Users\\AnaOtra\\x" }, ENV, disk([])), "yellow");
});

test("sin la carpeta contenedora la escritura falla: no es verde (amarillo), ni al crear un archivo ni al mover", () => {
  assert.equal(approvalTierOf("write_file", { path: "C:\\Users\\Ana\\jarvis\\nota.md", content: "x" }, ENV, disk([])), "yellow", "C:\\Users\\Ana\\jarvis no existe");
  assert.equal(approvalTierOf("move_file", { source: "C:\\Users\\Ana\\Downloads\\a.pdf", destination: "C:\\Users\\Ana\\Nueva\\a.pdf" }, ENV, disk([])), "yellow");
});

// ───────────────────────── Rutas relativas ─────────────────────────

const BASE = "C:\\Users\\Ana\\Documents";

test("una ruta relativa se resuelve contra la carpeta de trabajo de la herramienta antes de mirar si existe", () => {
  assert.equal(approvalTierOf("create_directory", { path: "Proyectos" }, ENV, disk([]), BASE), "green");
  assert.equal(approvalTierOf("write_file", { path: "nota.md", content: "x" }, ENV, disk([]), BASE), "green", "no existe, la carpeta sí");
  const existing = `${BASE}\\nota.md`;
  assert.equal(approvalTierOf("write_file", { path: "nota.md", content: "x" }, ENV, disk([existing]), BASE), "red", "existe: sobrescribir");
  assert.equal(approvalTierOf("write_file", { path: "nota.md", content: "x", mode: "append" }, ENV, disk([existing]), BASE), "yellow");
  assert.equal(approvalTierOf("move_file", { source: "a.pdf", destination: "..\\Downloads\\a.pdf" }, ENV, disk([`${BASE}\\a.pdf`]), BASE), "green");
  assert.equal(approvalTierOf("move_file", { source: "a.pdf", destination: "b.pdf" }, ENV, disk([`${BASE}\\a.pdf`, `${BASE}\\b.pdf`]), BASE), "red", "el destino ya existe");
});

test("una ruta relativa que sale de las carpetas del usuario, sin base o con una base relativa sigue en amarillo", () => {
  assert.equal(approvalTierOf("create_directory", { path: "..\\..\\..\\..\\Temp\\x" }, ENV, disk([]), BASE), "yellow", "resuelve fuera de las carpetas del usuario");
  assert.equal(approvalTierOf("create_directory", { path: "Proyectos" }, ENV, disk([])), "yellow", "sin base no se resuelve");
  assert.equal(approvalTierOf("create_directory", { path: "Proyectos" }, ENV, disk([]), "relativa"), "yellow", "una base relativa no sirve");
});

test("edit_block (en pausa) sigue en rojo", () => {
  assert.equal(approvalTierOf("edit_block", { file_path: "C:\\Users\\Ana\\Desktop\\a.txt" }, ENV, disk([])), "red");
});
