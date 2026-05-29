import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
import { spawn } from "node:child_process"

import { cleanupRequestDir, createRequestUploadDir, ensureDir } from "@/lib/upload"

export type PdfCompressPreset =
  | "balanced"
  | "screen"
  | "ebook"
  | "printer"
  | "prepress"

export type PdfCompressErrorCode = "GHOSTSCRIPT_NOT_FOUND" | "GHOSTSCRIPT_FAILED"

export class PdfCompressError extends Error {
  readonly code: PdfCompressErrorCode
  readonly exitCode?: number | null
  readonly stderr?: string

  constructor(
    code: PdfCompressErrorCode,
    message: string,
    options?: { exitCode?: number | null; stderr?: string },
  ) {
    super(message)
    this.code = code
    this.exitCode = options?.exitCode
    this.stderr = options?.stderr
  }
}

function getPdfSettings(preset: PdfCompressPreset): string {
  switch (preset) {
    case "screen":
      return "/screen"
    case "ebook":
      return "/ebook"
    case "printer":
      return "/printer"
    case "prepress":
      return "/prepress"
    case "balanced":
      return "/ebook"
  }
}

function getCandidateGhostscriptCommands(
  override?: string,
): readonly string[] {
  const commands: string[] = []

  if (override && override.trim().length > 0) {
    const trimmed = override.trim()
    commands.push(trimmed)

    if (process.platform === "win32") {
      const looksLikeDir =
        trimmed.endsWith("\\") ||
        trimmed.endsWith("/") ||
        path.extname(trimmed).length === 0
      if (looksLikeDir) {
        commands.push(
          path.join(trimmed, "gswin64c.exe"),
          path.join(trimmed, "gswin32c.exe"),
          path.join(trimmed, "gs.exe"),
        )
      }
    }
  }

  if (process.platform === "win32") {
    commands.push(
      "gswin64c",
      "gswin64c.exe",
      "gswin32c",
      "gswin32c.exe",
      "gs",
      "gs.exe",
    )
  } else {
    commands.push("gs")
  }

  return [...new Set(commands)]
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

function parseGhostscriptVersionDir(name: string): number[] | null {
  const match = /^gs(\d+(?:\.\d+)*)$/i.exec(name)
  if (!match) return null
  return match[1].split(".").map((part) => Number(part))
}

function compareNumberTuples(a: readonly number[], b: readonly number[]): number {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

let windowsGhostscriptCommandsCache: Promise<readonly string[]> | null = null

async function getWindowsInstalledGhostscriptCommands(): Promise<readonly string[]> {
  if (windowsGhostscriptCommandsCache) return windowsGhostscriptCommandsCache

  windowsGhostscriptCommandsCache = (async () => {
    const localAppData =
      typeof process.env.LOCALAPPDATA === "string" && process.env.LOCALAPPDATA.length > 0
        ? process.env.LOCALAPPDATA
        : null

    const roots = [
      process.env.ProgramW6432,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      "C:\\Program Files",
      "C:\\Program Files (x86)",
    ].filter((value): value is string => typeof value === "string" && value.length > 0)

    const candidateBases: string[] = []
    for (const root of roots) {
      candidateBases.push(path.join(root, "gs"), path.join(root, "GPL Ghostscript"))
    }

    const commands: string[] = []

    if (localAppData) {
      const userSpaceBin = path.join(localAppData, "Ghostscript", "bin")
      const win64 = path.join(userSpaceBin, "gswin64c.exe")
      const win32 = path.join(userSpaceBin, "gswin32c.exe")

      if (await fileExists(win64)) commands.push(win64)
      if (await fileExists(win32)) commands.push(win32)
    }

    for (const base of [...new Set(candidateBases)]) {
      const subdirs = await listDirectories(base)
      const versioned = subdirs
        .map((name) => ({ name, version: parseGhostscriptVersionDir(name) }))
        .filter(
          (entry): entry is { name: string; version: number[] } =>
            Array.isArray(entry.version) && entry.version.length > 0,
        )
        .sort((a, b) => compareNumberTuples(a.version, b.version))

      const candidatesToCheck =
        versioned.length > 0 ? [versioned[versioned.length - 1].name] : subdirs

      for (const dirName of candidatesToCheck) {
        const binDir = path.join(base, dirName, "bin")
        const win64 = path.join(binDir, "gswin64c.exe")
        const win32 = path.join(binDir, "gswin32c.exe")

        if (await fileExists(win64)) commands.push(win64)
        if (await fileExists(win32)) commands.push(win32)
      }
    }

    return [...new Set(commands)]
  })()

  return windowsGhostscriptCommandsCache
}

async function runGhostscript(
  args: readonly string[],
  options?: { ghostscriptPath?: string },
): Promise<void> {
  const baseCommands = getCandidateGhostscriptCommands(options?.ghostscriptPath)
  const commands =
    process.platform === "win32"
      ? [...baseCommands, ...(await getWindowsInstalledGhostscriptCommands())]
      : baseCommands
  let lastNotFound = false

  for (const command of commands) {
    const result = await new Promise<
      | { ok: true }
      | { ok: false; reason: "NOT_FOUND" }
      | { ok: false; reason: "FAILED"; exitCode: number | null; stderr: string }
    >((resolve) => {
      const child = spawn(command, [...args], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      })

      let stderr = ""
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk) => {
        stderr += chunk
      })

      child.on("error", (error) => {
        const code =
          typeof (error as NodeJS.ErrnoException).code === "string"
            ? (error as NodeJS.ErrnoException).code
            : undefined
        if (code === "ENOENT") {
          resolve({ ok: false, reason: "NOT_FOUND" })
          return
        }

        resolve({
          ok: false,
          reason: "FAILED",
          exitCode: null,
          stderr: error instanceof Error ? error.message : "Ghostscript failed.",
        })
      })

      child.on("close", (exitCode) => {
        if (exitCode === 0) {
          resolve({ ok: true })
          return
        }

        resolve({ ok: false, reason: "FAILED", exitCode, stderr })
      })
    })

    if (result.ok) return

    if (result.reason === "NOT_FOUND") {
      lastNotFound = true
      continue
    }

    const stderrTrimmed = result.stderr.trim()
    throw new PdfCompressError(
      "GHOSTSCRIPT_FAILED",
      "Ghostscript failed to compress the PDF.",
      {
        exitCode: result.exitCode,
        stderr: stderrTrimmed.length > 0 ? stderrTrimmed : undefined,
      },
    )
  }

  if (lastNotFound) {
    throw new PdfCompressError(
      "GHOSTSCRIPT_NOT_FOUND",
      "Ghostscript is not available on this server. Install Ghostscript or set GHOSTSCRIPT_PATH.",
    )
  }
}

export async function compressPdfBuffer(
  pdfBuffer: Uint8Array,
  options?: { preset?: PdfCompressPreset; ghostscriptPath?: string },
): Promise<Buffer> {
  const baseDir = path.join(os.tmpdir(), "pdf-compress")
  await ensureDir(baseDir)

  const { dir } = await createRequestUploadDir(baseDir)
  const inputPath = path.join(dir, "input.pdf")
  const outputPath = path.join(dir, "output.pdf")

  try {
    await fs.writeFile(inputPath, pdfBuffer)

    const preset: PdfCompressPreset = options?.preset ?? "balanced"
    const pdfSettings = getPdfSettings(preset)

    const args = [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-dQUIET",
      "-sDEVICE=pdfwrite",
      `-dPDFSETTINGS=${pdfSettings}`,
      `-sOutputFile=${outputPath}`,
      "-f",
      inputPath,
    ] as const

    await runGhostscript(args, { ghostscriptPath: options?.ghostscriptPath })

    const output = await fs.readFile(outputPath)
    return output
  } finally {
    await cleanupRequestDir(dir)
  }
}
