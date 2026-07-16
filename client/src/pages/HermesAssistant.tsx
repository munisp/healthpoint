import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bot, Send, Loader2, Sparkles, FileText, TrendingUp, Shield,
  Brain, Newspaper, Star, Zap, Clock, CheckCircle2, AlertTriangle,
  ChevronRight, RotateCcw, Copy, Download, History,
} from "lucide-react";
import { nanoid } from "nanoid";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  latencyMs?: number;
  timestamp: Date;
}

interface CapabilityResult {
  type: string;
  data: Record<string, unknown>;
  latencyMs: number;
  timestamp: Date;
}

// ─── Capability Cards ────────────────────────────────────────────────────────

const CAPABILITIES = [
  {
    id: "narrative",
    icon: FileText,
    title: "Narrative Generation",
    description: "Generate a persuasive IDR submission narrative citing 45 CFR §149.510",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
  },
  {
    id: "simulate",
    icon: TrendingUp,
    title: "Outcome Simulation",
    description: "Predict win/loss probabilities based on dispute parameters and historical data",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  {
    id: "risk",
    icon: Shield,
    title: "Risk Scoring",
    description: "Score dispute risk 0–100 with mitigation recommendations",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
  },
  {
    id: "enrich",
    icon: Brain,
    title: "FHIR Enrichment",
    description: "Extract structured IDR fields from a FHIR R4 bundle",
    color: "text-purple-600",
    bg: "bg-purple-50",
    border: "border-purple-200",
  },
  {
    id: "payer",
    icon: Zap,
    title: "Payer Intelligence",
    description: "Synthesize payer behavior patterns and counter-strategies",
    color: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
  },
  {
    id: "regulatory",
    icon: Newspaper,
    title: "Regulatory Feed",
    description: "Generate curated NSA/IDR regulatory change intelligence",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
  },
  {
    id: "arbitrator",
    icon: Star,
    title: "Arbitrator Scoring",
    description: "Analyze arbitrator decision patterns and calibrate offer strategy",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
  },
];

// ─── Suggested Prompts ──────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  {
    category: "Workflow",
    color: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
    prompts: [
      "What are the NSA IDR deadlines I need to know?",
      "Walk me through the 19-step IDR workflow",
      "What happens if the open negotiation period expires?",
    ],
  },
  {
    category: "Narrative",
    color: "bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100",
    prompts: [
      "Draft a formal IDR narrative for a cardiology claim",
      "How do I cite the QPA in my submission narrative?",
      "What evidence strengthens an IDR narrative?",
    ],
  },
  {
    category: "Strategy",
    color: "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100",
    prompts: [
      "How should I calibrate my opening offer?",
      "What payer tactics should I watch out for?",
      "When is it better to settle vs. proceed to IDR?",
    ],
  },
  {
    category: "Regulatory",
    color: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
    prompts: [
      "What are the latest CMS rule changes affecting IDR?",
      "Explain the QPA methodology under 45 CFR §149.510",
      "What state surprise billing laws override the NSA?",
    ],
  },
  {
    category: "Technical",
    color: "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100",
    prompts: [
      "How does FHIR R4 data get used in dispute enrichment?",
      "What SMART on FHIR scopes are needed for EMR access?",
      "Explain the Da Vinci PAS transaction flow",
    ],
  },
];

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({ disputeId }: { disputeId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hello! I'm **Hermes**, your AI agent for the HealthPoint IDR platform.\n\nI can help you with:\n- Drafting IDR submission narratives\n- Predicting dispute outcomes\n- Scoring dispute risk\n- Analyzing payer behavior\n- Interpreting FHIR/EMR data\n- Tracking regulatory changes\n- Calibrating offers for specific arbitrators\n\nHow can I assist you today?`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => nanoid());
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.hermes.chat.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: nanoid(),
        role: "assistant",
        content: data.reply,
        latencyMs: data.latencyMs,
        timestamp: new Date(),
      }]);
    },
    onError: (err) => {
      toast.error("Hermes error", { description: err.message });
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    setMessages(prev => [...prev, { id: nanoid(), role: "user", content: text, timestamp: new Date() }]);
    setInput("");
    const history = messages
      .filter(m => m.id !== "welcome")
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));
    chatMutation.mutate({ sessionId, message: text, disputeId, history });
  }, [input, chatMutation, messages, sessionId, disputeId]);

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const sendPrompt = useCallback((text: string) => {
    if (chatMutation.isPending) return;
    setMessages(prev => [...prev, { id: nanoid(), role: "user", content: text, timestamp: new Date() }]);
    const history = messages
      .filter(m => m.id !== "welcome")
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));
    chatMutation.mutate({ sessionId, message: text, disputeId, history });
  }, [chatMutation, messages, sessionId, disputeId]);

  const showSuggestions = messages.length === 1 && messages[0].id === "welcome" && !chatMutation.isPending;

  const renderContent = (content: string) => {
    // Basic markdown-like rendering
    return content
      .split("\n")
      .map((line, i) => {
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
        }
        if (line.startsWith("- ")) {
          return <li key={i} className="ml-4 list-disc">{line.slice(2)}</li>;
        }
        if (line === "") return <br key={i} />;
        // Inline bold
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <p key={i}>
            {parts.map((part, j) =>
              j % 2 === 1 ? <strong key={j}>{part}</strong> : part
            )}
          </p>
        );
      });
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-4" ref={scrollRef as React.RefObject<HTMLDivElement>}>
        <div className="space-y-4 pb-2">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                msg.role === "assistant" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {msg.role === "assistant" ? <Bot className="w-4 h-4" /> : "U"}
              </div>
              <div className={`max-w-[80%] group ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col gap-1`}>
                <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "assistant"
                    ? "bg-muted/60 text-foreground rounded-tl-sm"
                    : "bg-blue-600 text-white rounded-tr-sm"
                }`}>
                  <div className="space-y-0.5">{renderContent(msg.content)}</div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs text-muted-foreground">
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {msg.latencyMs && ` · ${(msg.latencyMs / 1000).toFixed(1)}s`}
                  </span>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyMessage(msg.content)}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1 items-center">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {showSuggestions && (
        <div className="border-t px-4 pt-3 pb-1 bg-muted/20">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Suggested prompts — click to ask
          </p>
          <div className="space-y-2">
            {SUGGESTED_PROMPTS.map((group) => (
              <div key={group.category}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{group.category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendPrompt(prompt)}
                      className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition-colors ${group.color}`}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t p-4">
        <div className="flex gap-2">
          <Input
            placeholder="Ask Hermes anything about NSA/IDR..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={chatMutation.isPending}
            className="flex-1"
          />
          <Button onClick={send} disabled={!input.trim() || chatMutation.isPending} size="icon">
            {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Hermes uses GPT-5 · Responses are AI-generated and should be reviewed by a qualified professional
        </p>
      </div>
    </div>
  );
}

