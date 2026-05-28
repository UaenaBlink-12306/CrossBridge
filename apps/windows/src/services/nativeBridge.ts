import { invoke } from "@tauri-apps/api/core";

interface TauriInternals {
  invoke?: unknown;
}

interface TauriGlobal {
  __TAURI_INTERNALS__?: TauriInternals;
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & typeof globalThis & TauriGlobal;
  return typeof tauriWindow.__TAURI_INTERNALS__?.invoke === "function";
}

export async function invokeTauriCommand<T>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Tauri command "${command}" is unavailable outside the native runtime.`);
  }

  return invoke<T>(command, args);
}
