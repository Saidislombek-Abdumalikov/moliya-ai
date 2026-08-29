# EpicSell / Moliya AI — Engineering & Testing Standards

React + Vite + Tailwind CSS + Telegram Bot / Telegram Mini App / Web App ecosystem.

## 🧪 Mandatory Testing Standard (Must Execute on Every Pass)

Before delivering changes, committing, or generating releases:

1. **Run Automated Test Suite**:
   ```bash
   npm test
   ```
   - Must run `tsx tests/auth_suite.ts` and achieve **100% PASS**.
   - Covers OTP generation, invalidation, single-use deletion, expiration, user idempotency, onboarding state preservation, relational storage operations, RLS isolation, and Supabase Auth session generation.

2. **Verify Web Production Build**:
   ```bash
   npm run build
   ```
   - Verifies TypeScript types, Vite bundle output, and esbuild backend bundle output.

3. **Version Increment & Tagging**:
   - Increment `version` in `package.json` on each commit.
   - Commit with descriptive release notes and create git tags (`git tag vX.Y.Z`).

4. **Evidence-Based Delivery**:
   - Never assume functionality solely from static inspection.
   - Provide concrete evidence (actual test outputs, logs, pass counts) in every report.

---

## 🏛️ System Architecture

- **Unified User Identity**: `moliya_user_tg_${tgId}`
- **Supabase Auth Email**: `tg${tgId}@moliya.app`
- **Database Schema**: Relational storage in `public.transactions` and `public.cards`; user metadata in `users.onboarding` JSONB column.
- **Client Channels**:
  - Web App (`https://moliya-ai-pi.vercel.app`)
  - Telegram Mini App (via WebApp `initData`)
  - Telegram Bot (`@moliya_v2bot`)

