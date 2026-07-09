import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HelpCircle, Search, ChevronDown, ChevronRight, BookOpen, FileText, Zap, Shield } from "lucide-react";

interface FAQ {
  q: string;
  a: string;
  category: string;
}

const FAQS: FAQ[] = [
  // IDR Process
  { category: "IDR Process", q: "What is the NSA Independent Dispute Resolution (IDR) process?", a: "The No Surprises Act (NSA) IDR process is a federal arbitration mechanism for resolving payment disputes between providers and payers for out-of-network services. It consists of 19 defined steps from open negotiation through determination and payment, with statutory deadlines at each stage." },
  { category: "IDR Process", q: "What are the 19 steps of the IDR workflow?", a: "The 19 steps are organized into 6 phases: Open Negotiation (steps 1-3), IDR Filing (4-6), Entity Selection (7-9), Arbitration (10-13), Payment (14-16), and Appeal (17-19). Each step has a statutory deadline measured in business days." },
  { category: "IDR Process", q: "What is the Qualifying Payment Amount (QPA)?", a: "The QPA is the median contracted rate for the same or similar item or service in the same geographic area. It serves as the starting point for IDR arbitration and is a key factor in the arbitrator's determination." },
  { category: "IDR Process", q: "How long does the IDR process take?", a: "The full IDR process has a statutory maximum of approximately 30 business days from initiation to determination, though appeals can extend this. The platform tracks all deadlines automatically and warns you 3 business days before each one." },
  // Platform Usage
  { category: "Platform", q: "How do I create a new dispute?", a: "Click 'New Dispute' in the sidebar or use the Cmd+K command palette and search for 'new dispute'. Fill in the required fields (service date, billed amount, QPA, party information) and submit. The system will automatically assign a reference number and start the workflow timer." },
  { category: "Platform", q: "How does the Document Analyzer work?", a: "Upload a PDF or image of an EOB, remittance advice, or CMS-1500 form. The VLM (Vision Language Model) analyzes the document and extracts up to 25 structured fields. You can review, correct, and save the extracted fields, then auto-fill them into the dispute form." },
  { category: "Platform", q: "What is the Financial Ledger?", a: "The Financial Ledger tracks all financial movements for each dispute using double-entry accounting. It records billed amounts, QPA, offers, determinations, admin fees, and payments. You can filter by date range, group by account, and export to CSV." },
  { category: "Platform", q: "How do I use the Global Search?", a: "Press Cmd+K (or Ctrl+K) to open the command palette, or navigate to Global Search in the sidebar. You can search across disputes, documents, and audit events simultaneously. Use category filters and date range pickers to narrow results. Save frequent searches for quick access." },
  { category: "Platform", q: "What are Saved Searches?", a: "Saved Searches let you bookmark a specific combination of query text, category filters, and date range. Click 'Save Search' in the results header, give it a name, and it will appear in the Saved Searches panel for one-click re-execution." },
  // Documents
  { category: "Documents", q: "What document types are supported?", a: "The platform supports PDF, PNG, JPG, JPEG, and TIFF files up to 50 MB. The Document Analyzer can process EOBs, remittance advices, CMS-1500 forms, medical records, and other clinical documents." },
  { category: "Documents", q: "Can I attach files to workflow notes?", a: "Yes. When adding a note to a workflow step, click 'Attach file' to upload images, PDFs, Word documents, CSVs, or Excel files (up to 10 MB each). Images show a thumbnail preview in the note; clicking opens a full-screen preview modal." },
  // Security
  { category: "Security", q: "How is my data protected?", a: "All data is encrypted in transit (TLS 1.3) and at rest. Sessions use JWKS-compatible JWT tokens stored in httpOnly cookies. The platform implements Permify-style ReBAC (Relationship-Based Access Control) so users can only access disputes they are authorized for." },
  { category: "Security", q: "What is the audit trail?", a: "Every action on the platform — dispute creation, document upload, step advancement, offer submission, user login — is logged to an immutable audit_log table. Admins can view the full audit trail, filter by date range and entity type, and export to CSV." },
  { category: "Security", q: "How do I manage user roles?", a: "Admins can promote or demote users via the User Management page (Admin → User Management). Two roles are available: 'user' (standard access to own disputes) and 'admin' (full platform access including user management and system health)." },
  // Webhooks
  { category: "Webhooks", q: "What are webhooks used for?", a: "Webhooks let you receive real-time notifications when events occur in the platform (e.g., dispute.created, determination.issued). Each webhook endpoint receives an HMAC-SHA256 signed payload. You can subscribe to specific event types and test delivery from the Webhook Manager." },
];

const CATEGORIES = ["All", ...Array.from(new Set(FAQS.map(f => f.category)))];

const QUICK_LINKS = [
  { title: "19-Step IDR Workflow Guide", icon: Zap, desc: "Complete walkthrough of all NSA IDR steps and deadlines" },
  { title: "Document Analyzer User Guide", icon: FileText, desc: "How to upload, analyze, and correct OCR-extracted fields" },
  { title: "API & Webhook Reference", icon: BookOpen, desc: "tRPC procedure catalog and webhook event schema" },
  { title: "Security & Compliance Guide", icon: Shield, desc: "Data retention, audit trail, and HIPAA considerations" },
];

export default function HelpCenter() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const filtered = FAQS.filter(f => {
    const matchCat = category === "All" || f.category === category;
    const matchSearch = !search || f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HelpCircle className="h-6 w-6 text-blue-600" />
          Help Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Frequently asked questions and platform documentation
        </p>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {QUICK_LINKS.map(link => (
          <Card key={link.title} className="cursor-pointer hover:border-primary/40 transition-colors">
            <CardContent className="p-4 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <link.icon className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium">{link.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{link.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FAQ search and filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search help articles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                category === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* FAQ accordion */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">
            No articles match your search. Try different keywords.
          </p>
        ) : (
          filtered.map((faq, i) => (
            <Card key={i} className="overflow-hidden">
              <button
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                onClick={() => toggle(i)}
              >
                <div className="mt-0.5 shrink-0">
                  {expanded.has(i)
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  }
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{faq.q}</p>
                    <Badge variant="secondary" className="text-xs">{faq.category}</Badge>
                  </div>
                </div>
              </button>
              {expanded.has(i) && (
                <div className="px-4 pb-4 pt-0 ml-7">
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Contact */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4 flex items-center gap-3">
          <HelpCircle className="h-5 w-5 text-blue-600 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Still need help?</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Contact your platform administrator or submit a support request via the system notification panel.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
