import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Bot, Send, Upload, FileText, CheckCircle2, AlertTriangle,
  Loader2, Brain, Sparkles, Scale, ChevronRight, Info,
  MessageSquare, ClipboardList, Shield, Zap, RotateCcw,
  ExternalLink, Copy, Download
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  suggestedActions?: string[];
  confidence?: "high" | "medium" | "low";
  toolsUsed?: string[];
  timestamp: Date;
}

interface DocAnalysisResult {
  documentType: string;
  extractedFields: Record<string, string | number | null>;
  validationIssues: string[];
  eligibilityFlags: string[];
  confidenceScore: number;
  summary: string;
  suggestedAction: string;
  networkStatus?: string;
  processingTimeSeconds?: number;
  agentTrace?: string[];
}

interface CMSResult {
  eligibility: {
    isEligible: boolean;
    eligibilityReason: string;
    missingRequirements: string[];
    warnings: string[];
    estimatedDeadline: string | null;
    regulatoryBasis?: string[];
  };
  draft: {
    formFields: Record<string, string>;
    attachmentChecklist: Array<{ item: string; status: string; required?: boolean }>;
    submissionNarrative: string;
    regulatoryBasis: string[];
    estimatedOutcome: string;
    nextSteps: string[];
  };
  processingTimeSeconds?: number;
  agentTrace?: string[];
}

