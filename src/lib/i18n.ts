// ─── Lightweight bilingual i18n (EN / PT) for the household finance app ──────
// Dictionaries are plain objects whose interpolated/plural values are small
// functions; `pt` is typed as `Dictionary` so both languages always stay in
// sync at compile time.

import {
  dueDateLabel,
  monthLabel,
  shortMonthLabel,
} from "@/lib/finance";

export type Lang = "en" | "pt";

export const LANGUAGES: { id: Lang; label: string; short: string }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "pt", label: "Português", short: "PT" },
];

/** BCP47 locale used for number/date formatting of each language. */
export function intlLocale(lang: Lang): string {
  return lang === "pt" ? "pt-PT" : "en-IE";
}

// ─── Category display names (DB keeps the canonical English keys) ────────────

const CATEGORY_LABELS: Record<Lang, Record<string, string>> = {
  en: {},
  pt: {
    Housing: "Habitação",
    Utilities: "Água e Luz",
    Groceries: "Alimentação",
    Transport: "Transportes",
    "Internet & Phone": "Internet e Telefone",
    Insurance: "Seguros",
    Health: "Saúde",
    Entertainment: "Lazer",
    Personal: "Pessoal",
    Education: "Educação",
    Other: "Outras",
  },
};

export function categoryLabel(category: string, lang: Lang): string {
  return CATEGORY_LABELS[lang][category] ?? category;
}

// ─── Compact axis money, e.g. "€1.2k" / "1,2 mil €" ──────────────────────────

export function compactEur(value: number, lang: Lang): string {
  const sep = (s: string) => (lang === "pt" ? s.replace(".", ",") : s);
  if (value >= 1000) {
    const k = value / 1000;
    const num = k >= 10 ? String(Math.round(k)) : k.toFixed(1);
    return lang === "pt" ? `${sep(num)} mil €` : `€${num}k`;
  }
  return lang === "pt" ? `${Math.round(value)} €` : `€${Math.round(value)}`;
}

// ─── English dictionary (canonical shape) ────────────────────────────────────

