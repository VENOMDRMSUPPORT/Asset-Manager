/**
 * use-settings.ts — React Query hooks for VenomGPT Settings API
 *
 * Wraps /api/settings (GET, PATCH, POST reset, DELETE history)
 * using plain fetch via TanStack Query — no generated client needed.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AgentModelInfo {
  modelId: string;
  displayName: string;
  lane: string;
  free: boolean;
}

export interface VenomGPTSettings {
  maxSteps: number;
  commandTimeoutSecs: number;
  showThinkEvents: boolean;
  agentModelOverride: string | null;
  visionModelOverride: string | null;
  historyCapacity: number;
}

export interface ProviderInfo {
  name: string;
  keySet: boolean;
  hasZai: boolean;
  hasReplit: boolean;
  agentModels: AgentModelInfo[];
  visionModels: AgentModelInfo[];
}

export interface HistoryStats {
  count: number;
  filePath: string;
  dataDir: string;
}

export interface SettingsResponse {
  settings: VenomGPTSettings;
  provider: ProviderInfo;
  history: HistoryStats;
}

async function fetchSettings(): Promise<SettingsResponse> {
  const r = await fetch(`${BASE}/api/settings`);
  if (!r.ok) throw new Error(`Settings fetch failed: ${r.status}`);
  return r.json() as Promise<SettingsResponse>;
}

async function patchSettings(patch: Partial<VenomGPTSettings>): Promise<{ settings: VenomGPTSettings }> {
  const r = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error || `Settings update failed: ${r.status}`);
  }
  return r.json() as Promise<{ settings: VenomGPTSettings }>;
}

async function resetSettings(): Promise<{ settings: VenomGPTSettings }> {
  const r = await fetch(`${BASE}/api/settings/reset`, { method: "POST" });
  if (!r.ok) throw new Error(`Settings reset failed: ${r.status}`);
  return r.json() as Promise<{ settings: VenomGPTSettings }>;
}

async function clearHistory(): Promise<void> {
  const r = await fetch(`${BASE}/api/settings/history`, { method: "DELETE" });
  if (!r.ok) throw new Error(`History clear failed: ${r.status}`);
}

export const SETTINGS_QUERY_KEY = ["vgpt-settings"] as const;

export function useGetSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: 10_000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchSettings,
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_QUERY_KEY, (old: SettingsResponse | undefined) =>
        old ? { ...old, settings: data.settings } : undefined
      );
    },
  });
}

export function useResetSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: resetSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}

export function useClearHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearHistory,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    },
  });
}
