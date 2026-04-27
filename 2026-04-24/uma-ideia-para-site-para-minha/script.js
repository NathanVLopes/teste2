const STORAGE_KEY = "casa-clara-expenses";

const form = document.querySelector("#expense-form");
const amountInput = document.querySelector("#amount");
const categoryInput = document.querySelector("#category");
const customCategoryField = document.querySelector("#custom-category-field");
const customCategoryInput = document.querySelector("#custom-category");
const personInput = document.querySelector("#person");
const dateInput = document.querySelector("#date");
const noteInput = document.querySelector("#note");
const expenseIdInput = document.querySelector("#expense-id");
const cancelEditButton = document.querySelector("#cancel-edit");
const submitButton = document.querySelector("#submit-button");
const monthFilter = document.querySelector("#month-filter");
const expenseList = document.querySelector("#expense-list");
const categoryBreakdown = document.querySelector("#category-breakdown");
const template = document.querySelector("#expense-item-template");

const monthlyTotal = document.querySelector("#monthly-total");
const expenseCount = document.querySelector("#expense-count");
const largestExpense = document.querySelector("#largest-expense");
const heroTotal = document.querySelector("#hero-total");
const heroTopCategory = document.querySelector("#hero-top-category");
const heroLastEntry = document.querySelector("#hero-last-entry");

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function getTodayValue() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function createSeedData() {
  const now = new Date();
  const currentMonth = `${now.getMonth() + 1}`.padStart(2, "0");
  const currentYear = now.getFullYear();

  return [
    {
      id: crypto.randomUUID(),
      amount: 120.5,
      category: "Mercado",
      person: "Maria",
      date: `${currentYear}-${currentMonth}-05`,
      note: "Compra da semana",
      createdAt: Date.now() - 3000,
    },
    {
      id: crypto.randomUUID(),
      amount: 65,
      category: "Transporte",
      person: "Joao",
      date: `${currentYear}-${currentMonth}-08`,
      note: "Gasolina",
      createdAt: Date.now() - 2000,
    },
    {
      id: crypto.randomUUID(),
      amount: 220,
      category: "Contas",
      person: "Ana",
      date: `${currentYear}-${currentMonth}-12`,
      note: "Energia e internet",
      createdAt: Date.now() - 1000,
    },
  ];
}

function loadExpenses() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    const seed = createSeedData();
    saveExpenses(seed);
    return seed;
  }

  try {
    return JSON.parse(saved);
  } catch (error) {
    console.error("Erro ao ler gastos salvos", error);
    const seed = createSeedData();
    saveExpenses(seed);
    return seed;
  }
}

function saveExpenses(expenses) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

let expenses = loadExpenses();

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`;
}

function ensureDefaultMonth() {
  if (!monthFilter.value) {
    monthFilter.value = getCurrentMonthValue();
  }
}

function getFilteredExpenses() {
  ensureDefaultMonth();
  return expenses
    .filter((expense) => expense.date.startsWith(monthFilter.value))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.createdAt - a.createdAt);
}

function formatCurrency(value) {
  return currencyFormatter.format(value || 0);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`));
}

function resetForm() {
  form.reset();
  expenseIdInput.value = "";
  submitButton.textContent = "Salvar gasto";
  cancelEditButton.hidden = true;
  dateInput.value = getTodayValue();
  customCategoryField.hidden = true;
  customCategoryInput.required = false;
}

function fillForm(expense) {
  expenseIdInput.value = expense.id;
  amountInput.value = expense.amount;
  const existingOption = [...categoryInput.options].some((option) => option.value === expense.category);

  if (existingOption) {
    categoryInput.value = expense.category;
    customCategoryField.hidden = true;
    customCategoryInput.required = false;
    customCategoryInput.value = "";
  } else {
    categoryInput.value = "__custom__";
    customCategoryField.hidden = false;
    customCategoryInput.required = true;
    customCategoryInput.value = expense.category;
  }

  personInput.value = expense.person;
  dateInput.value = expense.date;
  noteInput.value = expense.note || "";
  submitButton.textContent = "Salvar alteracoes";
  cancelEditButton.hidden = false;
}

function syncCustomCategoryField() {
  const isCustom = categoryInput.value === "__custom__";
  customCategoryField.hidden = !isCustom;
  customCategoryInput.required = isCustom;

  if (!isCustom) {
    customCategoryInput.value = "";
  }
}