const en = {
  // Header
  appTagline: "Shared household budget",
  previousMonth: "Previous month",
  nextMonth: "Next month",
  selectMonth: "Select month",
  toggleDarkMode: "Toggle dark mode",
  changeLanguage: "Change language",
  language: "Language",

  // Navigation & search (header)
  navAria: "Section navigation",
  navOverview: "Overview",
  navPeople: "People",
  navBills: "Bills",
  navCharts: "Insights",
  navUpcoming: "Upcoming",
  openMenuAria: "Open navigation menu",
  searchEntries: "Search entries…",
  searchEntriesAria: "Search entries by name or notes",
  clearSearchAria: "Clear search",
  noMatchSearch: "No entries match your search",
  dashboardTitle: "Dashboard",

  // Names & onboarding (first-run setup of the two persons)
  editNames: "Edit names",
  editNamesAria: "Edit the names of the two persons",
  personOneLabel: "Person 1",
  personTwoLabel: "Person 2",
  namesInputAria: (label: string) => `Name for ${label}`,
  namesHint: "You can change these names anytime from the header.",
  onboardingTitle: "Welcome to your household budget",
  onboardingSubtitle:
    "Before we start, tell us who the two people in this household are. Their names are used across the whole app.",
  startUsingApp: "Start using the app",
  namesUpdated: "Names updated",
  namesUpdatedDesc: (n1: string, n2: string) =>
    `The app now shows ${n1} & ${n2} across all sections.`,
  namesInvalid: "Please enter a name for each person.",

  // Summary cards
  householdIncome: "Household income",
  monthlyExpenses: "Monthly expenses",
  moneyRemaining: "Money remaining",
  unpaidBills: "Unpaid bills",
  billsUnpaid: (n: number, amount: string) =>
    `${n} ${n === 1 ? "bill" : "bills"} · ${amount} unpaid`,
  overduePaySoon: (n: number) => `${n} overdue · pay soon`,
  stillToSettle: (amount: string) => `${amount} still to settle`,

  // Person card
  personFinancesAria: (name: string) => `${name}'s finances`,
  monthlyFinances: "Monthly finances",
  salaryPill: "salary",
  mealCardPill: "meal card",
  mealCardInputAria: (name: string) => `${name}'s meal card money in euros`,
  saveMealCardAria: (name: string) => `Save ${name}'s meal card money`,
  editMealCardAria: (name: string, current: string) =>
    `Edit ${name}'s meal card money (currently ${current})`,
  mealCardUpdated: (name: string) => `${name}'s meal card updated`,
  mealCardSetTo: (amount: string) => `Meal card money set to ${amount}.`,
  invalidMealCard: "Invalid meal card amount",
  invalidMealCardDesc: "Please enter a valid amount in euros.",
  salaryInputAria: (name: string) => `${name}'s monthly salary in euros`,
  saveSalaryAria: (name: string) => `Save ${name}'s salary`,
  cancelSalaryEdit: "Cancel salary edit",
  editSalaryAria: (name: string, current: string) =>
    `Edit ${name}'s monthly salary (currently ${current})`,
  totalIncomeRow: "Total income",
  creditsRow: "Credits",
  availableAfterExpenses: "Available after all expenses",
  overBudget: (amount: string) =>
    `${amount} over budget — reduce expenses or update salary`,
  committedThisMonth: (amount: string) => `${amount} committed this month`,
  personal: "Personal",
  sharedShare: "Shared share",
  totalCommitted: "Total committed",
  paidUnpaid: "Paid / unpaid",
  incomeCommitted: "Income committed to expenses",
  setSalary: "set salary",
  committedPctAria: (name: string, pct: number) =>
    `${name}: ${pct}% of income committed`,
  expensesExceedBy: (amount: string) => `Expenses exceed income by ${amount}`,
  invalidSalary: "Invalid salary",
  invalidSalaryDesc: "Please enter a valid amount in euros.",
  salaryUpdated: (name: string) => `${name}'s salary updated`,
  incomeSetTo: (amount: string) => `Monthly income set to ${amount}.`,

  // Expense list
  expensesForMonthAria: (month: string) => `Expenses for ${month}`,
  billsExpenses: "Bills & expenses",
  itemsTotal: (n: number, total: string) =>
    `${n} ${n === 1 ? "item" : "items"} · ${total} total`,
  itemsWithCredits: (n: number, expenses: string, credits: string) =>
    `${n} ${n === 1 ? "item" : "items"} · ${expenses} in expenses · +${credits} in credits`,
  creditBadge: "Credit",
  creditMoneyInAria: (name: string, amount: string) =>
    `"${name}" is a credit of ${amount} that adds money to the balance`,
  addExpense: "Add expense",
  addEntry: "Add expense/credit",
  filterExpenses: "Filter expenses",
  filterByPerson: "Filter by person",
  filterByCategory: "Filter by category",
  filterByStatus: "Filter by payment status",
  allPersons: "All persons",
  allCategories: "All categories",
  allStatuses: "All statuses",
  shared: "Shared",
  paid: "Paid",
  unpaid: "Unpaid",
  clearFilters: "Clear filters",
  noExpensesYet: (month: string) => `No expenses yet for ${month}`,
  noMatchFilters: "No expenses match the current filters",
  emptyHintNew: (n1: string, n2: string) =>
    `Add your first entry — a bill, a utility or a refund — and it will be split between ${n1} and ${n2} automatically.`,
  emptyHintFilters: "Try adjusting or clearing the filters above.",
  addFirstExpense: "Add your first expense/credit",
  markPaidAria: (name: string, paid: boolean) =>
    `Mark "${name}" as ${paid ? "unpaid" : "paid"}`,
  editExpenseAria: (name: string) => `Edit "${name}"`,
  deleteExpenseAria: (name: string) => `Delete "${name}"`,
  overdueDays: (n: number) => (n === 1 ? "Overdue 1 day" : `Overdue ${n} days`),
  dueToday: "Due today",
  inDays: (n: number) => (n === 1 ? "in 1 day" : `in ${n} days`),
  sharedSplit: (split: string | null) =>
    split ? `Shared ${split}` : "Shared 50/50",
  deleteExpenseTitle: "Delete expense?",
  deleteExpenseDesc: (name: string, amount: string, month: string) =>
    `"${name}" (${amount}) will be removed from ${month}. This cannot be undone.`,
  cancel: "Cancel",
  delete: "Delete",

  // Expense dialog
  editExpense: "Edit entry",
  updateExpenseFor: (name: string, month: string) =>
    `Update "${name}" for ${month}.`,
  trackNewBill: (month: string) => `Track a new bill for ${month}.`,
  trackNewCredit: (month: string) =>
    `Add money received in ${month} — meal card top-ups, refunds, cashback or extra income. It increases the available balance.`,
  entryType: "Type",
  entryTypeAria: "Entry type — expense (−, money out) or credit (+, money in)",
  typeExpense: "Expense",
  typeExpenseHint: "Money out (−) — a bill to pay",
  typeCredit: "Credit",
  typeCreditHint: "Money in (+) — adds to the balance",
  addCredit: "Add credit",
  creditAdded: "Credit added",
  addedCreditToMonth: (name: string, amount: string, month: string) =>
    `"${name}" (+${amount}) was added to ${month}.`,
  nameLabel: "Name",
  namePlaceholder: "e.g. Rent, Electricity, Groceries",
  amountLabel: "Amount (€)",
  responsible: "Responsible",
  responsibleAria: "Who is responsible for this expense",
  splitLabel: (n1: string, n2: string) => `Split between ${n1} & ${n2}`,
  joaoShareAria: (n1: string) => `${n1}'s share percentage`,
  customSplitNote: "Custom split — the default is 50/50.",
  splitSliderHint: "Drag the slider to set each person's share.",
  // Per-person paid amounts on shared bills
  sharedPaidTitle: "Who paid how much?",
  paidLabel: (n: string) => `${n} paid`,
  paidInputAria: (n: string) => `Amount of the bill paid by ${n}`,
  paidAutoHint:
    "Enter what one person paid — the other adjusts automatically so both always add up to the bill.",
  category: "Category",
  categoryAria: "Expense category",
  dueDateOptional: "Due date (optional)",
  alreadyPaid: "Already paid",
  alreadyPaidHint:
    "Marks the bill as settled — it still counts towards the balance.",
  notesOptional: "Notes (optional)",
  notesPlaceholder: "Any extra details…",
  nameRequired: `Please give the expense a name, e.g. "Rent".`,
  amountRequired: "Please enter an amount greater than 0.",
  saveChanges: "Save changes",

  // Upcoming bills
  upcomingBills: "Upcoming bills",
  overdueCount: (n: number) => `${n} overdue`,
  stillToPay: (amount: string) => `${amount} still to be paid this month.`,
  nothingPending: "Nothing pending — all bills are settled.",
  everyBillPaid: "Every bill is marked as paid",
  noUpcomingPayments: "No upcoming payments for this month.",
  noDueDates:
    "Unpaid bills have no due dates set. Add due dates to see them here.",
  overdueWithDate: (dateLabel: string) => `Overdue · ${dateLabel}`,
  inDaysWithDate: (n: number, dateLabel: string) =>
    `${n === 1 ? "in 1 day" : `in ${n} days`} · ${dateLabel}`,
  noDueDate: "No due date",
  moreUnpaid: (n: number) =>
    `+ ${n} more unpaid ${n === 1 ? "bill" : "bills"} in the list below`,

  // Charts
  atAGlance: (n1: string, n2: string) => `${n1} vs ${n2} — at a glance`,
  chartSubtitle: "Income, committed expenses and what remains for each person.",
  barChartAria: (n1: string, n2: string) =>
    `Bar chart comparing ${n1} and ${n2}: salary, expenses and available money`,
  groupSalary: "Salary",
  groupIncome: "Income",
  groupExpenses: "Expenses",
  groupAvailable: "Available",
  expensesByCategory: "Expenses by category",
  categorySubtitle: "Where the household money goes this month.",
  pieChartAria: "Pie chart of expenses by category",
  noExpensesRecorded: "No expenses recorded yet.",

  // Page-level
  personalFinancesAria: "Personal finances",
  loadError: "Something went wrong loading your data",
  loadErrorHint: "Check your connection and try again.",
  retry: "Retry",
  footerNote: (n1: string, n2: string) =>
    `Household Budget · ${n1} & ${n2} — expenses always count towards the balance, whether they are paid or not. Data is saved for each month separately.`,

  // Toasts
  couldNotSaveSalary: "Could not save salary",
  tryAgain: "Please try again.",
  expenseUpdated: "Expense updated",
  savedForMonth: (name: string, month: string) =>
    `"${name}" was saved for ${month}.`,
  expenseAdded: "Expense added",
  addedToMonth: (name: string, amount: string, month: string) =>
    `"${name}" (${amount}) was added to ${month}.`,
  couldNotSaveExpense: "Could not save expense",
  markedUnpaid: "Marked as unpaid",
  markedPaid: "Marked as paid",
  reopened: (name: string) => `"${name}" reopened.`,
  settled: (name: string) => `"${name}" settled.`,
  couldNotUpdateStatus: "Could not update status",
  expenseDeleted: "Expense deleted",
  removedFromMonth: (name: string, month: string) =>
    `"${name}" was removed from ${month}.`,
  couldNotDelete: "Could not delete expense",
};

