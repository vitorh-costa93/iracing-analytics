/** Texto curto de frescura das fontes para o cabeçalho do Night Grid ("iRStats há 2 h · Garage61
 * há 9 h", docs/redesign-mockup/B.dc.html). Puro, para ser testável. */
export function relativeAge(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "sem registro";
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "sem registro";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}
