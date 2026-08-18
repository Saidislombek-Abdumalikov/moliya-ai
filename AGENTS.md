# EpicSell / Moliya AI — Engineering & Testing Standards

React + Vite + Tailwind CSS + Capacitor Android + Telegram Bot/Mini App ecosystem.

## 🧪 Mandatory Testing Standard (Must Execute on Every Pass)

Before delivering changes, committing, or generating releases:

1. **Run Automated Test Suite**:
   ```bash
   npm test
   ```
   - Must run `tsx tests/auth_suite.ts` and achieve **100% PASS (12/12)**.
   - Covers OTP generation, invalidation, single-use deletion, expiration, user idempotency, onboarding state preservation, and Supabase Auth session generation.

2. **Verify Web Production Build**:
   ```bash
   npm run build
   ```
   - Verifies TypeScript types and Vite bundle output.

3. **Rebuild Android APK**:
   ```bash
   npm run build:apk
   ```
   - Syncs assets with Capacitor and compiles Gradle debug APK (`moliya-ai.apk`).

4. **Version Increment & Tagging**:
   - Increment `version` in `package.json` on each commit.
   - Commit with descriptive release notes and create git tags (`git tag vX.Y.Z`).

5. **Evidence-Based Delivery**:
   - Never assume functionality solely from static inspection.
   - Provide concrete evidence (actual test outputs, logs, pass counts) in every report.

---

## 🏛️ System Architecture

- **Unified User Identity**: `moliya_user_tg_${tgId}`
- **Supabase Auth Email**: `tg${tgId}@moliya.app`
- **Database Schema**: All metadata (session tokens, OTP status, expiry, onboarding state) is stored inside the `users.onboarding` JSONB column.
- **Client Channels**:
  - Android Standalone APK (`ai.moliya.app`)
  - Telegram Mini App (via WebApp `initData`)
  - Telegram Bot (`@moliya_v2bot`)
  - Web App (`https://moliya-ai-pi.vercel.app`)
