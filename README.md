# BrandFlight

**Pre-publication brand governance for marketing copy and campaign assets.**

BrandFlight helps teams check campaign content against a brand's rules, approved facts and visual standards before it is published. Creators can audit and improve drafts, while Managers and Reviewers manage brand guidance and make the final review decision.

> **Codex 48 — Round 3 Final Build**  
> A working web application built by Team BrandFlight.

## Live project

| Resource | Link |
|---|---|
| **Live application** | https://brand-flight.vercel.app |
| **Backend health check** | https://brandflight.onrender.com/api/health |
| **Source repository** | https://github.com/rudrakshkr/BrandFlight |

The deployed application uses a separate frontend and API. The API connects to PostgreSQL through Prisma; uploaded images are stored in Cloudinary.

## What BrandFlight does

BrandFlight brings preflight checks and human approval into one workflow:

1. **Configure the brand.** A Manager maintains the brand profile, rules, approved facts, colour palette, accessibility standards and approved logo asset.
2. **Prepare a campaign.** A Creator writes campaign copy and uploads an image with meaningful alt text.
3. **Run preflight checks.** BrandFlight checks text and imagery, then returns findings with evidence and remediation guidance.
4. **Resolve findings.** The Creator edits the draft, applies a safe suggested replacement when one is available, or requests an exception with a structured reason.
5. **Submit for review.** The Creator saves the draft and submits it with the required audit evidence.
6. **Review and decide.** A Reviewer or Manager comments, requests changes with a reason, or approves the campaign.
7. **Verify the release.** Approved campaigns can receive a Release Passport that records the approved version and can be checked through a public verification page.

Automated checks assist the team; they do not replace human review or silently publish content.

## Main features

### Brand rulebook and approved facts

- Create and edit brand profiles, rules and approved facts.
- Configure terminology, tone, claim, visual and accessibility guidance.
- Maintain the approved brand colour palette and role-based foreground/background colour pairs.
- Register an approved logo or other brand asset for image comparison.
- Import rules and facts using structured JSON.

### Text preflight

- Deterministic checks identify configured terminology and numerical claims that do not match approved facts.
- Gemini provides semantic tone and claim review when an API key is configured.
- Findings include the category, severity, rule reference, evidence, confidence and suggested action where available.
- A direct replacement is offered only when a safe, non-empty replacement is available. Some findings provide guidance for manual editing instead.

### Image preflight and accessibility

- Accept campaign image uploads and store uploaded assets through Cloudinary.
- Use Sharp to inspect image dimensions and dominant colours and compare the palette with the active brand profile.
- Check alt-text presence and length.
- Locate visible text regions with Gemini assistance, then sample foreground and background pixels using Sharp to calculate contrast where the image region can be measured reliably.
- Compare measured text contrast with the configured WCAG 2.1 role target. Ambiguous, variable, transparent, multi-colour or otherwise unreliable regions are sent for manual review rather than being reported as a pass.
- Compare uploaded campaign artwork with a Manager-approved logo reference when one is configured.

The image check is a screening aid, not a complete WCAG conformance audit or certification. It does not currently measure every non-text icon or control boundary.

### Creator, Reviewer and Manager workflow

- JWT-authenticated roles with server-side role checks.
- Persistent campaign drafts, submissions and revision history.
- Reviewer comments and change requests with a required explanation.
- Creator override requests with structured categories: **Rule unclear**, **Channel exception** and **False positive**.
- Reviewer or Manager decisions on override requests, including a recorded decision note.
- Manager-only governance insights that aggregate override categories, outcomes and recurring rule references.
- Campaign change comparison to help reviewers understand what changed between revisions.

### Privacy-aware text processing

Before text is sent to Gemini, BrandFlight uses pattern-based detection to temporarily mask supported values such as email addresses, UPI IDs, Indian phone numbers, Aadhaar-shaped values, PAN-shaped values and Luhn-valid payment-card numbers. The original values are restored in the returned result, and detected PII ranges are excluded from numerical-claim detection.

