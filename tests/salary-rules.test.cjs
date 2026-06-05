const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enforceMinimumSalary,
  applySalaryRules,
  SALARY_OPTIONS
} = require("../js/salary-rules.js");

test("enforceMinimumSalary leaves salary unchanged when it is already 1300+", () => {
  const result = enforceMinimumSalary(1450, { randomSalaryFn: () => 0 });

  assert.equal(result.salary, 1450);
  assert.equal(result.adjusted, false);
  assert.equal(result.added, 0);
});

test("enforceMinimumSalary raises salary below 1300 to a 50-step value from 1300 to 2000", () => {
  const result = enforceMinimumSalary(1200, { randomSalaryFn: () => 0 });

  assert.equal(result.salary, 1300);
  assert.equal(result.adjusted, true);
  assert.equal(result.added, 100);
  assert.equal(SALARY_OPTIONS.includes(result.salary), true);
});

test("applySalaryRules applies minimum salary first and then the budget formula", () => {
  const result = applySalaryRules(
    1200,
    400,
    300,
    200,
    1000,
    {
      randomSalaryFn: () => 0,
      randomBudgetExtraFn: () => 0
    }
  );

  assert.equal(result.minimumApplied, true);
  assert.equal(result.budgetApplied, true);
  assert.equal(result.salary, 2300);
  assert.equal(result.minAdded, 100);
  assert.equal(result.budgetAdded, 1000);
  assert.equal(result.totalAdded, 1100);
});

test("applySalaryRules keeps salary after the 1300+ rule when budget is already sufficient", () => {
  const result = applySalaryRules(
    1250,
    200,
    100,
    50,
    1000,
    {
      randomSalaryFn: () => 0
    }
  );

  assert.equal(result.minimumApplied, true);
  assert.equal(result.budgetApplied, false);
  assert.equal(result.salary, 1300);
});
