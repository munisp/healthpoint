import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bell, BellRing, CheckCheck, AlertTriangle, Clock,
  Webhook, FileText, Scale, X, ExternalLink
} from "lucide-react";
import { useLocation } from "wouter";

type NotifType = "deadline" | "state_change" | "webhook_failure" | "document" | "determination" | "general";

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  disputeId?: string | null;
  read: boolean;
  createdAt: string | Date;
}

function notifIcon(type: NotifType) {
  switch (type) {
    case "deadline": return <Clock className="h-4 w-4 text-amber-500" />;
    case "state_change": return <Scale className="h-4 w-4 text-blue-500" />;
    case "webhook_failure": return <Webhook className="h-4 w-4 text-red-500" />;
    case "document": return <FileText className="h-4 w-4 text-violet-500" />;
    case "determination": return <CheckCheck className="h-4 w-4 text-green-500" />;
    default: return <Bell className="h-4 w-4 text-muted-foreground" />;
  }
}

function timeAgo(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const notifQuery = trpc.notifications.list.useQuery({}, {
    refetchInterval: 30_000,
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => notifQuery.refetch(),
  });

  const notifications: Notification[] = (notifQuery.data ?? []).map((n: any) => ({
    id: String(n.id),
    type: (n.type ?? "general") as NotifType,
    title: n.title ?? n.message ?? "Notification",
    body: n.body ?? n.message ?? "",
    disputeId: n.disputeId ?? null,
    read: !!n.read,
    createdAt: n.createdAt ?? new Date(),
  }));

  const unread = notifications.filter(n => !n.read).length;

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        className="relative flex items-center justify-center h-9 w-9 rounded-md hover:bg-muted transition-colors"
        onClick={() => setOpen(prev => !prev)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        {unread > 0 ? (
          <BellRing className="h-5 w-5 text-amber-500" />
        ) : (
          <Bell className="h-5 w-5 text-muted-foreground" />
        )}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-96 rounded-lg border bg-background shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Notifications</span>
              {unread > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{unread} new</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
              <button
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <ScrollArea className="max-h-[400px]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <Bell className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">All caught up</p>
                <p className="text-xs text-muted-foreground/70 mt-1">No notifications yet. Deadline alerts and dispute updates will appear here.</p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map(notif => (
                  <div
                    key={notif.id}
                    className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors ${!notif.read ? "bg-primary/5" : ""}`}
                    onClick={() => {
                      if (notif.disputeId) {
                        navigate(`/disputes/${notif.disputeId}`);
                        setOpen(false);
                      }
                    }}
                  >
                    <div className="mt-0.5 shrink-0">{notifIcon(notif.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-snug ${!notif.read ? "font-semibold" : "font-medium"}`}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                        )}
                      </div>
                      {notif.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">{timeAgo(notif.createdAt)}</span>
                        {notif.disputeId && (
                          <span className="flex items-center gap-0.5 text-[10px] text-primary">
                            <ExternalLink className="h-2.5 w-2.5" />
                            View dispute
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          {notifications.length > 0 && (
            <>
              <Separator />
              <div className="px-4 py-2.5 flex justify-center">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => { navigate("/notifications"); setOpen(false); }}
                >
                  View all notifications →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
