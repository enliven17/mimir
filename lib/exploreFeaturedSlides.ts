/**
 * Slides del carrusel “featured” en Market Explorer.
 * Copy bajo messages (explore.featuredSlides.<id>).
 * Las imágenes se importan en `exploreFeaturedImageAssets.ts` (blur + LCP).
 */
export const EXPLORE_FEATURED_SLIDE_IDS = ["boxing", "f1", "alvarez"] as const;

export type ExploreFeaturedSlideId = (typeof EXPLORE_FEATURED_SLIDE_IDS)[number];

export type FeaturedImageObjectPosition =
  | "center"
  | "top"
  | "bottom"
  /** Un poco por encima del borde inferior: deja aire para el copy sin perder el auto abajo. */
  | "bottomLifted";

export const exploreFeaturedSlideMedia: Record<
  ExploreFeaturedSlideId,
  {
    /** Ancla de `object-fit` para encuadrar el sujeto (p. ej. auto anclado abajo). */
    imageObjectPosition?: FeaturedImageObjectPosition;
  }
> = {
  boxing: {},
  f1: { imageObjectPosition: "bottomLifted" },
  alvarez: { imageObjectPosition: "top" },
};
