# Web App Template (tRPC + Manus Auth + Database)

This template gives you a React + Express + tRPC stack with Manus OAuth already wired. Procedures are your contracts, types flow end to end, and authentication “just works”.

---

## Quick Facts

- **tRPC-first:** define procedures in `server/routers.ts`, consume them with `trpc.*` hooks.
- **Superjson out of the box:** return Drizzle rows directly—`Date` stays a `Date`.
- **Auth baked in:** `/api/oauth/callback` handles Manus OAuth, `protectedProcedure` injects `ctx.user`.
- **Gateway-ready:** all RPC traffic is under `/api/trpc`, making it easy to route at the edge.

---

## Build Loop (Three Touch Points)

0. Replace the placeholder experience in `client/src/pages/Home.tsx` so the main entry point reflects your feature.
1. Update schema in `drizzle/schema.ts`, then run `pnpm db:push`.
2. Add database helpers in `server/db.ts` (return raw results).
3. Add or extend procedures in `server/routers.ts`, then wire the UI with `trpc.*.useQuery/useMutation`.

That’s it—no manual REST routes, no Axios client, no shared contract files.

---

## Frontend Workflow

1. Start by updating `client/src/pages/Home.tsx` (the landing page shell) using shadcn/ui components to introduce links, CTAs, or feature entry points. When you adjust branding, reference the shared `APP_TITLE`/`APP_LOGO` constants so the UI tracks environment configuration.
2. Create or update additional components under `client/src/pages/FeatureName.tsx`, continuing to leverage shadcn/ui + Tailwind for consistent styling.
3. Register the route (or navigation entry) in `client/src/App.tsx`.
4. Read data with `const { data, isLoading } = trpc.feature.useQuery(params);`.
5. Mutate data with `trpc.feature.useMutation()` and call `trpc.useUtils()` in the mutation's `onSuccess` callback to invalidate or optimistically update caches.
6. Use `useAuth()` for current user state, login URL from `getLoginUrl()`, and avoid direct cookie handling.
7. Handle loading/empty/error states in the UI—tRPC already surfaces typed responses and errors.

---

## Files You Own Most

```
drizzle/schema.ts → Database tables & types
server/db.ts → Query helpers (reuse across procedures)
server/routers.ts → tRPC procedures (auth + features)
client/src/App.tsx → Routes wiring & layout shells
client/src/lib/trpc.ts → tRPC client binding
client/src/pages/ → Feature UI that calls trpc hooks
```

Framework plumbing (OAuth, context, Vite bridge) lives under `server/_core`.

---

## Authentication Flow

- Manus OAuth completes at `/api/oauth/callback` and drops a session cookie.
- Each request to `/api/trpc` builds context via `server/_core/context.ts`, making the current user available as `ctx.user`.
- Wrap protected logic in `protectedProcedure`; public access uses `publicProcedure`.
- Frontend reads auth state with `trpc.auth.me.useQuery()` and invokes `trpc.auth.logout.useMutation()`—no cookie plumbing required.

---

## Frontend Prompt

- Use `trpc.*.useQuery/useMutation` for all backend calls—never introduce Axios/fetch wrappers.
- Invalidate caches with `trpc.useUtils()` helpers after mutations.
- Auth state comes from `useAuth()`; do not manipulate cookies manually.
- Build modern UI with shadcn/ui components (already installed) plus Tailwind utilities to match the design system.

---

## Environment Variables

| Key                        | What it controls                   |
| -------------------------- | ---------------------------------- |
| `DATABASE_URL`             | MySQL/TiDB connection string       |
| `JWT_SECRET`               | Session cookie signing secret      |
| `VITE_APP_ID`              | Manus OAuth application ID         |
| `OAUTH_SERVER_URL`         | Manus OAuth backend base URL       |
| `VITE_OAUTH_PORTAL_URL`    | Manus login portal URL (frontend)  |
| `OWNER_OPEN_ID`, `OWNER_NAME` | Optional preview identity seed |
| `VITE_APP_TITLE`             | Default title used by the login dialog and page header |
| `VITE_APP_LOGO`              | Logo image URL shared by the UI |

To change the app title or logo, update `VITE_APP_TITLE` and `VITE_APP_LOGO` in your environment configuration; do not edit these directly in code or commit `.env` files.

