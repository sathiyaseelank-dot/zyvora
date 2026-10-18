# ZYVORA — Premium Car/Bike Flag E-Commerce

Monorepo for the ZYVORA e-commerce platform. Built with npm workspaces.

> **New here?** Read [HANDOFF.md](./HANDOFF.md) first — verified current state,
> live URLs (one of which is *not* this project), tooling gotchas, and open
> items.

## Structure

```
zyvora/
├── apps/
│   ├── web/          # React + Vite storefront (React 19, Tailwind 4)
│   └── api/          # Express + TypeScript backend
├── packages/
│   ├── ui/           # Shared UI primitives (brand-agnostic)
│   ├── config/       # Shared tooling config (tsconfig, tailwind, eslint)
│   └── types/        # Shared TypeScript interfaces (API contracts)
├── package.json      # workspaces root
├── eslint.config.js
└── .env.example
```

## Brand Colors

- **Black**: `#0a0a0a` — Primary text, backgrounds
- **Gold**: `#d4a843` — Primary brand accent, buttons, highlights
- **Cream**: `#fdf8f0` — Product surfaces, backgrounds
- **Red**: `#c0392b` — Destructive actions, errors
- **Yellow**: `#f39c12` — Secondary accents, warnings

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10 (ships with Node 20+)
- PostgreSQL (for API)

### Install

```bash
npm install
```

### Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### Database

```bash
npm run migrate   # run pending migrations
npm run seed      # load sample data
```

Production runs on Supabase. The same schema lives in `supabase/migrations/`
for the GitHub integration to apply — see [SUPABASE.md](./SUPABASE.md) for how
the two migration runners are kept from conflicting, and for the RLS setup.

### Development

```bash
# Start all apps (web + api)
npm run dev

# Or individually
npm run dev -w @zyvora/web
npm run dev -w @zyvora/api
```

### Build

```bash
npm run build
```

### Typecheck

```bash
npm run typecheck
```

### Lint & Format

```bash
npm run lint
npm run format
npm run format:check
```

## Apps

### Web (Storefront)

- **Framework**: React 19 + Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **UI**: @zyvora/ui primitives + shadcn/ui patterns
- **Port**: 5173

### API (Backend)

- **Framework**: Express
- **Language**: TypeScript
- **Database**: PostgreSQL via Kysely
- **Validation**: Zod
- **Port**: 4000
- **Health**: `GET /health`

## Packages

### @zyvora/types

Shared TypeScript interfaces for API contracts. Every type here has a corresponding Zod schema in the API.

Key types: `Product`, `Order`, `CheckoutSession`, `DeliveryAddress`, `ApiError`, `AuthRequiredResponse`, `MinorUnits`.

### @zyvora/ui

Brand-agnostic UI primitives. No business logic, no ZYVORA-specific colors.

Components: `Button` (variants: default, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, icon)

### @zyvora/config

Shared tooling configuration:

- `tsconfig.base.json` — Base TypeScript config
- `tailwind.config.ts` — ZYVORA brand theme
- `eslint.config.js` — ESLint flat config
- `prettier.config.js` — Prettier config with Tailwind plugin

## Stories (E1 - Project Foundation & Tooling)

- ZYV-15: Scaffold backend application (Node + Express + TypeScript) ✅
- ZYV-16: Set up environment variables and .env.example ✅
- ZYV-17: Scaffold frontend application (React + TypeScript + Tailwind) ✅
- ZYV-19: Inspect existing project directory and preserve usable work ✅
- ZYV-20: Create shared types and configuration package ✅
- ZYV-21: Configure lint, format and typecheck scripts ✅

## License

MIT
