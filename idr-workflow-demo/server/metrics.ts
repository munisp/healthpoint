const documentAnalysisCounters: Record<"completed" | "failed" | "retryable_failure" | "dead_letter", number> = {
  completed: 0,
  failed: 0,
  retryable_failure: 0,
  dead_letter: 0,
};

export function incrementDocumentAnalysisMetric(
  outcome: "completed" | "failed" | "retryable_failure" | "dead_letter"
): void {
  documentAnalysisCounters[outcome] += 1;
}

/**
 * A deliberately narrow Prometheus exposition endpoint. Labels are static and
 * bounded; raw tenant, user, dispute, document, request, and payload values
 * must never be appended to this output.
 */
export function renderDocumentAnalysisMetrics(): string {
  const lines = [
    "# HELP healthpoint_document_analysis_jobs_total Document-analysis job outcomes since process start.",
    "# TYPE healthpoint_document_analysis_jobs_total counter",
    ...Object.entries(documentAnalysisCounters).map(
      ([outcome, count]) => `healthpoint_document_analysis_jobs_total{outcome=\"${outcome}\"} ${count}`
    ),
  ];
  return `${lines.join("\n")}\n`;
}
