/**
 * Test fill buttons for comprehensive.html — fills all fields per step.
 * Only shown when hostname is localhost.
 */
(function () {
  return
  // if (!/localhost|127\.0\.0\.1/i.test(window.location.hostname || "")) return;

  var DATA = {
    0: function () {},
    1: function (block) {
      setInput(block, "nombre", "Carlos");
      setInput(block, "primer-apellido", "García");
      setInput(block, "segundo-apellido", "López");
      setDropdown(block, "razon", "Gasto Imprevisto");
      setDate(block, "date", "15", "Marzo", "1990", "03");
      setDropdown(block, "genero", "Hombre");
      setDropdown(block, "estado-civil", "Soltero/a");
      setDropdown(block, "hijos", "0");
      setDropdown(block, "educacion", "Secundaria");
    },
    2: function (block) {
      setInput(block, "calle", "Gran Vía");
      setInput(block, "numero-casa", "42");
      setInput(block, "piso-escalera", "3B");
      setInput(block, "ciudad", "Madrid");
      setInput(block, "codigo-postal", "28013");
      setDropdown(block, "provincia", "Madrid");
      setDropdown(block, "tipo-calle", "Calle");
      setDropdown(block, "tipo-vivienda", "Alquiler (Vives solo)");
      setDropdown(block, "ciudadano", "Sí");
    },
    3: function (block) {
      setDropdown(block, "tipo-ingresos", "Trabajo Fijo");
      triggerEmploymentType(block);
      setInput(block, "nombre-empresa", "Tech Solutions España");
      setDate(block, "contrato", "01", "Enero", "2022", "01");
      setDropdown(block, "sector-contrato", "Finanzas");
      setInput(block, "salario-neto", "2500");
      setNominaDate(block);
      setInput(block, "mensualidad", "600");
      setInput(block, "otros-gastos", "150");
      setDropdown(block, "otras-fuentes", "Ninguna");
    },
    4: function (block) {
      setDropdown(block, "creditos-activos", "Ninguno");
      setDropdown(block, "vehiculo-propio", "No");
      setDropdown(block, "pep", "No");
      setDropdown(block, "historial-crediticio", "No");
    },
    5: function (block) {
      setDropdown(block, "hipoteca-oferta", "No gracias, no estoy interesado");
      setDropdown(block, "seguro-prestamo", "No gracias, no estoy interesado");
      setDropdown(block, "tarjeta-credito", "No gracias, no estoy interesado");
    },
    6: function (block) {
      setInput(block, "dni-nie", "12345678Z");
      setInput(block, "iban-summary", "ES9121000418450200051332");
    }
  };

  function setInput(block, name, value) {
    var inp = block.querySelector("input[name='" + name + "']");
    if (!inp) return;
    inp.value = value;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setDropdown(block, ddName, value) {
    var dd = block.querySelector("[data-dropdown='" + ddName + "']");
    if (!dd) return;
    var opt = dd.querySelector(".credit-form__dropdown-option[data-value='" + value + "']");
    if (opt) opt.click();
  }

  function setDate(block, prefix, day, monthName, year, monthNum) {
    var field = block.querySelector("[data-dropdown='" + prefix + "-day']")?.closest("[data-required-date]");
    if (!field) return;
    var dayEl = field.querySelector("[data-dropdown='" + prefix + "-day'] .credit-form__value");
    var monthEl = field.querySelector("[data-dropdown='" + prefix + "-month'] .credit-form__value");
    var yearEl = field.querySelector("[data-dropdown='" + prefix + "-year'] .credit-form__value");
    if (dayEl) { dayEl.textContent = day; dayEl.setAttribute("data-value", day); dayEl.setAttribute("data-empty", "false"); }
    if (monthEl) { monthEl.textContent = monthName; monthEl.setAttribute("data-value", monthNum); monthEl.setAttribute("data-empty", "false"); }
    if (yearEl) { yearEl.textContent = year; yearEl.setAttribute("data-value", year); yearEl.setAttribute("data-empty", "false"); }
  }

  function setNominaDate(block) {
    var now = new Date();
    var day = String(Math.min(28, now.getDate() + 5)).padStart(2, "0");
    var months = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    var m = now.getMonth();
    var y = now.getFullYear();
    if (parseInt(day) <= now.getDate()) { m = (m + 1) % 12; if (m === 0) y++; }
    setDate(block, "nomina", day, months[m], String(y), String(m + 1).padStart(2, "0"));
  }

  function triggerEmploymentType(block) {
    if (typeof window.displayEmploymentType === "function") {
      var form = block.querySelector(".credit-form");
      if (form) window.displayEmploymentType(form);
    }
  }

  function fillStep(stepIdx) {
    var blocks = document.querySelectorAll("[class^='main__content']");
    var block = blocks[stepIdx];
    if (!block) return;
    var fn = DATA[stepIdx];
    if (fn) fn(block);
    setTimeout(function () {
      if (typeof window.checkNextBtn === "function") window.checkNextBtn();
      if (typeof window.persistComprehensiveAnswers === "function") window.persistComprehensiveAnswers();
    }, 100);
  }

  function fillAll() {
    var blocks = document.querySelectorAll("[class^='main__content']");
    for (var i = 0; i < blocks.length; i++) {
      var fn = DATA[i];
      if (fn) fn(blocks[i]);
    }
    setTimeout(function () {
      if (typeof window.checkNextBtn === "function") window.checkNextBtn();
      if (typeof window.persistComprehensiveAnswers === "function") window.persistComprehensiveAnswers();
    }, 100);
  }

  function createBar() {
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#222;padding:6px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;";
    for (var i = 0; i <= 6; i++) {
      var btn = document.createElement("button");
      btn.textContent = "S" + (i + 1);
      btn.style.cssText = "padding:4px 10px;font-size:12px;background:#FA6C12;color:#fff;border:none;border-radius:4px;cursor:pointer;";
      btn.setAttribute("data-step", String(i));
      btn.addEventListener("click", function () { fillStep(parseInt(this.getAttribute("data-step"))); });
      bar.appendChild(btn);
    }
    var allBtn = document.createElement("button");
    allBtn.textContent = "ALL";
    allBtn.style.cssText = "padding:4px 10px;font-size:12px;background:#e91e63;color:#fff;border:none;border-radius:4px;cursor:pointer;";
    allBtn.addEventListener("click", fillAll);
    bar.appendChild(allBtn);
    document.body.appendChild(bar);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createBar);
  } else {
    createBar();
  }
})();
