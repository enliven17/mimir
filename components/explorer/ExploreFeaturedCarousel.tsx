"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  EXPLORE_FEATURED_SLIDE_IDS,
  exploreFeaturedSlideMedia,
  type FeaturedImageObjectPosition,
} from "@/lib/exploreFeaturedSlides";
import { EXPLORE_FEATURED_STATIC_IMAGES } from "@/lib/exploreFeaturedImageAssets";
import { Button } from "@/components/ui";

function featuredImageObjectClass(
  pos: FeaturedImageObjectPosition | undefined
): string {
  if (pos === "top") return "object-top";
  if (pos === "bottom") return "object-bottom";
  if (pos === "bottomLifted") return "object-[center_84%]";
  return "object-center";
}

const AUTO_ADVANCE_MS = 9000;

/** Trazo alineado con `public/icons/arrow-down.svg`; rotación para anterior / siguiente. */
function CarouselArrowIcon({ direction }: { direction: "prev" | "next" }) {
  const rotate = direction === "prev" ? "rotate-90" : "-rotate-90";
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      className={rotate}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 9L12 15L18 9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ExploreFeaturedCarousel({
  onPrimaryClick,
  onSecondaryClick,
}: {
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}) {
  const t = useTranslations("explore");
  const slides = EXPLORE_FEATURED_SLIDE_IDS;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionId = useId().replace(/:/g, "");
  const slideCount = slides.length;

  const activeId = slides[index]!;

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + slideCount) % slideCount);
    },
    [slideCount]
  );

  useEffect(() => {
    if (paused || slideCount <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slideCount);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused, slideCount]);

  /** Precarga las tres imágenes en red (Vercel/CDN) para reducir flash al cambiar de slide. */
  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (const id of slides) {
      const href = EXPLORE_FEATURED_STATIC_IMAGES[id].src;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      links.forEach((el) => el.remove());
    };
  }, [slides]);

  const titleId = `explore-featured-title-${activeId}-${regionId}`;

  type SlideField = "imageAlt" | "pill" | "titleLine1" | "titleLine2" | "body";
  const slideT = (field: SlideField) =>
    t(`featuredSlides.${activeId}.${field}` as never);

  return (
    <section
      className="mb-8"
      aria-roledescription="carousel"
      aria-label={t("featuredCarouselRegionAria")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setPaused(false);
      }}
    >
      <div
        className="group/card relative w-full overflow-hidden rounded-lg border border-white/[0.12] bg-pv-surface shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] max-sm:aspect-[3/4] sm:min-h-[420px] md:min-h-[480px]"
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute inset-0"
            aria-hidden
          >
            <div className="absolute inset-0 overflow-hidden bg-pv-surface">
              <Image
                src={EXPLORE_FEATURED_STATIC_IMAGES[activeId]}
                alt={slideT("imageAlt")}
                fill
                placeholder="blur"
                className={`object-cover transition-[transform] duration-[750ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] will-change-transform group-hover/card:scale-[1.045] ${featuredImageObjectClass(
                  exploreFeaturedSlideMedia[activeId].imageObjectPosition
                )}`}
                sizes="(max-width: 640px) 100vw, (max-width: 1280px) 92vw, 1200px"
                priority={index === 0}
                fetchPriority={index === 0 ? "high" : "auto"}
              />
            </div>
          </motion.div>
        </AnimatePresence>

        <div
          className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-black/[0.82] via-black/[0.48] to-black/[0.32]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/[0.78] via-black/[0.28] to-transparent sm:from-black/[0.72] sm:via-black/[0.2]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-0 top-0 z-[2] h-0 w-1 bg-pv-emerald transition-[height] duration-500 ease-out group-hover/card:h-full"
          aria-hidden
        />

        <div className="relative z-10 flex h-full min-h-0 flex-col p-6 sm:min-h-[420px] sm:p-8 md:min-h-[480px]">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={activeId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex min-h-0 flex-1 flex-col"
              aria-labelledby={titleId}
            >
              <p className="mb-6 sm:mb-7">
                <span className="inline-flex rounded border border-pv-emerald/35 bg-pv-emerald/[0.1] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
                  {slideT("pill")}
                </span>
              </p>
              <h2
                id={titleId}
                className="text-left font-display text-3xl font-bold uppercase leading-[1.08] tracking-tight text-pv-text sm:text-4xl md:text-5xl lg:text-6xl"
              >
                <span className="block">{slideT("titleLine1")}</span>
                <span className="mt-2 block uppercase text-pv-emerald sm:mt-2.5">
                  {slideT("titleLine2")}
                </span>
              </h2>
              <p className="mt-4 max-w-3xl whitespace-pre-line text-left text-sm leading-relaxed text-pv-muted max-sm:line-clamp-5 sm:mt-5 sm:text-[15px] sm:line-clamp-none">
                {slideT("body")}
              </p>

              <div className="mt-auto flex flex-col gap-4 pt-5 sm:flex-row sm:items-end sm:justify-between sm:pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="emerald"
                    fullWidth={false}
                    onClick={onPrimaryClick}
                    className="shadow-[0_12px_30px_-16px_rgba(78,222,163,0.75)]"
                  >
                    {t("featuredCtaPrimary")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    fullWidth={false}
                    onClick={onSecondaryClick}
                    className="!border !border-white/[0.18] !bg-white/[0.06] !text-pv-text shadow-none hover:!border-white/[0.28] hover:!bg-white/[0.1]"
                  >
                    {t("featuredCtaSecondary")}
                  </Button>
                </div>

                {slideCount > 1 ? (
                  <div
                    className="flex shrink-0 items-center gap-1 self-end sm:self-auto"
                    role="group"
                    aria-label={t("featuredCarouselNavAria")}
                  >
                    <button
                      type="button"
                      onClick={() => go(-1)}
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-white/[0.2] bg-black/40 text-pv-text backdrop-blur-sm transition-[background-color,border-color,transform] hover:border-white/[0.35] hover:bg-black/55 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg"
                      aria-label={t("featuredCarouselPrevAria")}
                    >
                      <CarouselArrowIcon direction="prev" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go(1)}
                      className="flex h-10 w-10 items-center justify-center rounded-md border border-white/[0.2] bg-black/40 text-pv-text backdrop-blur-sm transition-[background-color,border-color,transform] hover:border-white/[0.35] hover:bg-black/55 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/40 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg"
                      aria-label={t("featuredCarouselNextAria")}
                    >
                      <CarouselArrowIcon direction="next" />
                    </button>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {t("featuredCarouselStatus", {
          current: index + 1,
          total: slideCount,
        })}
      </p>
    </section>
  );
}
