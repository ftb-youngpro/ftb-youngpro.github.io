/* ============================================================================
   Young Pro Ministry — Faith Temple Baptist Church Inc.
   main.js — the immersive interaction + animation layer.

   TWO PATHS, ONE FILE:
     • ENHANCED (studio-grade): GSAP 3.13 + ScrollTrigger + SplitText + Lenis.
       Lenis smooth scroll, masked intro reveal, kinetic SplitText hero +
       section titles, ScrollTrigger.batch reveals, image-mask wipes, scrub
       parallax, ScrollTrigger count-up, scroll-velocity-reactive themes
       marquee, magnetic CTAs + custom emerald cursor (desktop pointer only).
     • FALLBACK (vanilla baseline): if ANY lib is blocked/absent, the page
       falls back to IntersectionObserver reveals, native scroll, CSS marquee,
       rAF count-up, rAF poster parallax — exactly the prior behavior.

   GUARDRAILS:
     • Feature-detects every lib (typeof window.X !== "undefined"); never
       assumes a CDN loaded; never throws (each module is try/caught).
     • prefers-reduced-motion: no Lenis / intro / parallax / marquee loop /
       cursor / magnetic / SplitText motion — instant final states. Live-toggle
       tears the enhanced layer down.
     • Mobile-first / perf: Lenis desktop/non-touch only; cursor + magnetic
       desktop fine-pointer only; parallax lightened on phones; will-change
       used sparingly and cleared after settle; only transform/opacity/
       clip-path/filter animated.
     • Nav drawer + lightbox + scrollspy + sticky header work in BOTH paths.
     • [data-year] hardcoded to 2026 (Date() intentionally never called).
   ============================================================================ */
