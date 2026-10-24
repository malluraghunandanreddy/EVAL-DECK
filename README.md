# TriLens (PolicyDrift engine)

Checks whether your privacy policy matches what your code and database actually do, per framework (DPDP, GDPR, CCPA). Next.js 15 on Vercel + Supabase Postgres. Not legal advice.

- `/` serves the static landing page in `public/landing.html` (rewrite in `next.config.ts`).
- Sign in with GitHub at `/api/auth/github`, onboarding at `/onboarding`, report at `/scan/:id`, public share `/r/:id`.
- Proof for judges: `/admin/proof`; fallback human approval: `/admin/approvals` (password `ADMIN_PASSWORD`).
- Widget: `<script src="https://<app>/w/<siteId>.js" async></script>`; hosted policy `/p/:siteId`, terms `/t/:siteId`.
- AgenticOrg setup (agents, workflow, prompts): `docs/AGENTICORG.md`.

## Run locally
```
cp .env.example .env.local   # fill values; never commit
npm install
npm run db:push              # create tables in Supabase
npm run dev
npm test                     # scan engine tests on scripts/fixtures/demo-repo
```

## Deploy
Import the repo in Vercel, add every variable from `.env.example` under Project Settings > Environment Variables, deploy, then set the GitHub OAuth app callback to `https://<app>/api/auth/github/callback` and `APP_BASE_URL` to the production URL.

---

# Frontend notes

- Landing page: `public/landing.html` (single file, edit the `CONFIG` block at the bottom). Shown at `/`.
- Shared look: `app/globals.css` (tokens match the landing page). Header: `app/components/SiteHeader.tsx`.
- Sign-in: `/signin` (GitHub, or email fallback). Pricing and "I'm interested": `/pricing`, `POST /api/interest`.
- Plans and prices shown on the site: `lib/plans.ts` (single report Rs 50, Pro monthly Rs 499 is a placeholder).
- Hackathon proof: `/admin/proof` shows the funnel (signed in, set up, got a report, interested, paid) and the interested list; `/admin/interest.csv` exports it.
- Terms and privacy: `/terms`, `/privacy` (beta drafts, set `CONTACT_EMAIL` to show a contact line).