This is not a general-purpose PII detector: it can miss information outside the supported patterns. Image pixels are not masked. Image processing uses external services, so the application requires an explicit acknowledgement before the image is sent for processing. Sensitive information should be manually redacted from images before upload.

### Release Passports

When a campaign is approved, BrandFlight can issue a Release Passport containing a snapshot of the campaign, relevant audit receipts, brand configuration and approval details. The snapshot is signed using HMAC-SHA256. A public, read-only verification route checks the signature and whether the saved snapshot still matches the current campaign and relevant evidence.

The passport provides a verifiable approval snapshot; it is not a blockchain record or a general-purpose append-only event ledger.

## PahariKnits judge workspace

The judge database is seeded with a sample brand workspace named **PahariKnits**, based on a Himalayan apparel catalogue. It includes:

- Six brand rules covering craft-led tone, unsupported superlatives, product claims, visual identity, alt text and text contrast.
- Nine approved product and policy facts covering product names, listed prices, materials, origins and return conditions.
- A navy, cream, copper and teal colour palette, with five role-based accessibility pairs.
- Demo accounts for Creator, Manager and Reviewer.

The official PahariKnits logo is included at `client/public/pahariknits-logo.png`. After deployment, a Manager should upload it once under **Brand Rulebook → Approved Brand Assets**, set the expected wordmark to `PahariKnits`, and save it as the primary logo reference. Keep the **Logo required on campaign images** option off unless the campaign creative being audited actually contains the logo.

The bundled logo is a brand reference asset, not a product photograph. For the image-audit walkthrough, upload an authentic PahariKnits product or campaign image using the Creator account.

## Technology and architecture

| Layer | Implementation | Responsibility |
|---|---|---|
| Frontend | React 19, TypeScript, Vite 8, React Router | Creator workspace, rulebook, campaign lists, review queue and verification UI |
| API | Node.js, Express 5, TypeScript | REST endpoints, authentication, validation and workflow enforcement |
| Authentication | JWT and bcryptjs | Signed user sessions and password hashing |
| Database | PostgreSQL, Prisma 7, `@prisma/adapter-pg` | Users, brands, rules, facts, assets, submissions, revisions, comments, receipts and passports |
| Semantic checks | Google GenAI SDK (default model: `gemini-3.5-flash-lite`) | Tone and claim review, text-region location and copy refinement |
| Image processing | Sharp | Dominant-colour and pixel-sampling analysis |
| Image storage | Cloudinary | Uploaded campaign and approved brand assets |
| Hosting | Vercel, Render and PostgreSQL (Neon for the judge environment) | Frontend, API and persistent data |

### Request flow

```text
Creator / Manager / Reviewer browser
              |
              | HTTPS, JSON and bearer JWT
              v
        React + Vite frontend
              |
              v
       Express + TypeScript API
          /       |        \
         /        |         \
        v         v          v
   Rule checks  Gemini      Sharp
        |       semantic   image/pixel
        |       review     analysis
        |         |          |
        +---------+----------+
                  |
                  v
         Prisma 7 + PostgreSQL
                  |
          Cloudinary assets
```

Audit receipts bind an audit result to the input and relevant configuration hashes. This makes it possible to reject submissions whose draft or audit evidence has become stale. A stale draft must be audited again before it can proceed through the required workflow.

## Getting started

### Requirements

- Node.js and npm compatible with the current Vite toolchain.
- A PostgreSQL database for local development.
- A Gemini API key for semantic text review and image text-region assistance.
- Cloudinary credentials for image uploads and approved brand assets.

The API can start without Gemini or Cloudinary credentials, but the related features will be unavailable or incomplete.

### 1. Configure the backend

From the repository root:

```bash
cd server
npm install
cp .env.example .env
```