Set these via the tooling interface—do not commit `.env` files.

---

## Feature Checklist

- [ ] Tables updated in `drizzle/schema.ts`, migrations pushed (`pnpm db:push`)
- [ ] Query helper added in `server/db.ts` (returns raw Drizzle rows)
- [ ] Procedure created in `server/routers.ts` (choose `public` vs `protected`)
- [ ] UI calls the procedure via `trpc.*.useQuery/useMutation`
- [ ] Success + error paths verified in the browser

---

## Current Core Files

```
client/
  public/         ← Static assets copied verbatim to '/'
  src/
    pages/        ← Page-level components
    components/   ← Reusable UI & shadcn/ui
    contexts/     ← React contexts
    hooks/        ← Custom hooks
    lib/trpc.ts   ← tRPC client
    App.tsx       ← Routes & layout
    main.tsx      ← Providers
    index.css     ← global style
drizzle/          ← Schema & migrations
server/
  db.ts           ← Query helpers
  routers.ts      ← tRPC procedures
storage/          ← S3 helpers
shared/           ← Shared constants & types
```

Only touch the files under “←” markers. Anything under `server/_core` or other tooling directories is framework-level—avoid editing unless you are extending the infrastructure.

Assets placed under `client/public` are served with aggressive caching, so add a content hash to filenames (for example, `logo.3fa9b2e4.svg`) whenever you replace a file and update its references to avoid stale assets.

Files in `client/public` are available at the root of your site—reference them with absolute paths (`/logo.3fa9b2e4.svg`, `/robots.txt`, etc.) from HTML templates, JSX, or meta tags.

---

## LLM Integration (Optional)

Use the preconfigured LLM helpers. Credentials are injected from the platform (no manual setup required).

```ts
import { invokeLLM } from "./server/_core/llm";

/**
 * Simple chat completion
 * type Role = "system" | "user" | "assistant" | "tool" | "function";
 * type TextContent = {
 *   type: "text";
 *   text: string;
 * };
 *
 * type ImageContent = {
 *   type: "image_url";
 *   image_url: {
 *     url: string;
 *     detail?: "auto" | "low" | "high";
 *   };
 * };
 *
 * type FileContent = {
 *   type: "file_url";
 *   file_url: {
 *     url: string;
 *     mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
 *   };
 * };
 * 
 * export type Message = {
 *   role: Role;
 *   content: string | Array<ImageContent | TextContent | FileContent>
 * };
 *
 * Supported parameters:
 * messages: Array<{
 *   role: 'system' | 'user' | 'assistant' | 'tool',
 *   content: string | { tool_call: { name: string, arguments: string } }
 * }>
 * tool_choice?: 'none' | 'auto' | 'required' | { type: 'function', function: { name: string } }
 * tools?: Tool[]
 */
const response = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, world!" },
  ],
});
```

Tips
- Always call llm functions from server-side code (e.g., inside tRPC procedures), to avoid exposing your API key.
- You don't need to manually set the model; the helper uses a sensible default.

### Structured Responses (JSON Schema)

Ask the model to return structured JSON via `response_format`:

```ts
import { invokeLLM } from "./server/_core/llm";

const structured = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant designed to output JSON." },
    { role: "user", content: "Extract the name and age from the following text: \"My name is Alice and I am 30 years old.\"" },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "person_info",
      strict: true,
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The name of the person" },
          age: { type: "integer", description: "The age of the person" },
        },
        required: ["name", "age"],
        additionalProperties: false,
      },
    },
  },
});

// The model responds with JSON content matching the schema.
// Access via `structured.choices[0].message.content` and JSON.parse if needed.
```
---

## ☁️ S3 File Storage (Production‑ready)

Use the preconfigured S3 helpers in `server/storage.ts`. Credentials are injected from the platform (no manual setup required).

```ts
import { storagePut, storageGet } from "./server/storage";

// Upload bytes to S3
const { key, url } = await storagePut(
  `uploads/${Date.now()}-file.png`,
  fileBuffer, // Buffer | Uint8Array | string
  "image/png"
);

// Generate a presigned GET URL (default 5 min)
const { url: downloadUrl } = await storageGet(key, 300);
```

