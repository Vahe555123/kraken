// ================= AMOUNT =================
setTimeout(() => {
  document.querySelectorAll(".currcentAmount").forEach((e) => {
    const amount = localStorage.getItem("currentAmount") || "2000";
    const normalizedAmount = amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    e.textContent = `€${normalizedAmount}`;
  });
}, 500);

// ================= RANDOM =================
const random1 = document.getElementById("random1");
const random2 = document.getElementById("random2");
const random3 = document.getElementById("random3");
const random4 = document.getElementById("random4");
const userName = document.getElementById("userName");

setTimeout(() => {
  userName.textContent = localStorage.getItem("inputName") || "Steve Young";

  if (!localStorage.getItem("random")) {
    const random1num = Math.floor(Math.random() * 11) + 6;
    const random2num = Math.floor(Math.random() * 10) + 43;
    const random3num = Math.floor(Math.random() * 11) + 2;
    const random4num = Math.floor(Math.random() * 11) + 74;

    const randomValues = {
      random1: random1num,
      random2: random2num,
      random3: random3num,
      random4: random4num,
    };

    random1.textContent = random1num;
    random2.textContent = random2num;
    random3.textContent = random3num;
    random4.textContent = random4num + "%";

    localStorage.setItem("random", JSON.stringify(randomValues));
  } else {
    const storedRandom = JSON.parse(localStorage.getItem("random"));

    random1.textContent = storedRandom.random1;
    random2.textContent = storedRandom.random2;
    random3.textContent = storedRandom.random3;
    random4.textContent = storedRandom.random4 + "%";
  }
}, 500);

