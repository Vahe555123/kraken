// flow-state.js — Questionnaire flow state persistence via sessionStorage
(function (root) {
  "use strict";

  var STORAGE_KEY = "questionnaireFlowState";
  var STORAGE = localStorage;

  function generateFlowId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).slice(2, 10);
    return ts + "-" + rand;
  }

  function captureSourceMeta() {
    var params = new URLSearchParams(window.location.search);
    var meta = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"].forEach(function (k) {
      var v = params.get(k);
      if (v) meta[k] = v;
    });
    meta.referrer = document.referrer || "";
    meta.landingPage = window.location.pathname;
    return meta;
  }

  function now() {
    return new Date().toISOString();
  }

  function FlowState() {}

  FlowState.load = function () {
    try {
      var raw = STORAGE.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  };

  FlowState.save = function (state) {
    state.updatedAt = now();
    try {
      STORAGE.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
    return state;
  };

  FlowState.init = function () {
    var existing = FlowState.load();
    if (existing && existing.flowId) {
      existing.currentPage = window.location.pathname;
      return FlowState.save(existing);
    }

    var state = {
      flowId: generateFlowId(),
      startedAt: now(),
      updatedAt: now(),
      currentPage: window.location.pathname,
      currentStep: 0,
      captchaResult: "pending",
      answers: {},
      routingHistory: [window.location.pathname],
      sourceMeta: captureSourceMeta()
    };
    return FlowState.save(state);
  };

  FlowState.update = function (patch) {
    var state = FlowState.load() || FlowState.init();
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        state[key] = patch[key];
      }
    }
    return FlowState.save(state);
  };

  FlowState.setStep = function (stepIndex) {
    return FlowState.update({ currentStep: stepIndex });
  };

  FlowState.setCaptchaResult = function (result) {
    return FlowState.update({ captchaResult: result });
  };

  FlowState.setAnswer = function (key, value) {
    var state = FlowState.load() || FlowState.init();
    state.answers[key] = value;
    return FlowState.save(state);
  };

  FlowState.addRoute = function (page) {
    var state = FlowState.load() || FlowState.init();
    if (!Array.isArray(state.routingHistory)) state.routingHistory = [];
    state.routingHistory.push(page);
    state.currentPage = page;
    return FlowState.save(state);
  };

  FlowState.clear = function () {
    try {
      STORAGE.removeItem(STORAGE_KEY);
    } catch (_) {}
  };

  FlowState.getFlowId = function () {
    var state = FlowState.load();
    return state ? state.flowId : null;
  };

  FlowState.getAllAnswers = function () {
    var state = FlowState.load();
    return state && state.answers ? state.answers : {};
  };

  root.FlowState = FlowState;
})(window);
