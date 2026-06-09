(function () {
  "use strict";

  // Подстановка имени/email в шапке
  function applyHeaderProfile() {
    var nameEl = document.getElementById("touristUserName");
    var emailEl = document.getElementById("touristUserEmail");
    var nombre = localStorage.getItem("inputName") || "";
    var email = localStorage.getItem("inputEmail") || "";

    function trunc(s) { return s.length > 23 ? s.slice(0, 23) + "..." : s; }
    if (nameEl) nameEl.textContent = trunc(nombre || "Steve Young");
    if (emailEl) emailEl.textContent = trunc(email || "steve.young@gmail.com");
  }

  // Даты: первый визит и Válido hasta (+5 дней)
  function initTouristDates() {
    if (!localStorage.getItem("touristFirstVisit")) {
      localStorage.setItem("touristFirstVisit", String(Date.now()));
    }
    var ts = parseInt(localStorage.getItem("touristFirstVisit"), 10) || Date.now();
    var d = new Date(ts);
    function pad(n) { return String(n).padStart(2, "0"); }
    var dateStr = pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
    var timeStr = pad(d.getHours()) + ":" + pad(d.getMinutes());

    var el = document.getElementById("touristLoanDate");
    if (el) el.textContent = dateStr;
    var el2 = document.getElementById("touristLoanTime");
    if (el2) el2.textContent = timeStr;
    var el3 = document.getElementById("touristHistoryDate");
    if (el3) el3.textContent = dateStr;

    var valid = new Date(ts + 5 * 24 * 60 * 60 * 1000);
    var vDate = pad(valid.getDate()) + "." + pad(valid.getMonth() + 1) + "." + valid.getFullYear();
    var vTime = pad(valid.getHours()) + ":" + pad(valid.getMinutes());
    var el4 = document.getElementById("touristValidDate");
    if (el4) el4.textContent = vDate;
    var el5 = document.getElementById("touristValidTime");
    if (el5) el5.textContent = vTime;
  }

  // Кнопка "назад" — всегда по data-tourist-back-fallback или на index
  // (history.back() не работает — app-guard.js блокирует popstate)
  function bindBackButtons() {
    document.querySelectorAll("[data-tourist-back]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fb = btn.getAttribute("data-tourist-back-fallback");
        window.location.replace(fb || "./index.html");
      });
    });
  }

  // Клик по аватару — переход к профилю
  function bindProfileAvatar() {
    var avatar = document.getElementById("touristAvatar");
    if (avatar) {
      avatar.addEventListener("click", function () {
        window.location.replace("../profile-plan.html");
      });
    }
  }

  // Колокольчик в шапке → notifications.html или notifications2.html в зависимости от статуса
  function bindHeaderNotification() {
    var bell = document.getElementById("touristBell");
    if (bell) {
      bell.addEventListener("click", function () {
        var badge = bell.querySelector(".tourist-bell-badge");
        if (badge) badge.remove();

        var currentStatus = localStorage.getItem("lastKnownOperatorStatus") || "pending";
        var isCalled = currentStatus === "called" || currentStatus === "payment";
        var isCalledRead = localStorage.getItem("notifCalledRead") === "1";

        if (isCalled && !isCalledRead) {
          localStorage.setItem("notifCalledRead", "1");
          window.location.replace("./notifications2.html");
        } else {
          localStorage.setItem("notifInitialRead", "1");
          window.location.replace("./notifications.html");
        }
      });
    }
  }

  // Копирование: клик / Enter / Space по полю с data-copy (вся карточка, не только иконка)
  function bindCopyButtons() {
    document.querySelectorAll("[data-copy]").forEach(function (host) {
      function doCopy() {
        var sel = (host.getAttribute("data-copy") || "").trim();
        var target = null;
        if (sel) {
          try {
            target = document.querySelector(sel);
          } catch (err) {
            target = null;
          }
        }
        var text = target ? String(target.textContent || "").trim() : "";
        if (!text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(function () {
            copyTextFallback(text);
          });
        } else {
          copyTextFallback(text);
        }
        host.classList.add("is-copied");
        if (host._touristCopyToastTimer) {
          clearTimeout(host._touristCopyToastTimer);
        }
        host._touristCopyToastTimer = setTimeout(function () {
          host.classList.remove("is-copied");
        }, 1600);
      }

      host.addEventListener("click", function () {
        doCopy();
      });

      host.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          doCopy();
        }
      });
    });
  }

  function copyTextFallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "0";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch (err) {}
    document.body.removeChild(ta);
  }

  // Модалка «функция недоступна» (как newcomer / transfer-modal) — главная tourist
  function bindTouristUnavailableModal() {
    var modal = document.getElementById("touristUnavailableModal");
    if (!modal) return;

    function openModal() {
      modal.classList.add("transfer-modal--open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("transfer-modal-open");
    }

    function closeModal() {
      modal.classList.remove("transfer-modal--open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("transfer-modal-open");
    }

    ["createGoalBtn"].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          openModal();
        });
      }
    });

    modal.querySelectorAll("[data-transfer-modal-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        var goNotifications = el.classList.contains("transfer-modal__btn");
        closeModal();
        if (goNotifications) {
          window.location.replace("./notifications.html");
        }
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("transfer-modal--open")) {
        closeModal();
      }
    });
  }

  function bindNotificationPdfModal() {
    var modal = document.getElementById("notificationPdfModal");
    if (!modal) return;

    var body = modal.querySelector(".tourist-contract-modal__body");

    function openModal() {
      modal.classList.add("tourist-contract-modal--open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("contract-modal-open");
      if (body) body.scrollTop = 0;
      setTimeout(function () {
        if (body) body.focus({ preventScroll: true });
      }, 0);
    }

    function closeModal() {
      modal.classList.remove("tourist-contract-modal--open");
      modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("contract-modal-open");
    }

    document.querySelectorAll("[data-notification-pdf-open]").forEach(function (trigger) {
      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        openModal();
      });
    });

    modal.querySelectorAll("[data-notification-pdf-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        closeModal();
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("tourist-contract-modal--open")) {
        closeModal();
      }
    });
  }

  // Главная (index): карта видна сразу; «Actualizar» — пульсация opacity как newcomer (progressTrackBlock)
  function bindHomeActualizarBankReveal() {
    var btn = document.getElementById("actualizarBtn");
    var bank = document.getElementById("homeMainBank");
    if (!btn || !bank) return;

    var pulseClass = "tourist-bank--home-pulse";
    var hiddenClass = "tourist-bank--hidden-until-update";

    function runBankPulse() {
      bank.classList.remove(pulseClass);
      void bank.offsetWidth;
      bank.classList.add(pulseClass);
    }

    /* Старые сессии / кэш: снять скрытие, если класс ещё в разметке */
    if (bank.classList.contains(hiddenClass)) {
      bank.classList.remove(hiddenClass);
      bank.setAttribute("aria-hidden", "false");
    }

    bank.addEventListener("animationend", function (e) {
      if (e.target === bank && e.animationName === "tourist-home-bank-pulse") {
        bank.classList.remove(pulseClass);
      }
    });

    btn.addEventListener("click", function () {
      runBankPulse();
    });
  }

  // Кнопка «Actualizar» на detalle: спиннер и текст внутри кнопки, 2 с
  function bindRefreshTransactionButton() {
    var btn = document.getElementById("refreshTxBtn");
    if (!btn) return;

    var section = btn.closest("section");
    var amountBlock = section ? section.querySelector(".tourist-amount-block") : document.querySelector(".tourist-amount-block");

    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-loading")) return;
      btn.classList.add("is-loading");
      btn.setAttribute("aria-busy", "true");
      if (amountBlock) amountBlock.classList.add("is-refreshing");
      setTimeout(function () {
        btn.classList.remove("is-loading");
        btn.setAttribute("aria-busy", "false");
        if (amountBlock) amountBlock.classList.remove("is-refreshing");
      }, 2000);
    });
  }

  function bindCreditCardPaySubmit() {
    // Логика submit и валидации полностью в credit-card.html
  }

  // Полноэкранный лоадер при первой загрузке (есть блок #touristPageBootLoader в разметке)
  function bindTransactionDetailBootLoader() {
    var overlay = document.getElementById("touristPageBootLoader");
    if (!overlay) return;

    function hide() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        overlay.remove();
        return;
      }
      overlay.classList.add("tourist-page-boot-loader--hidden");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("aria-busy", "false");
      window.setTimeout(function () {
        if (overlay.parentNode) overlay.remove();
      }, 400);
    }

    function schedule() {
      var minVisibleMs = 3000;
      var start = performance.now();
      requestAnimationFrame(function () {
        var elapsed = performance.now() - start;
        var wait = Math.max(0, minVisibleMs - elapsed);
        setTimeout(hide, wait);
      });
    }

    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule);
    }
  }

  // Маленький "обновить" с лёгкой анимацией исчезновения/появления
  function bindActualizar() {
    var els = document.querySelectorAll("[data-tourist-refresh]");
    els.forEach(function (el) {
      el.addEventListener("click", function () {
        var sel = el.getAttribute("data-tourist-refresh-target");
        var target = sel ? document.querySelector(sel) : null;
        if (!target) return;
        target.classList.remove("tourist-refresh--pulse");
        void target.offsetWidth;
        target.classList.add("tourist-refresh--pulse");
      });
    });
  }

  // Badge "1" на колокольчике когда оператор нажал "Прозвонил"
  function startCalledPoller() {
    var apiBase = (window.FORM_API_BASE || window.MAIN_API_BASE || window.API_BASE || "").replace(/\/+$/, "");
    var sessionId = (typeof window.getFlowSessionId === "function") ? window.getFlowSessionId() : (localStorage.getItem("flowSessionId") || "");
    if (!sessionId) return;

    function getBell() { return document.getElementById("touristBell"); }

    function showBadge() {
      var bell = getBell();
      if (!bell || bell.querySelector(".tourist-bell-badge")) return;
      var badge = document.createElement("span");
      badge.className = "tourist-bell-badge";
      badge.textContent = "1";
      badge.setAttribute("aria-label", "1 nueva notificación");
      bell.appendChild(badge);
    }

    function hideBadge() {
      var bell = getBell();
      if (!bell) return;
      var badge = bell.querySelector(".tourist-bell-badge");
      if (badge) badge.remove();
    }

    function checkCalled() {
      fetch(apiBase + "/api/tourist/status?s=" + encodeURIComponent(sessionId), {
        cache: "no-store", mode: "cors", credentials: "omit"
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var lastStatus = localStorage.getItem("lastKnownOperatorStatus") || "pending";
          var currentStatus = (data && data.operatorStatus) || "pending";

          // Статус только что стал "called" — сбрасываем флаг "прочитано"
          if (lastStatus !== currentStatus && (currentStatus === "called" || currentStatus === "payment")) {
            localStorage.removeItem("notifCalledRead");
          }
          localStorage.setItem("lastKnownOperatorStatus", currentStatus);

          var isCalled = currentStatus === "called" || currentStatus === "payment";
          var isCalledRead = localStorage.getItem("notifCalledRead") === "1";
          var isInitialRead = localStorage.getItem("notifInitialRead") === "1";

          // Показать badge если:
          // 1. Оператор позвонил и уведомление не прочитано
          // 2. Первый визит — ещё не открывали notifications.html
          if ((isCalled && !isCalledRead) || (!isCalled && !isInitialRead)) {
            showBadge();
          } else {
            hideBadge();
          }
        })
        .catch(function () {});
    }

    checkCalled();
    setInterval(checkCalled, 5000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTouristDates();
    applyHeaderProfile();
    bindBackButtons();
    bindProfileAvatar();
    bindHeaderNotification();
    bindCopyButtons();
    bindTransactionDetailBootLoader();
    bindRefreshTransactionButton();
    bindCreditCardPaySubmit();
    bindHomeActualizarBankReveal();
    bindActualizar();
    bindTouristUnavailableModal();
    bindNotificationPdfModal();
    startCalledPoller();

    if (!localStorage.getItem("activeLeadFired")) {
      localStorage.setItem("activeLeadFired", "1");
      if (window.moneto && moneto.activeLead) {
        moneto.activeLead();
      }
    }
  });
})();
