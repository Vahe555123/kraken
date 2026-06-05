(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DniValidation = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this,
  function () {
    "use strict";

    var DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

    function normalize(value) {
      return String(value || "")
        .replace(/[\s-]/g, "")
        .toUpperCase();
    }

    function validDNI(dni) {
      var normalized = normalize(dni);
      if (!normalized || normalized.length < 2) return false;

      var numericPart = normalized.slice(0, -1);
      var controlLetter = normalized.slice(-1);
      var expectedLetter = DNI_LETTERS.charAt(parseInt(numericPart, 10) % 23);
      return expectedLetter === controlLetter;
    }

    function validateDNI(idcode) {
      var normalized = normalize(idcode);
      var dniPattern = /^(\d{8})([A-Z])$/;
      if (dniPattern.test(normalized) === false) {
        return false;
      }

      return validDNI(normalized);
    }

    function validateNIE(idcode) {
      var normalized = normalize(idcode);
      var niePattern = /^[XYZ]\d{7,8}[A-Z]$/;
      if (niePattern.test(normalized) === false) {
        return false;
      }

      var niePrefix = normalized.charAt(0);
      switch (niePrefix) {
        case "X":
          niePrefix = "0";
          break;
        case "Y":
          niePrefix = "1";
          break;
        case "Z":
          niePrefix = "2";
          break;
      }

      return validDNI(niePrefix + normalized.substr(1));
    }

    function checkSpanishID(idcode) {
      if (!validateDNI(idcode) && !validateNIE(idcode)) {
        return false;
      }

      return true;
    }

    function isValidSpanishDni(value) {
      return validateDNI(value);
    }

    function isValidSpanishNie(value) {
      return validateNIE(value);
    }

    function isValidDniNie(value) {
      return checkSpanishID(value);
    }

    return {
      DNI_LETTERS: DNI_LETTERS,
      normalize: normalize,
      validDNI: validDNI,
      validateDNI: validateDNI,
      validateNIE: validateNIE,
      checkSpanishID: checkSpanishID,
      isValidSpanishDni: isValidSpanishDni,
      isValidSpanishNie: isValidSpanishNie,
      isValidDniNie: isValidDniNie
    };
  }
);
