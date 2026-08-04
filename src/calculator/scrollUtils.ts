const SCROLL_PAD_ATTR = "data-calc-scroll-pad";
const SCROLL_TOP_OFFSET = 56;

function getStickyTopInset(): number {
  const tabBar = document.querySelector<HTMLElement>(".pc-tab-bar");
  if (!tabBar) return 0;
  const bar = tabBar.closest(".sticky") as HTMLElement | null;
  return (bar ?? tabBar).getBoundingClientRect().height;
}

function removeStaleScrollPad() {
  document.querySelector(`[${SCROLL_PAD_ATTR}]`)?.remove();
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
  removeStaleScrollPad();

  const target = resolveScrollTarget(el);
  const topInset = getStickyTopInset();
  const targetTopY = topInset + SCROLL_TOP_OFFSET;
  const rect = target.getBoundingClientRect();
  const desiredScrollY = window.scrollY + rect.top - targetTopY;

  const maxScroll = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );
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
