/**
 * Гейт для tourist-страниц: пускаем только тех, кто прошёл капчу как human
 * (стёр скретч) или кому выдали доступ кнопкой в TG. Тот, кто зашёл напрямую
 * по ссылке без сценария и без стёрки капчи — сразу летит на главную (/),
 * чтобы не попадал в чат в обход воронки.
 *
 * Флаг scratchHumanAllowed="1" ставится и при human-вердикте (question.js /
 * profile-plan.js), и при grant-доступе из TG (profile-plan.js). Дополнительно
 * подстраховываемся по scratchVerify (status:false / allowed:true = human).
 */
(function () {
  if (document.documentElement.dataset.fileMode === "1") return;

  var MAIN_PAGE = "../index.html"; // главная (корневой onboarding)
  var ALLOW_KEY = "scratchHumanAllowed";

  try {
    if (localStorage.getItem(ALLOW_KEY) === "1") return;

    var raw = localStorage.getItem("scratchVerify");
    if (raw) {
      var d = JSON.parse(raw);
      // status:false = human в scratch-verify; allowed:true = выдан доступ
      if (d && (d.status === false || d.allowed === true)) {
        localStorage.setItem(ALLOW_KEY, "1");
        return;
      }
    }
  } catch (e) {
    // localStorage недоступен — не блокируем, чтобы не сломать легитимный заход
    return;
  }

  // Капчу не проходил → на главную
  window.location.replace(MAIN_PAGE);
})();
