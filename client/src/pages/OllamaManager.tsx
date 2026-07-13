import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import {
  Cpu, Download, Play, RefreshCw, CheckCircle2, XCircle,
  Loader2, Zap, Info, Server, Brain, X as XIcon,
} from "lucide-react";

const RECOMMENDED_MODELS = [
  { id: "gemma3:8b", label: "Gemma 3 8B", desc: "Google — excellent reasoning, 8B params, ~5GB", tag: "Recommended" },
  { id: "gemma3:4b", label: "Gemma 3 4B", desc: "Google — fast, lightweight, ~2.5GB", tag: "Fast" },
  { id: "qwen2.5:7b", label: "Qwen 2.5 7B", desc: "Alibaba — strong multilingual + code, ~4.5GB", tag: "Multilingual" },
  { id: "qwen2.5:14b", label: "Qwen 2.5 14B", desc: "Alibaba — high accuracy, 14B params, ~9GB", tag: "High Accuracy" },
  { id: "llama3.2:3b", label: "Llama 3.2 3B", desc: "Meta — ultra-fast, minimal RAM, ~2GB", tag: "Lightweight" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B", desc: "Meta — balanced performance, ~5GB", tag: "Balanced" },
  { id: "mistral:7b", label: "Mistral 7B", desc: "Mistral AI — strong instruction following, ~4GB", tag: "Instruction" },
  { id: "phi3.5:3.8b", label: "Phi 3.5 3.8B", desc: "Microsoft — compact but capable, ~2.5GB", tag: "Compact" },
];

export default function OllamaManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [pullModel, setPullModel] = useState("");
  const [testPrompt, setTestPrompt] = useState("Summarize the NSA No Surprises Act in 2 sentences.");
  const [testModel, setTestModel] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // ── Streaming pull state ────────────────────────────────────────────────────
  const [pullProgress, setPullProgress] = useState<{
    active: boolean;
    model: string;
    status: string;
    pct: number | null;
    completed: number;
    total: number;
    error: string | null;
  } | null>(null);
  const pullAbortRef = useRef<AbortController | null>(null);

  const statusQuery = trpc.ollama.status.useQuery(undefined, { refetchInterval: 30_000 });
  const modelsQuery = trpc.ollama.listModels.useQuery(undefined, { refetchInterval: 60_000 });
  const backendQuery = trpc.ollama.activeBackend.useQuery();

  const generateMutation = trpc.ollama.generate.useMutation({
    onSuccess: (data) => setTestResult(data.text),
    onError: (err) => toast.error(`Generation failed: ${err.message}`),
  });

  const handlePull = (modelName?: string) => {
    const target = (modelName ?? pullModel).trim();
    if (!target) return;

    // Abort any existing pull
    if (pullAbortRef.current) pullAbortRef.current.abort();
    const abort = new AbortController();
    pullAbortRef.current = abort;

    setPullProgress({ active: true, model: target, status: "Connecting to Ollama...", pct: null, completed: 0, total: 0, error: null });

    const url = `/api/ollama/pull-stream?model=${encodeURIComponent(target)}`;
    const es = new EventSource(url);

    // EventSource doesn't support AbortController directly — use a flag
    let cancelled = false;
    abort.signal.addEventListener("abort", () => {
      cancelled = true;
      es.close();
      setPullProgress(null);
      toast.info(`Download of ${target} was cancelled.`, {
        description: "The model was not saved. You can restart the download at any time.",
        duration: 4000,
      });
    });

    es.onmessage = (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(event.data) as {
          type: string;
          status?: string;
          pct?: number | null;
          completed?: number;
          total?: number;
          message?: string;
        };
        if (data.type === "progress") {
          setPullProgress(prev => prev ? {
            ...prev,
            status: data.status ?? prev.status,
            pct: data.pct ?? prev.pct,
            completed: data.completed ?? prev.completed,
            total: data.total ?? prev.total,
          } : null);
        } else if (data.type === "done") {
          es.close();
          setPullProgress(null);
          toast.success(`${target} is ready to use!`, {
            description: "The model has been downloaded and is now available for inference.",
            duration: 6000,
          });
          modelsQuery.refetch();
          setPullModel("");
        } else if (data.type === "error") {
          es.close();
          setPullProgress(prev => prev ? { ...prev, error: data.message ?? "Unknown error", active: false } : null);
          toast.error(`Failed to download ${target}`, {
            description: data.message ?? "An unexpected error occurred. Check that Ollama is running and the model name is correct.",
            duration: 8000,
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      if (cancelled) return;
      es.close();
      setPullProgress(prev => prev ? { ...prev, error: "Connection lost", active: false } : null);
      toast.error(`Connection to Ollama lost`, {
        description: `Download of ${target} was interrupted. Ensure Ollama is running and try again.`,
        duration: 8000,
      });
    };
  };

  const handleCancelPull = () => {
    if (pullAbortRef.current) pullAbortRef.current.abort();
  };

  const handleTest = () => {
    if (!testPrompt.trim()) return;
    setTestResult(null);
    generateMutation.mutate({
      prompt: testPrompt,
      model: testModel || undefined,
      systemPrompt: "You are a healthcare IDR compliance expert. Be concise and accurate.",
    });
  };

  const backend = backendQuery.data;
  const isOnline = statusQuery.data?.online;
  const models = modelsQuery.data ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="h-6 w-6 text-primary" />
          Ollama LLM Manager
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage local Ollama models (Gemma3, Qwen2.5, Llama3) for AI-powered IDR features.
          All inference runs locally — no data leaves your infrastructure.
        </p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" /> Ollama Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isOnline ? (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <div className="font-semibold text-green-700 dark:text-green-400">Online</div>
                  {statusQuery.data?.version && (
                    <div className="text-xs text-muted-foreground">v{statusQuery.data.version}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <div className="font-semibold text-destructive">Offline</div>
                  <div className="text-xs text-muted-foreground">Run: ollama serve</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="h-4 w-4" /> Active Backend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {backendQuery.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : backend ? (
              <div>
                <Badge variant={backend.name === "ollama" ? "default" : "secondary"} className="capitalize">
                  {backend.name}
                </Badge>
                <div className="text-xs text-muted-foreground mt-1">{backend.defaultModel}</div>
              </div>
            ) : (
              <Badge variant="destructive">Not configured</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Local Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{models.length}</div>
            <div className="text-xs text-muted-foreground">
              {models.length === 0 ? "No models pulled yet" : `${models.length} model${models.length !== 1 ? "s" : ""} available`}
            </div>
          </CardContent>
        </Card>
      </div>

      {!isOnline && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Ollama is not running. Start it with <code className="bg-muted px-1 rounded text-xs">ollama serve</code> on your machine.
            Download from <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline">ollama.com</a>.
            The platform will fall back to the configured LLM_API_URL or OPENAI_API_KEY if Ollama is unavailable.
          </AlertDescription>
        </Alert>
      )}

      {/* Available models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Locally Available Models</CardTitle>
          <CardDescription>Models pulled to your Ollama instance</CardDescription>
        </CardHeader>
        <CardContent>
          {modelsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading models...
            </div>
          ) : models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models found. Pull a model below to get started.</p>
          ) : (
            <div className="space-y-2">
              {models.map((m) => (
                <div key={m.name} className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Brain className="h-4 w-4 text-primary" />
                    <div>
                      <div className="font-medium text-sm">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {(m.size / 1e9).toFixed(1)} GB · Modified {new Date(m.modified_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Available</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommended models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommended Models for IDR</CardTitle>
          <CardDescription>Optimized for healthcare compliance, reasoning, and document analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {RECOMMENDED_MODELS.map((m) => {
              const isPulled = models.some(local => local.name === m.id || local.name.startsWith(m.id.split(":")[0]));
              return (
                <div key={m.id} className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${isPulled ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "bg-muted/30"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{m.label}</span>
                      <Badge variant="secondary" className="text-xs">{m.tag}</Badge>
                      {isPulled && <Badge variant="outline" className="text-xs text-green-700 border-green-300">Pulled</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{m.desc}</div>
                    <code className="text-xs text-primary">{m.id}</code>
                  </div>
                  {isAdmin && !isPulled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={!!pullProgress?.active}
                      onClick={() => handlePull(m.id)}
                    >
                      {pullProgress?.active && pullProgress.model === m.id
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <Download className="h-3 w-3 mr-1" />}
                      Pull
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pull custom model */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pull Custom Model</CardTitle>
            <CardDescription>Pull any model from the Ollama registry</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="e.g., deepseek-r1:8b, phi4:14b, codellama:7b"
                value={pullModel}
                onChange={e => setPullModel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handlePull()}
                disabled={!!pullProgress?.active}
              />
              <Button onClick={() => handlePull()} disabled={!pullModel.trim() || !!pullProgress?.active}>
                {pullProgress?.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Pull
              </Button>
            </div>
            {/* Real-time pull progress */}
            {pullProgress && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {pullProgress.active
                      ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      : pullProgress.error
                      ? <XCircle className="h-4 w-4 text-destructive" />
                      : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    <span className="text-sm font-medium">{pullProgress.model}</span>
                  </div>
                  {pullProgress.active && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={handleCancelPull}>
                      <XIcon className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{pullProgress.error ?? pullProgress.status}</p>
                {pullProgress.pct !== null && (
                  <div className="space-y-1">
                    <Progress value={pullProgress.pct} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{pullProgress.pct}%</span>
                      {pullProgress.total > 0 && (
                        <span>{(pullProgress.completed / 1024 / 1024).toFixed(0)} / {(pullProgress.total / 1024 / 1024).toFixed(0)} MB</span>
                      )}
                    </div>
                  </div>
                )}
                {pullProgress.pct === null && pullProgress.active && (
                  <Progress value={undefined} className="h-2 animate-pulse" />
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Browse available models at <a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer" className="underline">ollama.com/library</a>
            </p>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Test inference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Play className="h-4 w-4" /> Test Inference
          </CardTitle>
          <CardDescription>Run a test prompt through the active LLM backend</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Model (optional — leave blank to use active backend default)</Label>
            <Input
              placeholder={backend?.defaultModel ?? "e.g., gemma3:8b"}
              value={testModel}
              onChange={e => setTestModel(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Prompt</Label>
            <Textarea
              rows={3}
              value={testPrompt}
              onChange={e => setTestPrompt(e.target.value)}
            />
          </div>
          <Button onClick={handleTest} disabled={!testPrompt.trim() || generateMutation.isPending}>
            {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
            Run Inference
          </Button>
          {testResult && (
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> Response
              </div>
              <p className="text-sm whitespace-pre-wrap">{testResult}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backend priority info */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-800 dark:text-blue-200">
            <Info className="h-4 w-4" /> LLM Backend Priority
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <p><strong>1. Local Ollama</strong> — Set <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">OLLAMA_BASE_URL</code> (default: http://localhost:11434)</p>
          <p><strong>2. OpenAI-compatible API</strong> — Set <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">LLM_API_URL</code> + <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">LLM_API_KEY</code> (vLLM, LM Studio, Groq, Together AI, etc.)</p>
          <p><strong>3. OpenAI</strong> — Set <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">OPENAI_API_KEY</code></p>
          <p className="text-xs mt-2 opacity-80">All AI features (comment summaries, dispute narratives, EMR extraction, USCDI analysis) use this priority chain automatically.</p>
        </CardContent>
      </Card>
    </div>
  );
}
