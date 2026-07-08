# IDR Workflow AI Microservice

**Stack:** LangGraph · LangChain · FastAPI · Python 3.11

This microservice provides three agentic AI capabilities for the NSA IDR Workflow Platform:

## Architecture

```
Node.js (tRPC ai.* router)
        │  HTTP POST
        ▼
FastAPI AI Service (port 8000)
        │
        ├── POST /analyze-document  ──▶  DocumentAnalysisAgent (LangGraph)
        │                                 classify → validate → summarize
        │
        ├── POST /cms-submission    ──▶  CMSSubmissionAgent (LangGraph)
        │                                 check_eligibility → generate_form_fields → generate_narrative
        │
        └── POST /ask-assistant     ──▶  IDRAssistantAgent (LangGraph ReAct)
                                          agent ⇄ tools (NSA regulatory lookups)
```

## Agents

### 1. DocumentAnalysisAgent
**Type:** LangGraph Sequential Graph (3 nodes)

Analyzes uploaded medical billing documents:
- **classify** — Identifies document type (EOB, QPA docs, contracts, etc.) and extracts key fields
- **validate** — Checks NSA IDR compliance, flags missing fields and eligibility issues
- **summarize** — Generates plain-English summary and suggested action

### 2. CMSSubmissionAgent
**Type:** LangGraph Sequential Graph (3 nodes)

Generates CMS IDR portal submission drafts:
- **check_eligibility** — Assesses NSA IDR eligibility per 45 CFR §149.510
- **generate_form_fields** — Pre-fills all CMS portal form fields from dispute data
- **generate_narrative** — Writes 3-paragraph submission narrative and next steps

### 3. IDRAssistantAgent
**Type:** LangGraph ReAct (tool-calling loop)

Answers NSA IDR questions with regulatory citations:
- **Tools:** `lookup_nsa_deadline`, `lookup_qpa_methodology`, `lookup_administrative_fees`, `lookup_batching_rules`, `lookup_appeal_rights`
- Iterates tool calls until it has a complete, cited answer

## Running Locally

```bash
cd ai-service
pip install -r requirements.txt
AI_SERVICE_PORT=8000 python main.py
```

API docs available at: http://localhost:8000/docs

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_BASE` | LLM proxy base URL | `https://api.openai.com/v1` |
| `OPENAI_API_KEY` | API key for LLM proxy | Required |
| `AI_SERVICE_PORT` | Port to listen on | `8000` |

## Integration with Node.js

The Node.js tRPC `ai.*` router proxies all requests to this service:

```typescript
// server/routers.ts
ai: router({
  analyzeDocument: protectedProcedure.mutation(async ({ input }) => {
    const res = await fetch(`${AI_SERVICE_URL}/analyze-document`, { ... });
    return res.json();
  }),
  // ...
})
```

Set `AI_SERVICE_URL=http://localhost:8000` in the Node.js environment.
