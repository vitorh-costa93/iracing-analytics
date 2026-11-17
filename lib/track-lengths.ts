/**
 * Extensão oficial (em km) do traçado Road/GP principal de cada pista do iRacing
 * presente na base de corridas. Usada para normalizar o gap em segundos por km (`s/km`)
 * em `lib/winner-gap.ts` e na aba Deep Dive -> Histórico.
 */
const TRACK_LENGTH_KM: Record<string, number> = {
  "algarve international circuit": 4.653,
  "autodromo internazionale enzo e dino ferrari": 4.909,
  "autodromo internazionale del mugello": 5.245,
  "autodromo nazionale monza": 5.793,
  "autodromo hermanos rodriguez": 4.304,
  "autodromo jose carlos pace": 4.309,
  "circuit gilles villeneuve": 4.361,
  "circuit zandvoort": 4.259,
  "circuit zolder": 4.011,
  "circuit de barcelona catalunya": 4.657,
  "circuit de nevers magny-cours": 4.411,
  "circuit de spa-francorchamps": 7.004,
  "circuit des 24 heures du mans": 13.626,
  "circuit of the americas": 5.513,
  "circuito de jerez - angel nieto": 4.428,
  "daytona international speedway": 5.729,
  "donington park racing circuit": 4.020,
  "fuji international speedway": 4.563,
  "hockenheimring baden-wurttemberg": 4.574,
  "hungaroring": 4.381,
  "indianapolis motor speedway": 3.925,
  "miami international autodrome": 5.412,
  "misano world circuit marco simoncelli": 4.226,
  "mobility resort motegi": 4.801,
  "mount panorama circuit": 6.213,
  "nurburgring grand-prix-strecke": 5.148,
  "okayama international circuit": 3.703,
  "oulton park circuit": 4.332,
  "red bull ring": 4.318,
  "road america": 6.515,
  "road atlanta": 4.088,
  "sebring international raceway": 6.019,
  "shell v-power motorsport park at the bend": 4.950,
  "silverstone circuit": 5.891,
  "summit point raceway": 3.219,
  "suzuka international racing course": 5.807,
  "watkins glen international": 5.472,
  "weathertech raceway at laguna seca": 3.602,
};

function normalizeTrackName(name: string): string {
  return name
    .replace(/^\[Retired\]\s*/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Returns track length in kilometers, or null if unknown. */
export function trackLengthKm(trackName: string | null | undefined): number | null {
  if (!trackName) return null;
  const key = normalizeTrackName(trackName);
  if (TRACK_LENGTH_KM[key] !== undefined) return TRACK_LENGTH_KM[key];
  for (const [known, length] of Object.entries(TRACK_LENGTH_KM)) {
    if (key.includes(known) || known.includes(key)) return length;
  }
  return null;
}
