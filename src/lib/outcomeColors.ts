export const OUTCOME_COLORS = [
  '#25c0f4', '#f87171', '#facc15', '#4ade80', '#a78bfa', '#fb923c',
  '#f472b6', '#38bdf8', '#34d399', '#c084fc', '#fbbf24', '#e879f9',
] as const;

export function getOutcomeColor(index: number) {
  return OUTCOME_COLORS[index % OUTCOME_COLORS.length];
}
