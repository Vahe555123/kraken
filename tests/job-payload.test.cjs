const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "../js/job-payload.js"), "utf8");

function createPayloadSandbox() {
  const sandbox = {
    console,
    Date,
    Math,
    window: null,
    localStorage: {
      getItem: () => null
    },
    location: {
      search: ""
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "job-payload.js" });
  return sandbox;
}

function buildPayload(answers) {
  const sandbox = createPayloadSandbox();
  return {
    payload: sandbox.buildJobPayloadFromForm(answers, {
      email: "cliente@example.com",
      phone: "+34 600000000"
    }),
    validate: sandbox.validateComprehensiveJobPayload
  };
}

test("Desempleado substitution includes next payroll date", () => {
  const { payload, validate } = buildPayload({
    "Monthly Amount": "1000",
    "Plazo": "12",
    "Tipo ingresos": "Desempleado",
    "Salario Neto Mensual": "1200",
    "Mensualidad en Alquiler/Hipoteca": "100",
    "Otros gastos mensuales fijos": "50",
    "Otras Fuentes de Ingresos": "Ninguna",
    "Cuenta Bancaria (IBAN)": "ES9121000418450200051332"
  });

  assert.equal(payload.income.incomeType, "Trabajo Fijo");
  assert.equal(typeof payload.income.nextPayrollDate.day, "number");
  assert.equal(typeof payload.income.nextPayrollDate.year, "number");
  assert.equal(typeof payload.income.nextPayrollDate.month, "string");
  assert.equal(validate(payload).missing.includes("income.nextPayrollDate"), false);
});

test("other income values mapped to Otros keep the selected text as reason", () => {
  const { payload, validate } = buildPayload({
    "Monthly Amount": "1000",
    "Plazo": "12",
    "Tipo ingresos": "Trabajo Fijo",
    "Nombre de la Empresa": "Empresa Test",
    "Fecha de inicio del Contrato": "01 Enero 2022",
    "Sector del Contrato": "Finanzas",
    "Próximo día de pago de su Nómina": "20 Abril 2026",
    "Salario Neto Mensual": "1800",
    "Mensualidad en Alquiler/Hipoteca": "100",
    "Otros gastos mensuales fijos": "50",
    "Otras Fuentes de Ingresos": "Herencia",
    "Cuenta Bancaria (IBAN)": "ES9121000418450200051332"
  });

  assert.equal(payload.income.otherIncomeSources, "Otros");
  assert.equal(payload.income.otherIncomeSourcesReason, "Herencia");
  assert.equal(validate(payload).missing.includes("income.otherIncomeSourcesReason"), false);
});