Set the following values in `server/.env`. Never commit this file.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for the intended local or judge database |
| `JWT_SECRET` | Yes | Random signing secret of at least 32 characters |
| `CLIENT_URL` | Yes | Exact frontend origin allowed by CORS (local default: `http://localhost:5173`) |
| `PORT` | No | API port (defaults to `3000`) |
| `GEMINI_API_KEY` | For AI features | Google Gemini API key |
| `GEMINI_MODEL` | No | Model override; defaults to `gemini-3.5-flash-lite` |
| `CLOUDINARY_CLOUD_NAME` | For image features | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | For image features | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | For image features | Cloudinary API secret |
| `RELEASE_PASSPORT_SECRET` | No | Optional separate signing secret; defaults to `JWT_SECRET` if unset |
| `DEMO_CREATOR_PASSWORD` | For seeding | Creator account password (at least 16 characters) |
| `DEMO_MANAGER_PASSWORD` | For seeding | Manager account password (at least 16 characters) |
| `DEMO_REVIEWER_PASSWORD` | For seeding | Reviewer account password (at least 16 characters) |
| `DEMO_LOGIN_ENABLED` | For demo buttons | Set to `true` to enable the role-based demo-login endpoint |

Use unique random values for secrets and demo passwords. Do not paste credentials into issues, screenshots or the README.

### 2. Generate Prisma Client, migrate and seed

Run from `server/`:

```bash
npx prisma generate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts
npx prisma db seed --config prisma7.config.ts
```

Apply migrations **before** running the seed. A new database has no application tables until `migrate deploy` succeeds. The seed script creates the three demo accounts and upserts the PahariKnits brand profile, rules and approved facts. It does not delete submissions or review history.

### 3. Start the API

From `server/`:

```bash
npm run dev
```

The local API defaults to `http://localhost:3000`. Check it with:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok","service":"BrandFlight API"}
```

### 4. Configure and start the frontend

Open a second terminal from the repository root:

```bash
cd client
npm install
cp .env.example .env
```

Set `client/.env`:

```dotenv
VITE_API_URL=http://localhost:3000
VITE_DEMO_MODE=true
```

`VITE_API_URL` is the API origin only; do not add `/api`. Start the frontend:

```bash
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

## Judge walkthrough

The login page provides one-click access to the three seeded roles when demo access is enabled.

| Role | Demo account | Suggested walkthrough |
|---|---|---|
| **Creator** | `creator@brandflight.demo` | Audit copy, upload a product/campaign image, review findings, fix issues, save a draft and submit it for review. |
| **Reviewer** | `reviewer@brandflight.demo` | Open an in-review campaign, inspect audit evidence and revisions, comment, request changes with a reason, or approve. |
| **Manager** | `manager@brandflight.demo` | Inspect the PahariKnits rulebook and approved facts, review accessibility colour standards and governance insights, and manage brand assets. |

For demo sign-in, the backend must have `DEMO_LOGIN_ENABLED=true`, and the frontend production build must have `VITE_DEMO_MODE=true`. The three seeded users must exist in the judge database.

**Security:** public demo login allows anyone who can reach the API to request a session as any of the three demo roles. Use it only with an isolated judge database containing synthetic demo data. Disable `DEMO_LOGIN_ENABLED` after judging if public role access is no longer required.

## Testing and validation

### Run the checks

Frontend:

```bash
cd client
npm run build
npm run lint
npm test
```

Backend:

```bash
cd server
npm run build
npm test
```

The tests cover areas including:

- WCAG contrast calculations and approved-palette swatch recommendations.
- Pixel-based image text contrast analysis and uncertain-region handling.
- PII detection, temporary masking and restoration.
- Numerical-claim detection when PII-shaped values are present.
- Audit receipt hashing and Release Passport signing/verification.
- Review validation, override decisions and governance insight aggregation.
- API integration scenarios for authentication/RBAC, audits, drafts, revisions, comments, overrides and review decisions.

The API integration suite requires a separate disposable PostgreSQL database configured through `TEST_DATABASE_URL`. Do not point it at the judge database or any database containing data you need to keep. If the integration suite is skipped because the test database is not configured, that is not an end-to-end pass.

## Important API routes

