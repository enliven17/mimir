import type { StaticImageData } from "next/image";
import type { ExploreFeaturedSlideId } from "@/lib/exploreFeaturedSlides";
import boxing from "../public/images/fight-11.png";
import f1 from "../public/images/F1.png";
import alvarez from "../public/images/arg.png";

/** Imports estáticos: Next inyecta `blurDataURL` para `placeholder="blur"` y dimensiones estables. */
export const EXPLORE_FEATURED_STATIC_IMAGES: Record<
  ExploreFeaturedSlideId,
  StaticImageData
> = {
  boxing,
  f1,
  alvarez,
};