// ─── Capability Launcher ──────────────────────────────────────────────────────

function CapabilityLauncher() {
  const [activeCapability, setActiveCapability] = useState<string | null>(null);
  const [result, setResult] = useState<CapabilityResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [disputeId, setDisputeId] = useState("");
  const [narrativeStyle, setNarrativeStyle] = useState<"formal" | "concise" | "detailed">("formal");
  const [fhirBundle, setFhirBundle] = useState("");
  const [payerName, setPayerName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [arbitratorName, setArbitratorName] = useState("");

  const narrativeMutation = trpc.hermes.generateNarrative.useMutation();
  const simulateMutation = trpc.hermes.simulateOutcome.useMutation();
  const riskMutation = trpc.hermes.scoreRisk.useMutation();
  const enrichMutation = trpc.hermes.enrichFromFHIR.useMutation();
  const payerMutation = trpc.hermes.analyzePayerIntelligence.useMutation();
  const regulatoryMutation = trpc.hermes.generateRegulatoryFeed.useMutation();
  const arbitratorMutation = trpc.hermes.scoreArbitrator.useMutation();

  const runCapability = async () => {
    if (!activeCapability) return;
    setLoading(true);
    setResult(null);
    try {
      let data: Record<string, unknown> = {};
      let latencyMs = 0;

      switch (activeCapability) {
        case "narrative": {
          const r = await narrativeMutation.mutateAsync({ disputeId, style: narrativeStyle });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "simulate": {
          const r = await simulateMutation.mutateAsync({ disputeId });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "risk": {
          const r = await riskMutation.mutateAsync({ disputeId });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "enrich": {
          const r = await enrichMutation.mutateAsync({ disputeId, fhirBundle });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "payer": {
          const r = await payerMutation.mutateAsync({ payerName, serviceType });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "regulatory": {
          const r = await regulatoryMutation.mutateAsync({ maxEntries: 8 });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
        case "arbitrator": {
          const r = await arbitratorMutation.mutateAsync({ arbitratorName, serviceType, disputeId: disputeId || undefined });
          data = r as Record<string, unknown>;
          latencyMs = r.latencyMs;
          break;
        }
      }
      setResult({ type: activeCapability, data, latencyMs, timestamp: new Date() });
      toast.success("Hermes completed analysis", { description: `${(latencyMs / 1000).toFixed(1)}s` });
    } catch (err: unknown) {
      toast.error("Hermes error", { description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
    toast.success("Result copied to clipboard");
  };

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hermes-${result.type}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Downloaded");
  };

  const cap = CAPABILITIES.find(c => c.id === activeCapability);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
      {/* Left: Capability Grid */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select a Capability</h3>
        <div className="grid grid-cols-1 gap-2">
          {CAPABILITIES.map(c => {
            const Icon = c.icon;
            const isActive = activeCapability === c.id;
            return (
              <button
                key={c.id}
                onClick={() => { setActiveCapability(c.id); setResult(null); }}
                className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                  isActive
                    ? `${c.bg} ${c.border} border-2`
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className={`mt-0.5 p-1.5 rounded-md ${isActive ? c.bg : "bg-muted"}`}>
                  <Icon className={`w-4 h-4 ${isActive ? c.color : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className={`text-sm font-medium ${isActive ? c.color : ""}`}>{c.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                {isActive && <ChevronRight className={`ml-auto mt-1 w-4 h-4 ${c.color}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Form + Result */}
      <div className="flex flex-col gap-4">
        {!activeCapability && (
          <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground">
            <Sparkles className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">Select a capability to get started</p>
          </div>
        )}

        {activeCapability && (
          <Card className={`border-2 ${cap?.border}`}>
            <CardHeader className="pb-3">
              <CardTitle className={`text-base flex items-center gap-2 ${cap?.color}`}>
                {cap && <cap.icon className="w-4 h-4" />}
                {cap?.title}
              </CardTitle>
              <CardDescription className="text-xs">{cap?.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Dispute ID — shared across most capabilities */}
              {["narrative", "simulate", "risk", "enrich", "arbitrator"].includes(activeCapability) && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Dispute ID</label>
                  <Input
                    placeholder="e.g. disp_abc123"
                    value={disputeId}
                    onChange={e => setDisputeId(e.target.value)}
                    className="mt-1 text-sm"
                  />
                </div>
              )}

              {/* Narrative style */}
              {activeCapability === "narrative" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Style</label>
                  <Select value={narrativeStyle} onValueChange={v => setNarrativeStyle(v as typeof narrativeStyle)}>
                    <SelectTrigger className="mt-1 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="formal">Formal (legal)</SelectItem>
                      <SelectItem value="concise">Concise (brief)</SelectItem>
                      <SelectItem value="detailed">Detailed (comprehensive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* FHIR bundle */}
              {activeCapability === "enrich" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">FHIR R4 Bundle (JSON)</label>
                  <Textarea
                    placeholder='{"resourceType": "Bundle", ...}'
                    value={fhirBundle}
                    onChange={e => setFhirBundle(e.target.value)}
                    className="mt-1 text-xs font-mono h-28"
                  />
                </div>
              )}

              {/* Payer name */}
              {activeCapability === "payer" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Payer Name</label>
                    <Input placeholder="e.g. Aetna, UnitedHealthcare" value={payerName} onChange={e => setPayerName(e.target.value)} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Service Type (optional)</label>
                    <Input placeholder="e.g. Emergency, Radiology" value={serviceType} onChange={e => setServiceType(e.target.value)} className="mt-1 text-sm" />
                  </div>
                </>
              )}

              {/* Arbitrator */}
              {activeCapability === "arbitrator" && (
                <>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Arbitrator Name</label>
                    <Input placeholder="e.g. Dr. Jane Smith" value={arbitratorName} onChange={e => setArbitratorName(e.target.value)} className="mt-1 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Service Type (optional)</label>
                    <Input placeholder="e.g. Emergency, Surgery" value={serviceType} onChange={e => setServiceType(e.target.value)} className="mt-1 text-sm" />
                  </div>
                </>
              )}

              <Button
                onClick={runCapability}
                disabled={loading}
                className="w-full"
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running Hermes...</>
                  : <><Sparkles className="w-4 h-4 mr-2" />Run Analysis</>
                }
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {result && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Result
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    {(result.latencyMs / 1000).toFixed(1)}s
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={copyResult}>
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={downloadResult}>
                    <Download className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setResult(null)}>
                    <RotateCcw className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResultRenderer type={result.type} data={result.data} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Result Renderer ──────────────────────────────────────────────────────────

function ResultRenderer({ type, data }: { type: string; data: Record<string, unknown> }) {
  if (type === "narrative") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Generated Narrative</p>
        <div className="bg-muted/40 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
          {data.narrative as string}
        </div>
      </div>
    );
  }

  if (type === "simulate") {
    const providerWin = data.providerWinPct as number;
    const payerWin = data.payerWinPct as number;
    const split = data.splitPct as number;
    const withdrawn = data.withdrawnPct as number;
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Provider Wins", pct: providerWin, color: "bg-emerald-500" },
            { label: "Payer Wins", pct: payerWin, color: "bg-red-500" },
            { label: "Split", pct: split, color: "bg-amber-500" },
            { label: "Withdrawn", pct: withdrawn, color: "bg-slate-400" },
          ].map(item => (
            <div key={item.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-semibold">{item.pct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${item.color} rounded-full`} style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
        <Separator />
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Basis</p>
          <p className="text-xs text-foreground">{data.basis as string}</p>
        </div>
        {(data.keyFactors as string[])?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Key Factors</p>
            <ul className="space-y-0.5">
              {(data.keyFactors as string[]).map((f, i) => (
                <li key={i} className="text-xs flex gap-1.5">
                  <span className="text-muted-foreground">•</span>{f}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <p className="text-xs font-medium text-blue-700">Recommended Action</p>
          <p className="text-xs text-blue-600 mt-0.5">{data.recommendedAction as string}</p>
        </div>
      </div>
    );
  }

  if (type === "risk") {
    const level = data.riskLevel as string;
    const score = data.riskScore as number;
    const colorMap: Record<string, string> = {
      low: "text-emerald-600 bg-emerald-50 border-emerald-200",
      medium: "text-amber-600 bg-amber-50 border-amber-200",
      high: "text-orange-600 bg-orange-50 border-orange-200",
      critical: "text-red-600 bg-red-50 border-red-200",
    };
    return (
      <div className="space-y-3">
        <div className={`flex items-center justify-between p-3 rounded-lg border ${colorMap[level] ?? ""}`}>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide">Risk Level</p>
            <p className="text-2xl font-bold">{score}/100</p>
          </div>
          <Badge className={`uppercase ${colorMap[level]}`}>{level}</Badge>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Risk Factors</p>
          <ul className="space-y-0.5">
            {(data.riskFactors as string[]).map((f, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />{f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Mitigation Steps</p>
          <ul className="space-y-0.5">
            {(data.mitigationSteps as string[]).map((s, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />{s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (type === "payer") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Acceptance Rate</p>
            <p className="text-xl font-bold text-emerald-600">{data.estimatedAcceptanceRate as number}%</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Avg Rounds</p>
            <p className="text-xl font-bold text-blue-600">{data.avgRoundsToAccept as number}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Behavior Summary</p>
          <p className="text-xs">{data.behaviorSummary as string}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Known Tactics</p>
          <ul className="space-y-0.5">
            {(data.knownTactics as string[]).map((t, i) => (
              <li key={i} className="text-xs flex gap-1.5"><span className="text-muted-foreground">•</span>{t}</li>
            ))}
          </ul>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <p className="text-xs font-medium text-blue-700">Counter-Strategy</p>
          <p className="text-xs text-blue-600 mt-0.5">{data.recommendedCounterStrategy as string}</p>
        </div>
      </div>
    );
  }

  if (type === "regulatory") {
    const entries = (data.entries as Array<Record<string, unknown>>) ?? [];
    const impactColor: Record<string, string> = {
      low: "bg-slate-100 text-slate-700",
      medium: "bg-amber-100 text-amber-700",
      high: "bg-orange-100 text-orange-700",
      critical: "bg-red-100 text-red-700",
    };
    return (
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {entries.map((e, i) => (
          <div key={i} className="border rounded-lg p-2 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium leading-tight">{e.title as string}</p>
              <Badge className={`text-xs flex-shrink-0 ${impactColor[e.impactLevel as string] ?? ""}`}>
                {e.impactLevel as string}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{e.summary as string}</p>
            <p className="text-xs text-blue-600">{e.source as string}</p>
          </div>
        ))}
      </div>
    );
  }

  if (type === "arbitrator") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className="text-xl font-bold text-emerald-600">{data.providerWinRate as number}%</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Avg Award</p>
            <p className="text-lg font-bold text-blue-600">${(data.avgAwardAmount as number).toLocaleString()}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-2 text-center">
            <p className="text-xs text-muted-foreground">Avg Days</p>
            <p className="text-xl font-bold">{data.avgDecisionDays as number}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Decision Tendency</p>
          <p className="text-xs">{data.decisionTendency as string}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <p className="text-xs font-medium text-blue-700">Offer Calibration Advice</p>
          <p className="text-xs text-blue-600 mt-0.5">{data.offerCalibrationAdvice as string}</p>
        </div>
      </div>
    );
  }

  // Generic JSON fallback
  return (
    <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-auto max-h-64">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// ─── Job History Panel ────────────────────────────────────────────────────────

function JobHistoryPanel() {
  const { data: jobs, isLoading } = trpc.hermes.listJobs.useQuery({ limit: 30 });

  const typeLabel: Record<string, string> = {
    narrative_generation: "Narrative",
    outcome_simulation: "Simulation",
    fhir_enrichment: "FHIR Enrichment",
    risk_scoring: "Risk Score",
    payer_intelligence: "Payer Intel",
    regulatory_feed: "Regulatory",
    arbitrator_scoring: "Arbitrator",
    chat: "Chat",
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!jobs?.length) return (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
      <History className="w-10 h-10 mb-2 opacity-30" />
      <p className="text-sm">No Hermes jobs yet</p>
    </div>
  );

  return (
    <div className="p-4 space-y-2">
      {jobs.map(job => (
        <div key={job.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${job.status === "complete" ? "bg-emerald-500" : job.status === "failed" ? "bg-red-500" : "bg-amber-500"}`} />
            <div>
              <p className="text-sm font-medium">{typeLabel[job.jobType] ?? job.jobType}</p>
              <p className="text-xs text-muted-foreground">
                {job.disputeId ? `Dispute: ${job.disputeId.slice(0, 12)}...` : "No dispute"} ·{" "}
                {job.createdAt ? new Date(job.createdAt).toLocaleString() : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {job.latencyMs && (
              <Badge variant="outline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" />
                {(job.latencyMs / 1000).toFixed(1)}s
              </Badge>
            )}
            <Badge variant={job.status === "complete" ? "default" : "destructive"} className="text-xs">
              {job.status}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HermesAssistant() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("chat");

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              Hermes AI Agent
              <Badge className="bg-white/20 text-white border-white/30 text-xs">GPT-5</Badge>
            </h1>
            <p className="text-xs text-blue-100">NSA/IDR Intelligence Platform · 8 Capabilities</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="bg-white/10 border-white/30 text-white hover:bg-white/20" onClick={() => setLocation("/disputes")}>
            View Disputes
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-6 mt-4 w-fit">
          <TabsTrigger value="chat" className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5" />Chat
          </TabsTrigger>
          <TabsTrigger value="capabilities" className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />Capabilities
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />Job History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 overflow-hidden mt-0 border-0">
          <ChatPanel />
        </TabsContent>

        <TabsContent value="capabilities" className="flex-1 overflow-auto mt-0 border-0">
          <CapabilityLauncher />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-auto mt-0 border-0">
          <JobHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