| Route | Purpose |
|---|---|
| `GET /api/health` | API health check |
| `POST /api/auth/login` | Email/password login |
| `POST /api/auth/demo-login` | Opt-in role-based demo login |
| `GET /api/auth/me` | Current authenticated user |
| `/api/brands` | Brand profiles, rules, facts and approved brand assets |
| `/api/submissions` | Drafts, submissions, comments, revisions and review decisions |
| `POST /api/audit` | Text preflight audit |
| `POST /api/audit/refine` | Creator copy refinement |
| `/api/audit/image` | Image audit and related image endpoints |
| `/api/submissions/governance/override-insights` | Manager-only override insights |
| `GET /api/submissions/passport/:passportId/verify` | Public Release Passport verification endpoint |

Protected routes require `Authorization: Bearer <token>`. Authorization is enforced by backend middleware.

## Deployment

The current deployment targets are Vercel (frontend), Render (API) and Neon PostgreSQL (judge database). Environment variables must be set in the hosting dashboards; local `.env` files are not deployed automatically.

Before opening the application to judges, verify the following in the hosting dashboards:

- [ ] Vercel `VITE_API_URL` points to the deployed API origin (without `/api`).
- [ ] Vercel `VITE_DEMO_MODE=true` is set at build time if judge demo buttons are required; rebuild after changing it.
- [ ] Render `CLIENT_URL` exactly matches the deployed Vercel origin.
- [ ] Render `DATABASE_URL` points to the dedicated judge Neon project.
- [ ] Run `prisma migrate deploy` and then `prisma db seed` against that same judge database.
- [ ] `JWT_SECRET` is a unique random secret of at least 32 characters.
- [ ] Gemini credentials are configured and a real text audit has been checked.
- [ ] Cloudinary credentials are configured and a real image upload/audit has been checked.
- [ ] `DEMO_LOGIN_ENABLED=true` only for the intended judging window; test all three roles and role restrictions.
- [ ] The PahariKnits logo is registered as an approved brand asset if logo verification is part of the walkthrough.

A Git push deploys code when automatic deployment is enabled, but it does not change the database selected by the backend. The Render `DATABASE_URL` determines which PostgreSQL database the deployed API uses.

## Known limitations

- BrandFlight is a prototype and does not replace legal, compliance, brand or accessibility professionals.
- Gemini can produce false positives or miss context. Reviewers remain responsible for decisions.
- PII masking is pattern-based and only covers the supported formats listed above. It is not comprehensive detection.
- Image pixels are not PII-masked. Sensitive details should be removed from artwork before upload.
- Image contrast is calculated only when text regions and solid backgrounds can be sampled reliably. Uncertain, transparent, gradient, textured or multicolour regions may require manual review.
- Gemini-assisted text-region location is not full OCR. Non-text icon and control-boundary contrast is not yet measured automatically.
- The system checks configured brand rules and approved facts; it does not independently establish legal truth or product substantiation.
- Audit receipts are input/configuration-linked hashes. They are not an append-only event-sourcing ledger.
- Live credentials, deployment configuration and third-party service availability must be verified on the deployed environment.

## Project structure

```text
client/                 React + Vite application
  public/               Static assets, including BrandFlight and PahariKnits marks
  src/                  Pages, workflow panels, accessibility and UI components
server/                 Express + TypeScript API
  prisma/               Prisma schema, migrations and seed script
  src/                  Routes, middleware and service logic
  test/                 Unit tests and API integration tests
README.md               Setup, architecture, judge walkthrough and operating notes
```

## Future development

- Expand brand integrations and support importing approved facts from product/catalogue systems.
- Improve text extraction and image understanding for more complex campaign layouts.
- Add broader automated browser-based testing for the full Creator-to-Reviewer journey.
- Extend governance reporting with trend comparisons and rule-quality follow-up.

## Security and repository hygiene

- Never commit `.env` files, API keys, database URLs, JWT secrets, Cloudinary credentials or demo passwords.
- Keep test databases separate from judge and production databases.
- Review changes before committing:

```bash
git status --short
git diff --check
git diff
```

---

Built for **Codex 48 Hackathon by WeCodeCoders**.  
**Team BrandFlight** — Rudraksh Kumar, team leader and sole developer.
