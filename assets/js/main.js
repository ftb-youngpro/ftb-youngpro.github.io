/* ============================================================================
   Young Pro Ministry — Faith Temple Baptist Church Inc.
   main.js — the immersive interaction + animation layer.

   TWO PATHS, ONE FILE:
     • ENHANCED (studio-grade): GSAP 3.13 + ScrollTrigger + SplitText.
       NATIVE scroll (no Lenis — native is snappy and ScrollTrigger runs on it
       directly), masked intro reveal, kinetic SplitText hero + section titles,
       ScrollTrigger.batch reveals, image-mask wipes, scrub parallax,
       ScrollTrigger count-up, scroll-velocity-reactive themes marquee, magnetic
       CTAs + custom emerald cursor (desktop fine-pointer only).
     • FALLBACK (vanilla baseline): if ANY lib is blocked/absent, the page
       falls back to IntersectionObserver reveals, native scroll, CSS marquee,
       rAF count-up, rAF poster parallax.

   GUARDRAILS:
     • Feature-detects every lib (typeof window.X !== "undefined"); never
       assumes a CDN loaded; never throws (each module is try/caught).
     • prefers-reduced-motion: no intro / parallax / marquee loop / cursor /
       magnetic / SplitText motion — instant final states. Live-toggle tears the
       enhanced layer down.
     • Mobile-first / perf: native touch scroll always; cursor + magnetic +
       hero-parallax + tilt desktop fine-pointer only; the heaviest enhanced
       flourishes (intro / SplitText / mask wipes / scrub parallax / aurora
       scrub) are skipped on touch so phones get a calm, fast, fully-revealed
       page; will-change used sparingly; only transform/opacity/clip-path/filter
       animated.
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
    split: typeof window.SplitText !== "undefined"
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
  function scrollY() { return window.pageYOffset || window.scrollY || 0; }
  var supportsIO = typeof window.IntersectionObserver === "function";

  // Read --nav-h from CSS so JS + CSS never drift (CSS owns scroll-padding-top).
  var NAV_H = (function () {
    try {
      var v = parseInt(
        getComputedStyle(docEl).getPropertyValue("--nav-h"), 10);
      return isNaN(v) ? 68 : v;
    } catch (e) { return 68; }
  })();

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

  /* --- Ref-counted scroll lock --------------------------------------------
     Nav drawer, lightbox, and the intro all need to lock body scroll. A shared
     counter guarantees no consumer clears another's lock: body.overflow only
     returns to "" when the LAST lock releases. */
  var scrollLocks = 0;
  function lockScroll() {
    scrollLocks++;
    if (scrollLocks === 1) document.body.style.overflow = "hidden";
  }
  function unlockScroll() {
    if (scrollLocks > 0) scrollLocks--;
    if (scrollLocks === 0) document.body.style.overflow = "";
  }

  /* --- Module-scope handles for teardown (reduced-motion live-toggle) ------ */
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
     2. STICKY NAV — add .is-scrolled past 24px (native scroll).
     ========================================================================== */
  function initStickyHeader() {
    var header = $("[data-site-header]");
    if (!header) return;
    var THRESHOLD = 24;
    var update = function () {
      header.classList.toggle("is-scrolled", scrollY() > THRESHOLD);
    };
    update();
    on(window, "scroll", rafThrottle(update), { passive: true });
    on(window, "resize", rafThrottle(update), { passive: true });
  }

  /* ==========================================================================
     2b. HERO BACKGROUND PAUSE — stop the infinite aurora/halo keyframe loops
         while the hero is off-screen. These are large blurred layers (46-60vmax,
         48-90px blur) that the compositor keeps re-compositing every frame even
         when scrolled away (Chrome does NOT auto-pause off-screen compositor
         animations) — a real scroll-jank source deep in the page. We toggle
         .hero-bg-paused (animations.css -> animation-play-state: paused) via an
         IntersectionObserver, mirroring the marquee's in-view gating. Runs in
         BOTH paths (the CSS auroras animate enhanced AND fallback). No-op under
         reduced motion (already animation:none) and a no-op while the hero is on
         screen (no visual change).
     ========================================================================== */
  function initHeroBgPause() {
    if (prefersReduced() || !supportsIO) return;
    var hero = document.getElementById("hero");
    var bg = hero ? $(".hero-bg", hero) : null;
    if (!hero || !bg) return;
    var io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      bg.classList.toggle("hero-bg-paused", !(e && e.isIntersecting));
    }, { rootMargin: "120px 0px" });
    io.observe(hero);
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
    var locked = false;

    function setOpen(open) {
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      // Ref-counted scroll lock (only flip the drawer's own lock once).
      if (open && !locked) { lockScroll(); locked = true; }
      else if (!open && locked) { unlockScroll(); locked = false; }
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

    // Focus trap: keep Tab inside the drawer (toggle + links) on mobile.
    on(document, "keydown", function (e) {
      if (e.key !== "Tab" || !isOpen() || isDesktop()) return;
      var links = $all('a[href^="#"]', menu);
      if (!links.length) return;
      var first = toggle;
      var last = links[links.length - 1];
      var active = document.activeElement;
      // If focus has escaped the drawer entirely, pull it back in.
      if (active !== toggle && !menu.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
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
      // Resizing to desktop must release the lock + reset the drawer state.
      if (isDesktop() && isOpen()) {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
        if (locked) { unlockScroll(); locked = false; }
      }
    }), { passive: true });
  }

  /* ==========================================================================
     4. SMOOTH ANCHOR SCROLL + focus management (NATIVE scroll).
        Native scrollIntoView({behavior:'smooth'}) — CSS scroll-padding-top
        offsets the sticky nav. Reduced motion: instant jump.
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

        target.scrollIntoView({
          behavior: prefersReduced() ? "auto" : "smooth",
          block: "start"
        });

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
        One native passive scroll listener (rAF-throttled).
     ========================================================================== */
  function initScrollspy() {
    var navLinks = $all('[data-nav] a[href^="#"]');
    if (!navLinks.length) return;

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
      var probe = scrollY() + NAV_H + 48;
      var current = null;
      map.forEach(function (m) {
        if (m.top <= probe) current = m;
      });
      navLinks.forEach(function (l) { l.classList.remove("is-active"); });
      if (current) current.link.classList.add("is-active");
    });

    update();
    on(window, "scroll", update, { passive: true });
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
         No will-change churn: transform/opacity tweens are GPU-composited by
         GSAP already; toggling will-change per batch thrashes layers right as a
         section enters view (the moment you'd notice jank).
     ========================================================================== */
  function gsapRevealBatch() {
    var gsap = window.gsap, ST = window.ScrollTrigger;

    // Exclude SplitText-owned titles (.hero-title, .section-title) AND every
    // hero-inner reveal (.hero-eyebrow / .hero-lead / .hero-actions). The hero
    // entrance is owned by buildHeroTimeline() on desktop and by an explicit
    // .is-visible add on touch — if the batch also `gsap.set({opacity:0})` them,
    // its inline opacity:0 overrides that .is-visible class, and because the
    // batch only reveals on "top 88%" enter, any hero element already at/below
    // that line at first paint (the CTAs on a 320/375 phone) stays invisible on
    // load. Excluding the whole hero subtree keeps the CTAs visible immediately.
    var items = $all("[data-reveal]").filter(function (el) {
      return !el.matches(".hero-title, .section-title") && !el.closest(".hero");
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
              overwrite: true
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
     7b. COUNT-UP — ENHANCED path (ScrollTrigger fires GSAP tweens, native scroll).
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

     The marquee loops by translating the track left by exactly ONE original set
     ("half") then wrapping. For the viewport to STAY COVERED across a full loop,
     the cloned content to the right of the wrap point must be at least one
     viewport wide. One clone (2 sets total) only works when one set is already
     wider than the viewport; the themes set (~925px) is NARROWER than the
     marquee viewport (~1424px), so a single clone left a trailing gap on the
     right every loop cycle (the owner's "gap" / "starts at center" report).

     Fix: clone the ORIGINAL set as many times as needed so the total width is at
     least one set + one viewport. We then expose the total set count via
     --marquee-copies so the CSS-fallback keyframe translates by exactly one set
     (-100%/copies, NOT a hard-coded -50%), and store the original child count so
     the velocity ticker measures the true one-set period. -------------------- */
  function duplicateMarqueeChildren(track) {
    if (track.getAttribute("data-marquee-cloned") === "true") return;
    var originals = $all(":scope > *", track);
    if (!originals.length) return;
    var origCount = originals.length;

    function cloneSet() {
      originals.forEach(function (node) {
        var clone = node.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        $all("a, button, [tabindex]", clone).forEach(function (f) {
          f.setAttribute("tabindex", "-1");
        });
        track.appendChild(clone);
      });
    }

    var marquee = track.closest(".themes-marquee");
    var viewport = marquee ? marquee.clientWidth : (window.innerWidth || 0);

    // Always clone at least one set (minimum 2 sets) so there's a clone to
    // measure the period against.
    cloneSet();
    // Keep cloning whole sets until one-set-width + viewport <= total width, i.e.
    // until the content remaining to the right of the wrap point (total - one set)
    // covers the viewport. one-set-width = scrollWidth / (current set count).
    var guard = 0;
    while (guard++ < 12) {
      var sets = track.children.length / origCount;
      var oneSet = track.scrollWidth / sets;
      if (oneSet + viewport <= track.scrollWidth) break;
      cloneSet();
    }

    var copies = Math.round(track.children.length / origCount); // total set count
    track.setAttribute("data-marquee-copies", String(copies));
    track.setAttribute("data-marquee-orig", String(origCount));
    track.style.setProperty("--marquee-copies", String(copies));
    track.setAttribute("data-marquee-cloned", "true");
  }

  /* Resize top-up: widening the viewport can exceed the cloned coverage, which
     would reopen a trailing gap. Append more whole sets until one-set + viewport
     <= total width again, then refresh --marquee-copies so the CSS-fallback
     keyframe period stays = one set. No-op when already wide enough. Returns true
     if more sets were added. */
  function ensureMarqueeCoverage(track) {
    var origCount = parseInt(track.getAttribute("data-marquee-orig"), 10);
    if (!origCount || !track.children.length) return false;
    var originals = $all(":scope > *", track).slice(0, origCount);
    if (!originals.length) return false;
    var marquee = track.closest(".themes-marquee");
    var viewport = marquee ? marquee.clientWidth : (window.innerWidth || 0);
    var added = false, guard = 0;
    while (guard++ < 12) {
      var sets = track.children.length / origCount;
      var oneSet = track.scrollWidth / sets;
      if (oneSet + viewport <= track.scrollWidth) break;
      originals.forEach(function (node) {
        var clone = node.cloneNode(true);
        clone.setAttribute("aria-hidden", "true");
        $all("a, button, [tabindex]", clone).forEach(function (f) {
          f.setAttribute("tabindex", "-1");
        });
        track.appendChild(clone);
      });
      added = true;
    }
    if (added) {
      var copies = Math.round(track.children.length / origCount);
      track.setAttribute("data-marquee-copies", String(copies));
      track.style.setProperty("--marquee-copies", String(copies));
    }
    return added;
  }

  /* 10a. FALLBACK marquee — CSS keyframe loop, paused on hover/focus (CSS).
     The keyframe translates by -100%/--marquee-copies (= one set) so the loop
     period matches the enhanced ticker no matter how many sets we cloned. */
  function initMarquee() {
    var track = $("[data-themes-track]");
    if (!track) return;
    if (prefersReduced()) return; // leave static
    duplicateMarqueeChildren(track);
    track.classList.add("is-marquee");
    // Keep coverage (and --marquee-copies) correct if the viewport later widens.
    on(window, "resize", rafThrottle(function () {
      ensureMarqueeCoverage(track);
    }), { passive: true });
  }

  /* 10b. ENHANCED marquee — scroll-velocity reactive, GSAP ticker driven.
         Continuous calm baseline drift; scroll velocity (native, via
         ScrollTrigger.getVelocity) nudges speed/direction within a bounded
         clamp, decaying back to baseline. Pauses on hover/focus. The per-frame
         ticker only runs while the marquee is in view (IntersectionObserver),
         so it isn't doing idle compositor work when the section is off-screen. */
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

    // Measure the TRUE one-set repeat period: the distance from the first
    // original pill to the first pill of the SECOND set (= one set + one boundary
    // gap). This is exact regardless of how spacing is implemented and never
    // relies on scrollWidth/N (which omits the trailing gap and would wrap
    // ~gap/2 short, leaving a recurring seam). origCount is the ORIGINAL child
    // count stored by duplicateMarqueeChildren (the track may hold N>=2 sets now,
    // so children.length/2 is wrong). Recompute only on resize / font settle —
    // never per frame (offsetLeft forces a layout flush).
    var origCount = parseInt(track.getAttribute("data-marquee-orig"), 10) ||
      Math.round(track.children.length / 2);
    function measurePeriod() {
      var firstClone = track.children[origCount];
      return firstClone ? (firstClone.offsetLeft - track.children[0].offsetLeft) : 0;
    }
    var half = measurePeriod();
    if (!half) { track.classList.add("is-marquee"); return; } // safety: CSS loop
    marqueeTrack = track;

    var x = 0;
    var baseDir = -1;        // leftward baseline
    var baseSpeed = 0.6;     // px/frame (calm)
    var velFactor = 0;       // extra speed from scroll velocity
    var paused = false;
    var inView = true;       // gated by IntersectionObserver below
    var running = false;
    var primed = false;      // ignore the first velocity reading after start (see below)

    on(window, "resize", rafThrottle(function () {
      // Widening the viewport may need more clones to keep the right edge covered.
      ensureMarqueeCoverage(track);
      var h = measurePeriod();
      if (h) half = h;
    }), { passive: true });

    // Web fonts (Fraunces italic / Inter) load AFTER init can run, changing pill
    // widths and therefore the true period. `half` is measured at init (possibly
    // with fallback-font metrics); re-measure once fonts settle so the ticker
    // doesn't wrap early and leave a one-time seam on cold-cache first paint.
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        var h = measurePeriod();
        if (h) half = h;
      }).catch(function () {});
    } else {
      on(window, "load", function () {
        var h = measurePeriod();
        if (h) half = h;
      });
    }

    // Pause baseline on hover / focus (keyboard + mouse).
    if (marquee) {
      on(marquee, "pointerenter", function () { paused = true; });
      on(marquee, "pointerleave", function () { paused = false; });
      on(marquee, "focusin", function () { paused = true; });
      on(marquee, "focusout", function () { paused = false; });
    }

    // Native scroll velocity feeds the marquee (no Lenis). Gate the read on the
    // same inView flag the ticker uses so it does zero work while off-screen.
    // `primed` discards the first reading after the ticker (re)starts: scrolling
    // INTO the section yields a large getVelocity() on the first frame, which
    // would otherwise yank x ~17px in one frame (a visible jolt on scroll-in).
    // The sufficient cloning above means there's no gap regardless; this just
    // removes the cosmetic one-frame jump.
    if (ST) {
      ST.create({ onUpdate: function (self) {
        if (!inView) return;
        if (!primed) { primed = true; return; }
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

    function startTicker() {
      if (running) return;
      running = true;
      primed = false;       // re-prime so re-entering the section never yanks
      track.style.willChange = "transform";
      gsap.ticker.add(marqueeTick);
    }
    function stopTicker() {
      if (!running) return;
      running = false;
      gsap.ticker.remove(marqueeTick);
      track.style.willChange = "";
    }

    // Only run the per-frame ticker while the marquee is on screen.
    if (marquee && supportsIO) {
      var io = new IntersectionObserver(function (entries) {
        inView = entries[0] && entries[0].isIntersecting;
        if (inView) startTicker(); else stopTicker();
      }, { rootMargin: "120px 0px" });
      io.observe(marquee);
    } else {
      startTicker();
    }
  }

  /* ==========================================================================
     11a. POSTER PARALLAX — FALLBACK rAF (writes --shift, ≤24px peak).
          Caches each poster's offsetTop on resize/load (no per-frame
          getBoundingClientRect forced reflow); progress from scrollY.
     ========================================================================== */
  function initPosterParallax() {
    if (prefersReduced()) return;
    var posters = $all("[data-parallax]");
    if (!posters.length) return;

    var MAX = 24 * pxScale();
    var vh = window.innerHeight || document.documentElement.clientHeight;

    // Cache layout (top + height) so the scroll handler never reads the DOM.
    var data = posters.map(function (el) { return { el: el, top: 0, h: 0 }; });
    var measure = function () {
      vh = window.innerHeight || document.documentElement.clientHeight;
      data.forEach(function (d) {
        var r = d.el.getBoundingClientRect();
        d.top = r.top + scrollY();
        d.h = r.height;
      });
    };

    var update = rafThrottle(function () {
      var sy = scrollY();
      data.forEach(function (d) {
        var center = d.top + d.h / 2 - sy;          // center relative to viewport
        if (center < -200 || center > vh + 200) return;
        var prog = (center - vh / 2) / (vh / 2 + d.h / 2);
        prog = clamp(prog, -1, 1);
        d.el.style.setProperty("--shift", (-prog * MAX).toFixed(1) + "px");
      });
    });

    measure();
    update();
    on(window, "scroll", update, { passive: true });
    on(window, "resize", rafThrottle(function () { measure(); update(); }), { passive: true });
    on(window, "load", function () { measure(); update(); });
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
     12. AURORA SCRUB (ENHANCED) — gentle depth as the hero scrolls out.
         SIMPLIFIED per "robust over flashy": we no longer scrub yPercent on the
         90px-blurred .hero-bg (moving a giant blurred layer per frame was the
         costliest hero effect). We keep only the cheap --scrubY on the small
         gold blob (.aurora-3), which composes via `translate:` in the CSS.
     ========================================================================== */
  function gsapAuroraScrub() {
    var gsap = window.gsap;
    var s = pxScale();
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
         Targets every [data-mask] (2 posters, gallery imgs, 4 leader photos).
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
      // LINES ONLY (no "words"): word-splitting FLATTENS the nested
      // .text-gradient span, dropping "excellence," into an unclassed div with a
      // transparent fill and no gradient (the bug #3 root cause). Splitting by
      // line keeps the .text-gradient span intact as a child of a .split-line, so
      // its own background-clip:text emerald->gold fill (styles.css §3) keeps
      // painting. The line wrapper still gives us the rise-reveal.
      split = new window.SplitText(title, { type: "lines", linesClass: "split-line" });
    } catch (err) {
      title.classList.add("is-visible");
      return null;
    }
    splitInstances.push(split);
    gsap.set(split.lines, { overflow: "hidden" });
    gsap.set(title, { opacity: 1 });
    // Return a function the hero/intro timeline calls to play the lines in.
    // The gradient word survives untouched inside its .split-line, so we never
    // set color/fill here and "excellence" stays visible with its gradient.
    return function play(delay) {
      gsap.from(split.lines, {
        yPercent: 110, opacity: 0, duration: 0.9, ease: "power4.out",
        stagger: { each: 0.08, from: "start" },
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
     16. INTRO / LOAD-IN (ENHANCED, desktop only) — masked YP-mark + forest
         wipe, ≤1.2s, skippable, first-visit (sessionStorage), never traps (CSS
         failsafe + JS removal). Hands off to the hero timeline.
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

    // Lock scroll during the intro only (ref-counted).
    var introLocked = true;
    lockScroll();

    var done = false;
    var failsafeTimer = null;
    var heroStarted = false;
    function startHero() {
      if (heroStarted) return;
      heroStarted = true;
      heroTL.play(0);
    }
    function finish() {
      if (done) return;
      done = true;
      if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; }
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      if (introLocked) { unlockScroll(); introLocked = false; }
      startHero();   // guarantee the hero plays even if the timeline callback didn't fire
      refreshST();
    }

    // JS failsafe: always release the scroll-lock even if the GSAP timeline
    // errors or never completes (the CSS failsafe only fades the overlay; it
    // can't restore body scroll). `done` guards the double-call. 2s comfortably
    // exceeds the ~1.2s intro.
    failsafeTimer = setTimeout(finish, 2000);

    var introTL = gsap.timeline({ onComplete: finish });
    introTL
      .fromTo(mark,
        { opacity: 0, scale: 0.86 },
        { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }, 0)
      .to(mark, { scale: 1.04, duration: 0.25, ease: "power1.inOut" }, 0.35)
      .to([wipe, mark], { yPercent: -110, duration: 0.55, ease: "power4.inOut" }, 0.6)
      .to(intro, { opacity: 0, duration: 0.3, ease: "power2.out" }, 0.85)
      // Hand off to the hero as the wipe lifts (overlap for momentum).
      .add(startHero, 0.6);

    // Skippable: any input fast-forwards. Guarded so multiple inputs (e.g. a
    // wheel + a keydown) can't run skip twice, and so heroTL never re-snaps:
    // progress(1) lets the timeline's own startHero() callback fire, and finish()
    // is idempotent via `done`.
    function skip() {
      if (done) return;
      introTL.progress(1); // fires the .add(startHero) callback + onComplete -> finish
    }
    on(window, "keydown", skip, { once: true });
    on(window, "pointerdown", skip, { once: true });
    on(window, "wheel", skip, { once: true, passive: true });
  }

  /* ==========================================================================
     17. CUSTOM CURSOR (ENHANCED + finePointer) — emerald dot + trailing ring.
         Single GSAP ticker loop, interpolated (never per-event style writes).
         While active, the NATIVE OS cursor is hidden via html.yp-has-cursor
         (CSS gates the hide to fine-pointer). We add the class here, and remove
         it on window blur (so an alt-tabbed window isn't left cursorless) +
         on reduced-motion teardown. Touch / reduced-motion / non-enhanced never
         reach this function, so they always keep the native cursor.
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

    // Hide the native cursor only now that the custom one is wired (bug #4).
    docEl.classList.add("yp-has-cursor");

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
      // Pointer is back inside this window — re-hide the native cursor, but ONLY
      // while the custom cursor is still mounted. cursorNodes is [dot,ring] while
      // live and reset to [] on reduced-motion teardown; gating on it (not on
      // reduced motion) means once the cursor is removed this handler can never
      // re-assert yp-has-cursor and leave the document claiming a hidden cursor
      // with nothing to replace it.
      if (cursorNodes.length && !docEl.classList.contains("yp-has-cursor")) {
        docEl.classList.add("yp-has-cursor");
      }
    });
    on(document, "pointerleave", function () { setVisible(false); });
    // On blur, hide our cursor AND restore the native one (so an alt-tabbed
    // or background window never sits with no visible pointer).
    on(window, "blur", function () {
      setVisible(false);
      docEl.classList.remove("yp-has-cursor");
    });

    cursorLoop = function () {
      dx += (mx - dx) * 0.35; dy += (my - dy) * 0.35;  // dot: snappy
      rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;  // ring: trails (a touch
                                                       // snappier so clicks feel
                                                       // precise now that it's the
                                                       // only pointer indicator)
      dot.style.transform  = "translate(" + dx + "px," + dy + "px) translate(-50%,-50%)";
      ring.style.transform = "translate(" + rx + "px," + ry + "px) translate(-50%,-50%)";
    };
    gsap.ticker.add(cursorLoop);

    // Grow the ring over interactive elements. Track the closest interactive
    // ancestor and only toggle when it actually CHANGES, so crossing nested
    // children of one element (e.g. a tile's img + caption) doesn't flicker.
    var sel = 'a, button, [data-magnetic], .gallery-tile, input, [tabindex]:not([tabindex="-1"])';
    var hoverTarget = null;
    on(document, "pointerover", function (e) {
      var t = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (t && t !== hoverTarget) {
        hoverTarget = t;
        ring.classList.add("is-hovering");
      }
    });
    on(document, "pointerout", function (e) {
      if (!hoverTarget) return;
      // Only drop the hover state once the pointer leaves the tracked element
      // for something OUTSIDE it (relatedTarget is where the pointer is going).
      var to = e.relatedTarget;
      if (!to || !hoverTarget.contains(to)) {
        hoverTarget = null;
        ring.classList.remove("is-hovering");
      }
    });
  }

  /* ==========================================================================
     18. MAGNETIC BUTTONS (ENHANCED + finePointer) — transform-only pull.
         pointermove is rAF-throttled so the per-event getBoundingClientRect read
         happens at most once per frame; blur resets the offset so keyboard focus
         never leaves a button visually shifted off its hit area.
     ========================================================================== */
  function initMagnetic() {
    var gsap = window.gsap;
    $all("[data-magnetic]").forEach(function (btn) {
      var strength = 0.35, max = 12;
      var qX = gsap.quickTo(btn, "x", { duration: 0.4, ease: "power3" });
      var qY = gsap.quickTo(btn, "y", { duration: 0.4, ease: "power3" });
      var move = rafThrottle(function (cx, cy) {
        var r = btn.getBoundingClientRect();
        qX(clamp((cx - (r.left + r.width / 2)) * strength, -max, max));
        qY(clamp((cy - (r.top + r.height / 2)) * strength, -max, max));
      });
      on(btn, "pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        move(e.clientX, e.clientY);
      });
      var reset = function () { qX(0); qY(0); };
      on(btn, "pointerleave", reset);
      on(btn, "blur", reset);
    });
  }

  /* ==========================================================================
     19. GALLERY LIGHTBOX — open/close, focus-trap, ESC, inert background.
         Identical in both paths.

         The dialog is a DIRECT CHILD of <body> (sibling of <main>), so
         isolateBackground can inert #main + header + footer without inerting the
         dialog itself. (When the dialog lived inside #main, inert-ing #main made
         the overlay + X button inert too — only Esc, bound to document, worked.
         That was the real root cause of bug #2.)
     ========================================================================== */
  function initLightbox() {
    var dialog = $("[data-lightbox-dialog]");
    var triggers = $all("[data-lightbox]");
    if (!dialog || !triggers.length) return;

    var imgEl = $("[data-lightbox-image]", dialog);
    var capEl = $("[data-lightbox-caption]", dialog);
    var closers = $all("[data-lightbox-close]", dialog);
    var overlay = $(".lightbox-overlay", dialog);
    // The X button — the only FOCUSABLE closer (the overlay is a div). Use it for
    // open-focus; closers[0] is the overlay and would be a no-op to .focus().
    var closeBtn = $(".lightbox-close", dialog) ||
      closers.filter(function (c) { return c !== overlay; })[0] || null;
    var content = $(".lightbox-content", dialog) || dialog;
    var lastFocused = null;
    var locked = false;
    var pointerDownTarget = null;

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
        // getClientRects is more robust than offsetParent (which returns null
        // for descendants of a position:fixed ancestor — e.g. the .lightbox).
        return el.getClientRects().length > 0 || el === document.activeElement;
      });
    }

    function open(trigger) {
      lastFocused = trigger || document.activeElement;
      var full = trigger.getAttribute("data-full") || "";
      var caption = trigger.getAttribute("data-caption") || "";
      if (imgEl) {
        imgEl.setAttribute("src", full);
        // Empty alt: the visible .lightbox-caption inside this role="dialog" is the
        // single accessible description. Mirroring it onto the img's accessible name
        // would make a screen reader announce the same string twice.
        imgEl.setAttribute("alt", "");
      }
      if (capEl) capEl.textContent = caption;

      dialog.removeAttribute("hidden");
      if (!locked) { lockScroll(); locked = true; }
      isolateBackground(true);

      window.requestAnimationFrame(function () {
        if (closeBtn) closeBtn.focus();
        else if (content.focus) { content.setAttribute("tabindex", "-1"); content.focus(); }
      });
    }

    function close() {
      if (dialog.hasAttribute("hidden")) return;
      dialog.setAttribute("hidden", "");
      if (locked) { unlockScroll(); locked = false; }
      isolateBackground(false);
      if (imgEl) { imgEl.removeAttribute("src"); imgEl.setAttribute("alt", ""); }
      if (capEl) capEl.textContent = ""; // no stale caption can flash on next open
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      lastFocused = null;
    }

    triggers.forEach(function (t) {
      on(t, "click", function (e) { e.preventDefault(); open(t); });
    });

    // X button (and any other [data-lightbox-close] that isn't the backdrop):
    // unconditional close on click/tap.
    closers.forEach(function (c) {
      if (c === overlay) return; // backdrop handled below with a drag guard
      on(c, "click", function (e) { e.preventDefault(); close(); });
    });

    // Backdrop: close ONLY when the press both started AND ended on the overlay
    // itself, so a drag-select that starts on the image/caption and releases on
    // the backdrop doesn't accidentally close. We anchor pointerDownTarget on a
    // press ANYWHERE in the dialog (not just the overlay) so the guard state is
    // always tied to the true press origin regardless of future markup.
    on(dialog, "pointerdown", function (e) { pointerDownTarget = e.target; });
    if (overlay) {
      on(overlay, "click", function (e) {
        if (e.target === overlay && pointerDownTarget === overlay) close();
        pointerDownTarget = null;
      });
    }

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
     20b. FEATURED EVENT CARD — live countdown + Add-to-Calendar (.ics) + Share.
          Runs in BOTH paths (no GSAP dependency). One [data-event] element is
          the source of truth (its data-* attrs mirror the Event JSON-LD). Every
          piece degrades: countdown has a static fallback line in the markup; the
          Google-calendar anchor works with zero JS; share falls back from
          navigator.share -> clipboard -> a visible mailto-less toast. Each branch
          is self-guarded so a failure never breaks the card or the page.
     ========================================================================== */
  function initEventCard() {
    var card = $("[data-event]");
    if (!card) return;

    var title = card.getAttribute("data-event-title") || "Young Pro event";
    var startISO = card.getAttribute("data-event-start") || "";
    var endISO = card.getAttribute("data-event-end") || "";
    var location = card.getAttribute("data-event-location") || "";
    var url = card.getAttribute("data-event-url") ||
      (window.location ? window.location.href : "");
    var start = startISO ? new Date(startISO) : null;
    var end = endISO ? new Date(endISO) : null;
    var validStart = start && !isNaN(start.getTime());

    /* --- Live countdown: replace the static line's text with "Starts in N days"
       (or "Happening today" / "Starting soon"). Date() IS used here intentionally
       (unlike the footer year) because a countdown is inherently time-relative;
       if the event has passed we simply leave the static date/time line. ------ */
    (function countdown() {
      var line = $("[data-event-countdown]", card);
      if (!line || !validStart) return;
      var leaf = $(".yp-leaf-flourish", line); // keep the decorative mark
      var now = new Date();
      var ms = start.getTime() - now.getTime();
      var label = null;
      if (ms <= 0) {
        // Event today or already started — keep the static "date · time · venue"
        // line as-is (no misleading negative countdown).
        return;
      }
      var dayMs = 86400000;
      var days = Math.ceil(ms / dayMs);
      if (ms < dayMs) label = "Happening soon · today";
      else if (days === 1) label = "Starts tomorrow";
      else label = "Starts in " + days + " days";
      // Rebuild the line: leaf flourish (if present) + live label.
      line.textContent = "";
      if (leaf) line.appendChild(leaf);
      line.appendChild(document.createTextNode(label));
    })();

    /* --- Toast (aria-live=polite) for the clipboard-copy share fallback. ----- */
    var toast = null, toastTimer = null;
    function showToast(msg) {
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "yp-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      // force reflow so the transition runs even on a freshly-appended node
      void toast.offsetWidth;
      toast.classList.add("is-visible");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        if (toast) toast.classList.remove("is-visible");
      }, 2600);
    }

    /* --- Add-to-Calendar: in-JS .ics Blob download (the markup's Google anchor
       is the no-JS path). We intercept the Google anchor's click ONLY to offer a
       native .ics as well is overkill; instead we add a sibling behavior: if the
       browser supports Blob + URL, the anchor still goes to Google (universal),
       and we keep the .ics generator available for the Share menu / future use.
       Here we leave the Google anchor untouched (it just works) — no hijack. --- */
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function toICSDate(d) {
      // UTC basic format: YYYYMMDDTHHMMSSZ
      return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
        "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
    }
    function buildICS() {
      if (!validStart) return null;
      var dtEnd = (end && !isNaN(end.getTime()))
        ? end
        : new Date(start.getTime() + 2 * 3600000); // default 2h
      var esc = function (s) {
        return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;")
          .replace(/,/g, "\\,").replace(/\n/g, "\\n");
      };
      return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Young Pro Ministry//Happenings//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        "UID:" + toICSDate(start) + "-yp@ftb-youngpro.github.io",
        "DTSTAMP:" + toICSDate(new Date()),
        "DTSTART:" + toICSDate(start),
        "DTEND:" + toICSDate(dtEnd),
        "SUMMARY:" + esc(title),
        "DESCRIPTION:" + esc("A Young Pro Ministry gathering. Everyone's welcome — bring a friend. " + url),
        "LOCATION:" + esc(location),
        "URL:" + esc(url),
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR"
      ].join("\r\n");
    }

    // Offer the .ics download alongside the Google anchor: on a modifier-free
    // click we keep the universal Google link, but also expose a native .ics via
    // a long-press/right-click is non-discoverable, so instead we attach the .ics
    // to the Share flow below. (Anchor stays a plain, robust hyperlink.)

    /* --- Web Share with clipboard + toast fallback. ------------------------- */
    var shareBtn = $("[data-event-share]", card);
    if (shareBtn) {
      var shareData = {
        title: title,
        text: title + " — a Young Pro Ministry gathering. Everyone's welcome!",
        url: url
      };
      on(shareBtn, "click", function () {
        // 1) Native share sheet (mobile / supported desktop).
        if (navigator.share &&
            (!navigator.canShare || navigator.canShare(shareData))) {
          navigator.share(shareData).catch(function () { /* user cancelled — fine */ });
          return;
        }
        // 2) Clipboard copy + polite toast.
        var copyText = shareData.text + " " + url;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyText).then(function () {
            showToast("Link copied — share it with a friend!");
          }).catch(function () {
            legacyCopy(copyText);
          });
        } else {
          legacyCopy(copyText);
        }
      });
    }

    function legacyCopy(text) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        showToast(ok ? "Link copied — share it with a friend!" : "Copy the link from the address bar to share.");
      } catch (e) {
        showToast("Copy the link from the address bar to share.");
      }
    }

    /* --- Add a native .ics download next to the Google anchor (progressive
       enhancement): inject a second small link so users on Apple/Outlook get a
       proper calendar file. Only when Blob is supported. ---------------------- */
    var actions = $("[data-event-actions]", card);
    var googleAnchor = $("[data-event-cal-google]", card);
    if (actions && googleAnchor && validStart &&
        typeof window.Blob === "function" && window.URL && window.URL.createObjectURL) {
      var icsLink = document.createElement("a");
      icsLink.className = "btn-event";
      icsLink.setAttribute("download", "yp-malasakit.ics");
      icsLink.setAttribute("aria-label", "Download calendar file (.ics) for " + title);
      var leafSpan = document.createElement("span");
      leafSpan.className = "yp-leaf-flourish";
      leafSpan.setAttribute("aria-hidden", "true");
      icsLink.appendChild(leafSpan);
      icsLink.appendChild(document.createTextNode(".ics file"));
      // Lazily build the blob on click so we don't hold a URL we never use.
      on(icsLink, "click", function (e) {
        var ics = buildICS();
        if (!ics) return;
        try {
          var blob = new window.Blob([ics], { type: "text/calendar;charset=utf-8" });
          var href = window.URL.createObjectURL(blob);
          icsLink.setAttribute("href", href);
          // Revoke shortly after the download starts.
          setTimeout(function () { window.URL.revokeObjectURL(href); }, 4000);
        } catch (err) {
          e.preventDefault();
          showToast("Could not generate the calendar file — use “Add to calendar” instead.");
        }
      });
      // Insert the .ics link right after the Google anchor.
      if (googleAnchor.nextSibling) {
        actions.insertBefore(icsLink, googleAnchor.nextSibling);
      } else {
        actions.appendChild(icsLink);
      }
    }
  }

  /* --- ScrollTrigger.refresh helper (after fonts/images/intro) ------------- */
  function refreshST() {
    if (LIB.st && window.ScrollTrigger) {
      try { window.ScrollTrigger.refresh(); } catch (e) {}
    }
  }

  /* ==========================================================================
     21. REDUCED-MOTION LIVE TOGGLE — one-way teardown of the enhanced layer.
     ========================================================================== */
  function wireReducedMotionToggle() {
    var handler = function () {
      if (!prefersReduced() || !enhancedActive) return;
      enhancedActive = false;
      // Remove the gsap.ticker callbacks FIRST — they live outside globalTimeline
      // so clearing the timeline does NOT stop them.
      if (window.gsap && window.gsap.ticker) {
        try { if (marqueeTick) window.gsap.ticker.remove(marqueeTick); } catch (e) {}
        try { if (cursorLoop)  window.gsap.ticker.remove(cursorLoop); } catch (e) {}
      }
      marqueeTick = null;
      cursorLoop = null;
      // Reset the marquee to a static state (no residual inline transform; we do
      // NOT re-add .is-marquee, since its CSS loop is also unwanted here).
      if (marqueeTrack) {
        try { marqueeTrack.style.transform = "none"; marqueeTrack.style.willChange = ""; } catch (e) {}
      }
      // Kill ScrollTriggers + tweens.
      if (LIB.st && window.ScrollTrigger) {
        try { window.ScrollTrigger.getAll().forEach(function (t) { t.kill(); }); } catch (e) {}
      }
      if (window.gsap) {
        try { window.gsap.globalTimeline.clear(); } catch (e) {}
      }
      // Revert SplitText so headings read normally.
      splitInstances.forEach(function (s) { try { s.revert(); } catch (e) {} });
      splitInstances = [];
      // Remove cursor nodes + restore the native cursor.
      cursorNodes.forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
      cursorNodes = [];
      docEl.classList.remove("yp-has-cursor");
      // Remove intro if still present + release any intro scroll-lock.
      var intro = $(".yp-intro");
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      // Hard-reset the scroll lock (no overlays should be open in this state).
      scrollLocks = 0;
      document.body.style.overflow = "";
      // Ensure everything is visible + final. Clear inline opacity/transform with
      // PLAIN DOM first (so a GSAP throw can't strand content at opacity:0), then
      // best-effort GSAP clearProps.
      $all("[data-reveal]").forEach(function (el) {
        el.classList.add("is-visible");
        el.style.opacity = "";
        el.style.transform = "";
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
        img.classList.remove("is-masking");
      });
      $all("[data-magnetic]").forEach(function (b) { b.style.transform = "none"; });
      $all(".leader-card").forEach(function (c) { c.classList.add("in-color"); });
      // Force Vision count-up stats to their final values: the enhanced count is
      // driven only by gsapCountUp's ScrollTrigger, which we just killed. Without
      // this, a stat freezes mid-tween (toggle mid-flight) or stays at the static
      // "0" if #vision never scrolled into view (once:true never fired).
      $all("[data-count]").forEach(function (el) {
        var t = parseInt(el.getAttribute("data-count"), 10);
        if (!isNaN(t)) el.textContent = String(t);
      });
      // Drop the enhanced signal so CSS returns to the plain reduced-motion
      // resting state (re-enables the reveal transition; clears the will-change
      // priming on [data-mask] / [data-magnetic]).
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
    tasks.push(initHeroBgPause);     // pause aurora/halo loops when hero off-screen
    tasks.push(initNav);
    tasks.push(initSmoothAnchors);   // native smooth scroll for anchors (both paths)
    tasks.push(initScrollspy);       // native scroll listener (both paths)
    tasks.push(initLeaderPhotoFallback);
    tasks.push(initEventCard);       // featured-event countdown + add-to-cal + share (both paths)
    tasks.push(initTilt);            // independent of libs; finePointer + !reduced
    tasks.push(initLightbox);

    if (ENHANCED) {
      // Mark the enhanced path so CSS opts reveals into the GSAP-managed state.
      // Gate on ScrollTrigger: only when ST drives the scroll reveals do we want
      // the CSS reveal transition disabled. If ST is blocked we fall back to the
      // IntersectionObserver reveal (initReveal), which NEEDS the CSS fade — so
      // we leave `gsap-enhanced` off in that case to avoid a hard snap-in.
      if (LIB.st) docEl.classList.add("gsap-enhanced");
      enhancedActive = true;

      // The heaviest flourishes are desktop-only: on touch we keep native scroll
      // + cheap reveals and skip the intro / SplitText / mask wipes / scrub
      // parallax / aurora scrub (calm, fast, fully-revealed phone page).
      var heavyOK = !isTouch;

      // Hero kinetics + intro hand-off.
      if (heavyOK) {
        tasks.push(function () {
          var playHero = LIB.split ? makeHeroSplit() : null;
          // If SplitText is blocked/failed, makeHeroSplit() returns null and
          // never adds .is-visible — guarantee the <h1> is shown so it can't
          // stay at opacity:0 under `.js [data-reveal]:not(.is-visible){opacity:0}`.
          if (!playHero) {
            var ht = $(".hero-title");
            if (ht) ht.classList.add("is-visible");
          }
          runIntro(playHero); // builds + plays/holds the hero timeline
        });
      } else {
        // Touch: no intro, no SplitText. Just reveal the hero immediately.
        tasks.push(function () {
          [".hero-title", ".hero-eyebrow", ".hero-lead", ".hero-actions"].forEach(function (s) {
            var el = $(s); if (el) el.classList.add("is-visible");
          });
        });
      }

      // Scroll-driven modules (each gated on ScrollTrigger).
      if (LIB.st) {
        tasks.push(gsapRevealBatch);
        tasks.push(gsapCountUp);
        if (heavyOK) {
          tasks.push(gsapParallax);
          tasks.push(gsapAuroraScrub);
          tasks.push(gsapMaskReveals);
          if (LIB.split) {
            tasks.push(splitSectionTitles);
          } else {
            tasks.push(function () {
              $all("[data-split]").forEach(function (el) { el.classList.add("is-visible"); });
            });
          }
        } else {
          // Touch: reveal split titles immediately (no SplitText), and run the
          // light fallback poster parallax instead of the scrub (it's cheap and
          // lightened to 0.45x on phones). Mask images show fully (no wipe).
          tasks.push(function () {
            $all("[data-split]").forEach(function (el) { el.classList.add("is-visible"); });
            $all("[data-mask]").forEach(function (img) { img.style.opacity = "1"; });
          });
        }
        // Velocity marquee (desktop) / CSS loop (touch, handled inside).
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

      // Hero pointer-parallax + halo (desktop fine-pointer only).
      tasks.push(initHeroParallax);

      // Desktop pointer sugar.
      if (finePointer) {
        tasks.push(initCursor);
        tasks.push(initMagnetic);
      }

      // Refresh ScrollTrigger after window load (fonts/images settle layout).
      on(window, "load", function () { refreshST(); });

      tasks.push(wireReducedMotionToggle);

    } else {
      // ------------------ VANILLA FALLBACK PATH ------------------
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
