# Moliya Ai V2 - Application Documentation

## 1. Overview and Core Logic
Moliya is a personal finance and expense tracking application designed with a mobile-first philosophy. The core logic relies on a central state management system (`FinanceContext`) synced with **Firebase Firestore**.

### Data Management
- **Persistence:** All data (transactions, cards, security settings, onboarding details) is stored in Firebase under `users/{userId}` and locally cached in `localStorage` for offline resilience.
- **Transactions:** The system calculates the overall balance by combining a user's initial onboarding balance, the balances of all connected bank cards, and the sum of all individual transactions (incomes and expenses).
- **Sample Data:** New users are greeted with sample transactions and cards to demonstrate app features. The user can clear this data via the Profile screen to start fresh.
- **Card Deletion Logic:** When a card is deleted, its initial balance is optionally transferred back to the user's base cash balance so that the net worth doesn't spontaneously drop (unless the user specifically records an expense).

## 2. Layouts and Views
The application is structured into several distinct screens, utilizing a clean, single-view rendering pattern governed by `App.tsx`:

*   **OnboardingScreen:** A multi-step wizard asking for Language (Uzbek/Russian/English), Name & Phone, Initial Cash Balance, and an optional Security PIN.
*   **SecurityScreen:** A lock screen that appears if the user has enabled PIN protection, requiring authentication before granting access to the app.
*   **HomeScreen (Dashboard):** 
    *   **Hero Section:** Displays the total combined balance prominently at the top.
    *   **Summary Cards:** Two side-by-side cards showing total monthly income (green) and expenses (red).
    *   **Quick Actions:** A horizontal scrollable row of action buttons (Transfer, Payment, Top-up, More).
    *   **Recent Transactions:** A list of recent activity. Includes swipe/click-to-delete functionality.
    *   **Add Transaction FAB / Modals:** Bottom sliding drawers allowing users to quickly input new incomes or expenses with predefined categories.
*   **ProfileScreen (Settings & Management):**
    *   **User Details:** Displays name and phone number.
    *   **My Cards:** A horizontal list of bank cards. Users can add new cards (Uzcard, Humo, Visa) or delete existing ones.
    *   **Security Settings:** Toggles for PIN and FaceID.
    *   **Danger Zone:** Options to wipe all data (resetting the app completely).

## 3. Visual Identity and Colors
The app utilizes **Tailwind CSS** with a soft, modern, and accessible color palette, avoiding harsh pure whites and blacks in favor of refined slate and indigo tones.

*   **Backgrounds:**
    *   App Background: `bg-slate-50` (a very soft, cool off-white).
    *   Surface/Cards: `bg-white` with subtle drop shadows (`shadow-sm`, `shadow-md`).
*   **Typography:**
    *   Primary Text (Headings/Values): `text-slate-900` or `text-slate-800`.
    *   Secondary Text (Labels/Dates): `text-slate-500` or `text-slate-400`.
*   **Brand & Accents:**
    *   Primary Buttons & Active States: `bg-indigo-600`, `text-indigo-600`.
    *   Secondary Accents: `indigo-50` for subtle button backgrounds.
*   **Financial Indicators:**
    *   Income/Positive: `text-emerald-600`, `bg-emerald-500`, `bg-emerald-50` (for soft backgrounds).
    *   Expense/Negative: `text-rose-600`, `bg-rose-500`, `bg-rose-50` (for soft backgrounds).
*   **Shapes & Spacing:**
    *   Heavy use of large border radii (`rounded-2xl`, `rounded-3xl`) to create a friendly, tactile interface.
    *   Generous padding (`p-4`, `p-6`) to separate distinct functional areas.

## 4. Component Behaviors
*   **Bank Cards:** Rendered with CSS linear gradients resembling physical cards (e.g., green/blue for Uzcard, orange/red for Humo).
*   **Modals / Drawers:** Action forms (like adding a transaction or card) slide up from the bottom (using `framer-motion`), mimicking native mobile OS behaviors.
*   **Bottom Navigation:** Fixed at the bottom of the screen to switch between Home, Analytics (placeholder), Payments (placeholder), and Profile views.
