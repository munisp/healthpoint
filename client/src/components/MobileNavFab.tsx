import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import {
  Bell, FilePlus2, LayoutDashboard, Menu, ScrollText, Search, Settings,
} from "lucide-react";

const DESTINATIONS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Disputes", href: "/disputes", icon: ScrollText },
  { label: "New Dispute", href: "/disputes/new", icon: FilePlus2 },
  { label: "Search", href: "/search", icon: Search },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

/**
 * MobileNavFab - floating action button + bottom sheet giving thumb-zone
 * navigation to the 6 most-used destinations on small screens.
 * Hidden on md+ breakpoints; respects safe-area-inset-bottom.
 * Mounted in DashboardLayout by the wiring agent.
 */
export default function MobileNavFab() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <div
      className="md:hidden fixed right-4 z-50"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
            aria-label="Open navigation menu"
          >
            <Menu size={22} />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="rounded-t-xl"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        >
          <SheetHeader>
            <SheetTitle>Navigate</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 py-4">
            {DESTINATIONS.map(d => (
              <Button
                key={d.href}
                variant="outline"
                className="h-16 flex-col gap-1.5 text-xs"
                onClick={() => go(d.href)}
              >
                <d.icon size={18} className="text-primary" />
                {d.label}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
