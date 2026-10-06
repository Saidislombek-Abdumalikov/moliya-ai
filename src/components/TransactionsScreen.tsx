import { useState } from "react"
import CalendarScreen from "./CalendarScreen"
import HomeScreen from "./HomeScreen"
import type { OnboardingResult } from "./Onboarding"
export default function TransactionsScreen({
  onboarding,
  onUpdateOnboarding,
}: {
  onboarding?: OnboardingResult | null
  onUpdateOnboarding?: (data: Partial<OnboardingResult>) => void
}) {
  const [tab, setTab] = useState<"history" | "calendar">("history")
  const lang = onboarding?.language || "uz"
  const labels =
    lang === "en"
      ? ["Transactions", "Calendar", "All transactions"]
      : lang === "ru"
        ? ["Операции", "Календарь", "Все операции"]
        : lang === "uz_cyrl"
          ? ["Транзакциялар", "Тақвим", "Барча транзакциялар"]
          : ["Tranzaksiyalar", "Taqvim", "Barcha tranzaksiyalar"]
  return (
    <div>
      <header style={{ padding: "64px 20px 20px" }}>
        <h2>{labels[0]}</h2>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {(["calendar", "history"] as const).map((key, i) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              style={{
                flex: 1,
                padding: 12,
                border: 0,
                borderRadius: 14,
                background: tab === key ? "#6D28D9" : "#EDE9FE",
                color: tab === key ? "white" : "#5B21B6",
                cursor: "pointer",
              }}
            >
              {labels[i + 1]}
            </button>
          ))}
        </div>
      </header>
      {tab === "calendar" ? (
        <CalendarScreen embedded onboarding={onboarding} />
      ) : (
        <HomeScreen
          historyOnly
          onboarding={onboarding}
          onUpdateOnboarding={onUpdateOnboarding}
        />
      )}
    </div>
  )
}