function renderStats(filteredExpenses) {
  const total = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const largest = filteredExpenses.reduce((max, expense) => Math.max(max, expense.amount), 0);
  const grouped = filteredExpenses.reduce((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
    return acc;
  }, {});

  const topCategoryEntry = Object.entries(grouped).sort((a, b) => b[1] - a[1])[0];
  const lastEntry = [...expenses].sort((a, b) => b.createdAt - a.createdAt)[0];

  monthlyTotal.textContent = formatCurrency(total);
  expenseCount.textContent = String(filteredExpenses.length);
  largestExpense.textContent = formatCurrency(largest);

  heroTotal.textContent = formatCurrency(total);
  heroTopCategory.textContent = topCategoryEntry
    ? `${topCategoryEntry[0]} (${formatCurrency(topCategoryEntry[1])})`
    : "Sem dados";
  heroLastEntry.textContent = lastEntry
    ? `${lastEntry.category} - ${formatCurrency(lastEntry.amount)}`
    : "Nenhum ainda";
}

function renderCategories(filteredExpenses) {
  if (!filteredExpenses.length) {
    categoryBreakdown.innerHTML = '<div class="empty-state">Nenhum gasto encontrado nesse mes.</div>';
    return;
  }

  const totals = filteredExpenses.reduce((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
    return acc;
  }, {});

  const topTotal = Math.max(...Object.values(totals));

  categoryBreakdown.innerHTML = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => {
      const width = topTotal ? Math.max((amount / topTotal) * 100, 8) : 0;
      return `
        <article class="category-card">
          <div class="category-card__top">
            <strong>${category}</strong>
            <span>${formatCurrency(amount)}</span>
          </div>
          <div class="category-card__bar" aria-hidden="true">
            <div class="category-card__fill" style="width: ${width}%"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderExpenseList(filteredExpenses) {
  if (!filteredExpenses.length) {
    expenseList.innerHTML = '<div class="empty-state">Adicione gastos para ver a lista do mes.</div>';
    return;
  }

  expenseList.innerHTML = "";

  filteredExpenses.forEach((expense) => {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".expense-item");

    fragment.querySelector(".expense-item__category").textContent = expense.category;
    fragment.querySelector(".expense-item__amount").textContent = formatCurrency(expense.amount);
    fragment.querySelector(".expense-item__meta").textContent =
      `${expense.person} • ${formatDate(expense.date)}`;
    fragment.querySelector(".expense-item__note").textContent = expense.note || "Sem observacao.";

    fragment.querySelector(".action-edit").addEventListener("click", () => fillForm(expense));
    fragment.querySelector(".action-delete").addEventListener("click", () => deleteExpense(expense.id));

    article.dataset.id = expense.id;
    expenseList.appendChild(fragment);
  });
}

function render() {
  const filteredExpenses = getFilteredExpenses();
  renderStats(filteredExpenses);
  renderCategories(filteredExpenses);
  renderExpenseList(filteredExpenses);
}

function upsertExpense(event) {
  event.preventDefault();

  const selectedCategory = categoryInput.value === "__custom__"
    ? customCategoryInput.value.trim()
    : categoryInput.value;

  const expense = {
    id: expenseIdInput.value || crypto.randomUUID(),
    amount: Number(amountInput.value),
    category: selectedCategory,
    person: personInput.value.trim(),
    date: dateInput.value,
    note: noteInput.value.trim(),
    createdAt: expenseIdInput.value
      ? expenses.find((item) => item.id === expenseIdInput.value)?.createdAt || Date.now()
      : Date.now(),
  };

  if (!expense.amount || !expense.category || !expense.person || !expense.date) {
    return;
  }

  const existingIndex = expenses.findIndex((item) => item.id === expense.id);

  if (existingIndex >= 0) {
    expenses[existingIndex] = expense;
  } else {
    expenses.push(expense);
  }

  saveExpenses(expenses);
  monthFilter.value = expense.date.slice(0, 7);
  resetForm();
  render();
}

function deleteExpense(id) {
  expenses = expenses.filter((expense) => expense.id !== id);
  saveExpenses(expenses);

  if (!expenses.some((expense) => expense.date.startsWith(monthFilter.value))) {
    ensureDefaultMonth();
  }

  render();
}

form.addEventListener("submit", upsertExpense);
cancelEditButton.addEventListener("click", resetForm);
monthFilter.addEventListener("change", render);
categoryInput.addEventListener("change", syncCustomCategoryField);

ensureDefaultMonth();
resetForm();
render();
