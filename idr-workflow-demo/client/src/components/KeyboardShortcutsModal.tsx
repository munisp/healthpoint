import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Keyboard } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
  category: string;
}

const SHORTCUTS: Shortcut[] = [
  // Navigation
  { keys: ["?"], description: "Open keyboard shortcuts", category: "Navigation" },
  { keys: ["Cmd", "K"], description: "Open command palette", category: "Navigation" },
  { keys: ["Cmd", "/"], description: "Focus global search", category: "Navigation" },
  { keys: ["G", "D"], description: "Go to Dashboard", category: "Navigation" },
  { keys: ["G", "I"], description: "Go to Disputes", category: "Navigation" },
  { keys: ["G", "N"], description: "New dispute", category: "Navigation" },
  { keys: ["G", "A"], description: "Go to Audit Trail", category: "Navigation" },
  { keys: ["G", "L"], description: "Go to Financial Ledger", category: "Navigation" },
  { keys: ["G", "S"], description: "Go to Global Search", category: "Navigation" },
  // Disputes
  { keys: ["Cmd", "N"], description: "Create new dispute", category: "Disputes" },
  { keys: ["Cmd", "E"], description: "Export current view as CSV", category: "Disputes" },
  { keys: ["Cmd", "F"], description: "Focus filter / search bar", category: "Disputes" },
  { keys: ["Cmd", "A"], description: "Select all visible disputes", category: "Disputes" },
  // Document Analyzer
  { keys: ["Cmd", "U"], description: "Upload document for analysis", category: "Documents" },
  { keys: ["Cmd", "S"], description: "Save extracted field corrections", category: "Documents" },
  // UI
  { keys: ["Cmd", "D"], description: "Toggle dark / light mode", category: "UI" },
  { keys: ["Escape"], description: "Close modal / dialog", category: "UI" },
  { keys: ["Tab"], description: "Move focus forward", category: "UI" },
  { keys: ["Shift", "Tab"], description: "Move focus backward", category: "UI" },
];

const CATEGORIES = Array.from(new Set(SHORTCUTS.map(s => s.category)));

function KeyChip({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 text-[11px] font-mono font-semibold rounded border border-border bg-muted text-foreground shadow-sm">
      {label}
    </kbd>
  );
}

export default function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // ? key opens the modal (not inside an input/textarea)
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {CATEGORIES.map(category => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-2">
                {SHORTCUTS.filter(s => s.category === category).map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-foreground/80">{shortcut.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((key, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          {ki > 0 && <span className="text-[10px] text-muted-foreground">+</span>}
                          <KeyChip label={key} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t mt-2">
          <p className="text-xs text-muted-foreground text-center">
            Press <KeyChip label="?" /> anywhere outside an input to toggle this panel &nbsp;·&nbsp; <KeyChip label="Esc" /> to close
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
