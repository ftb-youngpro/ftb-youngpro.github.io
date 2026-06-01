/* ============================================================================
   Young Pro Ministry — Faith Temple Baptist Church Inc.
   main.js — the immersive interaction + animation layer.

   Vanilla ES, no libraries, runs with `defer`. Every behavior is guarded:
   if a hook is missing the page still works and nothing throws. Honors
   prefers-reduced-motion (parallax / tilt / marquee / count-up are skipped
   and final state is shown immediately).

   Targets the REAL hooks documented in index.html:
     [data-site-header] [data-nav-toggle] [data-nav] (#primary-nav)
     [data-reveal]  [data-count]  #vision
     .aurora (hero pointer-parallax)  .card (hover tilt)
     [data-themes-track]  [data-parallax]
     [data-lightbox] [data-lightbox-dialog] [data-lightbox-image]
       [data-lightbox-caption] [data-lightbox-close]
     [data-year]
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

  /* --- Pointer capability: only run hover-tilt / pointer-parallax on a real
     fine pointer (skip touch / coarse). -------------------------------------- */
  var finePointer = window.matchMedia
    ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
    : false;

  /* --- Tiny helpers -------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts || false); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var supportsIO = typeof window.IntersectionObserver === "function";

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

  /* ==========================================================================
     1. FOOTER YEAR  — hardcode 2026 (Date() is intentionally not used).
     ========================================================================== */
  function initYear() {
    $all("[data-year]").forEach(function (el) { el.textContent = "2026"; });
  }

  /* ==========================================================================
     2. STICKY NAV — add .is-scrolled past 24px.
     ========================================================================== */
  function initStickyHeader() {
    var header = $("[data-site-header]");
    if (!header) return;
    var THRESHOLD = 24;
    var update = function () {
      var scrolled = window.pageYOffset > THRESHOLD;
      header.classList.toggle("is-scrolled", scrolled);
    };
    update();
    on(window, "scroll", rafThrottle(update), { passive: true });
    on(window, "resize", rafThrottle(update), { passive: true });
  }

  /* ==========================================================================
     3. MOBILE NAV TOGGLE — accessible drawer.
        - toggle [data-nav] .is-open
        - flip aria-expanded + aria-label on the button
        - close on link click, Esc, and on resize to desktop
        - focus moves to the first link when opening; back to toggle on close
     ========================================================================== */
  function initNav() {
    var toggle = $("[data-nav-toggle]");
    var menu = $("[data-nav]");
    if (!toggle || !menu) return;

    var DESKTOP = 992; // matches the styles.css inline-nav breakpoint (min-width: 992px)
    var isDesktop = function () { return window.innerWidth >= DESKTOP; };

    function setOpen(open) {
      menu.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      // Lock background scroll while the drawer is open (mirrors the lightbox)
      // so the page behind the fixed panel can't scroll-chain under a thumb.
      document.body.style.overflow = open ? "hidden" : "";
      if (open) {
        var firstLink = $('a[href^="#"]', menu);
        if (firstLink) {
          // wait a frame so the drawer is visible before focusing
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

    // Focus trap: keep Tab cycling between the toggle and the drawer's links
    // so a keyboard user can't tab into the page hidden behind the open drawer.
    on(document, "keydown", function (e) {
      if (e.key !== "Tab" || !isOpen() || isDesktop()) return;
      var links = $all('a[href^="#"]', menu);
      if (!links.length) return;
      // The cycle is: toggle -> first link ... last link -> (back to toggle)
      var first = toggle;
      var last = links[links.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Close when any in-page nav link is tapped (mobile drawer).
    $all('a[href^="#"]', menu).forEach(function (link) {
      on(link, "click", function () { if (!isDesktop()) close(false); });
    });

    // Esc closes the drawer and returns focus to the toggle.
    on(document, "keydown", function (e) {
      if (e.key === "Escape" && isOpen() && !isDesktop()) close(true);
    });

    // Click outside the menu (but not the toggle) closes it.
    on(document, "click", function (e) {
      if (!isOpen() || isDesktop()) return;
      if (menu.contains(e.target) || toggle.contains(e.target)) return;
      close(false);
    });

    // If the viewport grows to desktop, ensure the drawer state is reset
    // (including the body scroll-lock we set while it was open).
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
     4. SMOOTH ANCHOR SCROLL
        CSS already sets `scroll-behavior: smooth` + scroll-padding-top, so
        native anchor jumps are smooth and correctly offset. We only intercept
        to (a) move keyboard focus to the target for accessibility, and
        (b) honor reduced motion by forcing an instant jump. We let the native
        behavior handle the visual scroll otherwise.
     ========================================================================== */
  function initSmoothAnchors() {
    var links = $all('a[href^="#"]');
    links.forEach(function (link) {
      on(link, "click", function (e) {
        var hash = link.getAttribute("href");
        if (!hash || hash === "#" || hash.length < 2) return;
        var target = document.getElementById(hash.slice(1));
        if (!target) return;

        e.preventDefault();

        // Update the URL hash without an extra jump.
        try { history.pushState(null, "", hash); }
        catch (err) { /* file:// or restricted — ignore */ }

        target.scrollIntoView({
          behavior: prefersReduced() ? "auto" : "smooth",
          block: "start"
        });

        // Move focus to the section for screen-reader + keyboard users.
        var hadTabindex = target.hasAttribute("tabindex");
        if (!hadTabindex) target.setAttribute("tabindex", "-1");
        // focus without scrolling (we already scrolled)
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
     5. SCROLL-REVEAL — fade + rise (stagger via inline --i is in CSS).
        IntersectionObserver adds .is-visible once, then unobserves.
        Fallback: if no IO or reduced motion, reveal everything immediately.
     ========================================================================== */
  function initReveal() {
    var items = $all("[data-reveal]");
    if (!items.length) return;

    if (!supportsIO || prefersReduced()) {
      items.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }

    var io = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* ==========================================================================
     6. COUNT-UP STATS — animate [data-count] 0 -> target when #vision enters.
        Ease-out, ~1.4s, runs once. Reduced motion / no-IO: show final value.
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
        var val = Math.round(easeOut(p) * target);
        el.textContent = String(val);
        if (p < 1) window.requestAnimationFrame(step);
        else el.textContent = String(target);
      }
      window.requestAnimationFrame(step);
    }

    // Prefer observing the #vision section; fall back to observing each number.
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
     7. HERO POINTER-PARALLAX (desktop fine-pointer only).
        Move the aurora blobs a few px against the cursor via --px / --py
        custom props (animations.css composes them with the drift keyframes).
        Skipped on touch and under reduced motion.
     ========================================================================== */
  function initHeroParallax() {
    if (!finePointer || prefersReduced()) return;
    var hero = $("#hero");
    var bg = hero ? $(".hero-bg", hero) : null;
    if (!hero || !bg) return;

    var MAX = 14; // px of drift at the screen edge
    var apply = rafThrottle(function (x, y) {
      bg.style.setProperty("--px", x.toFixed(1) + "px");
      bg.style.setProperty("--py", y.toFixed(1) + "px");
    });

    on(hero, "pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var nx = (e.clientX - r.left) / r.width - 0.5;  // -0.5 .. 0.5
      var ny = (e.clientY - r.top) / r.height - 0.5;
      apply(nx * MAX * 2, ny * MAX * 2);
    });
    on(hero, "pointerleave", function () {
      bg.style.setProperty("--px", "0px");
      bg.style.setProperty("--py", "0px");
    });
  }

  /* ==========================================================================
     8. CARD HOVER TILT (desktop fine-pointer only).
        Subtle ±5deg rotateX/Y toward the cursor; springs back on leave.
        Applies to .card elements; reduced motion / touch => skipped.
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
          var px = (e.clientX - r.left) / r.width - 0.5;   // -0.5..0.5
          var py = (e.clientY - r.top) / r.height - 0.5;
          // rotateX is driven by vertical position (invert so top tilts back)
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
     9. THEMES MARQUEE — duplicate children for a seamless loop, then start.
        styles.css pauses on hover/focus-within. Under reduced motion we leave
        the static (un-duplicated) list as-is — a calm wrapped row, no loop.
     ========================================================================== */
  function initMarquee() {
    var track = $("[data-themes-track]");
    if (!track) return;
    if (prefersReduced()) return; // leave static; CSS doesn't run the loop

    var originals = $all(":scope > *", track);
    if (!originals.length) return;

    // Duplicate the children once so translateX(-50%) loops seamlessly.
    // Clones are decorative + already represented => hide from a11y tree.
    originals.forEach(function (node) {
      var clone = node.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      // remove focusability from any interactive clones (none expected, safe)
      $all("a, button, [tabindex]", clone).forEach(function (f) {
        f.setAttribute("tabindex", "-1");
      });
      track.appendChild(clone);
    });

    // Enable the keyframe loop (gated behind .is-marquee in animations.css so
    // the un-duplicated list never animates and jumps).
    track.classList.add("is-marquee");
  }

  /* ==========================================================================
     10. PARALLAX POSTERS — drift slightly slower than scroll (max ~24px).
         Writes --shift (px) on each [data-parallax]; animations.css composes
         it with the hover scale. Throttled via rAF. Skipped on reduced motion.
     ========================================================================== */
  function initPosterParallax() {
    if (prefersReduced()) return;
    var posters = $all("[data-parallax]");
    if (!posters.length) return;

    var MAX = 24; // px of travel
    var vh = window.innerHeight || document.documentElement.clientHeight;

    var update = rafThrottle(function () {
      vh = window.innerHeight || document.documentElement.clientHeight;
      posters.forEach(function (el) {
        var r = el.getBoundingClientRect();
        // skip if fully off-screen
        if (r.bottom < -200 || r.top > vh + 200) return;
        // progress: -1 (just above view) .. 1 (just below view), 0 at center
        var center = r.top + r.height / 2;
        var prog = (center - vh / 2) / (vh / 2 + r.height / 2);
        prog = clamp(prog, -1, 1);
        // drift opposite to position so it eases past slower than scroll
        var shift = -prog * MAX;
        el.style.setProperty("--shift", shift.toFixed(1) + "px");
      });
    });

    update();
    on(window, "scroll", update, { passive: true });
    on(window, "resize", update, { passive: true });
  }

  /* ==========================================================================
     11. GALLERY LIGHTBOX — open on click, close on Esc / backdrop / button.
         Focus-managed: trap inside the dialog, restore focus on close.
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

    // Sibling landmarks to isolate from AT while the modal is open, so a
    // screen-reader virtual cursor can't roam the background behind the
    // aria-modal dialog. inert is preferred; aria-hidden is the fallback.
    var bgRegions = [
      document.getElementById("main"),
      $("[data-site-header]"),
      document.getElementById("site-footer")
    ].filter(Boolean);

    function isolateBackground(on) {
      bgRegions.forEach(function (el) {
        try {
          if (on) { el.inert = true; el.setAttribute("aria-hidden", "true"); }
          else { el.inert = false; el.removeAttribute("aria-hidden"); }
        } catch (err) {
          // inert unsupported — fall back to aria-hidden only
          if (on) el.setAttribute("aria-hidden", "true");
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
      document.body.style.overflow = "hidden"; // lock scroll behind modal
      isolateBackground(true); // hide background landmarks from AT

      // focus the close button (first sensible control)
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
      isolateBackground(false); // restore background landmarks to AT
      // removeAttribute (not src="") to avoid an empty-src request to the page URL
      if (imgEl) { imgEl.removeAttribute("src"); imgEl.setAttribute("alt", ""); }
      if (lastFocused && typeof lastFocused.focus === "function") {
        lastFocused.focus();
      }
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
          if (active === first || !dialog.contains(active)) {
            e.preventDefault(); last.focus();
          }
        } else {
          if (active === last || !dialog.contains(active)) {
            e.preventDefault(); first.focus();
          }
        }
      }
    });
  }

  /* ==========================================================================
     INIT — run after DOM is parsed. (Script is deferred, so DOM is ready,
     but guard anyway for safety.)
     ========================================================================== */
  function init() {
    // Each behavior is self-guarding; a throw in one must not block the rest.
    var tasks = [
      initYear, initStickyHeader, initNav, initSmoothAnchors,
      initReveal, initCountUp, initHeroParallax, initTilt,
      initMarquee, initPosterParallax, initLightbox
    ];
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
