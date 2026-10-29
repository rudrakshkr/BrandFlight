# BrandFlight

**Pre-publication brand governance for marketing copy and campaign assets.**

BrandFlight is a hackathon prototype that checks marketing drafts against a structured brand rulebook and approved facts before publication. It combines deterministic checks with Gemini-based semantic review and gives creators, managers, and reviewers a shared workflow for resolving findings and recording review decisions.

## What it does

- **Brand rulebook:** manage brand rules, approved terminology, product facts, and brand colours.
- **Text preflight:** scan copy for configured terminology rules and unsupported numerical claims; use Gemini for semantic tone and claim review when configured.
- **Image preflight:** upload campaign images, inspect dominant colours, compare them with the approved palette, and validate alt-text presence and length.
- **Explainable findings:** show the finding category, evidence, rule reference, confidence, and guidance where available.
- **Campaign workflow:** save drafts, submit them for review, view revision history, discuss submissions with comments, request overrides, request changes with a reason, and approve submissions according to role permissions.
- **Role-based access:** JWT-authenticated Creator, Manager, and Reviewer roles with server-side permissions.
- **Audit receipts:** record hashes for audit inputs and relevant brand configuration so a result can be tied to the inputs that were checked.
- **Judge onboarding:** one-click demo sign-in buttons for Creator, Manager, and Reviewer are available when demo access is enabled in both the frontend and backend configuration.

## Application architecture

```text
Browser (React + Vite)
        |
        | HTTP / JSON + bearer JWT
        v
Express + TypeScript API
  |        |           |
  |        |           +-- Gemini API (semantic tone/claim review and copy refinement)
  |        +-------------- Cloudinary (image asset storage) + Sharp (image analysis)
  +----------------------- Prisma 7 + PostgreSQL
```

### Technology stack

| Layer | Current implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, React Router, custom CSS |
| Backend | Node.js, Express 5, TypeScript, JWT, bcryptjs |
| Database | PostgreSQL, Prisma 7, `@prisma/adapter-pg` |
| Semantic review | Google GenAI SDK; `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite` |
| Image handling | Sharp for image analysis; Cloudinary for uploaded asset storage |
| Deployment targets | Frontend: Vercel; API: Render; database: PostgreSQL provider such as Neon |

The implementation has evolved since the Round 1 plan. This README describes the current package manifests and server defaults; it does not claim that the Round 1 planned React 18, Tailwind CSS, or Gemini 2.5 Flash configuration is the current stack.

## Quick start (local development)

### Prerequisites

- Node.js and npm compatible with the current Vite toolchain
- A PostgreSQL database (a local database or a development Neon database)
- A Gemini API key for semantic tone/claim review
- Cloudinary credentials for image uploads

The API can start without Gemini or Cloudinary configured, but the corresponding AI or image-upload capabilities will not be fully available.

### 1. Configure the server

From the repository root:

```bash
cd server
cp .env.example .env
npm install
```

Edit `server/.env` and set the values below. Keep this file local; never commit it.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma and the API |
| `JWT_SECRET` | Strong signing secret; the API requires at least 32 characters |
| `CLIENT_URL` | Exact browser origin allowed by CORS, normally `http://localhost:5173` locally |
| `PORT` | API port; defaults to `3000` |
| `GEMINI_API_KEY` | Google Gemini API key for semantic review and copy refinement |
| `GEMINI_MODEL` | Optional model override; defaults to `gemini-3.5-flash-lite` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name for image uploads |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `DEMO_CREATOR_PASSWORD` | Password used to seed the Creator account |
| `DEMO_MANAGER_PASSWORD` | Password used to seed the Manager account |
| `DEMO_REVIEWER_PASSWORD` | Password used to seed the Reviewer account |
| `DEMO_LOGIN_ENABLED` | Set to `true` to allow the one-click demo-login API endpoint |

All three demo passwords must be at least 16 characters for the seed script. They are used to seed normal password login; the one-click demo endpoint issues a short-lived token for the matching seeded role without asking for that password.

### 2. Generate Prisma Client, migrate, and seed

Run these commands from `server/`. This repository names its Prisma configuration `prisma7.config.ts`, so pass it explicitly to the Prisma CLI:

```bash
npx prisma generate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npx prisma db seed --config prisma7.config.ts
```

The seed script creates the demo Creator, Manager, and Reviewer users, the `brandflight-demo` / **Northstar Workspace** brand profile, starter rules, approved product facts, and the demo colour palette. Seeding requires the database and all three demo password variables to be configured.

### 3. Start the API

Still in `server/`:

```bash
npm run dev
```

The default API origin is `http://localhost:3000`. Check the health endpoint:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok","service":"BrandFlight API"}
```

### 4. Configure and start the frontend

In a second terminal, from the repository root:

```bash
cd client
cp .env.example .env
npm install
```

Set `client/.env`:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_DEMO_MODE=true
```

`VITE_API_URL` must be the **API origin**, without an `/api` suffix. The frontend adds the route paths itself. Demo buttons are shown automatically in Vite development mode; `VITE_DEMO_MODE=true` enables their visibility in a production build.

Start the frontend:

