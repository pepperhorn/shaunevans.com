/**
 * Server-side env read at call time. `import.meta.env.X` is inlined by Vite at
 * build, which freezes secrets into the image (or bakes in "" when absent at
 * build), so the built server must read `process.env` first. Vite's env is the
 * fallback for dev and tests.
 */
export function serverEnv(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}
