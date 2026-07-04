/**
 * DiceBear open-peeps avatar URLs — single source for every avatar in the app.
 */
const OPEN_PEEPS_ENDPOINT = "https://api.dicebear.com/9.x/open-peeps/svg";
const DEFAULT_BACKGROUND = "0b1020";

/** Pass `background: null` for a transparent avatar (e.g. inline SVG embeds). */
export function openPeepsAvatar(
  seed: string,
  background: string | null = DEFAULT_BACKGROUND,
): string {
  const safeSeed = seed.trim() || "mimir";
  const url = `${OPEN_PEEPS_ENDPOINT}?seed=${encodeURIComponent(safeSeed)}`;
  return background ? `${url}&backgroundColor=${background}` : url;
}
