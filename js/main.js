/* ==========================================================================
   main.js — boot sequence, preloader, cursor, nav, drag input, HUD.
   ========================================================================== */

import { heroIntro, initScroll } from "./animations.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- GSAP availability ---------- */
if (!window.gsap || !window.ScrollTrigger) {
  document.documentElement.classList.add("no-gsap");
}

/* ==========================================================================
   3D STAGE
   ========================================================================== */
let sceneAPI = null;

try {
  const { initMechanism } = await import("./scene.js");
  sceneAPI = initMechanism($("#webgl"));
  if (sceneAPI) $("#stage").classList.add("ready");
} catch (err) {
  console.warn("3D stage unavailable:", err);
}

/* ---------- HUD readouts (throttled DOM writes) ---------- */
const hudN1 = $("#hud-n1");
const hudN2 = $("#hud-n2");
const hudEgt = $("#hud-egt");
const mechState = $("#mech-state");
const mechFill = $("#mech-fill");
const mechPct = $("#mech-pct");

if (sceneAPI) {
  let frame = 0;
  sceneAPI.onFrame = ({ n1, n2, egt, explode }) => {
    if (++frame % 3 !== 0) return;
    if (hudN1) hudN1.textContent = n1.toFixed(1).padStart(4, "0");
    if (hudN2) hudN2.textContent = n2.toFixed(1).padStart(4, "0");
    if (hudEgt) hudEgt.textContent = String(Math.round(egt)).padStart(4, "0");
    if (mechFill) mechFill.style.width = (explode * 100).toFixed(0) + "%";
    if (mechPct) mechPct.textContent = String(Math.round(explode * 100)).padStart(3, "0") + "%";
    if (mechState) {
      mechState.textContent =
        explode < 0.02 ? "ASSEMBLED" :
        explode > 0.98 ? "EXPLODED" :
        `SEPARATING ${Math.round(explode * 100)}%`;
    }
  };
}

/* ---------- Drag to rotate (canvas itself ignores pointers) ---------- */
if (sceneAPI) {
  const zones = [$("#hero"), $("#mechanism")].filter(Boolean);
  let active = false;
  let lastX = 0, lastY = 0;

  const interactive = (t) => t.closest("a, button, .btn, .mech-readout");

  for (const zone of zones) {
    zone.addEventListener("pointerdown", (e) => {
      if (interactive(e.target)) return;
      active = true;
      lastX = e.clientX;
      lastY = e.clientY;
      sceneAPI.setDragging(true);
    });
  }
  addEventListener("pointermove", (e) => {
    if (!active) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    sceneAPI.nudge(dx * 0.005, dy * 0.003);
  }, { passive: true });
  const release = () => {
    if (!active) return;
    active = false;
    sceneAPI.setDragging(false);
  };
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
}

/* ==========================================================================
   PRELOADER
   ========================================================================== */
const preloader = $("#preloader");
const preFill = $("#pre-fill");
const prePct = $("#pre-pct");
const preStatus = $("#pre-status");
const preMessages = [
  "SPOOLING FAN — N1 RISING",
  "IGNITING ANNULAR COMBUSTOR",
  "STABILIZING HP SPOOL",
  "CHECKING TOLERANCES ±0.1",
  "LOADING SHEET 1 OF 1",
];

