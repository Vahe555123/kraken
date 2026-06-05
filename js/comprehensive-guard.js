/**
 * comprehensive.html только после human scratch или после кнопки в TG (grant).
 * Иначе — сразу на profile-plan (в т.ч. первый заход и ручной ввод URL).
 */
(function () {
  if (document.documentElement.dataset.fileMode === "1") return;

  var ALLOW_KEY = "scratchHumanAllowed";

  function redirect() {
    window.location.replace("./profile-plan.html");
  }

  // Уже помечен как human или доступ выдан
  if (localStorage.getItem(ALLOW_KEY) === "1") return;

  // Бот с токеном — без кнопки в TG не пускаем
  var token =
    localStorage.getItem("scratchAccessToken") ||
    (function () {
      try {
        var raw = localStorage.getItem("scratchVerify");
        if (raw) {
          var d = JSON.parse(raw);
          if (d.accessToken && d.allowed !== true) return d.accessToken;
        }
      } catch (e) {}
      return "";
    })();
  if (token) {
    redirect();
    return;
  }

  // Нет флага human — не проходил scratch как human
  try {
    var raw = localStorage.getItem("scratchVerify");
    if (raw) {
      var d = JSON.parse(raw);
      // status false = human в scratch-verify
      if (d.status === false || d.allowed === true) {
        localStorage.setItem(ALLOW_KEY, "1");
        return;
      }
    }
  } catch (e) {}

  redirect();
})();
