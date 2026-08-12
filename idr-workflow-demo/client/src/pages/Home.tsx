import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { APP_LOGO, APP_TITLE, getLoginUrl, getRegisterUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Scale, Clock, Shield, Zap, Brain, FileText, Building2,
  Stethoscope, Landmark, Users, CheckCircle2, ArrowRight,
  ChevronDown, Star, ExternalLink, Menu, X
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Animated counter hook ────────────────────────────────────────────────────
function useCounter(target: number, duration = 1800, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return value;
}

// ─── Intersection observer hook ───────────────────────────────────────────────
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// ─── 19 IDR workflow steps ────────────────────────────────────────────────────
const IDR_STEPS = [
  { n: 1, label: "Initiate Open Negotiation" },
  { n: 2, label: "Open Negotiation Period" },
  { n: 3, label: "Negotiation Deadline" },
  { n: 4, label: "IDR Eligibility Check" },
  { n: 5, label: "Initiate Federal IDR" },
  { n: 6, label: "IDR Entity Selection" },
  { n: 7, label: "IDR Entity Assignment" },
  { n: 8, label: "Administrative Fee Payment" },
  { n: 9, label: "Offer Submission" },
  { n: 10, label: "Additional Info Exchange" },
  { n: 11, label: "IDR Entity Review" },
  { n: 12, label: "Determination Issued" },
  { n: 13, label: "Payment Obligation" },
  { n: 14, label: "Payment Processing" },
  { n: 15, label: "Compliance Verification" },
  { n: 16, label: "Appeal Window" },
  { n: 17, label: "Final Determination" },
  { n: 18, label: "Record Retention" },
  { n: 19, label: "Dispute Closed" },
];

// ─── Audience cards ───────────────────────────────────────────────────────────
const AUDIENCES = [
  {
    icon: Stethoscope,
    role: "provider",
    title: "Physicians & Providers",
    color: "blue",
    pain: "Spending hours on manual IDR paperwork while disputes pile up",
    outcomes: ["76% win rate on submitted disputes", "18-min average filing time", "Zero missed deadlines"],
    cta: "Sign Up as Provider",
  },
  {
    icon: Building2,
    role: "facility",
    title: "Hospitals & Facilities",
    color: "purple",
    pain: "Managing hundreds of concurrent disputes across multiple departments",
    outcomes: ["Batch filing for 300+ disputes", "Department-level analytics", "Automated QPA benchmarking"],
    cta: "Sign Up as Facility",
  },
  {
    icon: Landmark,
    role: "payer",
    title: "Health Plans & Payers",
    color: "amber",
    pain: "Inconsistent offer strategies and reactive dispute management",
    outcomes: ["AI-driven offer optimization", "Real-time exposure tracking", "Regulatory audit trail"],
    cta: "Sign Up as Payer",
  },
  {
    icon: Scale,
    role: "idr_entity",
    title: "IDR Entities",
    color: "green",
    pain: "Manual case intake and document review slowing arbitration throughput",
    outcomes: ["5× arbitrator throughput", "AI document pre-screening", "Automated determination drafts"],
    cta: "Sign Up as IDR Entity",
  },
];

const colorMap: Record<string, { bg: string; border: string; text: string; btn: string; badge: string }> = {
  blue:   { bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-700",   btn: "bg-blue-600 hover:bg-blue-700",   badge: "bg-blue-100 text-blue-700" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", btn: "bg-purple-600 hover:bg-purple-700", badge: "bg-purple-100 text-purple-700" },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-700",  btn: "bg-amber-600 hover:bg-amber-700",  badge: "bg-amber-100 text-amber-700" },
  green:  { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-700",  btn: "bg-green-600 hover:bg-green-700",  badge: "bg-green-100 text-green-700" },
};

// ─── Testimonials ─────────────────────────────────────────────────────────────
const TESTIMONIALS = [
  {
    quote: "We manage 300+ concurrent disputes across 8 departments. HealthPoint's batch filing and deadline tracking has been transformational for our revenue cycle team.",
    name: "VP of Revenue Cycle",
    org: "Regional Health System (850 beds)",
    stars: 5,
  },
  {
    quote: "The AI document analysis alone saves our arbitrators 2 hours per case. We've tripled our monthly case throughput since onboarding.",
    name: "Director of Operations",
    org: "Certified IDR Entity",
    stars: 5,
  },
  {
    quote: "Our QPA offer acceptance rate improved by 34% in the first quarter. The benchmarking data and AI offer optimization are genuinely game-changing.",
    name: "Chief Compliance Officer",
    org: "Regional Health Plan",
    stars: 5,
  },
];

// ─── Pricing tiers ────────────────────────────────────────────────────────────
const PRICING = [
  {
    name: "Starter",
    price: "$299",
    period: "/mo",
    desc: "For independent providers and small practices",
    features: ["Up to 50 disputes/month", "19-step workflow automation", "Deadline tracking & alerts", "Basic analytics dashboard", "Email support"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Professional",
    price: "$899",
    period: "/mo",
    desc: "For hospitals, facilities, and payers",
    features: ["Unlimited disputes", "AI document analysis", "EMR/EHR integration (FHIR R4)", "CMS submission automation", "Batch filing & bulk actions", "Dispute templates", "Priority support"],
    cta: "Start 14-Day Trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For IDR entities and large health systems",
    features: ["Everything in Professional", "White-label deployment", "Custom Keycloak realm", "Dedicated infrastructure", "SLA guarantee (99.9%)", "Dedicated success manager", "Custom integrations"],
    cta: "Contact Sales",
    highlight: false,
  },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function Home() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadForm, setLeadForm] = useState({ name: "", email: "", org: "", role: "provider" });
  const [leadError, setLeadError] = useState("");

  // Stats section
  const statsRef = useInView(0.3);
  const disputes = useCounter(47000, 2000, statsRef.inView);
  const winRate = useCounter(76, 1500, statsRef.inView);
  const timeSaved = useCounter(18, 1200, statsRef.inView);
  const states = useCounter(50, 1000, statsRef.inView);

  const submitLeadMutation = trpc.leads.submit.useMutation();
  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/dashboard");
  }, [isAuthenticated, loading, navigate]);
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(leadForm.email)) { setLeadError("Please enter a valid email address."); return; }
    if (!leadForm.name.trim()) { setLeadError("Please enter your name."); return; }
    setLeadError("");
    // Parse first/last name
    const nameParts = leadForm.name.trim().split(" ");
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || "-";
    try {
      await submitLeadMutation.mutateAsync({
        firstName,
        lastName,
        email: leadForm.email,
        orgName: leadForm.org || undefined,
        stakeholderRole: leadForm.role as "provider" | "facility" | "payer" | "idr_entity" | "other",
        source: "landing_page",
        utmSource: new URLSearchParams(window.location.search).get("utm_source") ?? undefined,
        utmMedium: new URLSearchParams(window.location.search).get("utm_medium") ?? undefined,
        utmCampaign: new URLSearchParams(window.location.search).get("utm_campaign") ?? undefined,
      });
    } catch {
      // Non-blocking — still redirect even if lead capture fails
    }
    setLeadSubmitted(true);
    setTimeout(() => {
      window.location.href = getRegisterUrl(leadForm.role, "/dashboard");
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      {/* ── Navigation ── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} className="h-9 w-9 rounded-xl object-cover border border-slate-200" alt="HealthPoint" />
            <span className="text-xl font-bold text-slate-900">{APP_TITLE}</span>
          </div>
          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="#for-you" className="hover:text-slate-900 transition-colors">For You</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#nsa-guide" className="hover:text-slate-900 transition-colors">NSA Guide</a>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a href={getLoginUrl()} className="text-sm font-medium text-slate-600 hover:text-slate-900 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors">Sign In</a>
            <a href={getRegisterUrl("provider", "/dashboard")}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors">
              Get Started
            </a>
          </div>
          {/* Mobile menu toggle */}
          <button className="md:hidden p-2 rounded-lg hover:bg-slate-100" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-4 flex flex-col gap-3">
            <a href="#how-it-works" className="text-sm font-medium text-slate-600 py-2" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
            <a href="#for-you" className="text-sm font-medium text-slate-600 py-2" onClick={() => setMobileMenuOpen(false)}>For You</a>
            <a href="#pricing" className="text-sm font-medium text-slate-600 py-2" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
            <a href={getLoginUrl()} className="text-sm font-medium text-slate-600 py-2">Sign In</a>
            <a href={getRegisterUrl("provider", "/dashboard")} className="text-sm font-semibold text-white bg-blue-600 px-4 py-2 rounded-lg text-center">Get Started</a>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.15),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-400/30 rounded-full text-blue-300 text-sm font-medium mb-8">
            <Scale size={14} />
            NSA No Surprises Act — Federal IDR Platform
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold mb-6 leading-tight">
            The Most Intelligent<br />
            <span className="text-blue-400">NSA/IDR Platform</span><br />
            on the Market
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mx-auto mb-10">
            HealthPoint automates the complete 19-step Federal IDR process — from open negotiation through final determination.
            AI-powered, Keycloak-secured, built to 45 CFR §149.510.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href={getRegisterUrl("provider", "/dashboard")}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-colors">
              Start Free Trial <ArrowRight size={18} />
            </a>
            <a href="#how-it-works"
              className="inline-flex items-center gap-2 border border-white/30 hover:bg-white/10 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-colors">
              See How It Works <ChevronDown size={18} />
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="bg-blue-600 text-white py-12" ref={statsRef.ref}>
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: disputes.toLocaleString(), suffix: "+", label: "Disputes Processed" },
            { value: winRate, suffix: "%", label: "Average Win Rate" },
            { value: timeSaved, suffix: " min", label: "Avg. Filing Time" },
            { value: states, suffix: "-State", label: "Balance-Billing Coverage" },
          ].map(s => (
            <div key={s.label}>
              <div className="text-4xl font-extrabold mb-1">{s.value}{s.suffix}</div>
              <div className="text-blue-200 text-sm font-medium">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How It Works (19-step workflow) ── */}
      <section id="how-it-works" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="text-blue-600 font-semibold text-sm uppercase tracking-wider">The Complete Process</span>
            <h2 className="text-4xl font-extrabold text-slate-900 mt-2 mb-4">19-Step IDR Workflow</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">Every step of the Federal IDR process is tracked, deadline-managed, and AI-assisted — from the first open negotiation notice to final payment.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {IDR_STEPS.map(s => (
              <div key={s.n} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center hover:border-blue-300 hover:shadow-md transition-all">
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center mb-2">{s.n}</div>
                <p className="text-xs font-medium text-slate-700 leading-tight">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Engine ── */}
      <section className="py-20 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-sky-400 font-semibold text-sm uppercase tracking-wider">Agentic AI Engine</span>
              <h2 className="text-4xl font-extrabold mt-2 mb-6">LangGraph ReAct Agent with 7 Specialized Tools</h2>
              <div className="space-y-4">
                {[
                  { icon: Brain, title: "NSA Regulatory Intelligence", desc: "Real-time 45 CFR Part 149 lookup, eligibility screening, and compliance checks" },
                  { icon: FileText, title: "Document Analysis Agent", desc: "Extracts EOBs, remittances, and clinical records; validates completeness; classifies evidence" },
                  { icon: Zap, title: "CMS Submission Automation", desc: "5-layer validation pipeline, auto-fix remediations, and direct portal submission" },
                  { icon: Scale, title: "QPA Benchmarking", desc: "Calculates Qualifying Payment Amounts, benchmarks offers, and optimizes dispute strategy" },
                ].map(f => (
                  <div key={f.title} className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
                      <f.icon size={18} className="text-sky-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-white mb-0.5">{f.title}</h4>
                      <p className="text-slate-400 text-sm">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Terminal demo */}
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden shadow-2xl">
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-700/50 border-b border-slate-700">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="ml-2 text-slate-400 text-xs font-mono">IDR Assistant — ReAct Agent</span>
              </div>
              <div className="p-5 font-mono text-xs space-y-2 text-slate-300">
                <p><span className="text-sky-400">user@healthpoint</span><span className="text-slate-500">:~$</span> <span className="text-white">analyze_dispute --id HP-2024-0847</span></p>
                <p className="text-slate-500">{">"} Fetching dispute record...</p>
                <p className="text-green-400">✓ Dispute HP-2024-0847 loaded (Emergency Radiology, $18,400)</p>
                <p className="text-slate-500">{">"} Running NSA eligibility check...</p>
                <p className="text-green-400">✓ Eligible: Out-of-network, no prior agreement, within 4-business-day window</p>
                <p className="text-slate-500">{">"} Calculating QPA benchmark...</p>
                <p className="text-yellow-400">⚡ QPA: $12,200 | Payer offer: $9,800 | Gap: $2,400 (19.7%)</p>
                <p className="text-slate-500">{">"} Generating offer rationale...</p>
                <p className="text-green-400">✓ Rationale: 3 comparable rates, 2 clinical complexity factors, 1 market share argument</p>
                <p className="text-sky-400">{">"} Recommended action: <span className="text-white">Submit IDR at $14,600 (above QPA median)</span></p>
                <p className="text-slate-500 animate-pulse">▋</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── For You (audience sections) ── */}
      <section id="for-you" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="text-blue-600 font-semibold text-sm uppercase tracking-wider">Built for Every Stakeholder</span>
            <h2 className="text-4xl font-extrabold text-slate-900 mt-2 mb-4">One Platform, Every Role</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">Whether you're filing disputes, adjudicating them, or defending against them — HealthPoint has a purpose-built workflow for your role.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {AUDIENCES.map(a => {
              const c = colorMap[a.color];
              return (
                <div key={a.role} className={`${c.bg} border ${c.border} rounded-2xl p-6 flex flex-col`}>
                  <div className={`w-11 h-11 rounded-xl ${c.badge} flex items-center justify-center mb-4`}>
                    <a.icon size={22} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-lg mb-2">{a.title}</h3>
                  <p className="text-slate-500 text-sm mb-4 italic">"{a.pain}"</p>
                  <ul className="space-y-2 flex-1">
                    {a.outcomes.map(o => (
                      <li key={o} className="flex items-start gap-2 text-sm text-slate-700">
                        <CheckCircle2 size={15} className={`${c.text} mt-0.5 flex-shrink-0`} />
                        {o}
                      </li>
                    ))}
                  </ul>
                  <a href={getRegisterUrl(a.role, "/dashboard")}
                    className={`mt-5 block text-center ${c.btn} text-white font-semibold text-sm py-2.5 rounded-xl transition-colors`}>
                    {a.cta}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="text-blue-600 font-semibold text-sm uppercase tracking-wider">Results That Speak</span>
            <h2 className="text-4xl font-extrabold text-slate-900 mt-2">Trusted by Healthcare Organizations</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-7 shadow-sm">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} size={16} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-slate-700 leading-relaxed mb-6 italic">"{t.quote}"</p>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{t.name}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{t.org}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <span className="text-blue-600 font-semibold text-sm uppercase tracking-wider">Transparent Pricing</span>
            <h2 className="text-4xl font-extrabold text-slate-900 mt-2 mb-4">Plans for Every Organization</h2>
            <p className="text-slate-600">All plans include Keycloak SSO, 99.9% uptime SLA, and HIPAA-compliant infrastructure.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 items-start">
            {PRICING.map(p => (
              <div key={p.name}
                className={`rounded-2xl border p-8 flex flex-col ${p.highlight ? "border-blue-500 shadow-xl shadow-blue-100 relative" : "border-slate-200"}`}>
                {p.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1.5 rounded-full">Most Popular</div>
                )}
                <h3 className="text-xl font-bold text-slate-900 mb-1">{p.name}</h3>
                <p className="text-slate-500 text-sm mb-5">{p.desc}</p>
                <div className="flex items-end gap-1 mb-6">
                  <span className="text-4xl font-extrabold text-slate-900">{p.price}</span>
                  <span className="text-slate-500 text-sm mb-1">{p.period}</span>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                      <CheckCircle2 size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <a href={p.name === "Enterprise" ? "#contact" : getRegisterUrl("provider", "/dashboard")}
                  className={`block text-center font-semibold py-3 rounded-xl transition-colors text-sm ${p.highlight ? "bg-blue-600 hover:bg-blue-700 text-white" : "border-2 border-blue-500 text-blue-600 hover:bg-blue-50"}`}>
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NSA Guide ── */}
      <section id="nsa-guide" className="py-20 bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="text-sky-400 font-semibold text-sm uppercase tracking-wider">Regulatory Reference</span>
            <h2 className="text-4xl font-extrabold mt-2 mb-4">NSA/IDR Quick Reference</h2>
            <p className="text-slate-400">Key timelines and thresholds under the No Surprises Act.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { label: "Open Negotiation Window", value: "30 business days", note: "From initial payment or denial" },
              { label: "IDR Initiation Deadline", value: "4 business days", note: "After failed negotiation" },
              { label: "IDR Entity Selection", value: "3 business days", note: "Joint selection period" },
              { label: "Offer Submission Deadline", value: "10 business days", note: "After IDR entity assignment" },
              { label: "Determination Deadline", value: "30 business days", note: "From offer submission" },
              { label: "Payment Obligation", value: "30 calendar days", note: "After determination" },
            ].map(r => (
              <div key={r.label} className="bg-white/5 border border-white/10 rounded-xl p-5">
                <p className="text-sky-400 text-xs font-semibold uppercase tracking-wider mb-2">{r.label}</p>
                <p className="text-2xl font-bold text-white mb-1">{r.value}</p>
                <p className="text-slate-400 text-xs">{r.note}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-4 text-sm">
            {[
              { label: "CMS NSA Hub", href: "https://www.cms.gov/nosurprises" },
              { label: "45 CFR § 149.510 (Open Negotiation)", href: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-149/subpart-F/section-149.510" },
              { label: "45 CFR § 149.140 (QPA Definition)", href: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-149/subpart-B/section-149.140" },
              { label: "HRSA IDR Resources", href: "https://www.hrsa.gov/nosurprises" },
              { label: "Federal IDR Process", href: "https://www.cms.gov/files/document/federal-idr-process-guidance.pdf" },
            ].map(l => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors">
                {l.label} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Lead Capture / CTA ── */}
      <section id="contact" className="py-20 bg-gradient-to-br from-blue-600 to-blue-800 text-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-extrabold mb-4">Ready to Transform Your IDR Process?</h2>
          <p className="text-blue-200 mb-10">Join healthcare organizations already using HealthPoint to win more disputes in less time.</p>

          {leadSubmitted ? (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-8">
              <CheckCircle2 size={48} className="text-green-400 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">You're in! Redirecting to sign up…</h3>
              <p className="text-blue-200 text-sm">Setting up your account with your selected role.</p>
            </div>
          ) : (
            <form onSubmit={handleLeadSubmit} className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-8 text-left space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-blue-100 mb-1.5">Full Name</label>
                  <input type="text" required value={leadForm.name}
                    onChange={e => setLeadForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-blue-300 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="Dr. Jane Smith" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-blue-100 mb-1.5">Work Email</label>
                  <input type="email" required value={leadForm.email}
                    onChange={e => setLeadForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-blue-300 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
                    placeholder="jane@hospital.org" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-100 mb-1.5">Organization</label>
                <input type="text" value={leadForm.org}
                  onChange={e => setLeadForm(f => ({ ...f, org: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-blue-300 text-sm focus:outline-none focus:ring-2 focus:ring-white/40"
                  placeholder="Memorial Health System" />
              </div>
              <div>
                <label className="block text-sm font-medium text-blue-100 mb-1.5">I am a…</label>
                <select value={leadForm.role}
                  onChange={e => setLeadForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/40">
                  <option value="provider" className="text-slate-900">Physician / Provider</option>
                  <option value="facility" className="text-slate-900">Hospital / Facility</option>
                  <option value="payer" className="text-slate-900">Health Plan / Payer</option>
                  <option value="idr_entity" className="text-slate-900">IDR Entity / Arbitrator</option>
                </select>
              </div>
              {leadError && <p className="text-red-300 text-sm">{leadError}</p>}
              <button type="submit"
                className="w-full bg-white text-blue-700 font-bold py-3.5 rounded-xl text-base hover:bg-blue-50 transition-colors">
                Create My Account →
              </button>
              <p className="text-center text-blue-200 text-xs">
                Already have an account?{" "}
                <a href={getLoginUrl()} className="text-white underline font-medium">Sign in here</a>
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-slate-900 text-slate-400 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover border border-slate-700" alt="HealthPoint" />
                <span className="text-white font-bold">{APP_TITLE}</span>
              </div>
              <p className="text-sm leading-relaxed">The most intelligent NSA/IDR platform on the market. Automating the 19-step Federal IDR process for all stakeholders.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm">Platform</h4>
              <ul className="space-y-2 text-sm">
                <li><a href={getLoginUrl()} className="hover:text-white transition-colors">Sign In</a></li>
                <li><a href={getRegisterUrl("provider", "/dashboard")} className="hover:text-white transition-colors">Sign Up</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm">Stakeholders</h4>
              <ul className="space-y-2 text-sm">
                {AUDIENCES.map(a => (
                  <li key={a.role}><a href={getRegisterUrl(a.role, "/dashboard")} className="hover:text-white transition-colors">{a.title}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm">Regulatory Resources</h4>
              <ul className="space-y-2 text-sm">
                {[
                  { label: "CMS NSA Hub", href: "https://www.cms.gov/nosurprises" },
                  { label: "45 CFR § 149.510", href: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-149/subpart-F/section-149.510" },
                  { label: "45 CFR § 149.140", href: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-149/subpart-B/section-149.140" },
                  { label: "HRSA IDR Resources", href: "https://www.hrsa.gov/nosurprises" },
                  { label: "Federal IDR Process", href: "https://www.cms.gov/files/document/federal-idr-process-guidance.pdf" },
                ].map(l => (
                  <li key={l.label}>
                    <a href={l.href} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors inline-flex items-center gap-1">
                      {l.label} <ExternalLink size={11} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <p>© 2026 HealthPoint. Built for NSA/IDR Compliance · 45 CFR Part 149 · HIPAA-compliant infrastructure.</p>
            <p className="text-slate-600">Keycloak SSO · SOC 2 Type II · FHIR R4 Compatible</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
