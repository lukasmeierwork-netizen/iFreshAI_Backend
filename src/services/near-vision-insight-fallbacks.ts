type FallbackCopy = {
  emptyTitle: string;
  emptyBody: (periodDays: number) => string;
  trendTitle: (periodDays: number, trend: "declined" | "improved" | "stable") => string;
  trendBody: (
    count: number,
    latestSnellen: string,
    firstSnellen: string,
  ) => string;
};

const FALLBACKS: Record<string, FallbackCopy> = {
  en: {
    emptyTitle: "Not enough data yet",
    emptyBody: (days) =>
      `Complete a few more near vision tests over the next ${days} days to unlock a personalized trend analysis.`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "declined"
          : trend === "improved"
            ? "improved"
            : "stayed relatively stable";
      return `Last ${days} days: your near vision ${label}`;
    },
    trendBody: (count, latest, first) =>
      `We analyzed ${count} test result(s). Your latest value is ${latest} (first: ${first}). Keep test conditions consistent and repeat checks every few days for a more reliable trend.`,
  },
  "zh-Hans": {
    emptyTitle: "数据尚不足",
    emptyBody: (days) =>
      `请在未来 ${days} 天内多完成几次近视力测试，以解锁个性化趋势分析。`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "略有下降"
          : trend === "improved"
            ? "有所改善"
            : "基本保持稳定";
      return `过去 ${days} 天：你的近视力${label}`;
    },
    trendBody: (count, latest, first) =>
      `我们分析了 ${count} 次测试结果。最新值为 ${latest}（首次：${first}）。请在相似条件下测试，每隔几天复查以获得更可靠的趋势。`,
  },
  fr: {
    emptyTitle: "Pas assez de données",
    emptyBody: (days) =>
      `Effectuez encore quelques tests de vision de près dans les ${days} prochains jours pour débloquer une analyse personnalisée.`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "a légèrement diminué"
          : trend === "improved"
            ? "s'est améliorée"
            : "est restée relativement stable";
      return `${days} derniers jours : votre vision de près ${label}`;
    },
    trendBody: (count, latest, first) =>
      `Nous avons analysé ${count} résultat(s). Votre dernière valeur est ${latest} (première : ${first}). Gardez des conditions de test similaires et répétez les contrôles tous les quelques jours.`,
  },
  ko: {
    emptyTitle: "아직 데이터가 부족합니다",
    emptyBody: (days) =>
      `앞으로 ${days}일 동안 근거리 시력 검사를 더 진행하면 맞춤형 추세 분석을 확인할 수 있습니다.`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "약간 저하되었습니다"
          : trend === "improved"
            ? "개선되었습니다"
            : "비교적 안정적입니다";
      return `최근 ${days}일: 근거리 시력이 ${label}`;
    },
    trendBody: (count, latest, first) =>
      `${count}회의 검사 결과를 분석했습니다. 최신 값은 ${latest}(첫 값: ${first})입니다. 같은 조건에서 며칠마다 검사하면 더 신뢰할 수 있는 추세를 확인할 수 있습니다.`,
  },
  ja: {
    emptyTitle: "データがまだ不足しています",
    emptyBody: (days) =>
      `今後${days}日間で近見視力検査をもう数回行うと、パーソナライズされた傾向分析が表示されます。`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "やや低下しています"
          : trend === "improved"
            ? "改善しています"
            : "おおむね安定しています";
      return `過去${days}日間：近見視力は${label}`;
    },
    trendBody: (count, latest, first) =>
      `${count}件の検査結果を分析しました。最新値は${latest}（最初：${first}）です。同じ条件で数日おきに検査すると、より信頼できる傾向がわかります。`,
  },
  es: {
    emptyTitle: "Aun no hay suficientes datos",
    emptyBody: (days) =>
      `Completa mas pruebas de vision cercana en los proximos ${days} dias para desbloquear un analisis personalizado.`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "ha empeorado ligeramente"
          : trend === "improved"
            ? "ha mejorado"
            : "se ha mantenido relativamente estable";
      return `Ultimos ${days} dias: tu vision cercana ${label}`;
    },
    trendBody: (count, latest, first) =>
      `Analizamos ${count} resultado(s). Tu ultimo valor es ${latest} (primero: ${first}). Manten condiciones similares y repite las pruebas cada pocos dias.`,
  },
  de: {
    emptyTitle: "Noch nicht genug Daten",
    emptyBody: (days) =>
      `Fuhre in den nachsten ${days} Tagen noch ein paar Nahsicht-Tests durch, um eine personalisierte Trendanalyse freizuschalten.`,
    trendTitle: (days, trend) => {
      const label =
        trend === "declined"
          ? "hat sich leicht verschlechtert"
          : trend === "improved"
            ? "hat sich verbessert"
            : "ist relativ stabil geblieben";
      return `Letzte ${days} Tage: Deine Nahsicht ${label}`;
    },
    trendBody: (count, latest, first) =>
      `Wir haben ${count} Testergebnis(se) ausgewertet. Dein letzter Wert ist ${latest} (erster: ${first}). Halte die Testbedingungen konstant und wiederhole die Tests alle paar Tage.`,
  },
};

export function normalizeInsightLocale(raw: string | undefined): string {
  const trimmed = raw?.trim() || "en";
  if (FALLBACKS[trimmed]) return trimmed;
  const base = trimmed.split("-")[0]?.toLowerCase() ?? "en";
  if (base === "zh") return "zh-Hans";
  return FALLBACKS[base] ? base : "en";
}

const EN_FALLBACK = FALLBACKS.en;

export function fallbackInsightCopy(locale: string | undefined): FallbackCopy {
  const key = normalizeInsightLocale(locale);
  return (FALLBACKS[key] ?? EN_FALLBACK) as FallbackCopy;
}