(function () {
  "use strict";

  /* --- Swap the no-js baseline ASAP so reveals stay hidden until observed.
     (styles.css: `.no-js [data-reveal] { opacity:1 }` is the safe fallback;
     once we confirm JS runs we move to `.js` so the reveal resting state of
     opacity:0 applies and elements animate in.) ------------------------------ */
  var docEl = document.documentElement;
  docEl.classList.remove("no-js");
  docEl.classList.add("js");

  /* --- Reduced-motion preference (live-queried via matchMedia) ------------- */
  var reduceMQ = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false, addEventListener: function () {}, addListener: function () {} };
  var prefersReduced = function () { return !!reduceMQ.matches; };

  /* --- Pointer / touch capability ------------------------------------------ */
  var finePointer = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
    : false;
  var isTouch = window.matchMedia
    ? window.matchMedia("(hover: none) and (pointer: coarse)").matches
    : false;

  /* --- CAPABILITY GATE — one object, computed once, used everywhere -------- */
  var LIB = {
    gsap:  typeof window.gsap !== "undefined",
    st:    typeof window.ScrollTrigger !== "undefined",
    split: typeof window.SplitText !== "undefined",
    lenis: typeof window.Lenis !== "undefined"
  };
  // GSAP core is the master switch; the enhanced path runs only when GSAP is
  // present AND motion is allowed. Each sub-lib is additive on its own flag.
  var ENHANCED = LIB.gsap && !prefersReduced();

  /* --- Tiny helpers -------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var supportsIO = typeof window.IntersectionObserver === "function";
  var NAV_H = 68; // mirrors --nav-h in styles.css

  /* Travel multiplier — lighten parallax on small screens. */
  function pxScale() { return window.innerWidth < 768 ? 0.45 : 1; }

  /* requestAnimationFrame throttle: collapse many scroll/move events into one
     frame so handlers stay cheap. */
  function rafThrottle(fn) {
    var ticking = false;
    return function () {
      var args = arguments, self = this;
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        fn.apply(self, args);
      });
    };
  }

  /* --- Module-scope handles for teardown (reduced-motion live-toggle) ------ */
  var lenisInstance = null;
  var cursorNodes = [];        // [dot, ring] for removal
  var splitInstances = [];     // SplitText instances to revert
  var enhancedActive = false;  // true once the enhanced layer is wired
  var marqueeTick = null;      // gsap.ticker cb driving the velocity marquee
  var marqueeTrack = null;     // the themes track, so teardown can reset it
  var cursorLoop = null;       // gsap.ticker cb driving the custom cursor

  /* --- Register GSAP plugins defensively ----------------------------------- */
  if (LIB.gsap) {
    try {
      window.gsap.config({ nullTargetWarn: false });
      if (LIB.st)    window.gsap.registerPlugin(window.ScrollTrigger);
      if (LIB.split) window.gsap.registerPlugin(window.SplitText);
    } catch (err) { /* a plugin failed to register — degrade gracefully */ }
  }

  /* ==========================================================================
     1. FOOTER YEAR  — hardcode 2026 (Date() is intentionally not used).
     ========================================================================== */
  function initYear() {
    $all("[data-year]").forEach(function (el) { el.textContent = "2026"; });
  }

  /* ==========================================================================
     2. STICKY NAV — add .is-scrolled past 24px.
        window.pageYOffset still updates under Lenis (Lenis transforms the
        scroll, not the DOM), so the native scroll listener keeps working.
     ========================================================================== */
  function initStickyHeader() {
    var header = $("[data-site-header]");
    if (!header) return;
    var THRESHOLD = 24;
    var update = function () {
      header.classList.toggle("is-scrolled", window.pageYOffset > THRESHOLD);
    };
    update();
    on(window, "scroll", rafThrottle(update), { passive: true });
    on(window, "resize", rafThrottle(update), { passive: true });
  }

  /* ==========================================================================
     3. MOBILE NAV TOGGLE — accessible drawer (identical in both paths).
     ========================================================================== */
  function initNav() {
    var toggle = $("[data-nav-toggle]");
    var menu = $("[data-nav]");
    if (!toggle || !menu) return;

    var DESKTOP = 992; // matches the styles.css inline-nav breakpoint
    var isDesktop = function () { return window.innerWidth >= DESKTOP; };

    function setOpen(open) {
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
      if (open) {
        var firstLink = $('a[href^="#"]', menu);
        if (firstLink) {
          window.requestAnimationFrame(function () { firstLink.focus(); });
        }
      }
    }
    function isOpen() { return menu.classList.contains("is-open"); }
    function close(returnFocus) {
      if (!isOpen()) return;
      setOpen(false);
      if (returnFocus) toggle.focus();
    }

    on(toggle, "click", function () { setOpen(!isOpen()); });

    // Focus trap: cycle Tab between the toggle and the drawer links.
    on(document, "keydown", function (e) {
      if (e.key !== "Tab" || !isOpen() || isDesktop()) return;
      var links = $all('a[href^="#"]', menu);
      if (!links.length) return;
      var first = toggle;
      var last = links[links.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    });

    $all('a[href^="#"]', menu).forEach(function (link) {
      on(link, "click", function () { if (!isDesktop()) close(false); });
    });

    on(document, "keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !isDesktop()) close(true);
    });

    on(document, "click", function (e) {
      if (!isOpen() || isDesktop()) return;
      if (menu.contains(e.target) || toggle.contains(e.target)) return;
      close(false);
    });

    on(window, "resize", rafThrottle(function () {
      if (isDesktop() && isOpen()) {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
        document.body.style.overflow = "";
      }
    }), { passive: true });
  }

  /* ==========================================================================
     4. SMOOTH ANCHOR SCROLL + focus management.
        ENHANCED + Lenis: glide via lenis.scrollTo with the sticky-nav offset.
        Otherwise: native scrollIntoView (CSS owns scroll-padding-top).
        Reduced motion: instant jump.
     ========================================================================== */
  function initSmoothAnchors() {
    $all('a[href^="#"]').forEach(function (link) {
      on(link, "click", function (e) {
        var hash = link.getAttribute("href");
        if (!hash || hash === "#" || hash.length < 2) return;
        var target = document.getElementById(hash.slice(1));
        if (!target) return;

        e.preventDefault();
        try { history.pushState(null, "", hash); }
        catch (err) { /* file:// or restricted — ignore */ }

        if (lenisInstance && !prefersReduced()) {
          lenisInstance.scrollTo(target, {
            offset: -(NAV_H + 16),
            duration: 1.1
          });
        } else {
          target.scrollIntoView({
            behavior: prefersReduced() ? "auto" : "smooth",
            block: "start"
          });
        }

        // Move focus to the section for SR + keyboard users.
        var hadTabindex = target.hasAttribute("tabindex");
        if (!hadTabindex) target.setAttribute("tabindex", "-1");
        try { target.focus({ preventScroll: true }); }
        catch (err2) { target.focus(); }
        if (!hadTabindex) {
          var cleanup = function () {
            target.removeAttribute("tabindex");
            target.removeEventListener("blur", cleanup);
          };
          target.addEventListener("blur", cleanup);
        }
      });
    });
  }

  /* ==========================================================================
     5. SCROLLSPY — mark the nav link of the section currently in view.
        One listener, sourced from Lenis when present else native scroll.
     ========================================================================== */
  function initScrollspy() {
    var navLinks = $all('[data-nav] a[href^="#"]');
    if (!navLinks.length) return;

    // Map nav links -> section elements (skip the CTA "#join" duplicates fine).
    var map = navLinks
      .map(function (link) {
        var id = (link.getAttribute("href") || "").slice(1);
        var sec = id ? document.getElementById(id) : null;
        return sec ? { link: link, sec: sec, top: 0 } : null;
      })
      .filter(Boolean);
    if (!map.length) return;

    // Cache each section's offsetTop; only re-measure on resize / load, not on
    // every scroll frame (section positions don't move while scrolling).
    var measure = function () {
      map.forEach(function (m) { m.top = m.sec.offsetTop; });
    };
    measure();

    var update = rafThrottle(function () {
      var probe = (window.pageYOffset || 0) + NAV_H + 48;
      var current = null;
      map.forEach(function (m) {
        if (m.top <= probe) current = m;
      });
      navLinks.forEach(function (l) { l.classList.remove("is-active"); });
      if (current) current.link.classList.add("is-active");
    });

    update();
    if (lenisInstance) {
      lenisInstance.on("scroll", update);
    } else {
      on(window, "scroll", update, { passive: true });
    }
    var onResize = rafThrottle(function () { measure(); update(); });
    on(window, "resize", onResize, { passive: true });
    on(window, "load", function () { measure(); update(); });
  }

  /* ==========================================================================
     6a. REVEAL — FALLBACK path (IntersectionObserver + .is-visible).
         Also colorizes leader cards on scroll-in (adds .in-color) so the
         vanilla path matches the enhanced bloom.
     ========================================================================== */
  function initReveal() {
    var items = $all("[data-reveal]");
    if (!items.length) return;

    var colorize = function (el) {
      var card = el.classList && el.classList.contains("leader-card")
        ? el : (el.closest ? el.closest(".leader-card") : null);
      if (card) card.classList.add("in-color");
    };

    if (!supportsIO || prefersReduced()) {
      items.forEach(function (el) {
        el.classList.add("is-visible");
        colorize(el);
      });
      return;
    }

    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          colorize(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ==========================================================================
     6b. REVEAL — ENHANCED path (GSAP ScrollTrigger.batch).
         Hero title + section titles are owned by SplitText (excluded here).
         Leader cards colorize on enter via .in-color.
     ========================================================================== */
  function gsapRevealBatch() {
    var gsap = window.gsap, ST = window.ScrollTrigger;

    var items = $all("[data-reveal]").filter(function (el) {
      return !el.matches(".hero-title, .section-title");
    });
    if (items.length) {
      try {
        gsap.set(items, { opacity: 0, y: 28 });
        ST.batch(items, {
          start: "top 88%",
          once: true,
          onEnter: function (batch) {
            gsap.to(batch, {
              opacity: 1, y: 0, duration: 0.8, ease: "power3.out",
              stagger: { each: 0.08, from: "start" },
              overwrite: true,
              onStart: function () {
                batch.forEach(function (b) { b.style.willChange = "transform, opacity"; });
              },
              onComplete: function () {
                batch.forEach(function (b) { b.style.willChange = ""; });
              }
            });
          }
        });
      } catch (err) {
        // ST.batch wiring failed after gsap.set hid the items — never strand
        // content at opacity:0. Restore + mark visible so the page reads fully.
        items.forEach(function (el) {
          try { gsap.set(el, { clearProps: "opacity,transform" }); } catch (e2) {}
          el.classList.add("is-visible");
        });
      }
    }

    // Leader cards bloom duotone -> color on scroll-in (independent of reveal y).
    var leaderCards = $all(".leader-card");
    if (leaderCards.length) {
      ST.batch(leaderCards, {
        start: "top 82%",
        once: true,
        onEnter: function (batch) {
          batch.forEach(function (c) { c.classList.add("in-color"); });
        }
      });
    }
  }

  /* ==========================================================================
     7a. COUNT-UP — FALLBACK path (IO + rAF). Shows final on reduced/no-IO.
     ========================================================================== */
  function initCountUp() {
    var nums = $all("[data-count]");
    if (!nums.length) return;

    var setFinal = function () {
      nums.forEach(function (el) {
        var t = parseInt(el.getAttribute("data-count"), 10);
        el.textContent = isNaN(t) ? el.textContent : String(t);
      });
    };

    if (prefersReduced() || !supportsIO) { setFinal(); return; }

    var DURATION = 1400;
    var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };

    function run(el) {
      var target = parseInt(el.getAttribute("data-count"), 10);
      if (isNaN(target)) return;
      var start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = clamp((ts - start) / DURATION, 0, 1);
        el.textContent = String(Math.round(easeOut(p) * target));
        if (p < 1) window.requestAnimationFrame(step);
        else el.textContent = String(target);
      }
      window.requestAnimationFrame(step);
    }

    var trigger = document.getElementById("vision");
    var started = false;

    if (trigger) {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !started) {
            started = true;
            nums.forEach(run);
            obs.disconnect();
          }
        });
      }, { threshold: 0.25 });
      io.observe(trigger);
    } else {
      var ioEach = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            run(entry.target);
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.5 });
      nums.forEach(function (el) { ioEach.observe(el); });
    }
  }

  /* ==========================================================================
     7b. COUNT-UP — ENHANCED path (ScrollTrigger fires GSAP tweens).
     ========================================================================== */
  function gsapCountUp() {
    var gsap = window.gsap, ST = window.ScrollTrigger;
    var vision = document.getElementById("vision");
    var nums = $all("[data-count]");
    if (!vision || !nums.length) return;

    ST.create({
      trigger: vision, start: "top 70%", once: true,
      onEnter: function () {
        nums.forEach(function (el) {
          var target = parseInt(el.getAttribute("data-count"), 10);
          if (isNaN(target)) return;
          var obj = { v: 0 };
          gsap.to(obj, {
            v: target, duration: 1.6, ease: "power2.out",
            onUpdate: function () { el.textContent = String(Math.round(obj.v)); },
            onComplete: function () { el.textContent = String(target); }
          });
        });
      }
    });
  }

  /* ==========================================================================
     8. HERO POINTER-PARALLAX + reactive halo (desktop fine-pointer only).
        Drives --px/--py on .hero-bg (auroras compose via `translate:`) and
        --hx/--hy on the halo center. Skipped on touch / reduced motion.
     ========================================================================== */
  function initHeroParallax() {
    if (!finePointer || prefersReduced()) return;
    var hero = $("#hero");
    var bg = hero ? $(".hero-bg", hero) : null;
    var halo = hero ? $(".hero-halo", hero) : null;
    if (!hero || !bg) return;

    var MAX = 14;     // px aurora drift at the screen edge
    var HALO = 18;    // px halo-center shift
    var apply = rafThrottle(function (x, y, hx, hy) {
      bg.style.setProperty("--px", x.toFixed(1) + "px");
      bg.style.setProperty("--py", y.toFixed(1) + "px");
      if (halo) {
        halo.style.setProperty("--hx", hx.toFixed(1) + "px");
        halo.style.setProperty("--hy", hy.toFixed(1) + "px");
      }
    });

    on(hero, "pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var nx = (e.clientX - r.left) / r.width - 0.5;  // -0.5 .. 0.5
      var ny = (e.clientY - r.top) / r.height - 0.5;
      apply(nx * MAX * 2, ny * MAX * 2, nx * HALO * 2, ny * HALO * 2);
    });
    on(hero, "pointerleave", function () {
      bg.style.setProperty("--px", "0px");
      bg.style.setProperty("--py", "0px");
      if (halo) {
        halo.style.setProperty("--hx", "0px");
        halo.style.setProperty("--hy", "0px");
      }
    });
  }

  /* ==========================================================================
     9. CARD HOVER TILT (desktop fine-pointer only — independent of libs).
     ========================================================================== */
  function initTilt() {
    if (!finePointer || prefersReduced()) return;
    var cards = $all(".card");
    if (!cards.length) return;

    var MAX_DEG = 5;

    cards.forEach(function (card) {
      var raf = null;
      function move(e) {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
          raf = null;
          var r = card.getBoundingClientRect();
          if (!r.width || !r.height) return;
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          var rotX = clamp(-py * MAX_DEG * 2, -MAX_DEG, MAX_DEG);
          var rotY = clamp(px * MAX_DEG * 2, -MAX_DEG, MAX_DEG);
          card.style.setProperty("--tilt-x", rotX.toFixed(2) + "deg");
          card.style.setProperty("--tilt-y", rotY.toFixed(2) + "deg");
        });
      }
      function enter() { card.classList.add("is-tilting"); }
      function leave() {
        card.classList.remove("is-tilting");
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
      }
      on(card, "pointerenter", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        enter();
      });
      on(card, "pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        move(e);
      });
      on(card, "pointerleave", leave);
    });
  }

  /* ==========================================================================
     10. THEMES MARQUEE — shared clone helper.
     ========================================================================== */
  function duplicateMarqueeChildren(track) {
    if (track.getAttribute("data-marquee-cloned") === "true") return;
    var originals = $all(":scope > *", track);
    if (!originals.length) return;
    originals.forEach(function (node) {
      var clone = node.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      $all("a, button, [tabindex]", clone).forEach(function (f) {
        f.setAttribute("tabindex", "-1");
      });
      track.appendChild(clone);
    });
    track.setAttribute("data-marquee-cloned", "true");
  }

  /* 10a. FALLBACK marquee — CSS keyframe loop, paused on hover/focus (CSS). */
  function initMarquee() {
    var track = $("[data-themes-track]");
    if (!track) return;
    if (prefersReduced()) return; // leave static
    duplicateMarqueeChildren(track);
    track.classList.add("is-marquee");
  }

  /* 10b. ENHANCED marquee — scroll-velocity reactive, GSAP ticker driven.
         Continuous calm baseline drift; scroll velocity nudges speed/direction
         within a bounded clamp, decaying back to baseline. Pauses on hover/
         focus. Velocity source: Lenis if present, else ScrollTrigger. */
  function initVelocityMarquee() {
    var gsap = window.gsap, ST = window.ScrollTrigger;
    var marquee = $(".themes-marquee");
    var track = $("[data-themes-track]");
    if (!track) return;

    // Scroll-velocity reactivity is a desktop-pointer nicety; on touch the
    // per-frame ticker isn't worth the cost — fall back to the CSS loop.
    if (isTouch) { initMarquee(); return; }

    duplicateMarqueeChildren(track);
    track.classList.remove("is-marquee"); // GSAP owns it now
    track.style.willChange = "transform";

    // Measure the one-set width ONCE (children duplicated exactly once) and
    // recompute only on resize — never per frame (scrollWidth forces a layout
    // flush; reading it ~60x/s was a perpetual forced reflow, esp. on phones).
    var half = track.scrollWidth / 2;
    if (!half) { track.classList.add("is-marquee"); return; } // safety: revert to CSS loop
    marqueeTrack = track;

    var x = 0;
    var baseDir = -1;        // leftward baseline
    var baseSpeed = 0.6;     // px/frame (calm)
    var velFactor = 0;       // extra speed from scroll velocity
    var paused = false;

    on(window, "resize", rafThrottle(function () {
      var h = track.scrollWidth / 2;
      if (h) half = h;
    }), { passive: true });

    // Pause baseline on hover / focus (keyboard + mouse).
    if (marquee) {
      on(marquee, "pointerenter", function () { paused = true; });
      on(marquee, "pointerleave", function () { paused = false; });
      on(marquee, "focusin", function () { paused = true; });
      on(marquee, "focusout", function () { paused = false; });
    }

    if (lenisInstance) {
      lenisInstance.on("scroll", function (e) {
        velFactor = clamp((e.velocity || 0) * 0.25, -18, 18);
      });
    } else if (ST) {
      ST.create({ onUpdate: function (self) {
        velFactor = clamp(self.getVelocity() / 300, -18, 18);
      }});
    }

    marqueeTick = function () {
      var step = (paused ? 0 : baseSpeed * baseDir) + velFactor;
      x += step;
      velFactor *= 0.9;                      // decay back to baseline
      if (x <= -half) x += half;             // seamless wrap
      if (x > 0)      x -= half;
      track.style.transform = "translate3d(" + x + "px,0,0)";
    };
    gsap.ticker.add(marqueeTick);
  }

  /* ==========================================================================
     11a. POSTER PARALLAX — FALLBACK rAF (writes --shift, ≤24px peak).
     ========================================================================== */
  function initPosterParallax() {
    if (prefersReduced()) return;
    var posters = $all("[data-parallax]");
    if (!posters.length) return;

    var MAX = 24 * pxScale();
    var vh = window.innerHeight || document.documentElement.clientHeight;

    var update = rafThrottle(function () {
      vh = window.innerHeight || document.documentElement.clientHeight;
      posters.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var center = r.top + r.height / 2;
        var prog = (center - vh / 2) / (vh / 2 + r.height / 2);
        prog = clamp(prog, -1, 1);
        el.style.setProperty("--shift", (-prog * MAX).toFixed(1) + "px");
      });
    });

    update();
    on(window, "scroll", update, { passive: true });
    on(window, "resize", update, { passive: true });
  }

  /* ==========================================================================
     11b. POSTER PARALLAX — ENHANCED scrub (drives --shift so it composes with
          the CSS hover scale; ≤24px peak-to-peak desktop, lighter on mobile).
     ========================================================================== */
  function gsapParallax() {
    var gsap = window.gsap;
    var s = pxScale();
    $all(".post-poster[data-parallax]").forEach(function (img) {
      var post = img.closest(".post") || img;
      gsap.fromTo(img,
        { "--shift": (12 * s) + "px" },
        {
          "--shift": (-12 * s) + "px", ease: "none",
          scrollTrigger: { trigger: post, start: "top bottom", end: "bottom top", scrub: 0.5 }
        });
    });
  }

  /* ==========================================================================
     12. AURORA SCRUB (ENHANCED) — gentle group parallax as hero scrolls out.
         Scrubs .hero-bg (no keyframe transform of its own) so it never fights
         the per-blob CSS drift. Deeper accent on .aurora-3 via --scrubY which
         composes with that blob's `translate:` (not its keyframe transform).
     ========================================================================== */
  function gsapAuroraScrub() {
    var gsap = window.gsap;
    var s = pxScale();
    var hero = document.getElementById("hero");
    var bg = $(".hero-bg", hero || document);
    if (bg) {
      gsap.to(bg, {
        yPercent: -12 * s, ease: "none",
        scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: 0.6 }
      });
    }
    var a3 = $(".aurora-3");
    if (a3) {
      gsap.fromTo(a3,
        { "--scrubY": "0px" },
        {
          "--scrubY": (-60 * s) + "px", ease: "none",
          scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: 0.6 }
        });
    }
  }

  /* ==========================================================================
     13. IMAGE-MASK REVEALS (ENHANCED) — clip-path wipe + scale settle.
         Targets every [data-mask] (2 posters, 2 gallery imgs, 4 leader photos).
         Clears the inline transform on complete so the CSS hover scale +
         --shift parallax regain control; leaves clip-path at fully-open.
         NOTE: base CSS does NOT clip the image, so a no-JS page shows it fully.
     ========================================================================== */
  function gsapMaskReveals() {
    var gsap = window.gsap;
    $all("[data-mask]").forEach(function (img) {
      gsap.set(img, {
        clipPath: "inset(0 0 100% 0)",
        webkitClipPath: "inset(0 0 100% 0)",
        scale: 1.08,
        transformOrigin: "center"
      });
      gsap.to(img, {
        clipPath: "inset(0 0 0% 0)",
        webkitClipPath: "inset(0 0 0% 0)",
        scale: 1, duration: 1.0, ease: "power4.out",
        scrollTrigger: {
          trigger: img, start: "top 86%", once: true,
          // Prime the will-change:clip-path layer only for the wipe itself.
          onEnter: function () { img.classList.add("is-masking"); }
        },
        onComplete: function () {
          // Hand transform back to CSS (hover scale / --shift composition) and
          // drop the expensive will-change:clip-path layer now the wipe is done.
          gsap.set(img, { clearProps: "transform,scale,transformOrigin" });
          img.classList.remove("is-masking");
        }
      });
    });
  }

  /* ==========================================================================
     14. SPLITTEXT — kinetic hero headline (lines + words) + section titles.
         Hero is owned by the intro/hero timeline (returns a builder so the
         intro can chain it). Section titles get a per-title ScrollTrigger.
         Each splitting is wrapped so a failure reveals the text and never traps.
     ========================================================================== */
  function makeHeroSplit() {
    var gsap = window.gsap;
    var title = $(".hero-title");
    if (!title) return null;
    title.classList.add("is-visible"); // neutralize CSS reveal so it can't fight
    // Preserve the single <h1>'s accessible name explicitly before splitting
    // (parity with splitSectionTitles + a belt-and-suspenders guarantee given
    // the inner .text-gradient span makes this the most fragile case).
    if (!title.hasAttribute("aria-label")) {
      title.setAttribute("aria-label", title.textContent.trim());
    }
    var split;
    try {
      split = new window.SplitText(title, { type: "lines,words", linesClass: "split-line" });
    } catch (err) {
      title.classList.add("is-visible");
      return null;
    }
    splitInstances.push(split);
    gsap.set(split.lines, { overflow: "hidden" });
    gsap.set(title, { opacity: 1 });
    // Return a function the hero/intro timeline calls to play the words in.
    return function play(delay) {
      gsap.from(split.words, {
        yPercent: 120, opacity: 0, duration: 0.9, ease: "power4.out",
        stagger: { each: 0.04, from: "start" },
        delay: delay || 0
      });
    };
  }

  function splitSectionTitles() {
    var gsap = window.gsap;
    $all(".section-title[data-split]").forEach(function (title) {
      title.classList.add("is-visible"); // neutralize CSS reveal
      var s;
      // Preserve the accessible name explicitly before splitting.
      if (!title.hasAttribute("aria-label")) {
        title.setAttribute("aria-label", title.textContent.trim());
      }
      try {
        s = new window.SplitText(title, { type: "lines", linesClass: "split-line" });
      } catch (err) {
        title.classList.add("is-visible");
        return;
      }
      splitInstances.push(s);
      gsap.set(title, { perspective: 400 });
      gsap.set(s.lines, { overflow: "hidden" });
      gsap.from(s.lines, {
        yPercent: 110, opacity: 0, duration: 0.8, ease: "power4.out", stagger: 0.08,
        scrollTrigger: { trigger: title, start: "top 85%", once: true }
      });
    });
  }

  /* ==========================================================================
     15. HERO ENTRANCE — eyebrow / title lines / lead / actions, cohesive.
         Returns a GSAP timeline so the intro can hand off to it.
     ========================================================================== */
  function buildHeroTimeline(playHeroSplit) {
    var gsap = window.gsap;
    var tl = gsap.timeline();
    var eyebrow = $(".hero-eyebrow");
    var lead = $(".hero-lead");
    var actions = $(".hero-actions");

    [eyebrow, lead, actions].forEach(function (el) {
      if (el) el.classList.add("is-visible"); // neutralize CSS reveal
    });

    if (eyebrow) {
      tl.from(eyebrow, { y: 24, opacity: 0, duration: 0.6, ease: "power3.out" }, 0);
    }
    if (playHeroSplit) {
      tl.add(function () { playHeroSplit(0); }, 0.1);
    }
    var stragglers = [lead, actions].filter(Boolean);
    if (stragglers.length) {
      tl.from(stragglers, {
        y: 24, opacity: 0, duration: 0.6, ease: "power3.out", stagger: 0.08
      }, 0.35);
    }
    return tl;
  }

  /* ==========================================================================
     16. INTRO / LOAD-IN (ENHANCED only) — masked YP-mark + forest wipe, ≤1.2s,
         skippable, first-visit (sessionStorage), never traps (CSS failsafe +
         JS removal). Hands off to the hero timeline.
     ========================================================================== */
  function runIntro(playHeroSplit) {
    var gsap = window.gsap;
    var alreadyPlayed = false;
    try { alreadyPlayed = !!sessionStorage.getItem("yp-intro-played"); }
    catch (e) { /* sessionStorage blocked — just play it */ }

    // Build the hero timeline regardless (it must run whether or not we intro).
    var heroTL = buildHeroTimeline(playHeroSplit);

    if (alreadyPlayed) {
      // Internal re-render in the same session: skip the overlay, play hero now.
      refreshST();
      return;
    }
    try { sessionStorage.setItem("yp-intro-played", "1"); } catch (e) {}

    // Pause the hero timeline; the intro will resume it as the wipe lifts.
    heroTL.pause(0);

    // --- Inject the overlay ---
    var intro = document.createElement("div");
    intro.className = "yp-intro";
    intro.setAttribute("aria-hidden", "true");
    var mask = document.createElement("div");
    mask.className = "yp-intro-mask";
    var mark = document.createElement("img");
    mark.className = "yp-intro-mark";
    mark.src = "assets/img/yp-mark.svg";
    mark.alt = "";
    mark.width = 96; mark.height = 96;
    mask.appendChild(mark);
    var wipe = document.createElement("span");
    wipe.className = "yp-intro-wipe";
    intro.appendChild(mask);
    intro.appendChild(wipe);
    document.body.insertBefore(intro, document.body.firstChild);

    // Lock scroll during the intro only.
    if (lenisInstance) { try { lenisInstance.stop(); } catch (e) {} }
    document.body.style.overflow = "hidden";

    var done = false;
    var failsafeTimer = null;
    function finish() {
      if (done) return;
      done = true;
      if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; }
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      document.body.style.overflow = "";
      if (lenisInstance) { try { lenisInstance.start(); } catch (e) {} }
      refreshST();
    }

    // JS failsafe: always release the scroll-lock + Lenis even if the GSAP
    // timeline errors or never completes (the CSS failsafe only fades the
    // overlay; it can't restore body.overflow or restart Lenis). `done` guards
    // the double-call. 2s comfortably exceeds the ~1.2s intro.
    failsafeTimer = setTimeout(finish, 2000);

    var introTL = gsap.timeline({
      onComplete: finish
    });
    introTL
      .fromTo(mark,
        { opacity: 0, scale: 0.86 },
        { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }, 0)
      .to(mark, { scale: 1.04, duration: 0.25, ease: "power1.inOut" }, 0.35)
      .to([wipe, mark], { yPercent: -110, duration: 0.55, ease: "power4.inOut" }, 0.6)
      .to(intro, { opacity: 0, duration: 0.3, ease: "power2.out" }, 0.85)
      // Hand off to the hero as the wipe lifts (overlap for momentum).
      .add(function () { heroTL.play(0); }, 0.6);

    // Skippable: any input fast-forwards.
    function skip() {
      introTL.progress(1);
      heroTL.play(0);
      finish();
    }
    on(window, "keydown", skip, { once: true });
    on(window, "pointerdown", skip, { once: true });
    on(window, "wheel", skip, { once: true, passive: true });
  }

  /* ==========================================================================
     17. CUSTOM CURSOR (ENHANCED + finePointer) — emerald dot + trailing ring.
         Single GSAP ticker loop, interpolated (never per-event style writes).
         Native cursor stays visible; this is an overlay accent only.
     ========================================================================== */
  function initCursor() {
    var gsap = window.gsap;
    var dot = document.createElement("div");
    dot.className = "yp-cursor";
    dot.setAttribute("aria-hidden", "true");
    var ring = document.createElement("div");
    ring.className = "yp-cursor-ring";
    ring.setAttribute("aria-hidden", "true");
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    cursorNodes = [dot, ring];

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var dx = mx, dy = my, rx = mx, ry = my;
    var visible = false;

    function setVisible(v) {
      if (v === visible) return;
      visible = v;
      dot.style.opacity = ring.style.opacity = v ? "1" : "0";
    }

    on(window, "pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      mx = e.clientX; my = e.clientY;
      setVisible(true);
    });
    on(document, "pointerleave", function () { setVisible(false); });
    on(window, "blur", function () { setVisible(false); });

    cursorLoop = function () {
      dx += (mx - dx) * 0.35; dy += (my - dy) * 0.35;  // dot: snappy
      rx += (mx - rx) * 0.15; ry += (my - ry) * 0.15;  // ring: trails
      dot.style.transform  = "translate(" + dx + "px," + dy + "px) translate(-50%,-50%)";
      ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
    };
    gsap.ticker.add(cursorLoop);

    // Grow the ring over interactive elements.
    var sel = 'a, button, [data-magnetic], .gallery-tile, input, [tabindex]:not([tabindex="-1"])';
    on(document, "pointerover", function (e) {
      if (e.target && e.target.closest && e.target.closest(sel)) ring.classList.add("is-hovering");
    });
    on(document, "pointerout", function (e) {
      if (e.target && e.target.closest && e.target.closest(sel)) ring.classList.remove("is-hovering");
    });
  }

  /* ==========================================================================
     18. MAGNETIC BUTTONS (ENHANCED + finePointer) — transform-only pull.
     ========================================================================== */
  function initMagnetic() {
    var gsap = window.gsap;
    $all("[data-magnetic]").forEach(function (btn) {
      var strength = 0.35, max = 12;
      var qX = gsap.quickTo(btn, "x", { duration: 0.4, ease: "power3" });
      var qY = gsap.quickTo(btn, "y", { duration: 0.4, ease: "power3" });
      on(btn, "pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        var r = btn.getBoundingClientRect();
        qX(clamp((e.clientX - (r.left + r.width / 2)) * strength, -max, max));
        qY(clamp((e.clientY - (r.top + r.height / 2)) * strength, -max, max));
      });
      on(btn, "pointerleave", function () { qX(0); qY(0); });
    });
  }

  /* ==========================================================================
     19. GALLERY LIGHTBOX — open/close, focus-trap, ESC, inert background.
         Identical in both paths.
     ========================================================================== */
  function initLightbox() {
    var dialog = $("[data-lightbox-dialog]");
    var triggers = $all("[data-lightbox]");
    if (!dialog || !triggers.length) return;

    var imgEl = $("[data-lightbox-image]", dialog);
    var capEl = $("[data-lightbox-caption]", dialog);
    var closers = $all("[data-lightbox-close]", dialog);
    var content = $(".lightbox-content", dialog) || dialog;
    var lastFocused = null;

    var bgRegions = [
      document.getElementById("main"),
      $("[data-site-header]"),
      document.getElementById("site-footer")
    ].filter(Boolean);

    function isolateBackground(state) {
      bgRegions.forEach(function (el) {
        try {
          if (state) { el.inert = true; el.setAttribute("aria-hidden", "true"); }
          else { el.inert = false; el.removeAttribute("aria-hidden"); }
        } catch (err) {
          if (state) el.setAttribute("aria-hidden", "true");
          else el.removeAttribute("aria-hidden");
        }
      });
    }

    function focusables() {
      return $all(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        dialog
      ).filter(function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      });
    }

    function open(trigger) {
      lastFocused = trigger || document.activeElement;
      var full = trigger.getAttribute("data-full") || "";
      var caption = trigger.getAttribute("data-caption") || "";
      if (imgEl) {
        imgEl.setAttribute("src", full);
        imgEl.setAttribute("alt", caption);
      }
      if (capEl) capEl.textContent = caption;

      dialog.removeAttribute("hidden");
      document.body.style.overflow = "hidden";
      if (lenisInstance) { try { lenisInstance.stop(); } catch (e) {} }
      isolateBackground(true);

      var closeBtn = closers[0];
      window.requestAnimationFrame(function () {
        if (closeBtn) closeBtn.focus();
        else if (content.focus) { content.setAttribute("tabindex", "-1"); content.focus(); }
      });
    }

    function close() {
      if (dialog.hasAttribute("hidden")) return;
      dialog.setAttribute("hidden", "");
      document.body.style.overflow = "";
      if (lenisInstance) { try { lenisInstance.start(); } catch (e) {} }
      isolateBackground(false);
      if (imgEl) { imgEl.removeAttribute("src"); imgEl.setAttribute("alt", ""); }
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      lastFocused = null;
    }

    triggers.forEach(function (t) {
      on(t, "click", function (e) { e.preventDefault(); open(t); });
    });
    closers.forEach(function (c) { on(c, "click", close); });

    on(document, "keydown", function (e) {
      if (dialog.hasAttribute("hidden")) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "Tab") {
        var f = focusables();
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1];
        var active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !dialog.contains(active)) { e.preventDefault(); last.focus(); }
        } else {
          if (active === last || !dialog.contains(active)) { e.preventDefault(); first.focus(); }
        }
      }
    });
  }

  /* ==========================================================================
     20. LEADER PHOTO error fallback — hide failed img, show initials monogram.
         Runs in BOTH paths. Handles images that errored before the listener
         attached (img.complete && naturalWidth === 0).
     ========================================================================== */
  function initLeaderPhotoFallback() {
    $all(".leader-photo").forEach(function (img) {
      var fail = function () {
        var avatar = img.closest(".leader-avatar");
        if (avatar) avatar.classList.add("no-photo");
      };
      on(img, "error", fail);
      if (img.complete && img.naturalWidth === 0) fail();
    });
  }

  /* ==========================================================================
     21. LENIS SMOOTH SCROLL (ENHANCED + Lenis + non-touch).
     ========================================================================== */
  function initLenis() {
    var gsap = window.gsap;
    try {
      lenisInstance = new window.Lenis({
        duration: 1.05,
        easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
        smoothWheel: true,
        smoothTouch: false,
        touchMultiplier: 1.2,
        wheelMultiplier: 1.0,
        lerp: 0.1
      });
    } catch (err) { lenisInstance = null; return; }

    if (LIB.st) {
      lenisInstance.on("scroll", window.ScrollTrigger.update);
      // Null-guard: teardown sets lenisInstance = null after destroy; without
      // this the ticker callback would throw every frame on the dead instance.
      gsap.ticker.add(function (time) { if (lenisInstance) lenisInstance.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    } else {
      var raf = function (t) {
        if (!lenisInstance) return;
        lenisInstance.raf(t);
        window.requestAnimationFrame(raf);
      };
      window.requestAnimationFrame(raf);
    }
  }

  /* --- ScrollTrigger.refresh helper (after fonts/images/intro) ------------- */
  function refreshST() {
    if (LIB.st && window.ScrollTrigger) {
      try { window.ScrollTrigger.refresh(); } catch (e) {}
    }
  }

  /* ==========================================================================
     22. REDUCED-MOTION LIVE TOGGLE — one-way teardown of the enhanced layer.
     ========================================================================== */
  function wireReducedMotionToggle() {
    var handler = function () {
      if (!prefersReduced() || !enhancedActive) return;
      enhancedActive = false;
      // Remove the gsap.ticker callbacks FIRST — they live outside globalTimeline
      // so clearing the timeline does NOT stop them. Left running, the velocity
      // marquee keeps writing an inline transform (a reduced-motion violation)
      // and the cursor loop keeps writing to detached nodes.
      if (window.gsap && window.gsap.ticker) {
        try { if (marqueeTick) window.gsap.ticker.remove(marqueeTick); } catch (e) {}
        try { if (cursorLoop)  window.gsap.ticker.remove(cursorLoop); } catch (e) {}
      }
      marqueeTick = null;
      cursorLoop = null;
      // Reset the marquee to a static state (no residual inline transform; we do
      // NOT re-add .is-marquee, since its CSS loop is also unwanted here).
      if (marqueeTrack) { try { marqueeTrack.style.transform = "none"; } catch (e) {} }
      // Kill ScrollTriggers + tweens.
      if (LIB.st && window.ScrollTrigger) {
        try { window.ScrollTrigger.getAll().forEach(function (t) { t.kill(); }); } catch (e) {}
      }
      if (window.gsap) {
        try { window.gsap.globalTimeline.clear(); } catch (e) {}
      }
      // Destroy Lenis.
      if (lenisInstance) { try { lenisInstance.destroy(); } catch (e) {} lenisInstance = null; }
      // Revert SplitText so headings read normally.
      splitInstances.forEach(function (s) { try { s.revert(); } catch (e) {} });
      splitInstances = [];
      // Remove cursor nodes.
      cursorNodes.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
      cursorNodes = [];
      // Remove intro if still present.
      var intro = $(".yp-intro");
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      document.body.style.overflow = "";
      // Ensure everything is visible + final.
      $all("[data-reveal]").forEach(function (el) {
        el.classList.add("is-visible");
        if (window.gsap) { try { window.gsap.set(el, { clearProps: "all" }); } catch (e) {} }
      });
      $all("[data-split]").forEach(function (el) {
        el.classList.add("is-visible");
        el.style.opacity = "1";
      });
      $all("[data-mask]").forEach(function (img) {
        img.style.clipPath = "none";
        img.style.webkitClipPath = "none";
        img.style.transform = "none";
        img.style.opacity = "1";
      });
      $all("[data-magnetic]").forEach(function (b) { b.style.transform = "none"; });
      $all(".leader-card").forEach(function (c) { c.classList.add("in-color"); });
      // Drop the enhanced signal so CSS returns to the plain reduced-motion
      // resting state (re-enables the reveal transition; clears the will-change
      // priming on [data-mask] / [data-magnetic] that lingered after motion off).
      docEl.classList.remove("gsap-enhanced");
    };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", handler);
    else if (reduceMQ.addListener) reduceMQ.addListener(handler);
  }

  /* ==========================================================================
     INIT — every behavior is self-guarding; a throw in one must not block the
     rest. The fork between ENHANCED and FALLBACK lives here.
     ========================================================================== */
  function init() {
    var tasks = [];

    // --- Always-on (both paths) ---
    tasks.push(initYear);
    tasks.push(initStickyHeader);
    tasks.push(initNav);
    tasks.push(initLeaderPhotoFallback);
    tasks.push(initTilt);          // independent of libs; finePointer + !reduced
    tasks.push(initLightbox);

    if (ENHANCED) {
      // Mark the enhanced path so CSS opts reveals into the GSAP-managed state.
      // Gate on ScrollTrigger: only when ST drives the scroll reveals do we want
      // the CSS reveal transition disabled. If ST is blocked we fall back to the
      // IntersectionObserver reveal (initReveal), which NEEDS the CSS fade — so
      // we leave `gsap-enhanced` off in that case to avoid a hard snap-in.
      if (LIB.st) docEl.classList.add("gsap-enhanced");
      enhancedActive = true;

      // Lenis first so anchors/scrollspy/marquee can read it.
      if (LIB.lenis && !isTouch) tasks.push(initLenis);

      // Anchors + scrollspy (read lenisInstance set above).
      tasks.push(initSmoothAnchors);
      tasks.push(initScrollspy);

      // Hero kinetics + intro hand-off.
      tasks.push(function () {
        var playHero = LIB.split ? makeHeroSplit() : null;
        // If SplitText is blocked/failed, makeHeroSplit() returns null and never
        // adds .is-visible — guarantee the <h1> is shown so it can't stay at
        // opacity:0 under `.js [data-reveal]:not(.is-visible){opacity:0}`.
        if (!playHero) {
          var ht = $(".hero-title");
          if (ht) ht.classList.add("is-visible");
        }
        runIntro(playHero); // builds + plays/holds the hero timeline
      });

      // Scroll-driven modules (each gated on ScrollTrigger).
      if (LIB.st) {
        tasks.push(gsapRevealBatch);
        tasks.push(gsapCountUp);
        tasks.push(gsapParallax);
        tasks.push(gsapAuroraScrub);
        tasks.push(gsapMaskReveals);
        if (LIB.split) {
          tasks.push(splitSectionTitles);
        } else {
          // SplitText blocked/failed: reveal the [data-split] titles so they
          // can't stay at opacity:0 (the gsapRevealBatch excludes titles).
          tasks.push(function () {
            $all("[data-split]").forEach(function (el) { el.classList.add("is-visible"); });
          });
        }
        // Velocity marquee needs ST (and prefers Lenis); else CSS loop.
        tasks.push(initVelocityMarquee);
      } else {
        // GSAP present but ScrollTrigger blocked: reveals/count/marquee/parallax
        // fall back to the vanilla modules; titles just show via .is-visible.
        tasks.push(initReveal);
        tasks.push(initCountUp);
        tasks.push(initMarquee);
        tasks.push(initPosterParallax);
        tasks.push(function () {
          $all("[data-split]").forEach(function (el) { el.classList.add("is-visible"); });
        });
      }

      // Hero pointer-parallax + halo (desktop only).
      tasks.push(initHeroParallax);

      // Desktop pointer sugar.
      if (finePointer) {
        tasks.push(initCursor);
        tasks.push(initMagnetic);
      }

      // Refresh ScrollTrigger after window load (fonts/images settle layout).
      on(window, "load", function () {
        // Decode-aware: also refresh once images finish.
        refreshST();
      });

      tasks.push(wireReducedMotionToggle);

    } else {
      // ------------------ VANILLA FALLBACK PATH ------------------
      tasks.push(initSmoothAnchors);
      tasks.push(initScrollspy);
      tasks.push(initReveal);
      tasks.push(initCountUp);
      tasks.push(initHeroParallax);
      tasks.push(initMarquee);
      tasks.push(initPosterParallax);
      // [data-split] elements never animate here; the CSS reveal shows them.
    }

    tasks.forEach(function (fn) {
      try { fn(); } catch (err) { /* never break the page over one feature */ }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