// ─── Suggested questions ──────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "What is the deadline to initiate IDR after open negotiation fails?",
  "How is the Qualifying Payment Amount (QPA) calculated?",
  "What factors can an IDR entity consider beyond the QPA?",
  "What are the current CMS administrative fees for IDR?",
  "Can I batch multiple disputes together? What are the rules?",
  "What are my appeal rights after an IDR determination?",
  "What documents are required for a CMS IDR portal submission?",
  "What is the difference between emergency and non-emergency IDR disputes?",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIAssistant() {
  const { isAuthenticated } = useAuth();

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hello! I'm the IDR AI Assistant powered by LangGraph and LangChain. I can help you with NSA IDR questions, analyze uploaded documents, and generate CMS submission drafts. What can I help you with today?",
      sources: [],
      suggestedActions: ["Analyze a document", "Generate a CMS submission draft", "Ask about IDR deadlines"],
      confidence: "high",
      timestamp: new Date(),
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [selectedDisputeId, setSelectedDisputeId] = useState<string>("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Document analysis state
  const [docText, setDocText] = useState("");
  const [docType, setDocType] = useState("");
  const [docResult, setDocResult] = useState<DocAnalysisResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CMS submission state
  const [cmsDisputeId, setCmsDisputeId] = useState("");
  const [cmsContext, setCmsContext] = useState("");
  const [cmsResult, setCmsResult] = useState<CMSResult | null>(null);

  // Service health
  const { data: serviceHealth } = trpc.ai.serviceHealth.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const { data: agentInfo } = trpc.ai.agentInfo.useQuery();

  // Disputes for context selector
  const { data: disputesData } = trpc.disputes.list.useQuery({ limit: 50 });

  // Mutations
  const askMutation = trpc.ai.askAssistant.useMutation({
    onSuccess: (data: any) => {
      const msg: ChatMessage = {
        role: "assistant",
        content: data.answer || "I was unable to generate a response.",
        sources: data.sources || [],
        suggestedActions: data.suggestedActions || [],
        confidence: data.confidence || "medium",
        toolsUsed: data.toolsUsed || [],
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
    },
    onError: (err) => {
      toast.error(`Assistant error: ${err.message}`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I encountered an error. Please try again or check if the AI service is running.",
          timestamp: new Date(),
        },
      ]);
    },
  });

  const analyzeDocMutation = trpc.ai.analyzeDocument.useMutation({
    onSuccess: (data: any) => {
      setDocResult(data as DocAnalysisResult);
      toast.success("Document analyzed successfully");
    },
    onError: (err) => toast.error(`Analysis failed: ${err.message}`),
  });

  const cmsMutation = trpc.ai.generateCMSSubmission.useMutation({
    onSuccess: (data: any) => {
      setCmsResult(data as CMSResult);
      toast.success("CMS submission draft generated");
    },
    onError: (err) => toast.error(`CMS generation failed: ${err.message}`),
  });

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = useCallback(() => {
    if (!chatInput.trim() || askMutation.isPending) return;
    const question = chatInput.trim();
    setChatInput("");

    const userMsg: ChatMessage = { role: "user", content: question, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);

    const history = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    askMutation.mutate({
      question,
      disputeId: selectedDisputeId || undefined,
      conversationHistory: history,
    });
  }, [chatInput, askMutation, messages, selectedDisputeId]);

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setDocText(text.slice(0, 50000));
      // Infer type from filename
      const name = file.name.toLowerCase();
      if (name.includes("eob") || name.includes("explanation")) setDocType("Explanation of Benefits");
      else if (name.includes("qpa")) setDocType("QPA Documentation");
      else if (name.includes("contract")) setDocType("Provider Contract");
      else if (name.includes("auth")) setDocType("Prior Authorization");
      else setDocType("");
      toast.info(`File loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, [handleFileUpload]);

  const confidenceColor = (c?: string) => {
    if (c === "high") return "text-green-600 bg-green-50 border-green-200";
    if (c === "medium") return "text-yellow-600 bg-yellow-50 border-yellow-200";
    return "text-red-600 bg-red-50 border-red-200";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <Brain className="mx-auto mb-2 text-primary" size={40} />
            <CardTitle>AI Assistant</CardTitle>
            <CardDescription>Sign in to access the IDR AI Assistant</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-4 gap-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <Brain className="text-primary" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">IDR AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Powered by LangGraph · LangChain · FastAPI
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {serviceHealth && (
            <Badge
              variant="outline"
              className={serviceHealth.available ? "text-green-600 border-green-300 bg-green-50" : "text-red-600 border-red-300 bg-red-50"}
            >
              {serviceHealth.available ? (
                <><CheckCircle2 size={12} className="mr-1" />AI Service Online</>
              ) : (
                <><AlertTriangle size={12} className="mr-1" />AI Service Offline</>
              )}
            </Badge>
          )}
          {(agentInfo as any)?.agents?.map((a: any) => (
            <Badge key={a.name} variant="secondary" className="text-xs hidden sm:flex">
              <Zap size={10} className="mr-1" />{a.name.replace("Agent", "")}
            </Badge>
          ))}
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <MessageSquare size={14} />Chat Assistant
          </TabsTrigger>
          <TabsTrigger value="analyze" className="flex items-center gap-2">
            <FileText size={14} />Document Analysis
          </TabsTrigger>
          <TabsTrigger value="cms" className="flex items-center gap-2">
            <ClipboardList size={14} />CMS Submission
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-2">
            <Sparkles size={14} />Agent Info
          </TabsTrigger>
        </TabsList>

        {/* ── Chat Tab ──────────────────────────────────────────────────────── */}
        <TabsContent value="chat" className="flex-1 flex flex-col gap-3 min-h-0 mt-3">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 flex-1 min-h-0">
            {/* Sidebar */}
            <div className="lg:col-span-1 flex flex-col gap-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Scale size={14} />Dispute Context
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <select
                    className="w-full text-xs border rounded p-2 bg-background"
                    value={selectedDisputeId}
                    onChange={(e) => setSelectedDisputeId(e.target.value)}
                  >
                    <option value="">No dispute context</option>
                    {(disputesData?.items || []).map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.referenceNumber} — {d.serviceType?.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  {selectedDisputeId && (
                    <p className="text-xs text-muted-foreground mt-1">
                      AI answers will be tailored to this dispute
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Suggested Questions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => setChatInput(q)}
                      className="text-left text-xs p-2 rounded hover:bg-accent transition-colors border border-transparent hover:border-border"
                    >
                      <ChevronRight size={10} className="inline mr-1 text-muted-foreground" />
                      {q}
                    </button>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Chat area */}
            <div className="lg:col-span-3 flex flex-col gap-3 min-h-0">
              <Card className="flex-1 flex flex-col min-h-0">
                <ScrollArea className="flex-1 p-4" style={{ height: "420px" }}>
                  <div className="flex flex-col gap-4">
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                        }`}>
                          {msg.role === "user" ? "U" : <Bot size={16} />}
                        </div>
                        <div className={`flex flex-col gap-1 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-tr-sm"
                              : "bg-muted rounded-tl-sm"
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>

                          {/* Metadata for assistant messages */}
                          {msg.role === "assistant" && (
                            <div className="flex flex-col gap-1 w-full">
                              {msg.confidence && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className={`text-xs ${confidenceColor(msg.confidence)}`}>
                                    <Shield size={10} className="mr-1" />
                                    {msg.confidence} confidence
                                  </Badge>
                                  {(msg.toolsUsed || []).map((t) => (
                                    <Badge key={t} variant="outline" className="text-xs text-blue-600 bg-blue-50 border-blue-200">
                                      <Zap size={10} className="mr-1" />{t.replace("lookup_", "").replace(/_/g, " ")}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {(msg.sources || []).length > 0 && (
                                <div className="text-xs text-muted-foreground">
                                  <span className="font-medium">Sources: </span>
                                  {msg.sources!.join(" · ")}
                                </div>
                              )}
                              {(msg.suggestedActions || []).length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {msg.suggestedActions!.map((a) => (
                                    <button
                                      key={a}
                                      onClick={() => setChatInput(a)}
                                      className="text-xs px-2 py-1 rounded-full border hover:bg-accent transition-colors"
                                    >
                                      {a}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {msg.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}

                    {askMutation.isPending && (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Bot size={16} className="text-primary" />
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">Thinking with LangGraph ReAct...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>

                <Separator />
                <div className="p-3 flex gap-2">
                  <Textarea
                    placeholder="Ask about NSA IDR deadlines, QPA, batching rules, appeal rights..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    className="min-h-[60px] resize-none"
                    disabled={askMutation.isPending}
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleSendMessage}
                      disabled={!chatInput.trim() || askMutation.isPending}
                      size="icon"
                      className="h-10 w-10"
                    >
                      {askMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => setMessages([messages[0]])}
                      title="Clear chat"
                    >
                      <RotateCcw size={14} />
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── Document Analysis Tab ─────────────────────────────────────────── */}
        <TabsContent value="analyze" className="mt-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Input */}
            <div className="flex flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload size={18} />Upload or Paste Document
                  </CardTitle>
                  <CardDescription>
                    Supports EOB, QPA documentation, contracts, medical records, and more.
                    The DocumentAnalysisAgent (LangGraph) will classify, validate, and summarize.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {/* Drop zone */}
                  <div
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                      isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/30"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">Drop a file here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">TXT, PDF (text-based), or any text file</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.pdf,.csv,.json"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                    />
                  </div>

                  <div className="text-center text-xs text-muted-foreground">— or paste document text —</div>

                  <Input
                    placeholder="Document type hint (optional, e.g. 'Explanation of Benefits')"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  />

                  <Textarea
                    placeholder="Paste document text here (up to 50,000 characters)..."
                    value={docText}
                    onChange={(e) => setDocText(e.target.value)}
                    className="min-h-[200px] font-mono text-xs"
                  />

                  <Button
                    onClick={() => analyzeDocMutation.mutate({
                      documentText: docText,
                      documentType: docType || undefined,
                    })}
                    disabled={!docText.trim() || analyzeDocMutation.isPending}
                    className="w-full"
                  >
                    {analyzeDocMutation.isPending ? (
                      <><Loader2 size={14} className="mr-2 animate-spin" />Running DocumentAnalysisAgent...</>
                    ) : (
                      <><Brain size={14} className="mr-2" />Analyze with LangGraph</>
                    )}
                  </Button>

                  {analyzeDocMutation.isPending && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Agent trace: classify → validate → summarize</span>
                      </div>
                      <Progress value={undefined} className="h-1 animate-pulse" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Results */}
            <div className="flex flex-col gap-3">
              {docResult ? (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-green-500" />
                          {docResult.documentType}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={confidenceColor(
                            docResult.confidenceScore >= 70 ? "high" : docResult.confidenceScore >= 40 ? "medium" : "low"
                          )}>
                            {docResult.confidenceScore}% confidence
                          </Badge>
                          {docResult.processingTimeSeconds && (
                            <Badge variant="secondary" className="text-xs">
                              {docResult.processingTimeSeconds}s
                            </Badge>
                          )}
                        </div>
                      </div>
                      {docResult.agentTrace && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          {docResult.agentTrace.map((node, i) => (
                            <span key={node} className="flex items-center gap-1">
                              <Badge variant="outline" className="text-xs py-0">{node}</Badge>
                              {i < docResult.agentTrace!.length - 1 && <ChevronRight size={10} />}
                            </span>
                          ))}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{docResult.summary}</p>

                      {/* Extracted fields */}
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Extracted Fields</h4>
                        <div className="grid grid-cols-2 gap-1">
                          {Object.entries(docResult.extractedFields || {}).map(([k, v]) => v != null && (
                            <div key={k} className="flex flex-col bg-muted/50 rounded p-2">
                              <span className="text-xs text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                              <span className="text-xs font-medium">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Validation issues */}
                      {docResult.validationIssues.length > 0 && (
                        <Alert variant="destructive" className="py-2">
                          <AlertTriangle size={14} />
                          <AlertDescription>
                            <p className="font-medium text-xs mb-1">Validation Issues</p>
                            <ul className="text-xs space-y-0.5">
                              {docResult.validationIssues.map((issue, i) => (
                                <li key={i}>• {issue}</li>
                              ))}
                            </ul>
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Eligibility flags */}
                      {docResult.eligibilityFlags.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                            <Info size={12} />IDR Eligibility Flags
                          </p>
                          <ul className="text-xs text-blue-700 space-y-0.5">
                            {docResult.eligibilityFlags.map((flag, i) => (
                              <li key={i}>• {flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Suggested action */}
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-xs font-semibold text-green-700 mb-1">Suggested Action</p>
                        <p className="text-xs text-green-700">{docResult.suggestedAction}</p>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="flex-1 flex items-center justify-center min-h-[300px]">
                  <div className="text-center text-muted-foreground p-8">
                    <FileText size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No analysis yet</p>
                    <p className="text-xs mt-1">Upload or paste a document to run the DocumentAnalysisAgent</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── CMS Submission Tab ────────────────────────────────────────────── */}
        <TabsContent value="cms" className="mt-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Input */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList size={18} />Generate CMS Submission Draft
                </CardTitle>
                <CardDescription>
                  Select a dispute and the CMSSubmissionAgent (LangGraph) will check eligibility,
                  pre-fill all CMS portal form fields, and write the submission narrative.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Select Dispute</label>
                  <select
                    className="w-full text-sm border rounded p-2 bg-background"
                    value={cmsDisputeId}
                    onChange={(e) => setCmsDisputeId(e.target.value)}
                  >
                    <option value="">— Select a dispute —</option>
                    {(disputesData?.items || []).map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.referenceNumber} · {d.serviceType?.replace(/_/g, " ")} · ${d.billedAmount ?? "N/A"}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium mb-1 block">Additional Context (optional)</label>
                  <Textarea
                    placeholder="Any additional context about why open negotiation failed, special circumstances, etc."
                    value={cmsContext}
                    onChange={(e) => setCmsContext(e.target.value)}
                    className="min-h-[100px]"
                  />
                </div>

                <Button
                  onClick={() => cmsMutation.mutate({ disputeId: cmsDisputeId, additionalContext: cmsContext || undefined })}
                  disabled={!cmsDisputeId || cmsMutation.isPending}
                  className="w-full"
                >
                  {cmsMutation.isPending ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" />Running CMSSubmissionAgent...</>
                  ) : (
                    <><Sparkles size={14} className="mr-2" />Generate with LangGraph</>
                  )}
                </Button>

                {cmsMutation.isPending && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      Agent trace: check_eligibility → generate_form_fields → generate_narrative
                    </div>
                    <Progress value={undefined} className="h-1 animate-pulse" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CMS Results */}
            <div className="flex flex-col gap-3">
              {cmsResult ? (
                <ScrollArea style={{ maxHeight: "600px" }}>
                  <div className="flex flex-col gap-3 pr-2">
                    {/* Eligibility */}
                    <Card className={cmsResult.eligibility.isEligible ? "border-green-300" : "border-red-300"}>
                      <CardHeader className="pb-2">
                        <CardTitle className={`text-sm flex items-center gap-2 ${cmsResult.eligibility.isEligible ? "text-green-700" : "text-red-700"}`}>
                          {cmsResult.eligibility.isEligible ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                          {cmsResult.eligibility.isEligible ? "Eligible for IDR" : "Eligibility Issues Found"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-xs">{cmsResult.eligibility.eligibilityReason}</p>
                        {cmsResult.eligibility.missingRequirements.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-red-600">Missing Requirements:</p>
                            <ul className="text-xs text-red-600 mt-1 space-y-0.5">
                              {cmsResult.eligibility.missingRequirements.map((r, i) => (
                                <li key={i}>• {r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {cmsResult.eligibility.warnings.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-yellow-600">Warnings:</p>
                            <ul className="text-xs text-yellow-600 mt-1 space-y-0.5">
                              {cmsResult.eligibility.warnings.map((w, i) => (
                                <li key={i}>• {w}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(cmsResult.eligibility.regulatoryBasis || []).length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {cmsResult.eligibility.regulatoryBasis!.map((r) => (
                              <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Form Fields */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Pre-filled Form Fields</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 gap-1">
                          {Object.entries(cmsResult.draft.formFields).map(([k, v]) => v && (
                            <div key={k} className="flex justify-between items-center py-1 border-b last:border-0">
                              <span className="text-xs text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                              <span className="text-xs font-medium text-right max-w-[60%]">{v}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Attachment Checklist */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Attachment Checklist</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          {cmsResult.draft.attachmentChecklist.map((item, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`text-xs shrink-0 ${
                                  item.status === "ready" ? "text-green-600 border-green-300" :
                                  item.status === "missing" ? "text-red-600 border-red-300" :
                                  "text-gray-500 border-gray-300"
                                }`}
                              >
                                {item.status}
                              </Badge>
                              <span className="text-xs">{item.item}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Narrative */}
                    <Card>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">Submission Narrative</CardTitle>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(cmsResult.draft.submissionNarrative)}
                          >
                            <Copy size={12} className="mr-1" />Copy
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                          {cmsResult.draft.submissionNarrative}
                        </p>
                      </CardContent>
                    </Card>

                    {/* Estimated Outcome + Next Steps */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Estimated Outcome & Next Steps</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-xs text-muted-foreground">{cmsResult.draft.estimatedOutcome}</p>
                        <ol className="space-y-1">
                          {cmsResult.draft.nextSteps.map((step, i) => (
                            <li key={i} className="flex gap-2 text-xs">
                              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                {i + 1}
                              </span>
                              {step}
                            </li>
                          ))}
                        </ol>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => window.open("https://nsa-idr.cms.gov", "_blank")}
                        >
                          <ExternalLink size={12} className="mr-2" />Open CMS IDR Portal
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </ScrollArea>
              ) : (
                <Card className="flex-1 flex items-center justify-center min-h-[300px]">
                  <div className="text-center text-muted-foreground p-8">
                    <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No draft generated yet</p>
                    <p className="text-xs mt-1">Select a dispute and click Generate to run the CMSSubmissionAgent</p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Agent Info Tab ────────────────────────────────────────────────── */}
        <TabsContent value="agents" className="mt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                name: "DocumentAnalysisAgent",
                type: "LangGraph Sequential",
                icon: FileText,
                color: "text-blue-600",
                bg: "bg-blue-50",
                border: "border-blue-200",
                nodes: ["classify", "validate", "summarize"],
                description: "Extracts, validates, and classifies medical billing documents for NSA IDR compliance. Identifies document type, extracts key fields (CPT codes, NPI, amounts), flags validation issues, and assesses IDR eligibility implications.",
                endpoint: "POST /analyze-document",
              },
              {
                name: "CMSSubmissionAgent",
                type: "LangGraph Sequential",
                icon: ClipboardList,
                color: "text-purple-600",
                bg: "bg-purple-50",
                border: "border-purple-200",
                nodes: ["check_eligibility", "generate_form_fields", "generate_narrative"],
                description: "Checks NSA IDR eligibility per 45 CFR §149.510, pre-fills all CMS portal form fields from dispute data, generates a 3-paragraph submission narrative, and provides an attachment checklist with next steps.",
                endpoint: "POST /cms-submission",
              },
              {
                name: "IDRAssistantAgent",
                type: "LangGraph ReAct",
                icon: Bot,
                color: "text-green-600",
                bg: "bg-green-50",
                border: "border-green-200",
                nodes: ["agent", "tools", "agent (loop)"],
                description: "ReAct agent with 5 regulatory lookup tools: NSA deadlines, QPA methodology, administrative fees, batching rules, and appeal rights. Iterates tool calls until it has a complete, cited answer.",
                endpoint: "POST /ask-assistant",
              },
            ].map((agent) => (
              <Card key={agent.name} className={`border ${agent.border}`}>
                <CardHeader>
                  <div className={`w-10 h-10 rounded-xl ${agent.bg} flex items-center justify-center mb-2`}>
                    <agent.icon size={20} className={agent.color} />
                  </div>
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <Badge variant="outline" className={`w-fit text-xs ${agent.color}`}>{agent.type}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">{agent.description}</p>

                  <div>
                    <p className="text-xs font-semibold mb-1">Graph Nodes</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {agent.nodes.map((node, i) => (
                        <span key={node} className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-xs">{node}</Badge>
                          {i < agent.nodes.length - 1 && <ChevronRight size={10} className="text-muted-foreground" />}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="font-mono text-xs bg-muted rounded p-2">{agent.endpoint}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Stack info */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles size={16} />Open-Source AI Stack
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { name: "LangGraph", role: "Agent orchestration", desc: "Stateful multi-step graphs with conditional routing and tool calling loops" },
                  { name: "LangChain", role: "LLM abstraction", desc: "Prompt templates, tool definitions, message history, and chain composition" },
                  { name: "FastAPI", role: "API microservice", desc: "Async Python REST API with Pydantic validation and OpenAPI docs" },
                  { name: "PDFPlumber", role: "Document extraction", desc: "Accurate PDF text extraction for uploaded billing documents" },
                ].map((lib) => (
                  <div key={lib.name} className="bg-muted/50 rounded-lg p-3">
                    <p className="font-semibold text-sm">{lib.name}</p>
                    <p className="text-xs text-primary mt-0.5">{lib.role}</p>
                    <p className="text-xs text-muted-foreground mt-1">{lib.desc}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
