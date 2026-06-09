/* ============================================================================
   Young Pro Ministry — Bilingual (EN + Tagalog/Taglish) FAQ chatbot
   Faith Temple Baptist Church Inc.

   Self-contained vanilla IIFE. NO library dependency (no GSAP) — works even if
   the CDN is blocked. Same philosophy as main.js: "use strict", feature-detect,
   never throw, graceful no-JS / offline fallback, reduced-motion aware.

   Flow (per programming-notes/chatbot-spec.md):
     - injects a floating launcher (bottom-right) + an accessible chat panel
       (role=dialog, aria-modal, focus-trap, Esc-close, restores focus);
     - on FIRST open lazy-fetches assets/data/kb/index.json (the manifest);
     - per user message: normalize -> tokenize -> route to 1-2 topics -> fetch
       only those segment files (in-flight dedupe + in-memory cache) -> score
       intents -> confidence threshold -> answer or bilingual fallback;
     - language: auto-detect EN vs Tagalog/Taglish; a manual EN/TL toggle always
       wins and is persisted to localStorage (yp-chat-lang);
     - answers + their links render with textContent / real <a> (never innerHTML
       of KB or user text) — injection-safe.

   It guards everything: a missing fetch/CDN/localStorage never breaks the page.
   ============================================================================ */
