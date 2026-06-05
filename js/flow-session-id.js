/**
 * Уникальный ID сессии для капчи, WhatsApp и логов бота (формат ID…).
 * Один на вкладку, хранится в localStorage.
 */
(function (root) {
  "use strict";
  var KEY = "flowSessionId";

  /**
   * Короткий ID как ID4455: префикс ID + 4 цифры (1000–9999).
   * Тот же id уходит в WhatsApp, scratch-verify, job meta и TG — один формат везде.
   */
  function generate() {
    var n = 1000 + Math.floor(Math.random() * 9000);
    return "ID" + n;
  }

  /** Старый формат был ID + base36 (буквы), например IDMMNXVCPFALLI60T6 — заменяем на короткий. */
  function isLegacyFormat(id) {
    if (!id || id.length < 6 || id.indexOf("ID") !== 0) return false;
    var rest = String(id).slice(2);
    return /[A-Za-z]/.test(rest);
  }

  root.getFlowSessionId = function () {
    try {
      var id = localStorage.getItem(KEY);
      if (id && String(id).length >= 4 && !isLegacyFormat(id)) return id;
      if (isLegacyFormat(id)) {
        id = generate();
        localStorage.setItem(KEY, id);
        return id;
      }
      id = generate();
      localStorage.setItem(KEY, id);
      return id;
    } catch (e) {
      return generate();
    }
  };

  root.getWhatsAppSessionText = function (prefix) {
    var id = root.getFlowSessionId();
    var baseText = String(prefix || "Hola").trim();
    return id ? baseText + " Session: " + id : baseText;
  };

  root.buildWhatsAppUrl = function (prefix) {
    var base = root.WHATSAPP_BASE_URL || "";
    return base + encodeURIComponent(root.getWhatsAppSessionText(prefix));
  };

  root.getWhatsAppCompletedUrl = function () {
    return root.buildWhatsAppUrl("Hola, he completado la encuesta.");
  };
})(window);
