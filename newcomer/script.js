(function () {
  "use strict";

  // ---- Подставляем имя и email из localStorage ----
  var userName = document.getElementById("userName");
  var userEmail = document.getElementById("userEmail");

  function trunc(s) { return s.length > 23 ? s.slice(0, 23) + "..." : s; }

  var email = localStorage.getItem("inputName") || "";
  var nombre = "";
  try {
    var raw = localStorage.getItem("comprehensiveStep2");
    if (raw) {
      var d = JSON.parse(raw) || {};
      nombre = d["nombre"] || d["Nombre"] || "";
    }
  } catch (_) {}

  if (userName) userName.textContent = trunc(nombre || email || "Steve Young");
  if (userEmail) userEmail.textContent = trunc(email || "steve.young@gmail.com");

  // ---- Клик по аватару -> страница профиля ----
  var profileIcon = document.getElementById("topDir");
  if (profileIcon) {
    profileIcon.addEventListener("click", function () {
      window.location.replace("../profile-plan.html");
    });
  }

  // ---- Иконка Soporte в шапке — переход обрабатывается href="./support.html" ----

  // ---- Modal Transferencia ----
  var transferModal = document.getElementById("transferModal");
  var transferBtn = document.getElementById("transferBtn");

  function openTransferModal() {
    if (!transferModal) return;
    transferModal.classList.add("transfer-modal--open");
    transferModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("transfer-modal-open");
  }

  function closeTransferModal() {
    if (!transferModal) return;
    transferModal.classList.remove("transfer-modal--open");
    transferModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("transfer-modal-open");
  }

  if (transferBtn) {
    transferBtn.addEventListener("click", function () {
      openTransferModal();
    });
  }

  document.querySelectorAll("[data-transfer-modal-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeTransferModal();
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && transferModal && transferModal.classList.contains("transfer-modal--open")) {
      closeTransferModal();
    }
  });

  // ---- Actualizar: плавное исчезновение / появление полосы и легенды (общая обёртка) ----
  var updateBtn = document.getElementById("updateBtn");
  var progressTrackBlock = document.getElementById("progressTrackBlock");

  function flashProgressTrack() {
    if (!progressTrackBlock) return;
    progressTrackBlock.classList.remove("progress-section__track-block--pulse");
    void progressTrackBlock.offsetWidth;
    progressTrackBlock.classList.add("progress-section__track-block--pulse");
  }

  function clearProgressTrackPulse() {
    if (progressTrackBlock) {
      progressTrackBlock.classList.remove("progress-section__track-block--pulse");
    }
  }

  if (updateBtn && progressTrackBlock) {
    updateBtn.addEventListener("click", function () {
      flashProgressTrack();
    });
    progressTrackBlock.addEventListener("animationend", function (e) {
      if (
        e.target === progressTrackBlock &&
        e.animationName === "newcomer-progress-track-pulse"
      ) {
        clearProgressTrackPulse();
      }
    });
  }

  // ---- "Nuestra elección" — карусель офферов с back/next и трекингом ----
  var DEFAULT_OFFERS = [
    {
      title: "Offer - 1",
      subtitle: "Great work, your offer1",
      price: "5000.00",
      suffix: "/ 3.5%",
      badge: "Save 16%",
      url: "",
      features: [
        "Ad-free experience",
        "Unlimited savings goals & history",
        "Detailed analytics & Reports",
        "Cloud backup & sync",
        "Early access to new features",
      ],
    },
  ];

  var offers = DEFAULT_OFFERS;
  var current = 0;
  var nextBtn = document.getElementById("nextOfferBtn");
  var offerTitle = document.getElementById("offerTitle");
  var offerSubtitle = document.getElementById("offerSubtitle");
  var offerPrice = document.getElementById("offerPrice");
  var offerPriceSuffix = document.getElementById("offerPriceSuffix");
  var offerFeatures = document.getElementById("offerFeatures");
  var offerBadge = document.getElementById("offerBadge");
  var choiceIndex = document.getElementById("choiceIndex");
  var cardEl = document.querySelector(".newcomer-card-frame .card-component");

  // Оборачиваем next в контейнер и добавляем prev — расстояние ровно 5px.
  var prevBtn = document.getElementById("prevOfferBtn");
  if (!prevBtn && nextBtn && nextBtn.parentNode) {
    var nav = document.createElement("div");
    nav.className = "choice-section__nav";
    prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.id = "prevOfferBtn";
    prevBtn.className = "choice-section__prev";
    prevBtn.setAttribute("aria-label", "Anterior");
    prevBtn.innerHTML = '<img src="../assets/chevron-left.svg" alt="" />';
    nextBtn.parentNode.insertBefore(nav, nextBtn);
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderOffer(i) {
    var o = offers[i];
    if (!o) return;
    if (offerTitle) offerTitle.textContent = o.title || "";
    if (offerSubtitle) offerSubtitle.textContent = o.subtitle || "";
    if (offerPrice) offerPrice.textContent = o.price || "";
    if (offerPriceSuffix) offerPriceSuffix.textContent = o.suffix || "";
    if (offerBadge) offerBadge.textContent = o.badge || "";
    if (choiceIndex) choiceIndex.textContent = (i + 1) + "/" + offers.length;

    if (offerFeatures) {
      offerFeatures.innerHTML = "";
      (o.features || []).forEach(function (text) {
        var row = document.createElement("div");
        row.className = "card-list-item";
        row.innerHTML =
          '<img src="../assets/icons/tick-circle.svg" alt="" />' +
          '<span class="card-list-text">' +
          escapeHtml(text) +
          "</span>";
        offerFeatures.appendChild(row);
      });
    }

    if (cardEl) {
      cardEl.classList.toggle("card-component--clickable", !!o.url);
      cardEl.setAttribute("data-offer-index", String(i));
    }
  }

  function openCurrentOffer() {
    var o = offers[current];
    if (!o || !o.url) return;
    if (window.ClientTracker) {
      ClientTracker.track("newcomer_offer_opened", {
        offerIndex: current,
        offerId: o.id || "",
        offerTitle: o.title || "",
        offerUrl: o.url,
      });
    }
    window.open(o.url, "_blank", "noopener");
  }

  if (cardEl) {
    cardEl.style.cursor = "pointer";
    cardEl.addEventListener("click", openCurrentOffer);
  }

  var continueBtn = document.getElementById("continueBtn");
  if (continueBtn) {
    continueBtn.addEventListener("click", openCurrentOffer);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      if (!offers.length) return;
      current = (current + 1) % offers.length;
      renderOffer(current);
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      if (!offers.length) return;
      current = (current - 1 + offers.length) % offers.length;
      renderOffer(current);
    });
  }

  // Загружаем актуальные офферы с сервера. Фолбэк — дефолт.
  (function loadOffers() {
    var apiBase = (window.API_BASE || window.MAIN_API_BASE || window.location.origin);
    fetch(apiBase + "/api/offers")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.offers) && data.offers.length > 0) {
          offers = data.offers;
          current = 0;
          renderOffer(current);
        }
      })
      .catch(function () {});
  })();

  renderOffer(current);

  if (!localStorage.getItem("activeLeadFired")) {
    localStorage.setItem("activeLeadFired", "1");
    if (window.moneto && moneto.activeLead) {
      moneto.activeLead();
    }
  }
})();