(function () {
  "use strict";

  /* ---- 0. Feature detection: bail quietly if the platform can't support us. */
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (typeof window.fetch !== "function" || !document.body) return;

  // Don't double-init (in case the script is included twice).
  if (window.__ypChatInit) return;
  window.__ypChatInit = true;

  /* ---- Config ------------------------------------------------------------- */
  var KB_BASE = "assets/data/kb/";          // relative path — works under any subpath
  var MANIFEST_URL = KB_BASE + "index.json";
  var LANG_KEY = "yp-chat-lang";            // localStorage: "auto" | "en" | "tl"
  var CONFIDENCE_MIN = 4;                    // below this we don't trust the match
  var EMAIL = "ftb.youngpro.ministry@gmail.com";

  /* ---- Module state ------------------------------------------------------- */
  var manifest = null;                      // parsed index.json (loaded once on first open)
  var segmentCache = {};                    // topic -> intents[] (normalized lazily)
  var inflight = {};                        // topic -> Promise (dedupe concurrent fetches)
  var manifestPromise = null;               // dedupe the manifest fetch too
  var normalizedManifest = false;           // router/quick-questions pre-normalized once

  var built = false;                        // UI injected?
  var lastFocused = null;                   // element to restore focus to on close

  /* DOM refs (filled by buildUI) */
  var root, launcher, panel, logEl, chipsEl, inputEl, sendBtn, formEl,
      langAutoBtn, langEnBtn, langTlBtn, headerSubEl;

  /* ===========================================================================
     1. TEXT NORMALIZATION + TOKENIZE  (spec §3.1 / §3.2)
     =========================================================================== */
  var COMBINING = /[̀-ͯ]/g;       // Unicode combining marks (post-NFD)

  function normalize(s) {
    if (s == null) return "";
    var out = String(s).toLowerCase();
    // NFD + strip diacritics (é→e, ñ→n). Guard: some old engines lack normalize.
    if (typeof out.normalize === "function") {
      out = out.normalize("NFD").replace(COMBINING, "");
    }
    // Fold curly quotes / dashes to ASCII so 'yan == ’yan, et al.
    out = out
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, "-");
    // Non-alphanumeric (keep spaces) → space.
    out = out.replace(/[^a-z0-9\s]/g, " ");
    // Collapse whitespace.
    out = out.replace(/\s+/g, " ").trim();
    return out;
  }

  function tokenize(normalized) {
    if (!normalized) return [];
    return normalized.split(" ").filter(Boolean);
  }

  /* Small synonym map (engine-side, NOT the KB). Expansion only ADDS tokens. */
  var SYNONYMS = {
    yp: "young pro", ypf: "fellowship", ypgt: "get together",
    libre: "free", bayad: "cost", saan: "where", kailan: "when",
    oras: "time", paano: "how", papaano: "how", sino: "who",
    magkano: "cost", sumali: "join", lider: "leader", debosyonal: "devotional",
    simbahan: "church", lugar: "location", tema: "theme", kape: "coffee"
  };

  function expandTokens(tokens) {
    var seen = {};
    var out = [];
    function push(t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } }
    for (var i = 0; i < tokens.length; i++) {
      push(tokens[i]);
      var syn = SYNONYMS[tokens[i]];
      if (syn) {
        var parts = syn.split(" ");
        for (var j = 0; j < parts.length; j++) push(parts[j]);
      }
    }
    return out;
  }

  /* ===========================================================================
     2. LANGUAGE DETECTION  (spec §3.3) — manual toggle overrides
     =========================================================================== */
  var TL_STOPWORDS = {
    ano: 1, ang: 1, ng: 1, sa: 1, kayo: 1, ka: 1, ako: 1, paano: 1, papaano: 1,
    kailan: 1, saan: 1, bakit: 1, sino: 1, po: 1, ba: 1, mga: 1, naman: 1,
    yung: 1, ito: 1, yan: 1, may: 1, meron: 1, pwede: 1, gusto: 1, kasi: 1,
    dito: 1, kami: 1, tayo: 1, natin: 1, ninyo: 1, oras: 1, libre: 1, sumali: 1,
    nyo: 1, niyo: 1, magkano: 1, anong: 1, sila: 1, niya: 1, akin: 1, kanino: 1
  };

  function detectLang(tokens) {
    if (!tokens.length) return "en";
    var hits = 0;
    for (var i = 0; i < tokens.length; i++) {
      if (TL_STOPWORDS[tokens[i]]) hits++;
    }
    // Any Tagalog stopword is a strong signal in a short FAQ query.
    return hits >= 1 ? "tl" : "en";
  }

  /* Manual toggle (persisted). "auto" | "en" | "tl". */
  function getLangPref() {
    try {
      var v = window.localStorage.getItem(LANG_KEY);
      if (v === "en" || v === "tl" || v === "auto") return v;
    } catch (e) {}
    return "auto";
  }
  function setLangPref(v) {
    try { window.localStorage.setItem(LANG_KEY, v); } catch (e) {}
  }
  /* Resolve the language to answer in for a given query. */
  function resolveLang(tokens) {
    var pref = getLangPref();
    if (pref === "en" || pref === "tl") return pref;
    return detectLang(tokens);
  }

  /* ===========================================================================
     3. FETCH + LAZY-LOAD  (spec §4) — never throws; failure → [] → fallback
     =========================================================================== */
  function fetchJSON(url) {
    return window.fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    manifestPromise = fetchJSON(MANIFEST_URL).then(function (data) {
      manifest = data || {};
      prepManifest();
      return manifest;
    }).catch(function () {
      manifestPromise = null;     // allow a retry on the next message
      return null;                // signal: manifest unavailable
    });
    return manifestPromise;
  }

  function loadSegment(topic) {
    if (segmentCache[topic]) return Promise.resolve(segmentCache[topic]);
    if (inflight[topic]) return inflight[topic];
    var seg = (manifest && manifest.segments || []).filter(function (s) {
      return s.topic === topic;
    })[0];
    if (!seg || !seg.file) return Promise.resolve([]);
    inflight[topic] = fetchJSON(KB_BASE + seg.file).then(function (arr) {
      var list = Array.isArray(arr) ? arr : [];
      prepSegment(list);
      segmentCache[topic] = list;
      delete inflight[topic];
      return list;
    }).catch(function () {
      delete inflight[topic];
      return [];                  // never throw — empty array degrades to fallback
    });
    return inflight[topic];
  }

  /* ===========================================================================
     4. PRE-NORMALIZE the manifest + segments once (cache on the objects)
     =========================================================================== */
  function prepManifest() {
    if (normalizedManifest || !manifest) return;
    // Router: precompute, splitting phrase tokens from single tokens.
    var router = manifest.router || {};
    manifest.__router = [];
    for (var topic in router) {
      if (!Object.prototype.hasOwnProperty.call(router, topic)) continue;
      var phrases = [], singles = [];
      var list = router[topic] || [];
      for (var i = 0; i < list.length; i++) {
        var rt = normalize(list[i]);
        if (!rt) continue;
        if (rt.indexOf(" ") >= 0) phrases.push(rt);
        else singles.push(rt);
      }
      manifest.__router.push({ topic: topic, phrases: phrases, singles: singles });
    }
    // Quick-questions: support both `quickQuestions` (this KB) and `quick_questions`.
    manifest.__chips = manifest.quickQuestions || manifest.quick_questions || [];
    normalizedManifest = true;
  }

  /* Normalize each intent's keywords + q once; store on the object. */
  function prepSegment(list) {
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.__norm) continue;
      var kwPhrases = [], tokenSet = {};
      var kws = it.keywords || [];
      for (var k = 0; k < kws.length; k++) {
        var nk = normalize(kws[k]);
        if (!nk) continue;
        if (nk.indexOf(" ") >= 0) kwPhrases.push(nk);
        var kparts = nk.split(" ");
        for (var kp = 0; kp < kparts.length; kp++) tokenSet[kparts[kp]] = 1;
      }
      var qNorm = [];
      var qs = it.q || [];
      for (var qi = 0; qi < qs.length; qi++) {
        var nq = normalize(qs[qi]);
        if (!nq) continue;
        qNorm.push(nq);
        var qparts = nq.split(" ");
        for (var qp = 0; qp < qparts.length; qp++) tokenSet[qparts[qp]] = 1;
      }
      it.__norm = { kwPhrases: kwPhrases, qNorm: qNorm, tokenSet: tokenSet };
    }
  }

  /* ===========================================================================
     5. ROUTING  (spec §3.4) — pick the 1-2 best topics
     =========================================================================== */
  function route(tokens, phrase) {
    var tokenLookup = {};
    for (var t = 0; t < tokens.length; t++) tokenLookup[tokens[t]] = 1;

    var router = (manifest && manifest.__router) || [];
    var scored = [];
    for (var r = 0; r < router.length; r++) {
      var entry = router[r];
      var score = 0;
      // phrase hits weighted by word count
      for (var p = 0; p < entry.phrases.length; p++) {
        var ph = entry.phrases[p];
        if (phrase.indexOf(ph) >= 0) score += 2 * (ph.split(" ").length);
      }
      // single token hits
      for (var s = 0; s < entry.singles.length; s++) {
        if (tokenLookup[entry.singles[s]]) score += 1;
      }
      if (score > 0) scored.push({ topic: entry.topic, score: score });
    }
    scored.sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) {
      // No keyword overlap anywhere → cheap common guesses, engine still
      // applies the confidence gate so a bad match becomes the fallback.
      var guesses = [];
      if (segmentTopicExists("contact-app")) guesses.push("contact-app");
      else if (segmentTopicExists("contact")) guesses.push("contact");
      if (segmentTopicExists("identity")) guesses.push("identity");
      else if (segmentTopicExists("about")) guesses.push("about");
      return guesses.slice(0, 2);
    }
    return scored.slice(0, 2).map(function (x) { return x.topic; });
  }

  function segmentTopicExists(topic) {
    var segs = (manifest && manifest.segments) || [];
    for (var i = 0; i < segs.length; i++) if (segs[i].topic === topic) return true;
    return false;
  }

  /* ===========================================================================
     6. INTENT SCORING  (spec §3.5) within the fetched segments
     =========================================================================== */
  function scoreIntent(intent, queryTokens, queryPhrase) {
    var n = intent.__norm;
    if (!n) return { score: 0, overlap: 0 };

    // (a) exact quick-question / question match — decisive.
    for (var qi = 0; qi < n.qNorm.length; qi++) {
      if (queryPhrase === n.qNorm[qi]) {
        return { score: 1000 + (intent.priority || 1), overlap: 1000 };
      }
    }

    var s = 0;
    var overlap = 0;   // score earned from ACTUAL content matches (no priority nudge)

    // (b) phrase containment in keywords / questions (weighted by length).
    for (var kp = 0; kp < n.kwPhrases.length; kp++) {
      var kw = n.kwPhrases[kp];
      if (queryPhrase.indexOf(kw) >= 0) { s += 5 * kw.split(" ").length; overlap += 5; }
    }
    for (var qj = 0; qj < n.qNorm.length; qj++) {
      var q = n.qNorm[qj];
      if (queryPhrase.indexOf(q) >= 0 || q.indexOf(queryPhrase) >= 0) { s += 6; overlap += 6; }
    }

    // (c) single-token overlap (capped via coverage, not raw repetition).
    var matchedDistinct = 0;
    var counted = {};
    for (var t = 0; t < queryTokens.length; t++) {
      var tok = queryTokens[t];
      if (n.tokenSet[tok]) {
        s += 2;
        if (!counted[tok]) { counted[tok] = 1; matchedDistinct++; }
      }
    }
    s += 1.5 * matchedDistinct;   // coverage bonus
    overlap += matchedDistinct;   // real tokens that hit this intent

    // (d) priority nudge.
    s += (intent.priority || 1);

    return { score: s, overlap: overlap };
  }

  function bestIntent(segments, queryTokens, queryPhrase) {
    var best = null, bestScore = -Infinity, bestOverlap = 0;
    for (var i = 0; i < segments.length; i++) {
      var list = segments[i] || [];
      for (var j = 0; j < list.length; j++) {
        var r = scoreIntent(list[j], queryTokens, queryPhrase);
        if (r.score > bestScore) {
          bestScore = r.score; best = list[j]; bestOverlap = r.overlap;
        }
      }
    }
    return { intent: best, score: bestScore, overlap: bestOverlap };
  }

  /* Resolve a quick-question chip straight to its intent via match_id. */
  function resolveByMatchId(topic, matchId) {
    return loadSegment(topic).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === matchId) return list[i];
      }
      return null;
    });
  }

  /* ===========================================================================
     7. ANSWER PIPELINE  (spec §3.6 + §4 onUserMessage)
     =========================================================================== */
  function getFallback() {
    if (manifest && manifest.fallback) return manifest.fallback;
    // Hard inline fallback if even the manifest failed to load.
    return {
      a_en: "Sorry, I can't reach my notes right now. Please email the team at " +
            EMAIL + " and a leader will get back to you.",
      a_tl: "Pasensya, hindi ko maabot ang notes ko ngayon. Mag-email ka sa team sa " +
            EMAIL + " at may leader na sasagot sa'yo.",
      links: [{ label: "Email the team", href: "mailto:" + EMAIL }]
    };
  }

  function answerFor(text) {
    var phrase = normalize(text);
    var tokens = expandTokens(tokenize(phrase));
    var lang = resolveLang(tokenize(phrase)); // detect on raw tokens, not expanded

    return loadManifest().then(function (mf) {
      if (!mf) {
        // Manifest unreachable → graceful inline fallback (never a broken UI).
        return { reply: getFallback(), lang: lang };
      }
      var topics = route(tokens, phrase);
      if (!topics.length) return { reply: getFallback(), lang: lang };

      return Promise.all(topics.map(loadSegment)).then(function (segs) {
        var picked = bestIntent(segs, tokens, phrase);
        var reply;
        // Trust a match only if it clears the threshold AND earned its score from
        // real content overlap — never from the bare priority nudge alone. This
        // keeps a no-overlap query (incl. the cheap guess-path) on the warm
        // email fallback instead of a coincidentally high-priority intent.
        if (picked.intent && picked.score >= CONFIDENCE_MIN && picked.overlap > 0) {
          reply = picked.intent;
        } else {
          reply = getFallback();
        }
        return { reply: reply, lang: lang };
      });
    }).catch(function () {
      return { reply: getFallback(), lang: lang };
    });
  }

  /* ===========================================================================
     8. UI  (spec §5) — launcher + accessible dialog. Injection-safe rendering.
     =========================================================================== */
  var prefersReducedMotion = false;
  try {
    prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {}

  /* Inline SVG glyphs (tiny, no external requests). */
  function chatGlyph() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H10l-4.2 3.6A.7.7 0 0 1 4.7 18l.3-3H4.5A2.5 2.5 0 0 1 4 12.5z" ' +
      'fill="currentColor"/>' +
      '<circle cx="9" cy="9.2" r="1.15" fill="#0b1812"/>' +
      '<circle cx="12.5" cy="9.2" r="1.15" fill="#0b1812"/>' +
      '<circle cx="16" cy="9.2" r="1.15" fill="#0b1812"/></svg>';
  }
  function closeGlyph() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  }
  function sendGlyph() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M3.4 11.3 19.5 4.2c.9-.4 1.8.5 1.4 1.4l-7.1 16.1c-.4.9-1.7.8-2-.1l-2-6-6-2c-.9-.3-1-1.6-.4-2z" ' +
      'fill="currentColor"/></svg>';
  }

  function el(tag, cls, attrs) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) for (var a in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, a)) node.setAttribute(a, attrs[a]);
    }
    return node;
  }

  function buildUI() {
    if (built) return;
    built = true;

    root = el("div", "yp-chat-root", { "data-open": "false" });

    /* Launcher */
    launcher = el("button", "yp-chat-launcher", {
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      "aria-label": "Open the Young Pro chat helper"
    });
    launcher.innerHTML = chatGlyph();          // static, trusted SVG markup
    var dot = el("span", "yp-chat-launcher__dot", { "aria-hidden": "true" });
    launcher.appendChild(dot);

    /* Panel */
    panel = el("div", "yp-chat-panel", {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "yp-chat-title",
      tabindex: "-1"
    });

    /* Header */
    var header = el("div", "yp-chat-header");
    var mark = el("img", "yp-chat-header__mark", {
      src: "assets/img/yp-mark.svg", alt: "", "aria-hidden": "true",
      width: "34", height: "34"
    });
    var titles = el("div", "yp-chat-header__titles");
    var title = el("span", "yp-chat-header__title", { id: "yp-chat-title" });
    title.textContent = "YP Helper";
    headerSubEl = el("span", "yp-chat-header__sub");
    titles.appendChild(title);
    titles.appendChild(headerSubEl);

    /* Lang toggle (EN | TL — Auto is implicit when neither is pressed) */
    var langWrap = el("div", "yp-chat-lang", { role: "group", "aria-label": "Answer language" });
    langEnBtn = el("button", "yp-chat-lang__btn", { type: "button", "data-lang": "en" });
    langEnBtn.textContent = "EN";
    langTlBtn = el("button", "yp-chat-lang__btn", { type: "button", "data-lang": "tl" });
    langTlBtn.textContent = "TL";
    langWrap.appendChild(langEnBtn);
    langWrap.appendChild(langTlBtn);

    var closeBtn = el("button", "yp-chat-close", {
      type: "button", "aria-label": "Close the chat"
    });
    closeBtn.innerHTML = closeGlyph();

    header.appendChild(mark);
    header.appendChild(titles);
    header.appendChild(langWrap);
    header.appendChild(closeBtn);

    /* Log */
    logEl = el("div", "yp-chat-log", { role: "log", "aria-live": "polite", "aria-atomic": "false" });

    /* Chips */
    chipsEl = el("div", "yp-chat-chips", { "aria-label": "Quick questions", role: "group" });

    /* Input form */
    formEl = el("form", "yp-chat-form", { "aria-label": "Ask the YP helper" });
    var inputLabel = el("label", "yp-chat-sr", { "for": "yp-chat-input" });
    inputLabel.textContent = "Type your question";
    inputEl = el("textarea", "yp-chat-input", {
      id: "yp-chat-input", rows: "1", autocomplete: "off",
      placeholder: "Ask anything… EN or Tagalog"
    });
    sendBtn = el("button", "yp-chat-send", { type: "submit", "aria-label": "Send" });
    sendBtn.innerHTML = sendGlyph();
    formEl.appendChild(inputLabel);
    formEl.appendChild(inputEl);
    formEl.appendChild(sendBtn);

    panel.appendChild(header);
    panel.appendChild(logEl);
    panel.appendChild(chipsEl);
    panel.appendChild(formEl);

    root.appendChild(launcher);
    root.appendChild(panel);
    document.body.appendChild(root);

    /* ---- Wire events ---- */
    launcher.addEventListener("click", openChat);
    closeBtn.addEventListener("click", function () { closeChat(true); });
    langEnBtn.addEventListener("click", function () { onLangClick("en"); });
    langTlBtn.addEventListener("click", function () { onLangClick("tl"); });

    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      submitInput();
    });
    // Enter to send, Shift+Enter for newline.
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitInput();
      }
    });
    inputEl.addEventListener("input", autoGrow);

    panel.addEventListener("keydown", onPanelKeydown);

    reflectLangButtons();
  }

  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + "px";
  }

  /* ---- Language toggle UI ------------------------------------------------- */
  function onLangClick(lang) {
    var current = getLangPref();
    // Toggling the active language back off returns to auto.
    var next = current === lang ? "auto" : lang;
    setLangPref(next);
    reflectLangButtons();
    renderChips();   // chip labels follow the selected/auto language
  }

  function effectiveChipLang() {
    var pref = getLangPref();
    return pref === "tl" ? "tl" : "en"; // chips: TL only when explicitly TL
  }

  function reflectLangButtons() {
    var pref = getLangPref();
    langEnBtn.setAttribute("aria-pressed", pref === "en" ? "true" : "false");
    langTlBtn.setAttribute("aria-pressed", pref === "tl" ? "true" : "false");
    if (headerSubEl) {
      headerSubEl.innerHTML = "";
      var auto = document.createElement("span");
      auto.textContent = pref === "auto"
        ? "Auto language" : (pref === "tl" ? "Tagalog" : "English");
      headerSubEl.appendChild(auto);
    }
  }

  /* ===========================================================================
     9. OPEN / CLOSE + FOCUS TRAP  (mirrors the lightbox pattern in main.js)
     =========================================================================== */
  function focusables() {
    if (!panel) return [];
    var nodes = panel.querySelectorAll(
      'button, [href], textarea, input, [tabindex]:not([tabindex="-1"])'
    );
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.disabled) continue;
      if (n.offsetParent === null && n.getClientRects().length === 0) continue;
      out.push(n);
    }
    return out;
  }

  function onPanelKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeChat(true);
      return;
    }
    if (e.key !== "Tab") return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    var active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last || !panel.contains(active)) { e.preventDefault(); first.focus(); }
    }
  }

  var greeted = false;

  function openChat() {
    if (!built) buildUI();
    if (root.getAttribute("data-open") === "true") return;
    lastFocused = document.activeElement;
    root.setAttribute("data-open", "true");
    launcher.setAttribute("aria-expanded", "true");

    // Move focus into the panel (input is the natural first stop).
    var focusTarget = inputEl || panel;
    if (prefersReducedMotion) {
      try { focusTarget.focus({ preventScroll: true }); } catch (e) { focusTarget.focus(); }
    } else {
      window.requestAnimationFrame(function () {
        try { focusTarget.focus({ preventScroll: true }); } catch (e) { focusTarget.focus(); }
      });
    }

    // First open: load manifest, greet, render chips.
    loadManifest().then(function (mf) {
      if (!greeted) {
        greeted = true;
        if (mf && mf.greeting) {
          addBotMessage(pickLang(mf.greeting), null);
        } else {
          addBotMessage(
            "Hi! Ask me anything about the FTB Young Pro Ministry — English or Tagalog.",
            null
          );
        }
      }
      renderChips();
    });
  }

  function closeChat(returnFocus) {
    if (!root || root.getAttribute("data-open") !== "true") return;
    root.setAttribute("data-open", "false");
    launcher.setAttribute("aria-expanded", "false");
    if (returnFocus && lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    } else if (launcher) {
      launcher.focus();
    }
  }

  /* ===========================================================================
     10. RENDERING  (textContent only — injection-safe)
     =========================================================================== */
  function pickLang(obj, lang) {
    lang = lang || (getLangPref() === "tl" ? "tl" : "en");
    if (lang === "tl" && obj && obj.a_tl) return obj.a_tl;
    return (obj && (obj.a_en || obj.a_tl)) || "";
  }

  function addUserMessage(text) {
    var msg = el("div", "yp-chat-msg yp-chat-msg--user");
    msg.textContent = text;
    logEl.appendChild(msg);
    scrollLog();
  }

  function addBotMessage(text, links) {
    var msg = el("div", "yp-chat-msg yp-chat-msg--bot");
    msg.textContent = text;            // never innerHTML of KB text
    if (links && links.length) {
      var wrap = el("div", "yp-chat-links");
      for (var i = 0; i < links.length; i++) {
        var lnk = links[i];
        if (!lnk || !lnk.href) continue;
        var a = el("a", "yp-chat-link");
        a.textContent = lnk.label || lnk.href;
        a.setAttribute("href", lnk.href);
        var href = String(lnk.href);
        var external = /^https?:/i.test(href) || /^mailto:/i.test(href);
        if (external) {
          a.setAttribute("rel", "noopener noreferrer");
          if (/^https?:/i.test(href)) a.setAttribute("target", "_blank");
        }
        wrap.appendChild(a);
      }
      if (wrap.childNodes.length) msg.appendChild(wrap);
    }
    logEl.appendChild(msg);
    scrollLog();
    return msg;
  }

  var typingNode = null;
  function showTyping() {
    if (typingNode) return;
    typingNode = el("div", "yp-chat-typing", { "aria-hidden": "true" });
    typingNode.appendChild(el("span"));
    typingNode.appendChild(el("span"));
    typingNode.appendChild(el("span"));
    logEl.appendChild(typingNode);
    scrollLog();
  }
  function hideTyping() {
    if (typingNode && typingNode.parentNode) typingNode.parentNode.removeChild(typingNode);
    typingNode = null;
  }

  function scrollLog() {
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = "";
    var chips = (manifest && manifest.__chips) || [];
    var lang = effectiveChipLang();
    for (var i = 0; i < chips.length; i++) {
      (function (qq) {
        var label = (lang === "tl" ? qq.tl : qq.en) || qq.en || qq.tl;
        if (!label) return;
        var btn = el("button", "yp-chat-chip", { type: "button" });
        btn.textContent = label;
        btn.addEventListener("click", function () { onChipClick(qq); });
        chipsEl.appendChild(btn);
      })(chips[i]);
    }
  }

  /* ===========================================================================
     11. MESSAGE HANDLERS
     =========================================================================== */
  var busy = false;

  function finishReply(text, links) {
    hideTyping();
    addBotMessage(text, links);
    busy = false;
    if (sendBtn) sendBtn.disabled = false;
  }

  function submitInput() {
    if (busy) return;
    var text = (inputEl.value || "").trim();
    if (!text) return;
    inputEl.value = "";
    autoGrow();
    sendMessage(text);
  }

  function sendMessage(text) {
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    addUserMessage(text);
    showTyping();
    answerFor(text).then(function (res) {
      var r = res.reply || getFallback();
      finishReply(pickLang(r, res.lang), r.links);
    }).catch(function () {
      var fb = getFallback();
      finishReply(pickLang(fb), fb.links);
    });
  }

  function onChipClick(qq) {
    if (busy) return;
    var lang = getLangPref() === "tl" ? "tl" : "en";
    var label = (lang === "tl" ? qq.tl : qq.en) || qq.en || qq.tl;
    busy = true;
    if (sendBtn) sendBtn.disabled = true;
    addUserMessage(label);
    showTyping();

    loadManifest().then(function (mf) {
      if (!mf) { var fb = getFallback(); finishReply(pickLang(fb, lang), fb.links); return; }
      // Quick-question chips resolve to a specific intent via match_id (no scoring).
      if (qq.topic && qq.match_id) {
        resolveByMatchId(qq.topic, qq.match_id).then(function (intent) {
          if (intent) {
            // language: honor manual toggle; otherwise detect from the chip text.
            var useLang = getLangPref();
            if (useLang === "auto") useLang = detectLang(tokenize(normalize(label)));
            finishReply(pickLang(intent, useLang), intent.links);
          } else {
            // match_id missing → fall back to normal scoring on the chip text.
            answerFor(label).then(function (res) {
              var r = res.reply || getFallback();
              finishReply(pickLang(r, res.lang), r.links);
            });
          }
        });
      } else {
        answerFor(label).then(function (res) {
          var r = res.reply || getFallback();
          finishReply(pickLang(r, res.lang), r.links);
        });
      }
    }).catch(function () {
      var fb = getFallback();
      finishReply(pickLang(fb, lang), fb.links);
    });
  }

  /* ===========================================================================
     12. BOOT — inject the launcher once the DOM is ready. No-JS users never see
     it (and lose nothing — the FAQ page carries the same knowledge statically).
     =========================================================================== */
  function boot() {
    try { buildUI(); }
    catch (e) { /* never break the host page */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  /* Minimal test/diagnostic hook (used by the headless harness; harmless live). */
  window.YPChat = {
    open: openChat,
    close: function () { closeChat(false); },
    send: sendMessage,
    answerFor: answerFor,          // returns Promise<{reply, lang}>
    _state: function () {
      return {
        manifestLoaded: !!manifest,
        cachedTopics: Object.keys(segmentCache),
        langPref: getLangPref()
      };
    }
  };
})();
