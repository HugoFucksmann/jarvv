import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalTierOf } from "../src/core/policy/tiers.ts";

const ENV = { platform: "windows" as const, home: "C:\Users\Ana", desktop: "C:\Users\Ana\Desktop", documents: "C:\Users\Ana\Documents", downloads: "C:\Users\Ana\Downloads" };
const FOLDERS = ["C:\Users\Ana", "C:\Users\Ana\Documents", "C:\Users\Ana\Desktop", "C:\Users\Ana\Downloads"];
const disk = (existing: string[]) => ({ exists: (p: string) => existing.includes(p) || FOLDERS.includes(p) });

test("rojo: ejecutar comandos que modifican y cortar procesos", () => {
  assert.equal(approvalTierOf("run_command", { command: "Remove-Item x" }, ENV, disk([])), "red");
  assert.equal(approvalTierOf("stop_process", { pid: 4 }, ENV, disk([])), "red");
});

test("amarillo: herramientas no clasificadas", () => {
  assert.equal(approvalTierOf("alguna_herramienta", {}, ENV, disk([])), "yellow");
});
