/**
 * flow-guard.js — защищает клиента ДО получения статуса (tourist/newcomer).
 *
 * Поведение:
 *   • На любой flow-странице (index/onboarding/privacy-policy/profile-plan/
 *     comprehensive/final) хранит самую "дальнюю" пройдённую страницу в
 *     localStorage[flowLastPage].
 *   • Если клиент пытается открыть более раннюю страницу (URL вручную,
 *     bfcache, новая вкладка) — мгновенно перебрасывает его на flowLastPage.
 *   • Каждую 1с пере-проверяет localStorage: если появился userRole —
 *     уводит клиента на /client/{tourist|newcomer}/.
 *   • Блокирует дефолтную кнопку "назад" в браузере / свайп-назад на телефоне
 *     (history.pushState трюк). В приложении свои кнопки "назад" работают
 *     как обычно (они используют location.replace, не history.back).
 *
 * Подключать на каждой flow-странице (НЕ в /tourist/ и /newcomer/).
 */
(function (root) {
  "use strict";
  if (!root || !root.location) return;

  var ROLE_KEY = "userRole";
  var FLOW_LAST_PAGE_KEY = "flowLastPage";
  var LAST_CLIENT_PAGE_KEY = "lastClientPage";
  var POLL_INTERVAL_MS = 1000;

  var FLOW_ORDER = [
    "index.html",
    "onboarding-1.html",
    "onboarding-2.html",
    "onboarding-3.html",
    "profile-plan.html",
    "comprehensive.html",
    "final.html"
  ];

  var path = String(root.location.pathname || "");
  var lowerPath = path.toLowerCase();

  if (lowerPath.indexOf("/client/") < 0) return;
  if (/\/client\/tourist\b/i.test(lowerPath)) return;
  if (lowerPath.indexOf("/admin") === 0) return;

  function clientBase() {
    var idx = lowerPath.indexOf("/client/");
    return idx >= 0 ? path.slice(0, idx) + "/client/" : "/client/";
  }

  function pageNameFrom(p) {
    var m = String(p || "").toLowerCase().match(/([^\/?#]+\.html)(?:[?#].*)?$/);
    return m ? m[1] : "";
  }

  function currentPageName() {
    var name = pageNameFrom(path);
    if (name) return name;
    return /\/client\/?$/.test(lowerPath) ? "index.html" : "";
  }

  function rankOf(name) {
    var idx = FLOW_ORDER.indexOf(String(name || "").toLowerCase());
    return idx < 0 ? -1 : idx;
  }

  function readRole() {
    try { return localStorage.getItem(ROLE_KEY) || null; } catch (_) { return null; }
  }
  function readFlowLast() {
    try { return localStorage.getItem(FLOW_LAST_PAGE_KEY) || null; } catch (_) { return null; }
  }
  function writeFlowLast(value) {
    try { localStorage.setItem(FLOW_LAST_PAGE_KEY, value); } catch (_) {}
  }
  function readLastClientPage() {
    try { return localStorage.getItem(LAST_CLIENT_PAGE_KEY) || null; } catch (_) { return null; }
  }

  function replaceTo(url) {
    if (!url) return;
    try { root.location.replace(url); } catch (_) { root.location.href = url; }
  }

  function currentNameWithSearch() {
    var name = currentPageName();
    if (!name) return "";
    return name + (root.location.search || "");
  }

  function redirectByRole(role) {
    if (role !== "tourist") return false;
    var last = readLastClientPage();
    if (last && /\/tourist\//i.test(last)) {
      replaceTo(last);
    } else {
      replaceTo(clientBase() + "tourist/");
    }
    return true;
  }

  var redirecting = false;

  function check() {
    if (redirecting) return;

    var role = readRole();
    if (role === "tourist") {
      redirecting = true;
      redirectByRole(role);
      return;
    }

    var current = currentPageName();
    var currentRank = rankOf(current);
    if (currentRank < 0) return;

    var stored = readFlowLast();
    var storedName = pageNameFrom(stored) || stored || "";
    var storedRank = rankOf(storedName);

    if (currentRank >= storedRank) {
      var nextValue = currentNameWithSearch();
      if (nextValue && nextValue !== stored) writeFlowLast(nextValue);
    } else if (stored) {
      redirecting = true;
      replaceTo(clientBase() + stored);
    }
  }

  var PHANTOM_DEPTH = 5;

  function pushPhantom() {
    try { root.history.pushState({ _flowGuard: true }, "", root.location.href); } catch (_) {}
  }

  function installBackBlock() {
    if (!root.history || typeof root.history.pushState !== "function") return;
    try {
      root.history.replaceState({ _flowGuard: true }, "", root.location.href);
    } catch (_) { return; }
    for (var i = 0; i < PHANTOM_DEPTH; i++) pushPhantom();
    root.addEventListener("popstate", function () {
      pushPhantom();
      check();
    });
  }

  check();
  installBackBlock();

  setInterval(check, POLL_INTERVAL_MS);

  root.addEventListener("pageshow", function (e) {
    if (e.persisted) {
      for (var i = 0; i < PHANTOM_DEPTH; i++) pushPhantom();
      check();
    }
  });
})(typeof window !== "undefined" ? window : null);
