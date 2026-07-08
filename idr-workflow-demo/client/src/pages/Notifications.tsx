import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_LOGO, APP_TITLE } from "@/const";
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, Clock, Info, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const PRIORITY_CONFIG = {
  urgent: { bg: "bg-red-50", border: "border-red-200", icon: AlertTriangle, iconColor: "text-red-500", badge: "bg-red-100 text-red-800" },
  high: { bg: "bg-orange-50", border: "border-orange-200", icon: AlertTriangle, iconColor: "text-orange-500", badge: "bg-orange-100 text-orange-800" },
  medium: { bg: "bg-amber-50", border: "border-amber-200", icon: Clock, iconColor: "text-amber-500", badge: "bg-amber-100 text-amber-800" },
  low: { bg: "bg-slate-50", border: "border-slate-200", icon: Info, iconColor: "text-slate-400", badge: "bg-slate-100 text-slate-600" },
};

const TYPE_LABELS: Record<string, string> = {
  deadline_warning: "Deadline Warning",
  status_change: "Status Change",
  offer_received: "Offer Received",
  determination_issued: "Determination Issued",
  payment_due: "Payment Due",
  document_required: "Document Required",
  entity_selected: "Entity Selected",
  system: "System",
};

export default function Notifications() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();

  const { data: all, isLoading, refetch, isFetching } = trpc.notifications.list.useQuery({ unreadOnly: false });
  const { data: unread } = trpc.notifications.list.useQuery({ unreadOnly: true });

  const markReadMutation = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.dashboard.stats.invalidate();
    },
  });

  const markAllMutation = trpc.notifications.markAllRead.useMutation({
    onSuccess: (data) => {
      utils.notifications.list.invalidate();
      utils.dashboard.stats.invalidate();
      toast.success(`Marked ${data.count} notification${data.count !== 1 ? "s" : ""} as read`);
    },
  });

  const unreadCount = unread?.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={APP_LOGO} className="h-8 w-8 rounded-lg object-cover" alt="logo" />
          <span className="text-lg font-bold text-slate-800">{APP_TITLE}</span>
        </div>
        <nav className="flex items-center gap-4">
          <button onClick={() => navigate("/dashboard")} className="text-sm text-slate-600 hover:text-blue-600">Dashboard</button>
          <button onClick={() => navigate("/disputes")} className="text-sm text-slate-600 hover:text-blue-600">Disputes</button>
          <span className="text-sm text-slate-600">{user?.name}</span>
          <Button variant="outline" size="sm" onClick={logout}><LogOut size={14} /></Button>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/dashboard")} className="text-slate-400 hover:text-slate-600">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                Notifications
                {unreadCount > 0 && <Badge variant="destructive">{unreadCount} unread</Badge>}
              </h1>
              <p className="text-sm text-slate-500">Deadline alerts and status updates for your disputes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </Button>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending}>
                Mark all read
              </Button>
            )}
          </div>
        </div>

        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-700 flex items-center gap-2">
              <Bell size={16} className="text-blue-500" />
              All Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : !all?.length ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <CheckCircle2 size={40} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs mt-1">Deadline alerts and status updates will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {all.map(n => {
                  // Map notificationType to priority level
                  const priorityMap: Record<string, string> = {
                    deadline_warning: "urgent", payment_due: "high",
                    offer_received: "medium", determination_issued: "medium",
                    status_change: "low", document_required: "high",
                    entity_selected: "low", system: "low",
                  };
                  const priority = (priorityMap[n.notificationType] ?? "low") as keyof typeof PRIORITY_CONFIG;
                  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.low;
                  const NotifIcon = cfg.icon;
                  return (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                        !n.isRead ? `${cfg.bg} ${cfg.border} border-l-4` : "hover:bg-slate-50"
                      }`}
                    >
                      <NotifIcon size={16} className={`mt-0.5 shrink-0 ${cfg.iconColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className={`text-sm font-semibold ${!n.isRead ? "text-slate-800" : "text-slate-600"}`}>
                              {n.title}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.message}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>
                              {priority}
                            </span>
                            {!n.isRead && (
                              <button
                                onClick={() => markReadMutation.mutate({ id: n.id })}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                              >
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-slate-400">
                            {TYPE_LABELS[n.notificationType] ?? n.notificationType}
                          </span>
                          {n.dueDate && (
                            <span className="text-xs text-red-500 font-medium flex items-center gap-1">
                              <Clock size={10} />
                              Due {new Date(n.dueDate).toLocaleDateString()}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">
                            {new Date(n.createdAt ?? Date.now()).toLocaleString()}
                          </span>
                          {n.disputeId && (
                            <button
                              onClick={() => navigate(`/disputes/${n.disputeId}`)}
                              className="text-xs text-blue-600 hover:text-blue-700"
                            >
                              View dispute →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