```bash
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## Judge access and demo sign-in

The login screen offers one-click access to the three seeded roles:

| Role | Demo account email | Intended use |
|---|---|---|
| Creator | `creator@brandflight.demo` | Draft copy, run audits, resolve findings, save and submit content, and request overrides |
| Manager | `manager@brandflight.demo` | Manage brand guidance and participate in the review workflow |
| Reviewer | `reviewer@brandflight.demo` | Review submissions, comment, request changes, and approve content |

For local judging, make sure the three accounts have been seeded and `DEMO_LOGIN_ENABLED=true` is set in `server/.env`. In a production frontend build, set `VITE_DEMO_MODE=true` at build time as well.

**Security warning:** when `DEMO_LOGIN_ENABLED=true`, anyone who can reach the API can request a demo session for any of these three roles. Enable this only for a deliberately public demo/judge environment, use a non-production database with synthetic data, and turn it off when the judging window ends. `VITE_DEMO_MODE` only controls whether the buttons are shown; the backend `DEMO_LOGIN_ENABLED` switch controls whether the endpoint issues tokens.

If demo sign-in is unavailable, check that the backend switch is exactly `true`, all three users exist in the database, `JWT_SECRET` is configured, and the frontend's `VITE_API_URL` points to the correct API origin.

## Useful scripts

### Frontend (`client/`)

```bash
npm run dev      # Start Vite development server
npm run build    # Type-check and build the frontend
npm run lint     # Run ESLint
npm run preview  # Preview the production build locally
```

### Backend (`server/`)

```bash
npm run dev      # Run the API with tsx watch
npm run build    # Compile TypeScript
npm start        # Run the compiled API
npm test         # Run unit tests and the optional API integration suite
```

The unit tests cover audit receipt hashing and review-decision validation. The API integration suite is skipped unless `TEST_DATABASE_URL` points to a separate, disposable PostgreSQL test database. Configure and migrate that database according to the integration test's setup before using it. **Never point test runs at production or at a database containing data you need to keep.** A skipped integration suite is not evidence that the end-to-end workflow passed.

## Important API routes

| Route | Purpose |
|---|---|
| `GET /api/health` | API health check |
| `POST /api/auth/login` | Authenticate using email and password |
| `POST /api/auth/demo-login` | Opt-in one-click role-based demo sign-in |
| `GET /api/auth/me` | Return the authenticated user |
| `/api/brands` | Brand profiles, rules, approved facts, and brand assets |
| `/api/submissions` | Drafts, submission workflow, comments, and review operations |
| `POST /api/audit/refine` | Creator-only copy refinement endpoint |
| `POST /api/audit` | Authenticated text preflight audit |
| `/api/audit/image` | Image audit and related image workflow endpoints |

Protected API operations require `Authorization: Bearer <token>`. Server middleware, not frontend navigation alone, enforces the user's role.

## Deployment checklist (Vercel + Render + PostgreSQL)

Code in a repository snapshot cannot verify whether a live deployment is correctly configured. Before giving judges the URL, check each item in the actual hosting dashboards:

- [ ] Set the frontend's `VITE_API_URL` to the deployed API origin (no `/api` suffix) and rebuild the frontend.
- [ ] Set backend `CLIENT_URL` to the exact deployed frontend origin so CORS permits browser requests.
- [ ] Set a unique `JWT_SECRET` of at least 32 characters.
- [ ] Set `DATABASE_URL`, run the migrations against the intended deployment database, and seed the demo brand and accounts.
- [ ] Set `GEMINI_API_KEY` and verify a real text audit from a fresh browser session.
- [ ] Set all three Cloudinary credentials and verify a real image upload and audit from a fresh browser session.
- [ ] For judge access, temporarily set backend `DEMO_LOGIN_ENABLED=true` and frontend build variable `VITE_DEMO_MODE=true`; test each role and confirm role restrictions.
- [ ] Disable public demo sign-in after judging if it is no longer required.

Do not assume that local success proves the deployed migrations, environment variables, CORS policy, Gemini calls, or Cloudinary uploads work.

## Known limitations

- This is a prototype, not a replacement for legal, compliance, or accessibility review. AI findings can be wrong or miss context; reviewers remain responsible for final decisions.
- Image checks analyse image colour information and alt-text metadata. They do not perform full OCR of text inside flattened banners and do not certify complete WCAG 2.1 conformance or replace a human accessibility audit.
- A direct phrase replacement is offered only when a non-empty, safe suggestion is available. Deterministic terminology and numerical-claim findings may provide guidance without a direct replacement span.
- Audit receipts bind results to input/configuration hashes; they are not a separate append-only, tamper-proof decision-event log.
- The integration suite needs a dedicated PostgreSQL test database. Without it, the current test command can report a skipped integration suite while the unit tests pass.
- Live service health and external credentials must be verified in the deployment environment; they cannot be proven by the repository alone.

## Repository layout

```text
client/   React + Vite frontend
server/   Express API, Prisma schema/migrations, seed script, tests
README.md Project setup, feature overview, and operational notes
```

## Security and contribution notes

- Never commit `.env` files, real API keys, JWT secrets, database URLs, or actual demo passwords.
- Use `.env.example` files only for variable names and safe placeholders.
- Keep `.brandflight-backups/`, local backup copies, generated Repomix exports, dependency folders, and build output out of the public repository.
- Before committing, review `git status --short`, inspect `git diff`, and run `git diff --check`.
