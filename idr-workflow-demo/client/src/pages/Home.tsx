import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { Gavel, Scale, Shield, Clock } from "lucide-react";

export default function Home() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, loading, navigate]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-9 w-9 rounded-xl object-cover border border-white/20" alt="logo" />
          <span className="text-xl font-bold text-white">{APP_TITLE}</span>
        </div>
        <Button onClick={() => (window.location.href = getLoginUrl())} variant="outline"
          className="border-white/30 text-white hover:bg-white/10 bg-transparent">
          Sign In
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/20 border border-blue-400/30 rounded-full text-blue-300 text-sm font-medium mb-8">
          <Scale size={14} />
          NSA No Surprises Act — Federal IDR Platform
        </div>
        <h1 className="text-5xl font-extrabold text-white mb-6 max-w-3xl leading-tight">
          Manage IDR Disputes with<br />
          <span className="text-blue-400">Full NSA Compliance</span>
        </h1>
        <p className="text-lg text-slate-300 max-w-2xl mb-10">
          A complete 19-step Independent Dispute Resolution workflow platform built for the No Surprises Act.
          Track every deadline, manage offers, and coordinate with certified IDR entities — all in one place.
        </p>
        <div className="flex items-center gap-4">
          <Button size="lg" onClick={() => (window.location.href = getLoginUrl())}
            className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 text-base font-semibold">
            Get Started →
          </Button>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-16 max-w-3xl w-full">
          {[
            { icon: Scale, title: "19-Step Workflow", description: "Full NSA IDR process from open negotiation through determination and payment" },
            { icon: Clock, title: "Deadline Tracking", description: "Automated business-day calculations for all NSA-mandated timelines" },
            { icon: Shield, title: "NSA Compliant", description: "Built to 45 CFR §149.510 specifications with certified IDR entity management" },
          ].map(f => (
            <div key={f.title} className="bg-white/5 border border-white/10 rounded-xl p-5 text-left">
              <f.icon size={24} className="text-blue-400 mb-3" />
              <h3 className="text-white font-semibold mb-1">{f.title}</h3>
              <p className="text-slate-400 text-sm">{f.description}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-6 text-slate-500 text-xs">
        HealthPoint IDR Platform · Built for NSA/IDR Compliance · 45 CFR Part 149
      </footer>
    </div>
  );
}
