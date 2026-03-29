import { useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowLeft, Settings2, Cpu, Database, Activity, RotateCcw,
  Trash2, CheckCircle2, AlertCircle, Info, Zap, Eye, EyeOff,
  ChevronRight, Server, Lock
} from 'lucide-react';
import {
  useGetSettings, useUpdateSetting, useResetSettings, useClearHistory,
  type VenomGPTSettings,
} from '@/hooks/use-settings';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-panel-border">
        <Icon className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  label, description, children, badge,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-panel-border/40 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {badge && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-primary/40 text-primary">
              {badge}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="shrink-0 flex items-center">
        {children}
      </div>
    </div>
  );
}

function ReadOnlyValue({ value, mono = false }: { value: string; mono?: boolean }) {
  return (
    <span className={`text-sm text-muted-foreground ${mono ? 'font-mono text-xs bg-muted/40 px-2 py-0.5 rounded' : ''}`}>
      {value}
    </span>
  );
}

function SliderSetting({
  value, min, max, step = 1, onChange, format,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const label = format ? format(value) : String(value);
  return (
    <div className="flex items-center gap-3 w-56">
      <Slider
        min={min} max={max} step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="text-sm font-mono text-foreground w-14 text-right tabular-nums">{label}</span>
    </div>
  );
}

function SelectSetting({
  value, options, onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-sm bg-background border border-panel-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-52"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ConfirmButton({
  label, confirmLabel, variant = 'danger', icon: Icon, onConfirm, disabled,
}: {
  label: string; confirmLabel: string;
  variant?: 'danger' | 'warning';
  icon: React.ElementType;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  const base = variant === 'danger'
    ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
    : 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10';

  const confirm = base.replace('hover:', '').replace('/10', '/20') + ' ring-1 ring-offset-0';

  if (confirming) {
    return (
      <div className="flex gap-2">
        <button
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try { await onConfirm(); } finally { setRunning(false); setConfirming(false); }
          }}
          className={`text-xs px-3 py-1.5 border rounded flex items-center gap-1.5 transition-colors ${confirm}`}
        >
          <Icon className="w-3.5 h-3.5" />
          {running ? 'Working…' : confirmLabel}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs px-3 py-1.5 border border-panel-border rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      disabled={disabled}
      onClick={() => setConfirming(true)}
      className={`text-xs px-3 py-1.5 border rounded flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${base}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ─── Model table ─────────────────────────────────────────────────────────────

function ModelTable({ models }: { models: { modelId: string; displayName: string; lane: string; free: boolean }[] }) {
  return (
    <div className="rounded border border-panel-border overflow-hidden text-xs">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/30 border-b border-panel-border">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Model</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Lane</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Tier</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={m.modelId} className={i % 2 === 0 ? '' : 'bg-muted/10'}>
              <td className="px-3 py-2 font-mono text-foreground">{m.modelId}</td>
              <td className="px-3 py-2 text-muted-foreground capitalize">{m.lane}</td>
              <td className="px-3 py-2 text-right">
                {m.free
                  ? <span className="text-green-500/80">free</span>
                  : <span className="text-muted-foreground/60">paid</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useGetSettings();
  const { mutate: update, isPending: isSaving } = useUpdateSetting();
  const { mutateAsync: reset } = useResetSettings();
  const { mutateAsync: clearHist } = useClearHistory();

  const s = data?.settings;
  const provider = data?.provider;
  const history = data?.history;

  // Debounced update helper — fires immediately so sliders feel responsive
  const set = useCallback(<K extends keyof VenomGPTSettings>(key: K, value: VenomGPTSettings[K]) => {
    update({ [key]: value } as Partial<VenomGPTSettings>);
  }, [update]);

  const agentModelOptions = [
    { label: 'Auto (recommended)', value: '' },
    ...(provider?.agentModels ?? []).map(m => ({
      label: `${m.modelId}${m.free ? ' (free)' : ''}`,
      value: m.modelId,
    })),
  ];

  const visionModelOptions = [
    { label: 'Auto (recommended)', value: '' },
    ...(provider?.visionModels ?? []).map(m => ({
      label: `${m.modelId}${m.free ? ' (free)' : ''}`,
      value: m.modelId,
    })),
  ];

  const historyCapOptions = [25, 50, 100, 200].map(n => ({ label: `${n} tasks`, value: String(n) }));

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="h-12 bg-panel border-b border-panel-border flex items-center gap-4 px-4 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to IDE</span>
        </button>
        <div className="w-px h-5 bg-panel-border" />
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Settings2 className="w-4 h-4 text-primary" />
          <span>Settings</span>
        </div>
        {isSaving && (
          <span className="ml-auto text-xs text-muted-foreground animate-pulse">Saving…</span>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">

          {isLoading && (
            <div className="text-sm text-muted-foreground animate-pulse">Loading settings…</div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to load settings — is the API server running?
            </div>
          )}

          {s && (
            <>
              {/* ── 1. Agent Execution ─────────────────────────────────────── */}
              <Section title="Agent Execution" icon={Zap}>

                <SettingRow
                  label="Max Steps"
                  description="Maximum number of action turns per task. Higher = more complex tasks, longer runtime, higher cost."
                  badge="functional"
                >
                  <SliderSetting
                    value={s.maxSteps}
                    min={5} max={50}
                    onChange={v => set('maxSteps', v)}
                    format={v => `${v} steps`}
                  />
                </SettingRow>

                <SettingRow
                  label="Command Timeout"
                  description="Default time limit for each shell command the agent runs. The agent may request a shorter timeout; this is the ceiling."
                  badge="functional"
                >
                  <SliderSetting
                    value={s.commandTimeoutSecs}
                    min={30} max={300} step={15}
                    onChange={v => set('commandTimeoutSecs', v)}
                    format={v => `${v}s`}
                  />
                </SettingRow>

                <SettingRow
                  label="Show Thought Events"
                  description="Display the agent's [PLANNING], [INSPECTING], and [EDITING] reasoning steps in the output panel. Disable for a cleaner output view that shows only actions and results."
                  badge="functional"
                >
                  <div className="flex items-center gap-2">
                    {s.showThinkEvents
                      ? <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
                    <Switch
                      checked={s.showThinkEvents}
                      onCheckedChange={v => set('showThinkEvents', v)}
                    />
                  </div>
                </SettingRow>

              </Section>

              {/* ── 2. AI Model ────────────────────────────────────────────── */}
              <Section title="AI Model" icon={Cpu}>

                <SettingRow
                  label="Provider"
                  description="Determined by environment — set ZAI_API_KEY for Z.AI or configure the Replit AI integration for OpenAI."
                >
                  <div className="flex items-center gap-2">
                    {provider?.keySet
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <AlertCircle className="w-4 h-4 text-destructive" />}
                    <ReadOnlyValue value={provider?.name ?? '—'} />
                  </div>
                </SettingRow>

                <SettingRow
                  label="Primary Model"
                  description="Model used for coding and agentic tasks. Auto follows the GLM-5.1 → GLM-5 → GLM-4.7 → GLM-4.7-Flash fallback chain. Pin only if you need to test a specific model."
                  badge="functional"
                >
                  <SelectSetting
                    value={s.agentModelOverride ?? ''}
                    options={agentModelOptions}
                    onChange={v => set('agentModelOverride', v || null)}
                  />
                </SettingRow>

                <SettingRow
                  label="Vision Model"
                  description="Model used to analyze screenshots. Auto tries GLM-4.6V then falls back to GLM-4.6V-Flash (free). Pin only to force the flash model for cost savings."
                  badge="functional"
                >
                  <SelectSetting
                    value={s.visionModelOverride ?? ''}
                    options={visionModelOptions}
                    onChange={v => set('visionModelOverride', v || null)}
                  />
                </SettingRow>

                {/* Model registry table — informational */}
                {provider && (
                  <div className="space-y-3 pt-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Available coding models
                    </p>
                    <ModelTable models={provider.agentModels} />
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <Info className="w-3.5 h-3.5" /> Available vision models
                    </p>
                    <ModelTable models={provider.visionModels} />
                  </div>
                )}

                {/* Deferred settings — shown honestly */}
                <div className="rounded border border-panel-border/40 bg-muted/10 px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="w-3.5 h-3.5" />
                    <span className="font-medium">Deferred settings</span>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    Temperature, context-window size, and per-request token budgets are not
                    yet operator-configurable — they are tuned per intent type (fix, improve,
                    describe) to maintain agent reliability. These will be exposed in a future
                    settings pass once per-intent calibration is complete.
                  </p>
                </div>

              </Section>

              {/* ── 3. History & Data ──────────────────────────────────────── */}
              <Section title="History & Data" icon={Database}>

                <SettingRow
                  label="History Capacity"
                  description="Maximum number of completed tasks to retain in history.json. Older tasks are trimmed when the limit is exceeded. Changes take effect on the next task completion."
                  badge="functional"
                >
                  <SelectSetting
                    value={String(s.historyCapacity)}
                    options={historyCapOptions}
                    onChange={v => set('historyCapacity', Number(v))}
                  />
                </SettingRow>

                <SettingRow
                  label="Tasks Stored"
                  description="Number of task records currently in history."
                >
                  <ReadOnlyValue value={String(history?.count ?? '—')} />
                </SettingRow>

                <SettingRow
                  label="Storage Location"
                  description="Path to the history file on disk."
                >
                  <ReadOnlyValue value={history?.filePath ?? '—'} mono />
                </SettingRow>

                <SettingRow
                  label="Clear History"
                  description="Permanently delete all task history from disk and memory. Running tasks are unaffected."
                  badge="functional"
                >
                  <ConfirmButton
                    label="Clear History"
                    confirmLabel="Yes, clear all"
                    icon={Trash2}
                    onConfirm={clearHist}
                    disabled={history?.count === 0}
                  />
                </SettingRow>

              </Section>

              {/* ── 4. Diagnostics ─────────────────────────────────────────── */}
              <Section title="Diagnostics" icon={Activity}>

                <SettingRow label="API Key" description="Whether a valid API key is configured in the environment.">
                  <div className="flex items-center gap-2">
                    {provider?.keySet
                      ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                      : <AlertCircle className="w-4 h-4 text-destructive" />}
                    <ReadOnlyValue value={provider?.keySet ? 'Set' : 'Not configured'} />
                  </div>
                </SettingRow>

                <SettingRow label="Data Directory" description="Root directory for all VenomGPT state files (settings.json, history.json).">
                  <ReadOnlyValue value={history?.dataDir ?? '~/.venomgpt'} mono />
                </SettingRow>

                <SettingRow label="Lane Architecture" description="Z.AI uses two API lanes: PAAS (OpenAI-compatible, vision + free models) and Anthropic (Anthropic-compatible, GLM-5 family).">
                  <ReadOnlyValue value={provider?.hasZai ? 'PAAS + Anthropic' : 'Single lane'} />
                </SettingRow>

              </Section>

              {/* ── Reset all ─────────────────────────────────────────────── */}
              <div className="flex items-center justify-between pt-4 pb-8 border-t border-panel-border">
                <div>
                  <p className="text-sm font-medium text-foreground">Reset all settings</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Restore every setting to its factory default. Task history is not affected.</p>
                </div>
                <ConfirmButton
                  label="Reset to defaults"
                  confirmLabel="Yes, reset all"
                  variant="warning"
                  icon={RotateCcw}
                  onConfirm={async () => { await reset(); }}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
