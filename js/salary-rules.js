(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.SalaryRules = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this,
  function () {
    "use strict";

    var MIN_NET_SALARY = 1300;
    var MAX_RANDOM_NET_SALARY = 2000;
    var SALARY_STEP = 50;
    var BUDGET_EXTRA_OPTIONS = [400, 450, 500, 550, 600];

    function toInt(value) {
      var parsed = parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function roundTo50(value) {
      return Math.round((value || 0) / SALARY_STEP) * SALARY_STEP;
    }

    function buildSalaryOptions() {
      var values = [];
      for (var salary = MIN_NET_SALARY; salary <= MAX_RANDOM_NET_SALARY; salary += SALARY_STEP) {
        values.push(salary);
      }
      return values;
    }

    var SALARY_OPTIONS = buildSalaryOptions();

    function pickRandomFromList(values, randomFn) {
      if (!Array.isArray(values) || values.length === 0) return 0;
      var rand = typeof randomFn === "function" ? randomFn() : Math.random();
      var normalized = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 0.9999999999) : Math.random();
      return values[Math.floor(normalized * values.length)];
    }

    function enforceMinimumSalary(salary, options) {
      var currentSalary = toInt(salary);
      if (currentSalary <= 0) {
        return {
          salary: currentSalary,
          originalSalary: currentSalary,
          added: 0,
          adjusted: false
        };
      }

      if (currentSalary >= MIN_NET_SALARY) {
        return {
          salary: currentSalary,
          originalSalary: currentSalary,
          added: 0,
          adjusted: false
        };
      }

      var nextSalary = pickRandomFromList(
        SALARY_OPTIONS,
        options && typeof options.randomSalaryFn === "function" ? options.randomSalaryFn : null
      );

      return {
        salary: nextSalary,
        originalSalary: currentSalary,
        added: nextSalary - currentSalary,
        adjusted: nextSalary !== currentSalary
      };
    }

    function randomBudgetExtra(options) {
      return pickRandomFromList(
        BUDGET_EXTRA_OPTIONS,
        options && typeof options.randomBudgetExtraFn === "function" ? options.randomBudgetExtraFn : null
      );
    }

    function adjustSalaryForBudget(salary, monthlyLoanPayment, rentOrMortgage, otherExpenses, loanAmount, options) {
      var currentSalary = toInt(salary);
      if (currentSalary <= 0) {
        return {
          salary: currentSalary,
          originalSalary: currentSalary,
          added: 0,
          adjusted: false,
          budget: currentSalary
        };
      }

      var loan = toInt(monthlyLoanPayment);
      var rent = toInt(rentOrMortgage);
      var other = toInt(otherExpenses);
      var amount = toInt(loanAmount);
      var budget = currentSalary - (loan + rent + other);

      if (budget >= 500) {
        return {
          salary: currentSalary,
          originalSalary: currentSalary,
          added: 0,
          adjusted: false,
          budget: budget
        };
      }

      var targetBudget = amount + randomBudgetExtra(options);
      var nextSalary = roundTo50(loan + rent + other + targetBudget);

      return {
        salary: nextSalary,
        originalSalary: currentSalary,
        added: nextSalary - currentSalary,
        adjusted: nextSalary !== currentSalary,
        budget: budget
      };
    }

    function applySalaryRules(salary, monthlyLoanPayment, rentOrMortgage, otherExpenses, loanAmount, options) {
      var normalizedSalary = toInt(salary);
      if (normalizedSalary <= 0) {
        return {
          salary: normalizedSalary,
          originalSalary: normalizedSalary,
          minimumApplied: false,
          budgetApplied: false,
          minAdded: 0,
          budgetAdded: 0,
          totalAdded: 0,
          budgetBefore: normalizedSalary,
          budgetAfterMinimum: normalizedSalary
        };
      }

      var minimumResult = enforceMinimumSalary(normalizedSalary, options);
      var budgetResult = adjustSalaryForBudget(
        minimumResult.salary,
        monthlyLoanPayment,
        rentOrMortgage,
        otherExpenses,
        loanAmount,
        options
      );

      return {
        salary: budgetResult.salary,
        originalSalary: normalizedSalary,
        minimumApplied: minimumResult.adjusted,
        budgetApplied: budgetResult.adjusted,
        minAdded: minimumResult.added,
        budgetAdded: budgetResult.added,
        totalAdded: minimumResult.added + budgetResult.added,
        budgetBefore: normalizedSalary - (toInt(monthlyLoanPayment) + toInt(rentOrMortgage) + toInt(otherExpenses)),
        budgetAfterMinimum:
          minimumResult.salary - (toInt(monthlyLoanPayment) + toInt(rentOrMortgage) + toInt(otherExpenses))
      };
    }

    return {
      MIN_NET_SALARY: MIN_NET_SALARY,
      MAX_RANDOM_NET_SALARY: MAX_RANDOM_NET_SALARY,
      SALARY_STEP: SALARY_STEP,
      BUDGET_EXTRA_OPTIONS: BUDGET_EXTRA_OPTIONS.slice(),
      SALARY_OPTIONS: SALARY_OPTIONS.slice(),
      roundTo50: roundTo50,
      enforceMinimumSalary: enforceMinimumSalary,
      adjustSalaryForBudget: adjustSalaryForBudget,
      applySalaryRules: applySalaryRules
    };
  }
);
