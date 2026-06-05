// flow-events.js — Sends step/flow events to backend (NOT Telegram)
(function (root) {
  "use strict";

  var EVENT_ENDPOINT = "/api/flow/event";
  var API_BASE = "";

  if (root.FORM_API_BASE) {
    API_BASE = root.FORM_API_BASE;
  } else if (root.MAIN_API_BASE) {
    API_BASE = root.MAIN_API_BASE;
  } else if (root.API_BASE) {
    API_BASE = root.API_BASE;
  } else try {
    var meta = document.querySelector('meta[name="api-base"]');
    if (meta) {
      var val = meta.getAttribute("content");
      API_BASE = val && val.trim() ? val.trim() : window.location.origin;
    } else {
      API_BASE = window.location.origin;
    }
  } catch (_) {
    API_BASE = window.location.origin;
  }

  var _debounceTimers = {};

  function getFlowId() {
    return root.FlowState ? root.FlowState.getFlowId() : null;
  }

  function maskPhone(phone) {
    if (!phone || phone.length < 4) return "***";
    return phone.slice(0, -4).replace(/./g, "*") + phone.slice(-4);
  }

  function sendEvent(eventType, data) {
    var payload = {
      eventType: eventType,
      flowId: getFlowId(),
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
      data: data || {},
      user: {
        login: localStorage.getItem("inputName") || "",
        phone: localStorage.getItem("inputPhone") || ""
      }
    };

    try {
      if (root.fetchWithApiFallback) {
        root.fetchWithApiFallback(
          EVENT_ENDPOINT,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            mode: "cors",
            credentials: "omit",
            keepalive: true
          },
          API_BASE
        ).catch(function () {});
      } else {
        fetch(API_BASE + EVENT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          mode: "cors",
          credentials: "omit",
          keepalive: true
        }).catch(function () {});
      }
    } catch (_) {}
  }

  function sendEventDebounced(eventType, data, delay) {
    var key = eventType + (data && data.key ? ":" + data.key : "");
    if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
    _debounceTimers[key] = setTimeout(function () {
      sendEvent(eventType, data);
      delete _debounceTimers[key];
    }, delay || 800);
  }

  var FlowEvents = {
    send: sendEvent,
    sendDebounced: sendEventDebounced,

    flowStarted: function (meta) {
      sendEvent("flow_started", meta || {});
    },
    captchaOpened: function () {
      sendEvent("captcha_opened", {});
    },
    captchaCompleted: function (percent) {
      sendEvent("captcha_completed", { clearedPercent: percent });
    },
    captchaVerified: function (result) {
      sendEvent("captcha_verified", { result: result });
    },
    stepViewed: function (stepIndex, page) {
      sendEvent("step_viewed", { step: stepIndex, page: page || window.location.pathname });
    },
    stepAnswerUpdated: function (key, value) {
      sendEventDebounced("step_answer_updated", { key: key, value: value }, 800);
    },
    stepCompleted: function (stepIndex, answers) {
      var a = answers || {};
      if (typeof root.transformAnswersForDisplay === "function") a = root.transformAnswersForDisplay(a);
      sendEvent("step_completed", { step: stepIndex, answers: a });
    },
    redirectPerformed: function (from, to) {
      sendEvent("redirect_performed", { from: from, to: to });
    },
    flowCompleted: function (answers) {
      var a = answers || {};
      if (typeof root.transformAnswersForDisplay === "function") a = root.transformAnswersForDisplay(a);
      sendEvent("flow_completed", { answers: a });
    },
    validationError: function (step, fields) {
      sendEvent("validation_error", { step: step, fields: fields });
    }
  };

  root.FlowEvents = FlowEvents;
})(window);
