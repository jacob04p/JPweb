/* ==========================================================================
   animations.js — scroll choreography.
   GSAP + ScrollTrigger arrive as globals from the classic CDN tags in
   index.html; if the CDN is blocked, main.js falls back gracefully.
   One scrubbed master timeline drives the explode/reassemble arc; separate
   triggers handle reveals, counters, and the ambient handoff.
   ========================================================================== */

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Intro (fired once the preloader clears) ---------- */
export function heroIntro() {
  if (!gsap) return null;

  const markDone = () => {
    document.querySelectorAll(".reveal-hero").forEach((el) => el.classList.add("intro-done"));
  };

  if (reduced) {
    gsap.set([".reveal-hero", ".hero-kicker", ".hero-sub", ".hero-cta", ".hero-foot", ".hud"], {
      autoAlpha: 1, yPercent: 0, y: 0,
    });
    markDone();
    return null;
  }

  const tl = gsap.timeline({ defaults: { ease: "power4.out" }, onComplete: markDone });
  tl.fromTo(".hud", { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, ease: "power2.out" }, 0)
    .fromTo(".hero-kicker", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.15)
    .to(".reveal-hero", { yPercent: 0, duration: 1.15, stagger: 0.09 }, 0.25)
    .fromTo(".hero-sub", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.75)
    .fromTo(".hero-cta", { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.9)
    .fromTo(".hero-foot", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9 }, 1.1);
  return tl;
}

/* ---------- Scroll-driven behavior ---------- */
export function initScroll(sceneAPI) {
  if (!gsap || !ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);

  if (reduced) {
    gsap.set("[data-reveal]", { autoAlpha: 1, y: 0 });
    return;
  }

  /* Hero content drifts up + out while the model takes over. */
  gsap.to(".hero-content", {
    yPercent: -16,
    autoAlpha: 0,
    ease: "none",
    scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom 35%", scrub: true },
  });

  /* Master explode arc: one timeline, no competing writers.
     0 → 1 across hero + mechanism, then 1 → 0 as About arrives. */
  const proxy = { v: 0 };
  const apply = () => sceneAPI && sceneAPI.setExplode(proxy.v);
  gsap.timeline({
    scrollTrigger: {
      trigger: "#hero",
      start: "top top",
      endTrigger: "#about",
      end: "top 45%",
      scrub: 0.6,
      onUpdate: apply,
    },
  })
    .to(proxy, { v: 1, ease: "none", duration: 62 })
    .to(proxy, { v: 0, ease: "none", duration: 38 });

  /* Canvas hands off to ambient mode once content goes solid.
     Driven by a plain scroll listener (single writer, no trigger
     timing dependencies). */
  const stage = document.getElementById("stage");
  const about = document.getElementById("about");
  if (stage && about) {
    const syncAmbient = () => {
      const past = scrollY > about.offsetTop - innerHeight * 0.85;
      stage.classList.toggle("ambient", past);
      sceneAPI && sceneAPI.setAmbient(past);
    };
    addEventListener("scroll", syncAmbient, { passive: true });
    syncAmbient();
  }

  /* Generic reveals. */
  gsap.utils.toArray("[data-reveal]").forEach((el) => {
    gsap.to(el, {
      autoAlpha: 1,
      y: 0,
      duration: 1,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%" },
    });
  });

  /* Section rules draw in from the left. */
  gsap.utils.toArray(".section-head").forEach((head) => {
    const rule = head.querySelector(".section-rule");
    if (!rule) return;
    gsap.fromTo(
      rule,
      { scaleX: 0 },
      {
        scaleX: 1,
        duration: 1.2,
        ease: "power3.inOut",
        transformOrigin: "left center",
        scrollTrigger: { trigger: head, start: "top 85%" },
      }
    );
  });

  /* Timeline nodes fire along the rail. */
  gsap.utils.toArray(".tl-item").forEach((item) => {
    gsap.fromTo(
      item.querySelector(".tl-node"),
      { scale: 0 },
      {
        scale: 1,
        duration: 0.5,
        ease: "back.out(2.5)",
        scrollTrigger: { trigger: item, start: "top 82%" },
      }
    );
  });

  /* Counters. */
  gsap.utils.toArray("[data-counter]").forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const suffix = el.dataset.suffix || "";
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target,
      duration: 1.6,
      ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 90%" },
      onUpdate: () => {
        el.textContent = Math.round(obj.v).toLocaleString("en-US") + suffix;
      },
    });
  });
}
