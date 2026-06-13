export function getSportsDbApiKey(): string | null {
  const key = process.env.THESPORTSDB_API_KEY?.trim();
  return key && key !== '123' ? key : null;
}
