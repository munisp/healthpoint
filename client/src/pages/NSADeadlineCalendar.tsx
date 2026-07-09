import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface DeadlineEvent {
  date: string;
  label: string;
  disputeId: string;
  referenceNumber: string;
  type: "submission" | "response" | "determination" | "payment" | "sla";
  urgent: boolean;
}

export default function NSADeadlineCalendar() {
  const [, navigate] = useLocation();
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const { data } = trpc.disputes.list.useQuery({ limit: 100, offset: 0 });
  const disputes = data?.items ?? [];

  // Build deadline events from disputes
  const events = useMemo<DeadlineEvent[]>(() => {
    const result: DeadlineEvent[] = [];
    disputes.forEach(d => {
      if (!d.createdAt) return;
      const created = new Date(d.createdAt);
      const ref = d.referenceNumber;
      const id = d.id;

      // NSA 30-day open negotiation deadline
      const negotiationDeadline = new Date(created);
      negotiationDeadline.setDate(negotiationDeadline.getDate() + 30);
      result.push({ date: negotiationDeadline.toISOString().split("T")[0], label: "Open Negotiation Deadline", disputeId: id, referenceNumber: ref, type: "submission", urgent: (negotiationDeadline.getTime() - today.getTime()) < 7 * 86400000 });

      // NSA IDR initiation deadline (4 business days after open negotiation)
      const idrDeadline = new Date(negotiationDeadline);
      idrDeadline.setDate(idrDeadline.getDate() + 4);
      result.push({ date: idrDeadline.toISOString().split("T")[0], label: "IDR Initiation Deadline", disputeId: id, referenceNumber: ref, type: "submission", urgent: (idrDeadline.getTime() - today.getTime()) < 7 * 86400000 });

      // Payer response deadline (10 business days)
      const payerResponse = new Date(created);
      payerResponse.setDate(payerResponse.getDate() + 14);
      result.push({ date: payerResponse.toISOString().split("T")[0], label: "Payer Response Due", disputeId: id, referenceNumber: ref, type: "response", urgent: (payerResponse.getTime() - today.getTime()) < 3 * 86400000 });

      // IDR entity determination (30 business days from IDR initiation)
      const determination = new Date(idrDeadline);
      determination.setDate(determination.getDate() + 30);
      result.push({ date: determination.toISOString().split("T")[0], label: "IDR Determination Due", disputeId: id, referenceNumber: ref, type: "determination", urgent: false });

      // Payment deadline (30 days after determination)
      const payment = new Date(determination);
      payment.setDate(payment.getDate() + 30);
      result.push({ date: payment.toISOString().split("T")[0], label: "Payment Deadline", disputeId: id, referenceNumber: ref, type: "payment", urgent: false });
    });
    return result;
  }, [disputes]);

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = viewDate.getDay();

  const eventsByDate = useMemo(() => {
    const map: Record<string, DeadlineEvent[]> = {};
    events.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [events]);

  const TYPE_COLORS: Record<string, string> = {
    submission: "bg-blue-500",
    response: "bg-amber-500",
    determination: "bg-purple-500",
    payment: "bg-green-500",
    sla: "bg-red-500",
  };

  // Upcoming deadlines in next 14 days
  const upcoming = events
    .filter(e => {
      const d = new Date(e.date);
      const diff = d.getTime() - today.getTime();
      return diff >= 0 && diff <= 14 * 86400000;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-blue-600" />
          NSA Deadline Calendar
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Visual calendar of all NSA/IDR statutory deadlines across active disputes</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
                  <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-2">
              <div className="grid grid-cols-7 gap-px">
                {DAYS.map(d => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
                ))}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`empty-${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = eventsByDate[dateStr] ?? [];
                  const isToday = dateStr === today.toISOString().split("T")[0];
                  const hasUrgent = dayEvents.some(e => e.urgent);
                  return (
                    <div key={day} className={`min-h-[70px] p-1 border rounded text-xs ${isToday ? "border-blue-400 bg-blue-50/50" : "border-transparent hover:border-muted"}`}>
                      <div className={`font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-blue-600 text-white" : hasUrgent ? "text-red-600" : ""}`}>
                        {day}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map((e, idx) => (
                          <div
                            key={idx}
                            className={`${TYPE_COLORS[e.type]} text-white rounded px-1 py-0.5 truncate cursor-pointer text-[10px]`}
                            title={`${e.referenceNumber}: ${e.label}`}
                            onClick={() => navigate(`/disputes/${e.disputeId}`)}
                          >
                            {e.referenceNumber.split("-").slice(-1)[0]}: {e.label.split(" ")[0]}
                          </div>
                        ))}
                        {dayEvents.length > 3 && <div className="text-muted-foreground text-[10px] pl-1">+{dayEvents.length - 3} more</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t text-xs">
                {Object.entries(TYPE_COLORS).map(([type, color]) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className={`w-3 h-3 rounded ${color}`} />
                    <span className="text-muted-foreground capitalize">{type}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming deadlines sidebar */}
        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Next 14 Days
                {upcoming.filter(e => e.urgent).length > 0 && (
                  <Badge className="bg-red-100 text-red-700 text-xs">{upcoming.filter(e => e.urgent).length} urgent</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              {upcoming.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-green-400 mb-2" />
                  No deadlines in the next 14 days
                </div>
              ) : (
                <div className="space-y-2">
                  {upcoming.map((e, i) => {
                    const daysLeft = Math.ceil((new Date(e.date).getTime() - today.getTime()) / 86400000);
                    return (
                      <div
                        key={i}
                        className={`p-2 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow ${e.urgent ? "border-red-200 bg-red-50/30" : "border-muted"}`}
                        onClick={() => navigate(`/disputes/${e.disputeId}`)}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-mono text-primary">{e.referenceNumber}</span>
                          <Badge className={`text-xs ${daysLeft <= 3 ? "bg-red-100 text-red-700" : daysLeft <= 7 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                            {daysLeft === 0 ? "Today" : `${daysLeft}d`}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{e.label}</p>
                        <p className="text-xs text-muted-foreground">{new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
