import type { CategoryId } from "@/lib/constants";

/** Categorías principales del explorador (ids de contrato + copia de mercado). */
export const EXPLORE_PRIMARY_CATEGORY_ROW: {
  id: CategoryId;
  labelKey: string;
}[] = [
  { id: "sports", labelKey: "catSports" },
  { id: "crypto", labelKey: "catCrypto" },
  { id: "weather", labelKey: "catWeather" },
  { id: "culture", labelKey: "catCulture" },
  { id: "custom", labelKey: "catCustom" },
];
