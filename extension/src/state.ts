import type { Plan } from "@cartsmith/core";

/** Persisted run state — the single source of truth shared between the SW and the popup. */
export interface RunState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  plan: Plan | null;
  unresolved: string[];
  notes: string[];
  error: string | null;
  updatedAt: number;
}

/** Persisted form inputs, so the popup restores exactly what you typed. */
export interface Inputs {
  deck: string;
  maxSellers: number;
  condNM: boolean;
  condLP: boolean;
}

export const STATE_KEY = "cartsmith:state";
export const INPUTS_KEY = "cartsmith:inputs";

export const emptyState = (): RunState => ({
  status: "idle",
  progress: "",
  plan: null,
  unresolved: [],
  notes: [],
  error: null,
  updatedAt: 0,
});

export async function getState(): Promise<RunState> {
  const o = await chrome.storage.local.get(STATE_KEY);
  return (o[STATE_KEY] as RunState) ?? emptyState();
}

export async function setState(patch: Partial<RunState>): Promise<RunState> {
  const cur = await getState();
  const next: RunState = { ...cur, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

export async function getInputs(): Promise<Inputs | null> {
  const o = await chrome.storage.local.get(INPUTS_KEY);
  return (o[INPUTS_KEY] as Inputs) ?? null;
}

export async function saveInputs(inputs: Inputs): Promise<void> {
  await chrome.storage.local.set({ [INPUTS_KEY]: inputs });
}

export interface OptimizeParams {
  deck: string;
  maxSellers: number;
  conditions: string[];
}

export const MSG_OPTIMIZE = "CS_OPTIMIZE";