Tips
- Save metadata (path/URL/ACL/owner/mime/size) in your database; use S3 for the actual file bytes.
- Prefer Biz presigned URLs for large browser uploads; otherwise POST to your server and then call `storagePut`.

---

## Core File References

`drizzle/schema.ts`
```ts
import { mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// TODO: Add your tables here
```

`server/db.ts`
```ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.id) {
    throw new Error("User ID is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      id: user.id,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role === undefined) {
      if (user.id === ENV.ownerId) {
        user.role = 'admin';
        values.role = 'admin';
        updateSet.role = 'admin';
      }
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUser(id: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
```

`server/routers.ts`
```ts
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";

export const appRouter = router({
  system: router({
    health: publicProcedure
      .input(
        z.object({
          timestamp: z.number().min(0, "timestamp cannot be negative"),
        })
      )
      .query(() => ({
        ok: true,
      })),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: protectedProcedure.mutation(opts => {
      const { ctx } = opts;

      ctx.res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: ENV.isProduction,
        path: "/",
      });

      return {
        success: true,
      } as const;
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
```

`client/src/App.tsx`
```tsx
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
```

`client/src/lib/trpc.ts`
```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();
```

`client/src/pages/Home.tsx`
```tsx
import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { AlertCircle, Loader2 } from "lucide-react";

/**
 * Build polished modern webapp experiences. Visit the README for the full playbook.
 * All content in this page are only for example, delete if unneeded
 */
export default function Home() {
  let { user, loading, error, isAuthenticated, logout } = useAuth();
  // If theme is switchable in App.tsx, we can implement theme toggling like this:
  // const { theme, toggleTheme } = useTheme();

  const LoginBoxContent = () => {
    return (
      <>
        <CardHeader className="text-center">
          {isAuthenticated ? (
            <>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>You are signed in</CardDescription>
            </>
          ) : (
            <>
              <CardTitle>Get Started</CardTitle>
              <CardDescription>Sign in to use this App</CardDescription>
            </>
          )}
        </CardHeader>

        <Separator />

        <CardContent className="flex justify-center">
          {isAuthenticated ? (
            <div className="flex items-center gap-4">
              <Avatar className="size-12">
                <AvatarFallback className="text-lg font-semibold">
                  {user?.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-semibold">{user?.name}</div>
                <div className="text-sm text-muted-foreground">
                  {user?.email}
                </div>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={() => (window.location.href = getLoginUrl())}
            >
              Sign In
            </Button>
          )}
        </CardContent>
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="w-full border-b px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-2">
          <img
            src={APP_LOGO}
            className="h-8 w-8 rounded-lg border-border bg-background object-cover"
          />
          <span className="text-xl font-bold">{APP_TITLE}</span>
        </div>

        <div className="flex items-center gap-2">
          {isAuthenticated && (
            <Button variant="outline" onClick={logout}>
              Sign Out
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <Card style={{ minWidth: "350px" }}>
          {loading ? (
            <div className="flex items-center justify-center p-4">
              {/* Show loading at component level, not page level - keeps UI interactive */}
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <LoginBoxContent />
          )}
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}
```

---

## 🎨 Frontend Best Practices (shadcn-first)

- Prefer shadcn/ui components for interactions to keep a modern, consistent look; import from `@/components/ui/*` (e.g., `button`, `card`, `dialog`).
- Compose Tailwind utilities with component variants for layout and states; avoid excessive custom CSS. Use built-in `variant`, `size`, etc. where available.
- Preserve design tokens: keep the `@layer base` rules in `client/src/index.css`. Utilities like `border-border` and `font-sans` depend on them.
- Consistent design language: use spacing, radius, shadows, and typography via tokens. Extract shared UI into `components/` for reuse instead of copy‑paste.
- Accessibility and responsiveness: keep visible focus rings and ensure keyboard reachability; design mobile‑first with thoughtful breakpoints.
- Theming: Choose dark/light theme to start with for ThemeProvider according to your design style (dark or light bg), then manage colors pallette with CSS variables in `client/src/index.css` instead of hard‑coding to keep global consistency;
- Micro‑interactions and empty states: add motion, empty states, and icons tastefully to improve quality without distracting from content.
- Navigation: Design clear and intuitive navigation structure appropriate for the app type (e.g., top/side nav for multi-page apps, breadcrumbs or contextual navigation for SPAs)'. When building dashboard-like experience, use sidebar-nav to keep all page entry easy to access.

