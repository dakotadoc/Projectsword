// Letter ranks (E–A, EX) used for Magic Circuits and Servant stats.
// In calculations a rank becomes a number: E=1 … A=5, EX=6.

export const RANKS = ['E', 'D', 'C', 'B', 'A', 'EX'];

export function rankValue(rank) {
  const i = RANKS.indexOf(rank);
  if (i === -1) throw new Error(`Unknown rank: ${rank}`);
  return i + 1;
}