function runPreloader() {
  return new Promise((resolve) => {
    if (reduced) {
      preloader.remove();
      resolve();
      return;
    }
    const start = performance.now();
    const minMs = 1500;
    let loaded = document.readyState === "complete";
    let p = 0;
    let msg = 0;

    addEventListener("load", () => { loaded = true; }, { once: true });

    const step = () => {
      const elapsed = performance.now() - start;
      // The module's top-level await can register this after "load" already
      // fired, so re-check readyState and hard-cap the wait as a backstop.
      const settled = loaded || document.readyState === "complete" || elapsed > 2600;
      const ceiling = settled ? 1 : 0.92;
      p += (ceiling - p) * 0.035 + 0.001;

      preFill.style.width = (Math.min(p, 1) * 100).toFixed(1) + "%";
      prePct.textContent = String(Math.round(Math.min(p, 1) * 100)).padStart(3, "0");

      const nextMsg = Math.min(preMessages.length - 1, Math.floor(p * preMessages.length));
      if (nextMsg !== msg) {
        msg = nextMsg;
        preStatus.textContent = preMessages[msg];
      }

      if (p >= 0.999 && elapsed >= minMs) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function boot() {
  await runPreloader();
  if (window.gsap) {
    window.gsap.to(preloader, {
      yPercent: -100,
      duration: 0.9,
      ease: "power4.inOut",
      onComplete: () => preloader.remove(),
    });
    heroIntro();
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  } else {
    preloader.remove();
    document.documentElement.classList.add("no-gsap");
  }
  initScroll(sceneAPI);
}

/* ==========================================================================
   NAV
   ========================================================================== */
const nav = $("#nav");
const burger = $("#nav-burger");
const mobileMenu = $("#mobile-menu");

addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", scrollY > 40);
}, { passive: true });

function setMenu(open) {
  burger.classList.toggle("open", open);
  mobileMenu.classList.toggle("open", open);
  burger.setAttribute("aria-expanded", String(open));
  mobileMenu.setAttribute("aria-hidden", String(!open));
  document.body.style.overflow = open ? "hidden" : "";
}
burger.addEventListener("click", () => setMenu(!mobileMenu.classList.contains("open")));
$$("#mobile-menu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

/* ==========================================================================
   CUSTOM CURSOR
   ========================================================================== */
if (matchMedia("(pointer: fine)").matches && !reduced) {
  document.documentElement.classList.add("has-cursor");
  const cursor = $("#cursor");
  const h = $(".cursor-h", cursor);
  const v = $(".cursor-v", cursor);
  const dot = $(".cursor-dot", cursor);
  const label = $(".cursor-label", cursor);

  let tx = innerWidth / 2, ty = innerHeight / 2;
  let cx = tx, cy = ty;
  let down = false;

  addEventListener("pointermove", (e) => {
    tx = e.clientX;
    ty = e.clientY;
    cursor.style.opacity = "1";

    const el = e.target.closest("a, button, [data-magnetic]");
    dot.style.width = dot.style.height = el ? "14px" : down ? "3px" : "5px";
    label.textContent = el
      ? (el.dataset.cursorLabel || "OPEN")
      : (e.target.closest("#hero, #mechanism") ? "X " + Math.round(tx) + " · Y " + Math.round(ty) + " — DRAG" : "X " + Math.round(tx) + " · Y " + Math.round(ty));
  }, { passive: true });

  addEventListener("pointerdown", () => { down = true; });
  addEventListener("pointerup", () => { down = false; });
  document.addEventListener("mouseleave", () => { cursor.style.opacity = "0"; });

  (function loop() {
    cx += (tx - cx) * 0.22;
    cy += (ty - cy) * 0.22;
    h.style.transform = `translateY(${cy}px)`;
    v.style.transform = `translateX(${cx}px)`;
    dot.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -50%)`;
    label.style.transform = `translate(${tx + 16}px, ${ty + 16}px)`;
    requestAnimationFrame(loop);
  })();
}

/* ==========================================================================
   MAGNETIC BUTTONS
   ========================================================================== */
if (matchMedia("(pointer: fine)").matches && !reduced) {
  $$("[data-magnetic]").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      if (window.gsap) {
        window.gsap.to(el, { x: x * 0.18, y: y * 0.24, duration: 0.4, ease: "power2.out" });
      }
    });
    el.addEventListener("mouseleave", () => {
      if (window.gsap) {
        window.gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" });
      }
    });
  });
}

/* ---------- Go ---------- */
boot();