export type Dictionary = typeof en;

// ─── Portuguese dictionary (European Portuguese) ─────────────────────────────

const pt: Dictionary = {
  // Cabeçalho
  appTagline: "Orçamento familiar partilhado",
  previousMonth: "Mês anterior",
  nextMonth: "Mês seguinte",
  selectMonth: "Selecionar mês",
  toggleDarkMode: "Alternar modo escuro",
  changeLanguage: "Mudar o idioma",
  language: "Idioma",

  // Navegação e pesquisa (cabeçalho)
  navAria: "Navegação de secções",
  navOverview: "Visão geral",
  navPeople: "Pessoas",
  navBills: "Faturas",
  navCharts: "Análise",
  navUpcoming: "Próximas",
  openMenuAria: "Abrir menu de navegação",
  searchEntries: "Pesquisar lançamentos…",
  searchEntriesAria: "Pesquisar lançamentos por nome ou notas",
  clearSearchAria: "Limpar pesquisa",
  noMatchSearch: "Nenhum lançamento corresponde à pesquisa",
  dashboardTitle: "Painel",

  // Nomes e configuração inicial (nomes das duas pessoas)
  editNames: "Editar nomes",
  editNamesAria: "Editar os nomes das duas pessoas",
  personOneLabel: "Pessoa 1",
  personTwoLabel: "Pessoa 2",
  namesInputAria: (label) => `Nome para ${label}`,
  namesHint: "Pode alterar estes nomes a qualquer momento no cabeçalho.",
  onboardingTitle: "Bem-vindo ao seu orçamento familiar",
  onboardingSubtitle:
    "Antes de começar, indique quem são as duas pessoas deste agregado. Os nomes são usados em toda a aplicação.",
  startUsingApp: "Começar a usar a aplicação",
  namesUpdated: "Nomes atualizados",
  namesUpdatedDesc: (n1, n2) =>
    `A aplicação passa a mostrar ${n1} & ${n2} em todas as secções.`,
  namesInvalid: "Introduza um nome para cada pessoa.",

  // Cartões de resumo
  householdIncome: "Rendimento do agregado",
  monthlyExpenses: "Despesas do mês",
  moneyRemaining: "Dinheiro restante",
  unpaidBills: "Faturas por pagar",
  billsUnpaid: (n, amount) =>
    `${n} ${n === 1 ? "fatura" : "faturas"} · ${amount} por pagar`,
  overduePaySoon: (n) => `${n} em atraso · pague em breve`,
  stillToSettle: (amount) => `${amount} ainda por liquidar`,

  // Cartão de pessoa
  personFinancesAria: (name) => `Finanças de ${name}`,
  monthlyFinances: "Finanças mensais",
  salaryPill: "salário",
  mealCardPill: "cartão-refeição",
  mealCardInputAria: (name) => `Dinheiro do cartão-refeição de ${name} em euros`,
  saveMealCardAria: (name) => `Guardar o dinheiro do cartão-refeição de ${name}`,
  editMealCardAria: (name, current) =>
    `Editar o dinheiro do cartão-refeição de ${name} (atualmente ${current})`,
  mealCardUpdated: (name) => `Cartão-refeição de ${name} atualizado`,
  mealCardSetTo: (amount) => `Dinheiro do cartão-refeição definido como ${amount}.`,
  invalidMealCard: "Valor de cartão-refeição inválido",
  invalidMealCardDesc: "Introduza um valor válido em euros.",
  salaryInputAria: (name) => `Salário mensal de ${name} em euros`,
  saveSalaryAria: (name) => `Guardar o salário de ${name}`,
  cancelSalaryEdit: "Cancelar edição do salário",
  editSalaryAria: (name, current) =>
    `Editar o salário mensal de ${name} (atualmente ${current})`,
  totalIncomeRow: "Rendimento total",
  creditsRow: "Créditos",
  availableAfterExpenses: "Disponível após todas as despesas",
  overBudget: (amount) =>
    `${amount} acima do orçamento — reduza despesas ou atualize o salário`,
  committedThisMonth: (amount) => `${amount} comprometidos este mês`,
  personal: "Pessoal",
  sharedShare: "Parte partilhada",
  totalCommitted: "Total comprometido",
  paidUnpaid: "Pago / por pagar",
  incomeCommitted: "Rendimento comprometido em despesas",
  setSalary: "definir salário",
  committedPctAria: (name, pct) =>
    `${name}: ${pct}% do rendimento comprometido`,
  expensesExceedBy: (amount) => `As despesas excedem o rendimento em ${amount}`,
  invalidSalary: "Salário inválido",
  invalidSalaryDesc: "Introduza um valor válido em euros.",
  salaryUpdated: (name) => `Salário de ${name} atualizado`,
  incomeSetTo: (amount) => `Rendimento mensal definido como ${amount}.`,

  // Lista de despesas
  expensesForMonthAria: (month) => `Despesas de ${month}`,
  billsExpenses: "Faturas e despesas",
  itemsTotal: (n, total) => `${n} ${n === 1 ? "item" : "itens"} · ${total} no total`,
  itemsWithCredits: (n, expenses, credits) =>
    `${n} ${n === 1 ? "item" : "itens"} · ${expenses} em despesas · +${credits} em créditos`,
  creditBadge: "Crédito",
  creditMoneyInAria: (name, amount) =>
    `"${name}" é um crédito de ${amount} que adiciona dinheiro ao saldo`,
  addExpense: "Adicionar despesa",
  addEntry: "Adicionar despesa/crédito",
  filterExpenses: "Filtrar despesas",
  filterByPerson: "Filtrar por pessoa",
  filterByCategory: "Filtrar por categoria",
  filterByStatus: "Filtrar por estado de pagamento",
  allPersons: "Todas as pessoas",
  allCategories: "Todas as categorias",
  allStatuses: "Todos os estados",
  shared: "Partilhada",
  paid: "Paga",
  unpaid: "Por pagar",
  clearFilters: "Limpar filtros",
  noExpensesYet: (month) => `Ainda sem despesas em ${month}`,
  noMatchFilters: "Nenhuma despesa corresponde aos filtros atuais",
  emptyHintNew: (n1, n2) =>
    `Adicione o primeiro lançamento — fatura, água e luz ou reembolso — e ele será dividido entre ${n1} e ${n2} automaticamente.`,
  emptyHintFilters: "Tente ajustar ou limpar os filtros acima.",
  addFirstExpense: "Adicionar a primeira despesa/crédito",
  markPaidAria: (name, paid) =>
    `Marcar "${name}" como ${paid ? "por pagar" : "paga"}`,
  editExpenseAria: (name) => `Editar "${name}"`,
  deleteExpenseAria: (name) => `Eliminar "${name}"`,
  overdueDays: (n) => (n === 1 ? "Atrasada 1 dia" : `Atrasada ${n} dias`),
  dueToday: "Vence hoje",
  inDays: (n) => (n === 1 ? "em 1 dia" : `em ${n} dias`),
  sharedSplit: (split) =>
    split ? `Partilhada ${split}` : "Partilhada 50/50",
  deleteExpenseTitle: "Eliminar despesa?",
  deleteExpenseDesc: (name, amount, month) =>
    `"${name}" (${amount}) será removida de ${month}. Esta ação não pode ser anulada.`,
  cancel: "Cancelar",
  delete: "Eliminar",

  // Janela de despesa
  editExpense: "Editar lançamento",
  updateExpenseFor: (name, month) => `Atualizar "${name}" de ${month}.`,
  trackNewBill: (month) => `Registar uma nova fatura de ${month}.`,
  trackNewCredit: (month) =>
    `Adicione dinheiro recebido em ${month} — cargas de cartão-refeição, reembolsos, cashback ou rendimentos extra. Aumenta o saldo disponível.`,
  entryType: "Tipo",
  entryTypeAria: "Tipo de lançamento — despesa (−, dinheiro que sai) ou crédito (+, dinheiro que entra)",
  typeExpense: "Despesa",
  typeExpenseHint: "Dinheiro que sai (−) — uma fatura a pagar",
  typeCredit: "Crédito",
  typeCreditHint: "Dinheiro que entra (+) — aumenta o saldo",
  addCredit: "Adicionar crédito",
  creditAdded: "Crédito adicionado",
  addedCreditToMonth: (name, amount, month) =>
    `"${name}" (+${amount}) foi adicionado a ${month}.`,
  nameLabel: "Nome",
  namePlaceholder: "ex.: Renda, Eletricidade, Compras",
  amountLabel: "Valor (€)",
  responsible: "Responsável",
  responsibleAria: "Quem é responsável por esta despesa",
  splitLabel: (n1, n2) => `Divisão entre ${n1} e ${n2}`,
  joaoShareAria: (n1) => `Percentagem da parte de ${n1}`,
  customSplitNote: "Divisão personalizada — o predefinido é 50/50.",
  splitSliderHint: "Arraste o controlo para definir a parte de cada um.",
  // Valores pagos por pessoa em faturas partilhadas
  sharedPaidTitle: "Quem pagou quanto?",
  paidLabel: (n: string) => `${n} pagou`,
  paidInputAria: (n: string) => `Valor da fatura pago por ${n}`,
  paidAutoHint:
    "Introduza quanto uma pessoa pagou — o outro valor ajusta-se automaticamente para ambos somarem sempre o total da fatura.",
  category: "Categoria",
  categoryAria: "Categoria da despesa",
  dueDateOptional: "Data de vencimento (opcional)",
  alreadyPaid: "Já paga",
  alreadyPaidHint:
    "Marca a fatura como liquidada — continua a contar para o saldo.",
  notesOptional: "Notas (opcional)",
  notesPlaceholder: "Detalhes adicionais…",
  nameRequired: `Dê um nome à despesa, por ex. "Renda".`,
  amountRequired: "Introduza um valor superior a 0.",
  saveChanges: "Guardar alterações",

  // Faturas a chegar
  upcomingBills: "Próximas faturas",
  overdueCount: (n) => `${n} em atraso`,
  stillToPay: (amount) => `${amount} ainda por pagar este mês.`,
  nothingPending: "Nada pendente — todas as faturas estão liquidadas.",
  everyBillPaid: "Todas as faturas estão marcadas como pagas",
  noUpcomingPayments: "Sem pagamentos próximos para este mês.",
  noDueDates:
    "As faturas por pagar não têm data de vencimento. Adicione datas para vê-las aqui.",
  overdueWithDate: (dateLabel) => `Em atraso · ${dateLabel}`,
  inDaysWithDate: (n, dateLabel) =>
    `${n === 1 ? "em 1 dia" : `em ${n} dias`} · ${dateLabel}`,
  noDueDate: "Sem data de vencimento",
  moreUnpaid: (n) =>
    n === 1
      ? "+ 1 fatura por pagar na lista abaixo"
      : `+ ${n} faturas por pagar na lista abaixo`,

  // Gráficos
  atAGlance: (n1, n2) => `${n1} vs ${n2} — num relance`,
  chartSubtitle: "Rendimento, despesas comprometidas e o que resta a cada pessoa.",
  barChartAria: (n1, n2) =>
    `Gráfico de barras comparando ${n1} e ${n2}: salário, despesas e dinheiro disponível`,
  groupSalary: "Salário",
  groupIncome: "Rendimento",
  groupExpenses: "Despesas",
  groupAvailable: "Disponível",
  expensesByCategory: "Despesas por categoria",
  categorySubtitle: "Para onde vai o dinheiro do agregado este mês.",
  pieChartAria: "Gráfico circular das despesas por categoria",
  noExpensesRecorded: "Ainda não há despesas registadas.",

  // Página
  personalFinancesAria: "Finanças pessoais",
  loadError: "Ocorreu um erro ao carregar os seus dados",
  loadErrorHint: "Verifique a ligação e tente novamente.",
  retry: "Tentar novamente",
  footerNote: (n1, n2) =>
    `Orçamento Familiar · ${n1} & ${n2} — as despesas contam sempre para o saldo, pagas ou por pagar. Os dados são guardados separadamente para cada mês.`,

  // Notificações
  couldNotSaveSalary: "Não foi possível guardar o salário",
  tryAgain: "Por favor, tente novamente.",
  expenseUpdated: "Despesa atualizada",
  savedForMonth: (name, month) => `"${name}" foi guardada em ${month}.`,
  expenseAdded: "Despesa adicionada",
  addedToMonth: (name, amount, month) =>
    `"${name}" (${amount}) foi adicionada a ${month}.`,
  couldNotSaveExpense: "Não foi possível guardar a despesa",
  markedUnpaid: "Marcada como por pagar",
  markedPaid: "Marcada como paga",
  reopened: (name) => `"${name}" foi reaberta.`,
  settled: (name) => `"${name}" foi liquidada.`,
  couldNotUpdateStatus: "Não foi possível atualizar o estado",
  expenseDeleted: "Despesa eliminada",
  removedFromMonth: (name, month) => `"${name}" foi removida de ${month}.`,
  couldNotDelete: "Não foi possível eliminar a despesa",
};