**React component rules:**
- Never call setState/navigation in render phase → wrap in `useEffect`

---

## Tips

- Keep router files under ~150 lines—split into `server/routers/<feature>.ts` once they grow.
- Reset cached queries (`utils.feature.invalidate()`) after mutations to keep UI fresh.
- For optimistic updates, use the `onMutate/onError/onSettled` pattern.

---

## Dashboard & Admin Panel Apps

For dashboard or admin-focused applications, follow these patterns:

**Layout & Navigation**
- Use `DashboardLayout` component from `client/src/components/DashboardLayout.tsx` and remove any page-level headers to avoid duplication.
- When use this layout, read its content before make any change, only edit the `menuItems` array. Do not modify the sidebar implementation itself unless you have to.

**Role-based Access Control**
When building apps with distinct access levels (e.g., e-commerce with public home, user account, admin panel):
- The `user` table includes a `role` field (enum: `admin` | `user`) for identity separation
- Use `ctx.user.role` in procedures to gate admin-only operations
- Frontend can conditionally render navigation/routes based on `useAuth().user?.role`

Example procedure pattern:
```ts
adminOnlyProcedure: protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
}),
```

**Managing Admins**
- To promote a user to admin, update the `role` field directly in the database via the system UI or SQL
- If you need additional roles beyond `admin`/`user`, extend the enum in `drizzle/schema.ts` and push the migration

---

## Common Pitfalls

### Infinite loading loops from unstable references
**Anti-pattern:** Creating new objects/arrays in render that are used as query inputs
```tsx
// ❌ Bad: New Date() creates new reference every render → infinite queries
const { data } = trpc.items.getByDate.useQuery({
  date: new Date(), // ← New object every render!
});

// ❌ Bad: Array/object literals in query input
const { data } = trpc.items.getByIds.useQuery({
  ids: [1, 2, 3], // ← New array reference every render!
});
```

**Correct approach:** Stabilize references with useState/useMemo
```tsx
// ✅ Good: Initialize once with useState
const [date] = useState(() => new Date());
const { data } = trpc.items.getByDate.useQuery({ date });

// ✅ Good: Memoize complex inputs
const ids = useMemo(() => [1, 2, 3], []);
const { data } = trpc.items.getByIds.useQuery({ ids });
```

**Why this happens:** TRPC queries trigger when input references change. Objects/arrays created in render have new references each time, causing infinite re-fetches.

### Navigation dead-ends in subpages
**Problem:** Creating nested routes without escape routes—no header nav, no sidebar, no back button.

**Solution:** Choose navigation based on app structure:
```tsx
// For dashboard/multi-section apps: Use persistent sidebar (from shadcn/ui)
import { SidebarProvider, Sidebar, SidebarContent, SidebarInset } from "@/components/ui/sidebar";

<SidebarProvider>
  <Sidebar>
    <SidebarContent>
      {/* Navigation menu items - always visible */}
    </SidebarContent>
  </Sidebar>
  <SidebarInset>
    {children}  {/* Page content */}
  </SidebarInset>
</SidebarProvider>

// For linear flows (detail pages, wizards): Use back button
import { useRouter } from "wouter";

const router = useRouter();
<div>
  <Button variant="ghost" onClick={() => router.back()}>
    ← Back
  </Button>
  <ItemDetailPage />
</div>
```

### Dark mode styling without theme configuration
**Problem:** Using dark foreground colors without setting the theme, making text invisible on default light backgrounds.

**Solution:** Set `defaultTheme="dark"` in App.tsx, then update CSS variables in `index.css`:
```tsx
// App.tsx: Set the default theme first
<ThemeProvider defaultTheme="dark">  {/* Applies .dark class to root */}
  <div className="text-foreground bg-background">
    Content  {/* Now uses dark theme CSS variables */}
  </div>
</ThemeProvider>
```

```css
/* index.css: Adjust color palette for dark theme */
.dark {
  --background: oklch(0.145 0 0);  /* Dark background */
  --foreground: oklch(0.985 0 0);  /* Light text */
  /* ... other variables ... */
}
```
