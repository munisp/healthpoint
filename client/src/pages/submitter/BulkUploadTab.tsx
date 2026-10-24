/**
 * BulkUploadTab — Phase 19-FE. Chunked, resumable bulk upload client for
 * the submitter console, wired to the Phase 19 backend:
 *
 *   tRPC:  bulkUpload.createUploadSession / finalizeUpload /
 *          getUploadStatus / cancelUpload / listUploadSessions
 *   raw:   PUT /api/bulk-upload/:sessionId/chunks/:chunkIndex
 *          (cookie auth, x-chunk-sha256 header — see
 *          server/ingest/chunk-handler.ts)
 *
 * Chunking/resume logic lives in @/lib/bulk-upload (unit-tested). Resume
 * after a browser refresh: the session descriptor + confirmed chunk set is
 * persisted in localStorage per org; the user re-selects the SAME file
 * (verified by size + whole-file sha256) and already-confirmed chunks are
 * skipped. Honest limit: browsers do not let a page re-read a file without
 * the user picking it again, so resume always requires re-selection.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  CHUNK_SIZE_BYTES,
  clearResumeState,
  computeTotalChunks,
  detectFileType,
  fileChunkSource,
  formatBytes,
  loadResumeState,
  saveResumeState,
  sha256Hex,
  uploadChunks,
  type BulkUploadFileType,
  type UploadResumeState,
} from "@/lib/bulk-upload";

type SessionRow = {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  chunksReceived: number;
  totalChunks: number;
  rowsProcessed: number;
  rowsAccepted: number;
  rowsQuarantined: number;
  errorMessage: string | null;
  createdAt: string | Date;
  completedAt: string | Date | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  uploading: "secondary",
  ready: "secondary",
  ingesting: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

const FILE_TYPES: Array<{ value: BulkUploadFileType; label: string }> = [
  { value: "837", label: "837 claims (X12)" },
  { value: "835", label: "835 remittance (X12)" },
  { value: "csv", label: "CSV claims" },
  { value: "ndjson", label: "NDJSON (FHIR Claims)" },
];

export default function BulkUploadTab({ orgId }: { orgId: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<BulkUploadFileType>("837");
  const [resume, setResume] = useState<UploadResumeState | null>(null);
  const [phase, setPhase] = useState<"idle" | "hashing" | "creating" | "uploading" | "finalizing" | "done">("idle");
  const [chunksDone, setChunksDone] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const utils = trpc.useUtils();
  const createSession = trpc.bulkUpload.createUploadSession.useMutation();
  const finalize = trpc.bulkUpload.finalizeUpload.useMutation();
  const cancel = trpc.bulkUpload.cancelUpload.useMutation({
    onSuccess: () => {
      clearResumeState(window.localStorage, orgId);
      setResume(null);
      setPhase("idle");
      setActiveSessionId(null);
      toast.success("Upload cancelled");
      utils.bulkUpload.listUploadSessions.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  // Poll the active session while ingestion runs.
  const statusQ = trpc.bulkUpload.getUploadStatus.useQuery(
    { orgId, sessionId: activeSessionId! },
    {
      enabled: !!activeSessionId && (phase === "finalizing" || phase === "done"),
      refetchInterval: phase === "finalizing" ? 1500 : false,
    },
  );

  const sessionsQ = trpc.bulkUpload.listUploadSessions.useQuery({ orgId, limit: 25 });
  const sessions = (sessionsQ.data?.sessions ?? []) as SessionRow[];

  // On mount / org switch: surface a resumable session, if any.
  useEffect(() => {
    setResume(loadResumeState(window.localStorage, orgId));
    setPhase("idle");
    setFile(null);
    setActiveSessionId(null);
    setChunksDone(0);
  }, [orgId]);

  // When ingestion reaches a terminal state, stop polling + clear resume.
  const terminalStatus = statusQ.data?.status;
  const terminalData = statusQ.data;
  useEffect(() => {
    const s = terminalStatus;
    if (!s || !terminalData) return;
    if (s === "completed") {
      setPhase("done");
      clearResumeState(window.localStorage, orgId);
      setResume(null);
      utils.bulkUpload.listUploadSessions.invalidate();
      toast.success(`Ingestion complete: ${terminalData.rowsAccepted} accepted, ${terminalData.rowsQuarantined} quarantined`);
    } else if (s === "failed" || s === "cancelled") {
      setPhase("done");
      clearResumeState(window.localStorage, orgId);
      setResume(null);
      utils.bulkUpload.listUploadSessions.invalidate();
      if (s === "failed") toast.error(terminalData.errorMessage ?? "Ingestion failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalStatus]);

  const onPick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    const detected = detectFileType(f.name);
    if (detected) setFileType(detected);
    else toast.info("Could not detect the file type from the name — please pick it below.");
  };

  async function startUpload(resuming: UploadResumeState | null) {
    if (!file) return;
    cancelRef.current = false;
    try {
      setPhase("hashing");
      const wholeHash = await sha256Hex(await file.arrayBuffer());
      if (resuming) {
        if (resuming.sizeBytes !== file.size || resuming.sha256 !== wholeHash || resuming.fileType !== fileType) {
          toast.error("This file does not match the saved session (size/hash/type differ). Pick the same file to resume, or discard the saved session.");
          setPhase("idle");
          return;
        }
      }
      const chunks = computeTotalChunks(file.size);
      setTotalChunks(chunks);

      let sessionId: string;
      const skip = new Set<number>(resuming?.uploadedChunks ?? []);
      if (resuming) {
        sessionId = resuming.sessionId;
        setChunksDone(skip.size);
      } else {
        setPhase("creating");
        const s = await createSession.mutateAsync({
          orgId,
          fileName: file.name,
          fileType,
          sizeBytes: file.size,
          totalChunks: chunks,
          sha256: wholeHash,
        });
        sessionId = s.sessionId;
      }
      setActiveSessionId(sessionId);

      const state: UploadResumeState = resuming ?? {
        version: 1,
        orgId,
        sessionId,
        fileName: file.name,
        fileType,
        sizeBytes: file.size,
        sha256: wholeHash,
        totalChunks: chunks,
        uploadedChunks: [],
        updatedAt: new Date().toISOString(),
      };

      setPhase("uploading");
      await uploadChunks({
        sessionId,
        source: fileChunkSource(file),
        totalChunks: chunks,
        skip,
        fetchImpl: fetch as never,
        isCancelled: () => cancelRef.current,
        onChunk: r => {
          state.uploadedChunks = [...new Set([...state.uploadedChunks, r.chunkIndex])];
          saveResumeState(window.localStorage, state);
          setChunksDone(state.uploadedChunks.length);
        },
      });
      if (cancelRef.current) {
        setPhase("idle");
        return; // resume state already persisted per chunk
      }

      setPhase("finalizing");
      await finalize.mutateAsync({ orgId, sessionId });
      statusQ.refetch();
      utils.bulkUpload.listUploadSessions.invalidate();
    } catch (e) {
      setPhase("idle");
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const uploading = phase === "uploading" || phase === "hashing" || phase === "creating";
  const pct = totalChunks > 0 ? Math.round((chunksDone / totalChunks) * 100) : 0;

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Bulk upload (837 / 835 / CSV / NDJSON)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">
            Large files are split into {formatBytes(CHUNK_SIZE_BYTES)} chunks in your browser and uploaded one at a
            time, each with its own SHA-256 integrity check. You can safely close or refresh this tab mid-upload:
            re-select the same file afterwards and the upload resumes where it stopped. Rows that fail validation
            land in the Quarantine tab for review — nothing is silently dropped.
          </p>

          {resume && phase === "idle" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm space-y-2" role="status">
              <p className="font-medium text-amber-900">
                Resumable upload found: {resume.fileName} ({formatBytes(resume.sizeBytes)}) —{" "}
                {resume.uploadedChunks.length}/{resume.totalChunks} chunks already uploaded.
              </p>
              <p className="text-xs text-amber-800">
                Re-select the same file below to resume. The file is verified by size and SHA-256 before any chunk is skipped.
              </p>
              <Button size="sm" variant="outline"
                onClick={() => { clearResumeState(window.localStorage, orgId); setResume(null); }}>
                Discard saved session
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.ndjson,.jsonl,.837,.837p,.835,.era,.x12,.edi,.txt"
              className="text-sm"
              aria-label="Choose a bulk upload file"
              onChange={e => onPick(e.target.files?.[0])}
              disabled={uploading || phase === "finalizing"}
            />
            <div className="flex items-center gap-2">
              <Label htmlFor="bu-type" className="text-sm">File type</Label>
              <select
                id="bu-type"
                className="border rounded px-2 py-1 text-sm bg-background"
                value={fileType}
                onChange={e => setFileType(e.target.value as BulkUploadFileType)}
                disabled={uploading || phase === "finalizing"}
              >
                {FILE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {file && phase === "idle" && (
            <p className="text-sm text-muted-foreground">
              {file.name} — {formatBytes(file.size)} · {computeTotalChunks(file.size)} chunk{computeTotalChunks(file.size) > 1 ? "s" : ""}
            </p>
          )}

          {(phase !== "idle" || chunksDone > 0) && totalChunks > 0 && (
            <div className="space-y-1">
              <Progress value={pct} aria-label="Upload progress" />
              <p className="text-xs text-muted-foreground" role="status">
                {phase === "hashing" && "Computing file fingerprint…"}
                {phase === "creating" && "Creating upload session…"}
                {phase === "uploading" && `Uploading: chunk ${chunksDone}/${totalChunks} (${pct}%)`}
                {phase === "finalizing" &&
                  `Finalizing and ingesting… ${statusQ.data ? `status: ${statusQ.data.status} — ${statusQ.data.rowsProcessed} rows processed, ${statusQ.data.rowsQuarantined} quarantined` : ""}`}
                {phase === "done" && statusQ.data && `Finished: ${statusQ.data.status} — ${statusQ.data.rowsAccepted} accepted, ${statusQ.data.rowsQuarantined} quarantined`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!file || uploading || phase === "finalizing"}
              onClick={() => startUpload(resume)}
            >
              {resume ? "Resume upload" : "Start upload"}
            </Button>
            {(uploading || phase === "finalizing") && activeSessionId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  cancelRef.current = true;
                  cancel.mutate({ orgId, sessionId: activeSessionId });
                }}
                disabled={cancel.isPending}
              >
                Cancel upload
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Upload session history</span>
            <Button size="sm" variant="ghost" onClick={() => sessionsQ.refetch()} disabled={sessionsQ.isFetching}>
              {sessionsQ.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsQ.isLoading && <p className="text-sm text-muted-foreground">Loading sessions…</p>}
          {sessionsQ.isError && <p role="alert" className="text-sm text-destructive">{sessionsQ.error.message}</p>}
          {sessionsQ.data && sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">No bulk uploads yet for this organization.</p>
          )}
          {sessions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Rows (accepted / quarantined)</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.fileName}</TableCell>
                    <TableCell>{s.fileType}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[s.status] ?? "outline"}>{s.status}</Badge>
                      {s.errorMessage && (
                        <p className="text-xs text-destructive mt-1 max-w-xs truncate" title={s.errorMessage}>{s.errorMessage}</p>
                      )}
                    </TableCell>
                    <TableCell>{s.chunksReceived}/{s.totalChunks}</TableCell>
                    <TableCell>{s.rowsAccepted} / {s.rowsQuarantined}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {s.status === "uploading" && (
                        <Button size="sm" variant="outline"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate({ orgId, sessionId: s.id })}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