export const dictionaries: Record<Lang, Dictionary> = { en, pt };

// ─── Locale-aware formatters (currency, months, dates) ───────────────────────

export function createFormatters(lang: Lang) {
  const locale = intlLocale(lang);
  const eur = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const eur0 = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  // Intl gives lowercase month names in Portuguese; capitalize for UI.
  const cap = (s: string) =>
    lang === "pt" && s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  return {
    lang,
    locale,
    /** "€1,200.00" (EN) / "1.200,00 €" (PT). */
    eur: (value: number, roundTo0 = false) =>
      Number.isFinite(value)
        ? (roundTo0 ? eur0 : eur).format(value)
        : lang === "pt"
          ? "0,00 €"
          : "€0.00",
    /** "November 2026" / "Novembro de 2026". */
    month: (month: string) => cap(monthLabel(month, locale)),
    /** "Nov 26" / "nov 26". */
    shortMonth: (month: string) => cap(shortMonthLabel(month, locale)),
    /** "Nov 18, 2026" / "18/11/2026". */
    date: (dueDate: string) => dueDateLabel(dueDate, locale),
    /** "Nov 18" / "18 de nov". */
    dateShort: (dueDate: string) => {
      const [y, m, d] = dueDate.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    },
    /** "Mon, Nov 18" / "seg, 18 de nov". */
    dateWeekday: (dueDate: string) => {
      const [y, m, d] = dueDate.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    },
    /** Translated category display name. */
    category: (category: string) => categoryLabel(category, lang),
  };
}

export type Formatters = ReturnType<typeof createFormatters>;
