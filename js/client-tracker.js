/**
 * client-tracker.js — отправка событий пользователя на /api/track.
 * Используется в страницах туриста и новичка.
 */
(function (root) {
  "use strict";

  function getApiBase() {
    if (root.API_BASE) return root.API_BASE;
    if (root.MAIN_API_BASE) return root.MAIN_API_BASE;
    try {
      var meta = document.querySelector('meta[name="api-base"]');
      if (meta) {
        var val = meta.getAttribute("content");
        if (val && val.trim()) return val.trim();
      }
    } catch (_) {}
    return root.location.origin;
  }

  function getEmail() {
    try {
      return (
        localStorage.getItem("inputName") ||
        localStorage.getItem("inputEmail") ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  function getFlowSessionId() {
    try {
      if (typeof root.getFlowSessionId === "function") return root.getFlowSessionId();
      return localStorage.getItem("flowSessionId") || "";
    } catch (_) {
      return "";
    }
  }

  function track(event, extra) {
    var payload = Object.assign(
      {
        event: event,
        email: getEmail(),
        flowSessionId: getFlowSessionId(),
      },
      extra || {}
    );

    try {
      fetch(getApiBase() + "/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
        credentials: "omit",
        keepalive: true,
      }).catch(function () {});
    } catch (_) {}
  }

  root.ClientTracker = { track: track };
})(window);
