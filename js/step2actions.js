jQuery(document).ready(function () {
  // Loansum/loantime START
  document.getElementById("slider-loansum").oninput = function () {
    loansumamount = parseInt(document.getElementById("slider-loansum").value);
    if (loansumamount >= 500) {
      if (jQuery("#slider-lt").attr("min") !== "12") {
        jQuery("#slider-lt").attr({
          max: 96,
          min: 12,
        });
        document.getElementById("slider-lt").value = 12;
        jQuery("#slider-lt").trigger("input");
      }
    } else {
      if (jQuery("#slider-lt").attr("min") !== "7") {
        jQuery("#slider-lt").attr({
          max: 33,
          min: 7,
        });
        document.getElementById("slider-lt").value = 33;
        jQuery("#slider-lt").trigger("input");
      }
    }
    if (loansumamount > 5000) {
      if (loansumamount % 1000 !== 0) {
        loansumamount = Math.round(loansumamount / 1000) * 1000;
        document.getElementById("slider-loansum").value = loansumamount;
        jQuery("#slider-loansum").trigger("change");
      }
    }
    // Update the meses and días depend on the loansum
    let selectLtimeOptions = document.getElementById("number-lt");
    selectLtimeOptions.innerHTML = "";

    let minTime = loansumamount >= 500 ? 12 : 7;
    let maxTime = loansumamount >= 500 ? 96 : 33;
    let timeUnit = loansumamount >= 500 ? "meses" : "días";

    for (let i = minTime; i <= maxTime; i++) {
      let option = document.createElement("option");
      option.value = i;
      option.text = i + " " + timeUnit;
      selectLtimeOptions.add(option);
    }
    // Set the value of the <select> to match the slider's current value
    selectLtimeOptions.value = document.getElementById("slider-lt").value;
    jQuery("#slider-lt").trigger("input");
    jQuery("#number-loansum").val(loansumamount);
    document.getElementById("number-loansum").value = parseInt(
      document.getElementById("slider-loansum").value
    );
  };
  document.getElementById("slider-lt").oninput = function () {
    document.getElementById("number-lt").value = this.value;
  };
  /* // Hide the nav in the grid form
    jQuery("#masthead").hide(); */
  jQuery('select[name="number-loansum"]').on("change", function () {
    jQuery("#slider-loansum").val(parseInt(jQuery(this).val()));
    jQuery("#slider-loansum").trigger("input");
  });
  jQuery("#number-lt").on("change", function () {
    jQuery("#slider-lt").val(parseInt(jQuery(this).val()));
    jQuery("#slider-lt").trigger("input");
  });
  // Loansum/loantime END

  function displayEmploymentType() {
    const employment = jQuery('select[name="employment_type"]');

    if (
      employment.val() == "7" ||
      employment.val() == "9" ||
      employment.val() == "10"
    ) {
      jQuery(".workdependant").hide();
    } else {
      jQuery(".workdependant").show();
    }

    if (employment.val() == "2") {
      jQuery(".worktemporary").show();
    } else {
      jQuery(".worktemporary").hide();
    }
  }
  jQuery('select[name="employment_type"]').on("change", displayEmploymentType);
  displayEmploymentType();

  function displaySourceOfWealth() {
    const sourceOfWealth = jQuery('select[name="source_of_wealth"]');
    if (sourceOfWealth.val() == "6") {
      jQuery(".source_of_wealth_visibility").show();
    } else {
      jQuery(".source_of_wealth_visibility").hide();
    }
  }
  jQuery('select[name="source_of_wealth"]').on("change", displaySourceOfWealth);
  displaySourceOfWealth();

  function displayActiveLoans() {
    const activeLoans = jQuery('select[name="active_loans_pending"]');
    if (activeLoans.val() == "0") {
      jQuery(".activecreditsependant").hide();
    } else {
      jQuery(".activecreditsependant").show();
    }
  }
  jQuery('select[name="active_loans_pending"]').on(
    "change",
    displayActiveLoans
  );
  displayActiveLoans();

  function displayVehicleLoan() {
    const vehicletype = jQuery("#vehicle_type").val();
    const province_id = jQuery("#province-select").val();
    if (
      vehicletype < 2 ||
      province_id == "44" ||
      province_id == "13" ||
      province_id == "50"
    ) {
      jQuery("#vehicleloanquestion").hide();
      jQuery("#platenumber").hide();
      jQuery("#car_km").hide();
    } else {
      jQuery("#vehicleloanquestion").show();
      if (jQuery("#vehicleloan_yes:checked").val()) {
        jQuery("#platenumber").show();
        jQuery("#car_km").show();
      }
    }
  }
  jQuery("#province-select").on("change", displayVehicleLoan);
  jQuery("#vehicle_type").on("change", displayVehicleLoan);
  displayVehicleLoan();

  function displayInterestedInVehicleLoan() {
    if (
      jQuery('input[name="interested_in_vehicle_loan"]:checked').val() ===
      "true"
    ) {
      jQuery("#platenumber").show();
      jQuery("#car_km").show();
    } else {
      jQuery("#platenumber").hide();
      jQuery("#car_km").hide();
    }
  }
  jQuery('input[name="interested_in_vehicle_loan"]').on(
    "change",
    displayInterestedInVehicleLoan
  );
  displayInterestedInVehicleLoan();

  jQuery("#day_of_birth").on("change", function () {
    jQuery("#sendsteptwo").validate().element(this);
  });
  jQuery("#month_of_birth").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#day_of_birth");
  });
  jQuery("#year_of_birth").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#day_of_birth");
  });
  jQuery("#work_start_date_day").on("change", function () {
    jQuery("#sendsteptwo").validate().element(this);
  });
  jQuery("#work_start_date_month").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#work_start_date_day");
  });
  jQuery("#work_start_date_year").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#work_start_date_day");
  });
  jQuery("#work_end_date_day").on("change", function () {
    jQuery("#sendsteptwo").validate().element(this);
  });
  jQuery("#work_end_date_month").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#work_end_date_day");
  });
  jQuery("#work_end_date_year").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#work_end_date_day");
  });
  jQuery("#payday_date_day").on("change", function () {
    jQuery("#sendsteptwo").validate().element(this);
  });
  jQuery("#payday_date_month").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#payday_date_day");
  });
  jQuery("#payday_date_year").on("change", function () {
    jQuery("#sendsteptwo").validate().element("#payday_date_day");
  });

  let currentStep = 1;
  let sentStep = 0;
  let sections = jQuery(".form-section");
  const apiApplication = jQuery("#api-application").val() == "true";
  const totalSteps = sections.length;
  const initialProgressPercent = 15;
  const loadingIcon = jQuery(".loading-icon");

  // Show the slider only in step1
  function updateSliderArea() {
    if (currentStep === 1) {
      jQuery(".slider-area").show();
    } else {
      jQuery(".slider-area").hide();
    }
  }

  const prefilledSteps = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: false,
  };

  async function handleContinueEvent(event) {
    const startingStep = currentStep;
    if (event) {
      event.preventDefault();
    }

    if (currentStep > sentStep) {
      sentStep = currentStep;
      try {
        ConsentManager.instance().gtm_publish_with_consents(
          "event",
          "step2_section_" + currentStep,
          {
            section: currentStep,
          }
        );
      } catch (e) {}
    }

    // Organic applicants just require validation
    if (!apiApplication) {
      const validation = jQuery("#sendsteptwo").valid();
      if (!validation) {
        return;
      }

      incrementStep(1);
      updateStepSection(false);

      return;
    }

    // API applicants are eligible for prefill
    let validationErrorOccurred = false;
    for (step in prefilledSteps) {
      if (currentStep > step) {
        continue;
      }
      if (currentStep < step) {
        break;
      }

      const validation = jQuery("#sendsteptwo").valid();

      if (prefilledSteps[step]) {
        jQuery("#sendsteptwo")
          .find("input, select")
          .each(function (index, element) {
            const parsedElement = jQuery(element);
            if (!parsedElement) {
              return;
            }

            const value = parsedElement.val();
            if (value && value !== "") {
              parsedElement.addClass("has-success");
            } else {
              parsedElement.addClass("has-warning");
            }
          });

        jQuery(".invalid-field").each(function (index, element) {
          const parsedElement = jQuery(element);
          parsedElement.addClass("has-warning");
          parsedElement.text("Complete este campo.");
        });
      }

      prefilledSteps[step] = false;

      if (!validation) {
        validationErrorOccurred = true;
        break;
      }

      incrementStep(1);

      const autoContinue = prefilledSteps[currentStep];
      if (!autoContinue) {
        break;
      }
    }

    if (startingStep !== currentStep) {
      updateStepSection(validationErrorOccurred);
    }
  }

  async function incrementStep(step) {
    sections.eq(currentStep - 1).hide();
    currentStep = currentStep + step;
    sections.eq(currentStep - 1).show();
  }

  async function updateStepSection(validationErrorOccurred) {
    loadingIcon.addClass("active");

    // Dont double animate on validation error
    if (!validationErrorOccurred) {
      const stepContainerTop = jQuery(".step-container").offset().top - 40;
      jQuery("html, body").animate({ scrollTop: stepContainerTop }, "slow");
    }

    setTimeout(function () {
      updateSliderArea();

      jQuery(".previous-button").show();

      const enableSubmit = currentStep !== totalSteps;
      jQuery("#form-submit").prop("disabled", enableSubmit);

      const progressPercent =
        initialProgressPercent +
        (currentStep - 1) * ((120 - initialProgressPercent) / totalSteps);
      jQuery(".step-progress").css("width", progressPercent + "%");
      jQuery(".progress-percent").text(progressPercent.toFixed(0) + "%");

      for (let step = 0; step < currentStep; step++) {
        jQuery(".step").eq(step).addClass("completed");
      }
      loadingIcon.removeClass("active");
    }, 1000);
  }

  jQuery(".continue-button").click(handleContinueEvent);

  jQuery(".previous-button").click(function (event) {
    event.preventDefault();
    let stepContainerTop = jQuery(".step-container").offset().top - 40;
    jQuery("html, body").animate({ scrollTop: stepContainerTop }, "slow");
    loadingIcon.addClass("active");
    setTimeout(function () {
      loadingIcon.removeClass("active");
      if (currentStep > 1) {
        incrementStep(-1);
        updateSliderArea();
        jQuery("#form-submit").prop("disabled", true);
        jQuery(".continue-button").show();
        const progressPercent =
          initialProgressPercent +
          (currentStep - 1) * ((120 - initialProgressPercent) / totalSteps);
        jQuery(".step-progress").css("width", progressPercent + "%");
        jQuery(".progress-percent").text(progressPercent.toFixed(0) + "%");
        jQuery(".step").eq(currentStep).removeClass("completed");
      }
    }, 1000);
  });

  function displayNationality() {
    const val = jQuery("input[name=spanish]:checked").val();

    if (val === "true") {
      jQuery("#spanish_no").hide("slow");
    } else if (val == undefined) {
      jQuery("#spanish_no").hide();
    } else {
      jQuery("#spanish_no").show("slow");
    }
  }
  jQuery("input[name=spanish]").on("change", displayNationality);
  displayNationality();

  function displayEmploymentYes() {
    const employment = jQuery("select[name=employment_type]")
      .children("option:selected")
      .val();
    if (
      employment == "1" ||
      employment == "2" ||
      employment == "3" ||
      employment == "5" ||
      employment == "5" ||
      employment == "6" ||
      employment == "11" ||
      employment == "12"
    ) {
      jQuery("#employment_yes").show("slow");
    } else {
      jQuery("#employment_yes").hide("slow");
    }
  }
  jQuery("select[name=employment_type]").on("change", displayEmploymentYes);
  displayEmploymentYes();

  jQuery.validator.addMethod(
    "validateName",
    function (a, b, c) {
      let nimi = jQuery(b).val();
      if (nimi.length < 3) {
        return false;
      }
      let re =
        /^(([A-Za-z¡ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝWÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿOEoeŠšŸŽžƒśźż -]+$))$/;
      return re.test(nimi);
    },
    "No válido."
  );

  jQuery.validator.addMethod(
    "validateID",
    function (a, b, c) {
      let idcode = jQuery(b).val();
      if (!validateDNI(idcode) && !validateNIE(idcode)) {
        return false;
      }
      return true;
    },
    "DNI/NIE no válido."
  );

    jQuery.validator.addMethod(
        "validatePostal",
        function (a, b, c) {
          const regnr = jQuery(b)
            .val()
            .replace(/[^0-9]/g, "");
          jQuery(b).val(regnr);
          if (regnr.length != 5) {
            return false;
          }
          return true;
        },
        "El código postal es incorrecto (5 dígitos)"
    );
  jQuery.validator.addMethod(
    "validateBDate",
    function (a, b, c) {
      let pvm = jQuery(b).val();
      let re =
        /^((0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/(19[0-9]{2}|20[0-2][0-9]))$/;
      return re.test(pvm);
    },
    "No válido."
  );

  jQuery.validator.addMethod(
    "validateAge",
    function (a, b, params) {
      let birthDay = jQuery(b).val();
      let birthMonth = parseInt(jQuery(params.month).val());
      let birthYear = parseInt(jQuery(params.year).val());
      if (!birthDay || !birthMonth || !birthYear) {
        return true;
      }
      birthMonth--;
      let now = new Date();
      let NowYear = now.getFullYear();
      let NowMonth = now.getMonth();
      let NowDay = now.getDate();
      let age = NowYear - birthYear;
      let ageMonth = NowMonth - birthMonth;
      let ageDay = NowDay - birthDay;
      if (ageMonth < 0 || (ageMonth == 0 && ageDay < 0)) {
        age = parseInt(age) - 1;
      }
      return age > 17;
    },
    "Solo mayores de 18 años."
  );

  jQuery.validator.addMethod(
    "validateDate",
    function (a, b, c) {
      let pvm = jQuery(b).val();
      let re =
        /^((0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/(19[0-9]{2}|20[0-2][0-9]))$/;
      if (!re.test(pvm)) {
        return false;
      }
      let now = new Date();
      let dateParts = pvm.split("/");
      let myDate = new Date(dateParts[2], dateParts[1] - 1, dateParts[0]);
      return now > myDate;
    },
    "No válido."
  );

  jQuery.validator.addMethod(
    "isFutureDate",
    function (a, b, params) {
      let day = jQuery(b).val();
      let month = parseInt(jQuery(params.month).val());
      let year = parseInt(jQuery(params.year).val());
      if (!day || !month || !year) {
        return true;
      }
      let now = new Date();
      let myDate = new Date(year, month - 1, day);
      return myDate > now;
    },
    "La fecha no puede ser en pasado."
  );

  jQuery.validator.addMethod(
    "isPastDate",
    function (a, b, params) {
      let day = jQuery(b).val();
      let month = parseInt(jQuery(params.month).val());
      let year = parseInt(jQuery(params.year).val());
      if (!day || !month || !year) {
        return true;
      }
      let now = new Date();
      let myDate = new Date(year, month - 1, day);
      return myDate < now;
    },
    "La fecha no puede ser en futuro."
  );

  jQuery.validator.addMethod(
    "validateESIBAN",
    function (a, b, c) {
      let iban = jQuery(b).val().replace(/ /g, "").toUpperCase(),
        ibancheckdigits = "",
        leadingZeroes = true,
        cRest = "",
        cOperator = "",
        countrycode,
        ibancheck,
        charAt,
        cChar,
        bbanpattern,
        bbancountrypatterns,
        i,
        p;
      let ibanregexp =
        /^((ES)?(\d\d)?(?:-)?(\d{4,4})(?:-)?(\d{4,4})(?:-)?(\d{2,2})(?:-)?(\d{10,10})$)$/;
      if (!ibanregexp.test(iban)) {
        return false; // Invalid country specific format
      }
      // Now check the checksum, first convert to digits
      ibancheck = iban.substring(4, iban.length) + iban.substring(0, 4);
      for (i = 0; i < ibancheck.length; i++) {
        charAt = ibancheck.charAt(i);
        if (charAt !== "0") {
          leadingZeroes = false;
        }
        if (!leadingZeroes) {
          ibancheckdigits += "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(
            charAt
          );
        }
      }
      // Calculate the result of: ibancheckdigits % 97
      for (p = 0; p < ibancheckdigits.length; p++) {
        cChar = ibancheckdigits.charAt(p);
        cOperator = "" + cRest + "" + cChar;
        cRest = cOperator % 97;
      }
      return cRest === 1;
    },
    "IBAN español no válido.<span class='vinkki error-vinkki' title='Comprueba que has introducido correctamente tu IBAN. Ha de ser una cuenta española, y contiene 24 caracteres, empezando por las letras \"ES\"'><span class='question' title=''></span>"
  );

  jQuery.validator.addMethod(
    "isValidDay",
    function (a, b, params) {
      let day = jQuery(b).val();
      let month = parseInt(jQuery(params.month).val());
      let year = parseInt(jQuery(params.year).val());
      if (!month || !year) {
        return true;
      }
      let date = new Date(year, month - 1, day);
      return (
        date.getFullYear() == year &&
        date.getMonth() == month - 1 &&
        date.getDate() == day
      );
    },
    "No válido."
  );

  jQuery.extend(jQuery.validator.messages, {
    required: "Campo obligatorio.",
    digits: "Sólo números.",
  });

  jQuery("#sendsteptwo").validate({
    errorPlacement: function (a, b) {
      if (jQuery(b).is(":radio")) {
        a.insertAfter(b.parent().last());
      } else {
        a.insertAfter(b);
      }
    },
    invalidHandler: function (event, validator) {
      let errors = validator.numberOfInvalids();
      if (errors) {
        jQuery("html, body").animate(
          {
            scrollTop:
              jQuery(validator.errorList[0].element).parent().offset().top - 90,
          },
          1500
        );
      }
    },
    focusInvalid: !1,
    focusCleanup: true,
    ignore:
      ":not(select:visible, input:visible, input[type=checkbox]:visible, input[type=radio]:visible)",
    errorElement: "span",
    errorClass: "invalid-field",
    validClass: "has-success",
    highlight: function (element, errorClass, validClass) {
      const fetchedElement = jQuery(element);
      fetchedElement.removeClass(validClass);
      fetchedElement.removeClass("has-warning");

      if (errorClass === "invalid-field") {
        fetchedElement.addClass("has-error");
      } else {
        fetchedElement.addClass(errorClass);
      }

      const warningId =
        fetchedElement.attr("name") ??
        fetchedElement.attr("id") ??
        element.name ??
        element.id;

      if (warningId) {
        const warningElement = jQuery("#" + warningId + "-error");
        if (warningElement) {
          warningElement.removeClass("has-warning");
        }
      }
    },
    unhighlight: function (element, errorClass, validClass) {
      const fetchedElement = jQuery(element);
      fetchedElement.removeClass("has-error");
      fetchedElement.removeClass("has-warning");
      fetchedElement.addClass(validClass);

      const warningId =
        fetchedElement.attr("name") ??
        fetchedElement.attr("id") ??
        element.name ??
        element.id;

      if (!warningId) {
        const warningElement = jQuery("#" + warningId + "-error");
        if (warningElement) {
          warningElement.removeClass("has-warning");
        }
      }
    },
    errorPlacement: function (error, element) {
      if (
        element.attr("type") == "radio" ||
        element.attr("type") == "checkbox"
      ) {
        error.appendTo(element.closest("div.dm-cols-1"));
      } else {
        error.insertAfter(element);
      }
    },
    rules: {
      loan_reason: {
        required: true,
      },
      gender: {
        required: true,
      },
      first_name: {
        required: true,
        validateName: true,
      },
      last_name: {
        required: true,
        validateName: true,
      },
      day_of_birth: {
        required: true,
        isValidDay: {
          month: "#month_of_birth",
          year: "#year_of_birth",
        },
        validateAge: {
          month: "#month_of_birth",
          year: "#year_of_birth",
        },
      },
      month_of_birth: {
        required: true,
      },
      year_of_birth: {
        required: true,
      },
      marital_status: {
        required: true,
      },
      children: {
        required: true,
      },
      education: {
        required: true,
      },
      // section2
      street: {
        required: true,
      },
      house_number: {
        required: true,
      },
      flat_number: {
        required: true,
      },
      city: {
        required: true,
      },
      zip: {
        required: true,
        validatePostal: true
      },
      county: {
        required: true,
      },
      type_of_street: {
        required: true,
      },
      home_ownership_type: {
        required: true,
      },
      spanish: {
        required: true,
      },
      nationality: {
        required: true,
      },
      id_code: {
        required: true,
        validateID: true,
      },
      // section3
      employment_type: {
        required: true,
      },
      employment_position: {
        required: true,
      },
      company_name: {
        required: true,
      },
      work_start_date_day: {
        required: true,
        isValidDay: {
          month: "#work_start_date_month",
          year: "#work_start_date_year",
        },
        isPastDate: {
          month: "#work_start_date_month",
          year: "#work_start_date_year",
        },
      },
      work_start_date_month: {
        required: true,
      },
      work_start_date_year: {
        required: true,
      },
      work_end_date_day: {
        required: true,
        isValidDay: {
          month: "#work_end_date_month",
          year: "#work_end_date_year",
        },
        isFutureDate: {
          month: "#work_end_date_month",
          year: "#work_end_date_year",
        },
      },
      work_end_date_month: {
        required: true,
      },
      work_end_date_year: {
        required: true,
      },
      payday_date_day: {
        required: true,
        isValidDay: {
          month: "#payday_date_month",
          year: "#payday_date_year",
        },
        isFutureDate: {
          month: "#payday_date_month",
          year: "#payday_date_year",
        },
      },
      payday_date_month: {
        required: true,
      },
      payday_date_year: {
        required: true,
      },
      company_sector: {
        required: true,
      },
      income: {
        required: true,
        digits: true,
      },
      expenses: {
        required: true,
        digits: true,
      },
      accomodation_monthly_cost: {
        required: true,
        digits: true,
      },
      source_of_wealth: {
        required: true,
        // forced select already
      },
      source_of_wealth_text: {
        required: true,
      },
      bank_account_number: {
        required: true,
        validateESIBAN: true,
      },
      // section 4
      active_loans_pending: {
        required: true,
        // forced select already
      },
      active_loans_borrower: {
        required: true,
      },
      active_loans_amount: {
        required: true,
        digits: true,
      },
      active_loans_pending_months: {
        required: true,
        digits: true,
      },
      vehicle_type: {
        required: true,
      },
      interested_in_vehicle_loan: {
        required: true,
      },
      license_plate_number: {
        required: true,
      },
      car_km: {
        required: true,
      },
      pep: {
        required: true,
        // force-checked already
      },
      bad_credit_records: {
        required: true,
      },
      interested_in_mortgage: {
        required: true,
      },
      interested_in_insurance: {
        required: true,
      },
      interested_in_creditcard: {
        required: true,
      },
      palvelukuvaus: {
        // required: true
      },
      confirmo: {
        required: true,
      },
    },
    submitHandler: function (form, event) {
      event.preventDefault();

      // Make sure there's no step skipping
      if (!jQuery("#pasocinco").is(":visible")) {
        currentStep = 1;
        updateStepSection(false);

        for (section of sections) {
          jQuery(section).hide();
        }
        sections.eq(currentStep).show();

        return false;
      }

      jQuery(".submit-button").prop("disabled", true);

      jQuery(".loading-icon").addClass("active");

      let formData = jQuery(form)
        .serializeArray()
        .reduce(function (obj, item) {
          obj[item.name] = item.value;
          return obj;
        }, {});

      let responseData = [];
      let lastDataPos = 0;

      jQuery
        .ajax({
          url: "/wp-admin/admin-ajax.php",
          type: "post",
          data: {
            action: "send_second_step",
            data: formData,
          },
        })
        .fail(function (data) {
          setTimeout(function () {
            jQuery(".form-submit").prop("disabled", false);
            jQuery(".loading-icon").removeClass("active");
            window.location.replace("https://www.financiar24.es/gracias/");
          }, 500);
        })
        .done(function (data) {
          try {
            if (data.parameters) {
              ConsentManager.instance().gtm_publish_with_consents(
                "event",
                "generate_lead",
                data.parameters
              );
            }
          } catch (e) {}
          setTimeout(
            function (url) {
              jQuery(".loading-icon").removeClass("active");
              if (
                typeof url === "string" &&
                (url.startsWith("http:") ||
                  url.startsWith("https:") ||
                  url.startsWith("/"))
              ) {
                window.location.replace(url);
              } else {
                window.location.replace(
                  "https://www.financiar24.es/gracias/?rdf=ef1"
                );
              }
            },
            1000,
            data.url
          );
        });
    },
  });

  try {
    ConsentManager.instance().gtm_publish_with_consents(
      "event",
      "step2_start",
      { variation: "originalform" }
    );
  } catch (e) {}

  if (apiApplication) {
    handleContinueEvent();
  }

  let isFormChanged = false;
  jQuery("input, select, textarea").on("change", function () {
    isFormChanged = true;
  });

  function warnBeforeUnload(event) {
    if (isFormChanged) {
      const message =
        "Tienes cambios sin guardar. ¿Estás seguro de que quieres salir de esta página?";
      event.preventDefault();
      event.returnValue = message;
      return message;
    }
  }

  jQuery(window).on("beforeunload", warnBeforeUnload);
  jQuery("form").on("submit", function () {
    jQuery(window).off("beforeunload", warnBeforeUnload);
  });

  if (window?.clarity) {
    let formType = "autocompleteless";
    if (apiApplication) {
      formType = "autocompleteless-api";
    }
    window.clarity("set", "draivi_form_type", formType);
  }
});