// ================= SCRATCH MODAL =================
document.addEventListener("DOMContentLoaded", function () {
  if (window.getFlowSessionId) window.getFlowSessionId();

  const continueBtn = document.getElementById("continueBtn");
  const modalOverlay = document.getElementById("modalOverlay");
  const profileContainer = document.querySelector(".profile-container");
  const canvas = document.getElementById("scratchCanvas");
  const ctx = canvas.getContext("2d");
  const finalImage = document.getElementById("finalImage");
  const progressPercent = document.getElementById("progressPercent");

  // ================= CONFIG =================
  let isDrawing = false;
  let brushRadius = 36;

  // ======= STATS =======
  let scratchStartTime = null;
  let scratchEndTime = null;
  let scratchCompleted = false;
  let scratchClearedPercent = 0;

  let lastPoint = null;
  let hasPointerDown = false;
  let hasPointerMove = false;
  let totalPathLength = 0;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // ================= IMAGE =================
  const spoilerImg = new Image();
  spoilerImg.src = "./assets/spoiler.png";

  // ================= UTILS =================
  function resetScratchStats() {
    scratchStartTime = null;
    scratchEndTime = null;
    scratchCompleted = false;
    scratchClearedPercent = 0;

    lastPoint = null;
    hasPointerDown = false;
    hasPointerMove = false;
    totalPathLength = 0;

    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;

    progressPercent.textContent = "0%";
    progressPercent.parentElement.style.opacity = "1";
    //finalImage.style.display = "none";
  }

  function recalcBrushRadius() {
    const size = Math.min(canvas.width, canvas.height);
    brushRadius = Math.max(32, Math.min(48, size * 0.12));
  }

  function resizeCanvas() {
    const modalContainer = document.querySelector(".modal-container");
    if (!modalContainer) return;

    const rect = modalContainer.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(spoilerImg, 0, 0, canvas.width, canvas.height);

    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    recalcBrushRadius();
    resetScratchStats();
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  // ================= SCRATCH =================
  function startScratch(e) {
    if (e.cancelable) e.preventDefault();
    if (scratchCompleted) return;

    isDrawing = true;
    hasPointerDown = true;

    const { x, y } = getPos(e);

    if (!scratchStartTime) {
      scratchStartTime = performance.now();
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    lastPoint = { x, y };

    ctx.beginPath();
    ctx.arc(x, y, brushRadius, 0, Math.PI * 2);
    ctx.fill();

    checkScratched();
  }

  function scratchMove(e) {
    if (!isDrawing || scratchCompleted) return;
    if (e.cancelable) e.preventDefault();

    hasPointerMove = true;
    const { x, y } = getPos(e);

    if (lastPoint) {
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;
      totalPathLength += Math.hypot(dx, dy);

      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(x, y);
      ctx.lineWidth = brushRadius * 2;
      ctx.stroke();
    }

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    lastPoint = { x, y };
    checkScratched();
  }

  function endScratch(e) {
    if (e && e.cancelable) e.preventDefault();
    isDrawing = false;
  }

  // ================= PROGRESS =================
  async function checkScratched() {
    if (scratchCompleted) return;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let cleared = 0;

    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] === 0) cleared++;
    }

    const percent = (cleared / (canvas.width * canvas.height)) * 100;
    scratchClearedPercent = percent;
    progressPercent.textContent = Math.floor(percent) + "%";

    if (percent >= 70) {
      scratchCompleted = true;
      scratchEndTime = performance.now();

      progressPercent.parentElement.style.opacity = "0";
      canvas.style.transition = "opacity 0.4s ease";
      canvas.style.opacity = "0";

      await sendToServer();
    }
  }

  // ================= SERVER =================
  async function sendToServer() {
    const bboxWidth = isFinite(minX) ? Math.max(0, maxX - minX) : 0;
    const bboxHeight = isFinite(minY) ? Math.max(0, maxY - minY) : 0;

    const payload = {
      flowSessionId: window.getFlowSessionId ? window.getFlowSessionId() : null,
      clearedPercent: Math.round(scratchClearedPercent || 0),
      pointerEvents: {
        hasPointerDown,
        hasPointerMove,
      },
      bbox: {
        bboxWidth: Math.round(bboxWidth),
        bboxHeight: Math.round(bboxHeight),
      },
      canvas: {
        canvasWidth: Math.round(canvas.width),
        canvasHeight: Math.round(canvas.height),
      },
      query: window.location.search || "",
    };

    console.log('[SCRATCH-VERIFY] Sending payload to server:', payload);

    try {
      var _api = window.FORM_API_BASE || window.MAIN_API_BASE || window.API_BASE || window.location.origin;
      const verifyResult = window.fetchJsonWithApiFallback
        ? await window.fetchJsonWithApiFallback(
            "/api/scratch-verify",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
            _api
          )
        : {
            response: await fetch(_api + "/api/scratch-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }),
            data: null,
          };

      const res = verifyResult.response;
      const data = verifyResult.data !== null ? verifyResult.data : await res.json();

      console.log('[SCRATCH-VERIFY] Server response:', {
        status: data.status,
        allowed: data.allowed,
        hasAccessToken: !!data.accessToken,
        geo: data.geo,
        url: data.url,
      });

      localStorage.removeItem("comprehensiveAddressGeoAutofillApplied");
      localStorage.setItem("scratchVerify", JSON.stringify(data));
      if (data.accessToken) localStorage.setItem("scratchAccessToken", data.accessToken);
      console.log(data);
      // status true = bot — продолжаем опрос на profile-plan, comprehensive только после TG
      if (data.status === true && data.accessToken) {
        localStorage.setItem("url", "profile-plan.html");
        if (window.scratchAccessPoll) window.scratchAccessPoll.start();
        return;
      }
      if (!data.status) {
        localStorage.setItem("scratchHumanAllowed", "1");
      }
      // location.href = "../final.html"
      return;
      // ========== ЭЛЕМЕНТЫ ==========
      // элементы
      // const badge = document.getElementById("cardBadge");
      // const title = document.getElementById("cardTitle");
      // const subtitle = document.getElementById("cardSubtitle");
      // const currency = document.getElementById("cardCurrency");
      // const amount = document.getElementById("cardAmount");
      // const rate = document.getElementById("cardRate");
      // const list = document.getElementById("cardList");

      // // заполнение
      // badge.textContent = data.ui.badge || "";
      // title.textContent = data.ui.title || "";
      // subtitle.innerHTML = data.ui.subtitle ? data.ui.subtitle.replace(/\n/g, "<br>") : "";
      // currency.textContent = "€"; // если всегда евро
      // amount.textContent = data.ui.price || "";
      // rate.textContent = data.ui.priceSuffix || "";

      // list.innerHTML = "";
      // if (Array.isArray(data.ui.features)) {
      //   data.ui.features.forEach(item => {
      //     const div = document.createElement("div");
      //     div.className = "card-list-item";
      //     div.innerHTML = `<img src="./assets/icons/tick-circle.svg" alt="" /><span class="card-list-text">${item}</span>`;
      //     list.appendChild(div);
      //   });
      // }
    } catch (err) {
      console.log("Verify error:", err);
    }
  }

  // ================= EVENTS =================
  canvas.addEventListener("mousedown", startScratch);
  canvas.addEventListener("mousemove", scratchMove);
  canvas.addEventListener("mouseup", endScratch);
  canvas.addEventListener("mouseleave", endScratch);

  canvas.addEventListener("touchstart", startScratch, { passive: false });
  canvas.addEventListener("touchmove", scratchMove, { passive: false });
  canvas.addEventListener("touchend", endScratch, { passive: false });
  canvas.addEventListener("touchcancel", endScratch, { passive: false });

  // ================= MODAL =================
  continueBtn.addEventListener("click", function () {
    // profile-plan1.html — в конце опроса только WhatsApp с уникальным ID
    if (window.location.pathname.indexOf("profile-plan1") >= 0 && window.getWhatsAppCompletedUrl) {
      window.location.replace(window.getWhatsAppCompletedUrl());
      return;
    }
    var url = localStorage.getItem("url") || "comprehensive.html";
    // Бот без разрешения — comprehensive запрещён
    if (url.indexOf("comprehensive") >= 0 && localStorage.getItem("scratchAccessToken")) {
      var _base = window.FORM_API_BASE || window.MAIN_API_BASE || window.API_BASE || window.location.origin;
      (window.fetchJsonWithApiFallback
        ? window.fetchJsonWithApiFallback(
            "/api/scratch-access/" + encodeURIComponent(localStorage.getItem("scratchAccessToken")),
            {
              method: "GET",
              cache: "no-store",
              mode: "cors",
              credentials: "omit"
            },
            _base
          ).then(function (result) { return result.data; })
        : fetch(_base + "/api/scratch-access/" + encodeURIComponent(localStorage.getItem("scratchAccessToken"))).then(function (r) { return r.json(); }))
        .then(function (d) {
          if (d && d.allowed) {
            if (d.ui) {
              try {
                var raw = localStorage.getItem("scratchVerify");
                var obj = raw ? JSON.parse(raw) : {};
                obj.ui = d.ui;
                obj.allowed = true;
                obj.status = false;
                obj.url = "comprehensive.html";
                delete obj.accessToken;
                localStorage.removeItem("comprehensiveAddressGeoAutofillApplied");
                localStorage.setItem("scratchVerify", JSON.stringify(obj));
              } catch (e) {}
            }
            localStorage.setItem("scratchHumanAllowed", "1");
            localStorage.removeItem("scratchAccessToken");
            localStorage.setItem("url", "comprehensive.html");
            location.replace("comprehensive.html");
          } else {
            alert("Espere la confirmación del operador o escriba por WhatsApp.");
          }
        })
        .catch(function () { alert("Espere la confirmación."); });
      return;
    }
    var email = localStorage.getItem("inputName") || "";
    var phone = localStorage.getItem("inputPhone") || "";
    if ((email || phone) && (url.includes("comprehensive") || url.includes("profile-plan"))) {
      var sep = url.indexOf("?") >= 0 ? "&" : "?";
      if (email) url += sep + "email=" + encodeURIComponent(email);
      if (phone) url += (url.indexOf("?") >= 0 ? "&" : "?") + "phone=" + encodeURIComponent(phone);
    }
    location.replace(url);
    // modalOverlay.classList.add("active");
    // profileContainer.classList.add("modal-active");
    // document.body.style.overflow = "hidden";

    // setTimeout(() => {
    //   resizeCanvas();
    // }, 60);
  });

  modalOverlay.addEventListener("click", function (e) {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove("active");
      profileContainer.classList.remove("modal-active");
      document.body.style.overflow = "";
    }
  });

  window.addEventListener("resize", function () {
    if (modalOverlay.classList.contains("active")) {
      resizeCanvas();
    }
  });

  spoilerImg.onload = resizeCanvas;
});
