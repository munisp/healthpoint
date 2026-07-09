import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, FileText, X, CheckCircle2, AlertCircle, Search, Loader2 } from "lucide-react";

interface FileEntry {
  id: string;
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export default function BatchEvidenceUpload() {
  const [disputeSearch, setDisputeSearch] = useState("");
  const [selectedDisputeId, setSelectedDisputeId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const { data: allDisputes } = trpc.disputes.list.useQuery({ limit: 200 });
  const disputes = (allDisputes?.items ?? []) as any[];

  const filteredDisputes = disputes.filter((d) =>
    disputeSearch === "" ||
    d.referenceNumber.toLowerCase().includes(disputeSearch.toLowerCase()) ||
    d.initiatingPartyName.toLowerCase().includes(disputeSearch.toLowerCase())
  );

  const selectedDispute = disputes.find((d) => d.id === selectedDisputeId);

  const uploadEvidenceMutation = trpc.documents.upload.useMutation();

  function addFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const entries: FileEntry[] = [];
    for (const file of Array.from(newFiles)) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(`${file.name}: Unsupported file type`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name}: File too large (max 20MB)`);
        continue;
      }
      entries.push({ id: crypto.randomUUID(), file, status: "pending" });
    }
    setFiles(prev => [...prev, ...entries]);
  }

  function removeFile(id: string) {
    setFiles(prev => prev.filter(f => f.id !== id));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function uploadAll() {
    if (!selectedDisputeId) { toast.error("Please select a dispute first"); return; }
    if (files.length === 0) { toast.error("No files to upload"); return; }

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    for (const entry of files.filter(f => f.status === "pending")) {
      setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: "uploading" } : f));
      try {
        // Convert file to base64 for upload
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(entry.file);
        });

        await uploadEvidenceMutation.mutateAsync({
          disputeId: selectedDisputeId,
          fileName: entry.file.name,
          fileType: entry.file.type,
          fileSize: entry.file.size,
          documentType: "other" as const,
          storageKey: `evidence/${selectedDisputeId}/${Date.now()}-${entry.file.name}`,
          storageUrl: `data:${entry.file.type};base64,${base64}`,
        });

        setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: "done" } : f));
        successCount++;
      } catch (err: any) {
        setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, status: "error", error: err.message ?? "Upload failed" } : f));
        errorCount++;
      }
    }

    setIsUploading(false);
    if (successCount > 0) toast.success(`${successCount} file${successCount !== 1 ? "s" : ""} uploaded successfully`);
    if (errorCount > 0) toast.error(`${errorCount} file${errorCount !== 1 ? "s" : ""} failed to upload`);
  }

  const pendingCount = files.filter(f => f.status === "pending").length;
  const doneCount = files.filter(f => f.status === "done").length;
  const errorCount = files.filter(f => f.status === "error").length;

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-100">
            <Upload size={20} className="text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Batch Evidence Upload</h1>
            <p className="text-sm text-slate-500">Upload multiple evidence files to a dispute at once</p>
          </div>
        </div>

        {/* Dispute Selector */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Select Target Dispute</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedDispute ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-teal-50 border border-teal-200">
                <div>
                  <span className="font-semibold text-sm text-slate-800">{selectedDispute.referenceNumber}</span>
                  <span className="text-xs text-slate-500 ml-2">{selectedDispute.initiatingPartyName}</span>
                  <Badge className="ml-2 text-xs bg-teal-100 text-teal-700">Selected</Badge>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setSelectedDisputeId(null); setDisputeSearch(""); }}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <Input
                    placeholder="Search by reference or party name..."
                    value={disputeSearch}
                    onChange={e => setDisputeSearch(e.target.value)}
                    className="pl-8 text-sm"
                  />
                </div>
                {disputeSearch.length > 1 && (
                  <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                    {filteredDisputes.slice(0, 10).map((d) => (
                      <button
                        key={d.id}
                        onClick={() => { setSelectedDisputeId(d.id); setDisputeSearch(d.referenceNumber); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-xs border-b border-slate-50 last:border-0"
                      >
                        <span className="font-semibold text-slate-700">{d.referenceNumber}</span>
                        <span className="text-slate-400 ml-2">{d.initiatingPartyName}</span>
                      </button>
                    ))}
                    {filteredDisputes.length === 0 && <p className="text-xs text-slate-400 text-center py-3">No disputes found</p>}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drop Zone */}
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragging ? "border-teal-400 bg-teal-50" : "border-slate-200 hover:border-slate-300"}`}
        >
          <Upload size={32} className={`mx-auto mb-3 ${isDragging ? "text-teal-500" : "text-slate-300"}`} />
          <p className="text-sm font-medium text-slate-600 mb-1">Drag & drop files here</p>
          <p className="text-xs text-slate-400 mb-3">PDF, JPEG, PNG, TIFF, DOC, DOCX — max 20MB each</p>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild>
              <span>Browse Files</span>
            </Button>
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.tiff,.doc,.docx"
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
          </label>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-700">
                  Files ({files.length})
                  {doneCount > 0 && <span className="ml-2 text-green-600">{doneCount} uploaded</span>}
                  {errorCount > 0 && <span className="ml-2 text-red-600">{errorCount} failed</span>}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400"
                  onClick={() => setFiles(prev => prev.filter(f => f.status !== "done"))}
                >
                  Clear done
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {files.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <FileText size={16} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700 truncate">{entry.file.name}</div>
                    <div className="text-xs text-slate-400">{formatSize(entry.file.size)}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {entry.status === "pending" && <Badge className="text-xs bg-slate-100 text-slate-500">Pending</Badge>}
                    {entry.status === "uploading" && <Loader2 size={14} className="text-blue-500 animate-spin" />}
                    {entry.status === "done" && <CheckCircle2 size={14} className="text-green-500" />}
                    {entry.status === "error" && (
                      <div className="flex items-center gap-1">
                        <AlertCircle size={14} className="text-red-500" />
                        <span className="text-xs text-red-500">{entry.error}</span>
                      </div>
                    )}
                    {entry.status !== "uploading" && entry.status !== "done" && (
                      <button onClick={() => removeFile(entry.id)} className="text-slate-300 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Upload Button */}
        {files.length > 0 && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setFiles([])}>Clear All</Button>
            <Button
              onClick={uploadAll}
              disabled={isUploading || pendingCount === 0 || !selectedDisputeId}
              className="bg-teal-600 hover:bg-teal-700 text-white"
            >
              {isUploading ? (
                <><Loader2 size={14} className="mr-2 animate-spin" />Uploading...</>
              ) : (
                <><Upload size={14} className="mr-2" />Upload {pendingCount} File{pendingCount !== 1 ? "s" : ""}</>
              )}
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
