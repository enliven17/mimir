import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/** Fills missing `explore` keys so older or partial message files do not throw at runtime. */
const EXPLORE_FALLBACKS: Record<string, Record<string, string>> = {
  en: {
    noResults: "No challenges match these filters",
    noResultsDesc:
      "Reset filters, broaden your search, or publish a new challenge.",
    noResultsEyebrow: "Zero matches",
    openChallengesEmptyEyebrow: "Empty arena",
    openChallengesEmptyTitle: "No open challenges right now",
    openChallengesEmptyDesc:
      "The arena is quiet. Publish a challenge and set the tone.",
    openChallengesEmptyCta: "CREATE CHALLENGE",
    sortHighestConfidence: "Highest confidence",
    minStakeArenaOnlyHint: "Minimum stake filters Arena Live only",
    quickFilterNeedsArenaOnlyHint: "Only applies to Arena Live challenges",
    settlementBasisExpandAria: "Show full settlement basis",
    settlementBasisCollapseAria: "Collapse settlement basis",
  },
  es: {
    noResults: "Ningún desafío coincide con estos filtros",
    noResultsDesc:
      "Probá restablecer los filtros, ampliar la búsqueda o publicar un desafío nuevo.",
    noResultsEyebrow: "Sin coincidencias",
    openChallengesEmptyEyebrow: "Arena vacía",
    openChallengesEmptyTitle: "No hay desafíos abiertos ahora",
    openChallengesEmptyDesc:
      "La arena está tranquila. Publicá un desafío y marcá el ritmo.",
    openChallengesEmptyCta: "CREAR DESAFÍO",
    sortHighestConfidence: "Mayor confianza",
    minStakeArenaOnlyHint: "La apuesta mínima filtra solo Arena Live",
    quickFilterNeedsArenaOnlyHint: "Solo aplica a desafíos en Arena Live",
    settlementBasisExpandAria: "Ver texto completo de la base de resolución",
    settlementBasisCollapseAria: "Ocultar texto completo de la base de resolución",
  },
};

function mergeExploreMessages(
  messages: Record<string, unknown>,
  locale: string
): Record<string, unknown> {
  const base =
    EXPLORE_FALLBACKS[locale] ?? EXPLORE_FALLBACKS[routing.defaultLocale] ?? {};
  const explore = messages.explore;
  if (!explore || typeof explore !== "object" || Array.isArray(explore)) {
    return messages;
  }
  return {
    ...messages,
    explore: {
      ...base,
      ...(explore as Record<string, string>),
    },
  };
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.includes(requested as any)
    ? requested!
    : routing.defaultLocale;

  const raw = (await import(`../messages/${locale}.json`)).default as Record<
    string,
    unknown
  >;

  return {
    locale,
    messages: mergeExploreMessages(raw, locale),
  };
});