function validateDNI(idcode) {
  idcode = String(idcode || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  let dnire = /^(\d{8})([A-Z])$/;
  if (dnire.test(idcode) == false) {
    return false;
  }
  return validDNI(idcode);
}

function validateNIE(idcode) {
  idcode = String(idcode || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  let niere = /^[XYZ]\d{7,8}[A-Z]$/;
  if (niere.test(idcode) == false) {
    return false;
  }

  let nie_prefix = idcode.charAt(0);
  switch (nie_prefix) {
    case "X":
      nie_prefix = 0;
      break;
    case "Y":
      nie_prefix = 1;
      break;
    case "Z":
      nie_prefix = 2;
      break;
  }
  return validDNI(nie_prefix + idcode.substr(1));
}

function validDNI(dni) {
  let dni_letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  let numericPart = String(dni || "").slice(0, -1);
  let controlLetter = String(dni || "").slice(-1);
  let letter = dni_letters.charAt(parseInt(numericPart, 10) % 23);
  return letter == controlLetter;
}

function space(str) {
  if (!str) {
    return false;
  }
  if (str.length > 1 && str.substr(0, 2) != "ES") {
    return false;
  }
  if (str.length > 2) {
    str = "ES" + str.substr(2).replace(/[^\d]/g, "");
  }
  let after = 4;
  let v = str.replace(/[^\dA-Z]/g, ""),
    reg = new RegExp(".{" + after + "}", "g");
  return v.replace(reg, function (a) {
    return a + " ";
  });
}

let el = document.getElementById("iban");
if (el != null) {
  el.addEventListener("keyup", function () {
    let key = event.keyCode || event.charCode;
    if (key !== 8 && key !== 46) {
      let ibanvalue = space(this.value);
      if (ibanvalue != false) {
        this.value = ibanvalue;
      } else {
        this.value = "ES";
      }
    }
  });
}

jQuery(function () {
  let checkboxes = ["confirmocheck", "personal", "pkcheck"];

  jQuery.each(checkboxes.slice().reverse(), function (__, id) {
    // Select the checkbox by ID and check if it exists in the DOM
    const checkbox = jQuery(`#${id}`);
    if (!checkbox.length) {
      // Find the index of the item and splice it from the original array
      const index = checkboxes.indexOf(id);
      if (index > -1) {
        checkboxes.splice(index, 1); // Remove the element at the found index
      }
    }
  });

  jQuery("#all, #select-all").on("click", function () {
    let isChecked = false;

    if (jQuery(this).is(":checked")) {
      isChecked = true;
    }

    checkboxes.forEach((id) => {
      jQuery(`#${id}`).prop("checked", isChecked);
      jQuery(`#${id}`).removeClass("not-checked");
      if (jQuery(`#${id}`).siblings().hasClass("invalid-field")) {
        jQuery(`#${id}`).siblings(".invalid-field").remove();
      }
    });
  });

  checkboxes.forEach((id) => {
    jQuery(`#${id}`).on("change", function () {
      const allChecked = checkboxes.every((checkboxId) =>
        jQuery(`#${checkboxId}`).is(":checked")
      );

      if (allChecked) {
        jQuery("#all").prop("checked", true).prop("indeterminate", false); // Set "Check All" to checked
      } else {
        const someChecked = checkboxes.some((checkboxId) =>
          jQuery(`#${checkboxId}`).is(":checked")
        );
        jQuery("#all")
          .prop("indeterminate", someChecked)
          .prop("checked", false);
      }
    });
  });

  jQuery("#modal-launcher-personal-data").on("click", function (event) {
    event.preventDefault();
    jQuery("#modal-background-general, #modal-content-general").addClass(
      "modal-active"
    );
    jQuery("#general-content").load("/terms/personal-data.html");
  });
});

jQuery(function () {
  jQuery("#modal-launcher-tickbox, #modal-background-tickbox").click(function (
    e
  ) {
    e.preventDefault();
    jQuery("#modal-content-tickbox, #modal-background-tickbox").toggleClass(
      "modal-active"
    );
  });
});
jQuery(function () {
  jQuery("#modal-close-tickbox").click(function (e) {
    e.preventDefault();
    jQuery("#modal-content-tickbox, #modal-background-tickbox").toggleClass(
      "modal-active"
    );
    jQuery("#confirmocheck").prop("checked", true);
  });
});
jQuery(function () {
  jQuery(".dm-input-blurfield").on("blur", function () {
    if (jQuery(this).siblings(".dm-input-info").is(":visible")) {
      jQuery(this).siblings(".dm-input-info").hide();
      jQuery(this).siblings(".dm-input-info").addClass("fromblurvisible");
    } else {
      jQuery(this).siblings(".dm-input-info").removeClass("fromblurvisible");
    }
  });
  jQuery(".dm-label-info-icon").on("click", function () {
    if (jQuery(this).siblings(".dm-input-info").hasClass("fromblurvisible")) {
      jQuery(this).siblings(".dm-input-info").hide();
    } else {
      jQuery(this).siblings(".dm-input-info").toggle();
    }
    jQuery(this).siblings(".dm-input-info").removeClass("fromblurvisible");
  });
  jQuery(".dm-input-info").on("click", function () {
    jQuery(this).hide();
    jQuery(this).siblings(".dm-input-info").removeClass("fromblurvisible");
  });
});

function applicant_age_in_years() {
  let day_of_birth = jQuery("#day_of_birth").val();
  let month_of_birth = jQuery("#month_of_birth").val();
  let year_of_birth = jQuery("#year_of_birth").val();
  let current_date = new Date();
  let current_day = current_date.getDate();
  let current_month = current_date.getMonth() + 1;
  let current_year = current_date.getFullYear();

  if (day_of_birth && month_of_birth && year_of_birth) {
    let age = current_year - year_of_birth;
    if (
      current_month < month_of_birth ||
      (current_month == month_of_birth && current_day < day_of_birth)
    ) {
      age--;
    }
    return age;
  }
  return 0;
}
