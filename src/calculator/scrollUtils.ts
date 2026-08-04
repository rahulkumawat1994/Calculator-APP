const SCROLL_PAD_ATTR = "data-calc-scroll-pad";
const SCROLL_TOP_OFFSET = 56;

function getStickyTopInset(): number {
  const tabBar = document.querySelector<HTMLElement>(".pc-tab-bar");
  if (!tabBar) return 0;
  const bar = tabBar.closest(".sticky") as HTMLElement | null;
  return (bar ?? tabBar).getBoundingClientRect().height;
}

function ensureScrollRoom(extraPx: number) {
  const existing = document.querySelector<HTMLElement>(`[${SCROLL_PAD_ATTR}]`);
  if (existing) {
    const current = parseFloat(existing.style.height) || 0;
    if (extraPx > current) existing.style.height = `${extraPx}px`;
    return;
  }
  const pad = document.createElement("div");
  pad.setAttribute(SCROLL_PAD_ATTR, "true");
  pad.setAttribute("aria-hidden", "true");
  pad.style.height = `${extraPx}px`;
  pad.style.pointerEvents = "none";
  document.body.appendChild(pad);
}

function clearScrollPad(delay = 900) {
  window.setTimeout(() => {
    document.querySelector(`[${SCROLL_PAD_ATTR}]`)?.remove();
  }, delay);
}

function resolveScrollTarget(el: HTMLElement): HTMLElement {
  if (el.dataset.hasParseError === "true") {
    const banner = el.querySelector<HTMLElement>("[data-parse-error-banner]");
    if (banner) return banner;
    const openBody = el.querySelector<HTMLElement>(
      ".pc-result__collapse--open .pc-result__body",
    );
    if (openBody) return openBody;
  }
  return el;
}

/** Scroll so the target sits in the upper viewport, clear of the fixed CTA/dock. */
export function scrollElementIntoView(
  el: HTMLElement,
  behavior: ScrollBehavior = "smooth",
) {
  const target = resolveScrollTarget(el);
  const topInset = getStickyTopInset();
  const targetTopY = topInset + SCROLL_TOP_OFFSET;

  const rect = target.getBoundingClientRect();
  const desiredScrollY = window.scrollY + rect.top - targetTopY;

  const maxScrollWithoutPad =
    document.documentElement.scrollHeight - window.innerHeight;
  if (desiredScrollY > maxScrollWithoutPad) {
    ensureScrollRoom(desiredScrollY - maxScrollWithoutPad + 96);
    clearScrollPad(behavior === "smooth" ? 900 : 150);
    requestAnimationFrame(() => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const nextScroll = Math.max(0, Math.min(maxScroll, desiredScrollY));
      window.scrollTo({ top: nextScroll, behavior });
    });
    return;
  }

  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const nextScroll = Math.max(0, Math.min(maxScroll, desiredScrollY));
  window.scrollTo({ top: nextScroll, behavior });
}

export function scrollToElement(id: string, behavior: ScrollBehavior = "smooth") {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    scrollElementIntoView(el, behavior);
  });
}
