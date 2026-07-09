import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Sparkles, FileText, CheckCircle2, Trash2, Copy, Download, Loader2, Wand2 } from "lucide-react";

const NARRATIVE_TYPES = [
  { value: "opening_statement", label: "Opening Statement", description: "Initial position statement for IDR submission" },
  { value: "counter_argument", label: "Counter-Argument Brief", description: "Rebuttal to payer's position" },
  { value: "closing_summary", label: "Closing Summary", description: "Final summary of key arguments" },
  { value: "appeal_brief", label: "Appeal Brief", description: "Formal appeal of an IDR determination" },
  { value: "mediation_memo", label: "Mediation Memorandum", description: "Memo for mediation proceedings" },
];

export default function NarrativeGenerator() {
  const [disputeId, setDisputeId] = useState("");
  const [narrativeType, setNarrativeType] = useState("opening_statement");
  const [context, setContext] = useState("");
  const [viewNarrative, setViewNarrative] = useState<{ content: string; type: string } | null>(null);
  const utils = trpc.useUtils();

  const { data: narratives = [], isLoading } = trpc.narratives.list.useQuery(
    { disputeId },
    { enabled: disputeId.length > 3 }
  );

  const generateMutation = trpc.narratives.generate.useMutation({
    onSuccess: (data) => {
      utils.narratives.list.invalidate();
      setViewNarrative({ content: data.content, type: data.narrativeType });
      toast.success("Narrative generated successfully");
    },
    onError: (e) => toast.error("Generation failed: " + e.message),
  });

  const approveMutation = trpc.narratives.approve.useMutation({
    onSuccess: () => { utils.narratives.list.invalidate(); toast.success("Narrative approved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.narratives.delete.useMutation({
    onSuccess: () => { utils.narratives.list.invalidate(); toast.success("Narrative deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
  };

  const downloadText = (content: string, type: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedType = NARRATIVE_TYPES.find(t => t.value === narrativeType);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-violet-600" />
          AI Narrative Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Generate professional legal narratives for IDR proceedings using AI</p>
      </div>

      {/* Generator card */}
      <Card className="border-violet-200 bg-violet-50/30 dark:bg-violet-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-600" />
            Generate New Narrative
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Dispute ID *</label>
              <Input
                placeholder="Enter dispute ID to generate narrative for"
                value={disputeId}
                onChange={e => setDisputeId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Narrative Type</label>
              <Select value={narrativeType} onValueChange={setNarrativeType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NARRATIVE_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      <div>
                        <div className="font-medium">{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedType && (
            <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-100 dark:bg-violet-950/30 rounded p-2">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span><strong>{selectedType.label}:</strong> {selectedType.description}</span>
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Additional Context <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Textarea
              placeholder="Add specific facts, QPA amounts, relevant dates, or other context to improve the narrative..."
              value={context}
              onChange={e => setContext(e.target.value)}
              className="min-h-[80px]"
              maxLength={1000}
            />
          </div>
          <Button
            onClick={() => generateMutation.mutate({ disputeId, narrativeType: narrativeType as any, context: context || undefined })}
            disabled={generateMutation.isPending || disputeId.length < 4}
            className="w-full bg-violet-600 hover:bg-violet-700"
          >
            {generateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating narrative...</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />Generate {selectedType?.label}</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Saved narratives */}
      {disputeId.length > 3 && (
        <div>
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Saved Narratives for this Dispute
            {narratives.length > 0 && <Badge variant="outline">{narratives.length}</Badge>}
          </h2>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : narratives.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border-2 border-dashed rounded-lg">
              No narratives generated yet for this dispute
            </div>
          ) : (
            <div className="space-y-3">
              {narratives.map(n => {
                const typeLabel = NARRATIVE_TYPES.find(t => t.value === n.narrativeType)?.label ?? n.narrativeType;
                return (
                  <Card key={n.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">{typeLabel}</Badge>
                            {n.approved && <Badge className="text-xs bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>}
                            <span className="text-xs text-muted-foreground">{n.wordCount} words · {new Date(n.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">{n.content}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => setViewNarrative({ content: n.content, type: typeLabel })}>
                            View
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => copyToClipboard(n.content)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => downloadText(n.content, n.narrativeType)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          {!n.approved && (
                            <Button variant="ghost" size="sm" className="text-green-600" onClick={() => approveMutation.mutate({ id: n.id })}>
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteMutation.mutate({ id: n.id })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* View narrative dialog */}
      <Dialog open={!!viewNarrative} onOpenChange={open => !open && setViewNarrative(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-violet-600" />
              {viewNarrative?.type}
            </DialogTitle>
          </DialogHeader>
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed bg-muted/30 rounded-lg p-4">
              {viewNarrative?.content}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => viewNarrative && copyToClipboard(viewNarrative.content)}>
              <Copy className="h-4 w-4 mr-2" />Copy
            </Button>
            <Button variant="outline" onClick={() => viewNarrative && downloadText(viewNarrative.content, viewNarrative.type)}>
              <Download className="h-4 w-4 mr-2" />Download
            </Button>
            <Button onClick={() => setViewNarrative(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
