const STORAGE_KEY = "tempo-tasks-v1";
const THEME_KEY = "tempo-theme";
const MODE_KEY = "tempo-view-mode";
const SORT_PRIMARY_KEY = "tempo-sort-primary";
const SORT_SECONDARY_KEY = "tempo-sort-secondary";
const PROJECTS_KEY = "tempo-projects-v1";
const TRASH_KEY = "tempo-trash-v1";
const FILTERS_KEY = "tempo-filters-v1";
const GROUP_KEY = "tempo-group-by";
const FAVORITES_KEY = "tempo-favorite-projects-v1";
const TAGS_KEY = "tempo-tags-v1";
const {
  makeId, normalizeTask, createNextRecurringTask, getLiveActualHours, startTaskTimer, stopTaskTimer, getDeadlineStatus, calculateDashboardStats, normalizeSavedFilter, matchesSavedFilter,
  sortTasks, groupTasks, resolveProject, normalizeProjectName, normalizeTagName, addProject, removeProject, collectTags, renameTag, removeTag, applyTaskDetails, applyTableEdit, closeDialog,
  CSV_FIELDS, parseCSV, autoMapHeaders, csvRowsToTasks, mergeImportedTasks, tasksToCSV, createBackup, parseBackup,
} = TempoCore;

const todayISO = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const starterTasks = [
  normalizeTask({ title: "今日いちばん大事なことを決める", due: todayISO(), project: "個人", tags: ["集中"], priority: "high", status: "doing", estimate: 1, actual: 0.5, subtasks: [{ title: "候補を書き出す", completed: true }, { title: "ひとつ選ぶ", completed: false }], createdAt: Date.now() - 3000 }),
  normalizeTask({ title: "メールの返信をまとめて終わらせる", due: todayISO(), project: "仕事", tags: ["連絡"], priority: "normal", status: "todo", estimate: 1.5, createdAt: Date.now() - 2000 }),
  normalizeTask({ title: "帰りにコーヒー豆を買う", due: addDays(todayISO(), 1), project: "買い物", tags: ["外出"], priority: "low", status: "todo", estimate: 0.5, createdAt: Date.now() - 1000 }),
];

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved.map(normalizeTask) : starterTasks;
  } catch {
    return starterTasks;
  }
}

function loadProjects(tasks) {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    const savedProjects = Array.isArray(saved) ? saved : ["個人", "仕事", "買い物"];
    return [...new Set(["未分類", ...savedProjects, ...tasks.map((task) => task.project)].filter(Boolean))];
  } catch {
    return [...new Set(["未分類", "個人", "仕事", "買い物", ...tasks.map((task) => task.project)].filter(Boolean))];
  }
}

function loadTags(tasks) {
  try {
    const saved = JSON.parse(localStorage.getItem(TAGS_KEY));
    return collectTags(tasks, Array.isArray(saved) ? saved : []);
  } catch {
    return collectTags(tasks);
  }
}

function loadCollection(key, mapper) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Array.isArray(saved) ? saved.map(mapper) : [];
  } catch {
    return [];
  }
}

const loadedTasks = loadTasks();
const loadedGroupBy = localStorage.getItem(GROUP_KEY);

const state = {
  tasks: loadedTasks,
  trash: loadCollection(TRASH_KEY, normalizeTask),
  savedFilters: loadCollection(FILTERS_KEY, normalizeSavedFilter).filter((filter) => filter.name),
  projects: loadProjects(loadedTasks),
  favoriteProjects: loadCollection(FAVORITES_KEY, (project) => normalizeProjectName(project)).filter(Boolean),
  tags: loadTags(loadedTasks),
  view: "today",
  activeProject: null,
  activeFilterId: null,
  search: "",
  sortPrimary: localStorage.getItem(SORT_PRIMARY_KEY) || "due",
  sortSecondary: localStorage.getItem(SORT_SECONDARY_KEY) || "priority",
  groupBy: ["project", "tag", "priority", "none"].includes(loadedGroupBy) ? loadedGroupBy : "project",
  mode: localStorage.getItem(MODE_KEY) || "list",
  subtaskDraft: [],
  csvParsed: null,
  csvMapping: {},
  calendarOffset: 0,
};

const undoStack = [];
let savedTaskSnapshot = JSON.stringify({ tasks: state.tasks, trash: state.trash });
let applyingSyncSnapshot = false;
let syncNotifyTimer = 0;

const elements = {
  form: document.querySelector("#task-form"),
  input: document.querySelector("#task-input"),
  list: document.querySelector("#task-list"),
  table: document.querySelector("#table-view"),
  board: document.querySelector("#kanban-board"),
  timeline: document.querySelector("#timeline-view"),
  upcomingCalendar: document.querySelector("#upcoming-calendar"),
  report: document.querySelector("#report-view"),
  deadlineSummary: document.querySelector("#deadline-summary"),
  deadlineTotal: document.querySelector("#deadline-total"),
  template: document.querySelector("#task-template"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyMessage: document.querySelector("#empty-message"),
  focusAdd: document.querySelector("#focus-add"),
  summary: document.querySelector("#task-summary"),
  title: document.querySelector("#view-title"),
  subtitle: document.querySelector("#view-subtitle"),
  dateLabel: document.querySelector("#date-label"),
  search: document.querySelector("#search-input"),
  sortPrimary: document.querySelector("#sort-primary"),
  sortSecondary: document.querySelector("#sort-secondary"),
  due: document.querySelector("#due-select"),
  project: document.querySelector("#project-select"),
  priority: document.querySelector("#priority-select"),
  progress: document.querySelector("#progress-ring"),
  progressValue: document.querySelector("#progress-value"),
  toast: document.querySelector("#toast"),
  toastMessage: document.querySelector("#toast-message"),
  undoButton: document.querySelector("#undo-button"),
  viewSwitcher: document.querySelector("#view-switcher"),
  listToolbar: document.querySelector("#list-toolbar"),
  groupControl: document.querySelector("#group-control"),
  groupSelect: document.querySelector("#group-select"),
  sidebar: document.querySelector("#sidebar"),
  scrim: document.querySelector("#sidebar-scrim"),
  projectNavigation: document.querySelector("#project-navigation"),
  favoriteProjectSection: document.querySelector("#favorite-project-section"),
  favoriteProjectNavigation: document.querySelector("#favorite-project-navigation"),
  dialog: document.querySelector("#task-dialog"),
  taskDialogEyebrow: document.querySelector("#task-dialog-eyebrow"),
  taskDialogTitle: document.querySelector("#task-dialog-title"),
  editForm: document.querySelector("#edit-form"),
  editId: document.querySelector("#edit-id"),
  editTitle: document.querySelector("#edit-title"),
  editStatus: document.querySelector("#edit-status"),
  editPriority: document.querySelector("#edit-priority"),
  editDue: document.querySelector("#edit-due"),
  editProject: document.querySelector("#edit-project"),
  editNewProject: document.querySelector("#edit-new-project"),
  editTags: document.querySelector("#edit-tags"),
  editRepeat: document.querySelector("#edit-repeat"),
  editEstimate: document.querySelector("#edit-estimate"),
  editActual: document.querySelector("#edit-actual"),
  effortBalance: document.querySelector("#effort-balance"),
  subtaskList: document.querySelector("#subtask-list"),
  subtaskInput: document.querySelector("#subtask-input"),
  subtaskProgress: document.querySelector("#subtask-progress"),
  saveTaskButton: document.querySelector("#save-task"),
  deleteTaskButton: document.querySelector("#delete-task"),
  timerPanel: document.querySelector("#timer-panel"),
  timerDisplay: document.querySelector("#timer-display"),
  toggleTaskTimer: document.querySelector("#toggle-task-timer"),
  projectDialog: document.querySelector("#project-dialog"),
  projectForm: document.querySelector("#project-form"),
  newProjectName: document.querySelector("#new-project-name"),
  newProjectFavorite: document.querySelector("#new-project-favorite"),
  tagDialog: document.querySelector("#tag-dialog"),
  tagManagerList: document.querySelector("#tag-manager-list"),
  tagManagerEmpty: document.querySelector("#tag-manager-empty"),
  newTagName: document.querySelector("#new-tag-name"),
  tagCount: document.querySelector("#tag-count"),
  csvFileInput: document.querySelector("#csv-file-input"),
  jsonFileInput: document.querySelector("#json-file-input"),
  csvImportDialog: document.querySelector("#csv-import-dialog"),
  csvImportForm: document.querySelector("#csv-import-form"),
  csvImportContent: document.querySelector("#csv-import-content"),
  csvPastePanel: document.querySelector("#csv-paste-panel"),
  csvPasteInput: document.querySelector("#csv-paste-input"),
  csvFileName: document.querySelector("#csv-file-name"),
  csvFileMeta: document.querySelector("#csv-file-meta"),
  csvMappingGrid: document.querySelector("#csv-mapping-grid"),
  csvPreviewHead: document.querySelector("#csv-preview-head"),
  csvPreviewBody: document.querySelector("#csv-preview-body"),
  csvPreviewSummary: document.querySelector("#csv-preview-summary"),
  csvImportMode: document.querySelector("#csv-import-mode"),
  csvDuplicateMode: document.querySelector("#csv-duplicate-mode"),
  csvImportError: document.querySelector("#csv-import-error"),
  executeCsvImport: document.querySelector("#execute-csv-import"),
  filterNavigation: document.querySelector("#filter-navigation"),
  filterDialog: document.querySelector("#filter-dialog"),
  filterForm: document.querySelector("#filter-form"),
  filterId: document.querySelector("#filter-id"),
  filterDialogEyebrow: document.querySelector("#filter-dialog-eyebrow"),
  filterDialogTitle: document.querySelector("#filter-dialog-title"),
  saveFilterButton: document.querySelector("#save-filter"),
  filterName: document.querySelector("#filter-name"),
  filterProject: document.querySelector("#filter-project"),
  filterStatus: document.querySelector("#filter-status"),
  filterPriority: document.querySelector("#filter-priority"),
  filterDue: document.querySelector("#filter-due"),
  filterTag: document.querySelector("#filter-tag"),
};

function scheduleSyncSnapshot() {
  if (applyingSyncSnapshot) return;
  clearTimeout(syncNotifyTimer);
  syncNotifyTimer = setTimeout(() => {
    if (window.TempoSync && window.TempoAppSyncAdapter) window.TempoSync.markLocalChange(createSyncSnapshot());
  }, 0);
}

function saveTasks({ recordUndo = true, sync = true } = {}) {
  const nextSnapshot = JSON.stringify({ tasks: state.tasks, trash: state.trash });
  if (recordUndo && nextSnapshot !== savedTaskSnapshot) {
    undoStack.push(savedTaskSnapshot);
    if (undoStack.length > 20) undoStack.shift();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  localStorage.setItem(TRASH_KEY, JSON.stringify(state.trash));
  state.tags = collectTags(state.tasks, state.tags);
  localStorage.setItem(TAGS_KEY, JSON.stringify(state.tags));
  savedTaskSnapshot = nextSnapshot;
  elements.undoButton.hidden = undoStack.length === 0;
  if (sync) scheduleSyncSnapshot();
}

function saveProjects() {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects));
  scheduleSyncSnapshot();
}

function saveTags() {
  state.tags = collectTags(state.tasks, state.tags);
  localStorage.setItem(TAGS_KEY, JSON.stringify(state.tags));
  scheduleSyncSnapshot();
}

function saveFilters() {
  localStorage.setItem(FILTERS_KEY, JSON.stringify(state.savedFilters));
  scheduleSyncSnapshot();
}

function saveFavoriteProjects() {
  state.favoriteProjects = [...new Set(state.favoriteProjects)].filter((project) => getProjects().includes(project));
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favoriteProjects));
  scheduleSyncSnapshot();
}

function formatDate(iso) {
  if (!iso) return "期限なし";
  if (iso === todayISO()) return "今日";
  if (iso === addDays(todayISO(), 1)) return "明日";
  return new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", weekday: "short" }).format(new Date(`${iso}T12:00:00`));
}

function formatHours(value) {
  return Number(value) % 1 === 0 ? `${Number(value)}h` : `${Number(value).toFixed(1)}h`;
}

function formatTimer(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0");
  const rest = String(safeSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${rest}`;
}

function activeTimerSeconds(task, now = Date.now()) {
  return task?.timerStartedAt ? Math.max(0, Math.floor((now - task.timerStartedAt) / 1000)) : 0;
}

function colorHue(value) {
  return [...String(value || "未分類")].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) % 360, 18);
}

function applyNamedColor(element, value) {
  element.classList.add("named-color");
  element.style.setProperty("--label-hue", colorHue(value));
}

function dueTone(due, status = "todo") {
  return getDeadlineStatus({ due, status }, todayISO()).tone;
}

function formatDeadlineLabel(task) {
  const deadline = getDeadlineStatus(task, todayISO());
  return deadline.label || formatDate(task.due);
}

function matchesCommonFilters(task) {
  if (state.activeProject && task.project !== state.activeProject) return false;
  const savedFilter = state.savedFilters.find((filter) => filter.id === state.activeFilterId);
  if (savedFilter && !matchesSavedFilter(task, savedFilter, todayISO())) return false;
  const query = state.search.toLowerCase();
  return !query || [task.title, task.project, ...task.tags].some((value) => String(value).toLowerCase().includes(query));
}

function getVisibleTasks(includeDone = false) {
  const today = todayISO();
  const source = state.view === "trash" ? state.trash : state.tasks;
  const filtered = source
    .filter((task) => {
      if (!matchesCommonFilters(task)) return false;
      if (state.view === "trash") return true;
      if (state.activeFilterId) return true;
      if (state.view === "today" && (!task.due || task.due > today || (!includeDone && task.status === "done"))) return false;
      if (state.view === "all" && !includeDone && task.status === "done") return false;
      if (state.view === "upcoming" && (task.status === "done" || !task.due || task.due < today)) return false;
      if (state.view === "completed" && task.status !== "done") return false;
      return true;
    });
  return sortTasks(filtered, state.sortPrimary, state.sortSecondary);
}

function makeTagRow(tags) {
  const row = document.createElement("div");
  row.className = "tag-row";
  tags.slice(0, 3).forEach((tag) => {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.innerHTML = `<span aria-hidden="true">#</span><span></span>`;
    pill.lastElementChild.textContent = tag;
    applyNamedColor(pill, tag);
    row.append(pill);
  });
  return row;
}

function createListTaskCard(task) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  const completedSubtasks = task.subtasks.filter((item) => item.completed).length;
  card.dataset.id = task.id;
  card.dataset.project = task.project;
  card.draggable = true;
  card.classList.toggle("is-completed", task.status === "done");
  card.dataset.dueTone = dueTone(task.due, task.status);
  card.querySelector(".task-title").textContent = task.title;
  card.querySelector(".task-date").textContent = formatDeadlineLabel(task);
  card.querySelector(".task-date").dataset.tone = dueTone(task.due, task.status);
  card.querySelector(".task-date").classList.toggle("is-overdue", Boolean(task.due && task.due < todayISO() && task.status !== "done"));
  card.querySelector(".task-project-label").textContent = task.project;
  applyNamedColor(card.querySelector(".task-project-label"), task.project);
  const effort = card.querySelector(".effort-label");
  effort.dataset.effortTask = task.id;
  effort.textContent = task.estimate || task.actual || task.timerStartedAt ? `${formatHours(getLiveActualHours(task))}${task.estimate ? ` / ${formatHours(task.estimate)}` : ""}` : "";
  effort.hidden = !task.estimate && !task.actual && !task.timerStartedAt;
  const subtask = card.querySelector(".subtask-label");
  subtask.textContent = task.subtasks.length ? `${completedSubtasks}/${task.subtasks.length}` : "";
  subtask.hidden = !task.subtasks.length;
  const statusLabel = card.querySelector(".status-label");
  statusLabel.textContent = { todo: "未着手", doing: "進行中", done: "完了" }[task.status];
  statusLabel.dataset.value = task.status;
  const priorityLabel = card.querySelector(".priority-label");
  priorityLabel.textContent = { high: "高", normal: "通常", low: "低" }[task.priority];
  priorityLabel.dataset.value = task.priority;
  priorityLabel.hidden = false;
  const repeatLabel = card.querySelector(".repeat-label");
  repeatLabel.textContent = { daily: "毎日", weekdays: "平日", weekly: "毎週", monthly: "毎月" }[task.repeat] || "";
  repeatLabel.hidden = task.repeat === "none";
  const priorityButton = card.querySelector(".priority-button");
  priorityButton.classList.toggle("is-high", task.priority === "high");
  priorityButton.setAttribute("aria-label", task.priority === "high" ? "優先度は高です。通常へ戻す" : "優先度を高にする");
  const timerButton = card.querySelector(".task-timer-button");
  timerButton.dataset.timerTask = task.id;
  timerButton.classList.toggle("is-running", Boolean(task.timerStartedAt));
  timerButton.querySelector(".timer-icon").textContent = task.timerStartedAt ? "■" : "▶";
  timerButton.querySelector(".timer-value").textContent = task.timerStartedAt ? formatTimer(activeTimerSeconds(task)) : "開始";
  timerButton.setAttribute("aria-label", task.timerStartedAt ? `「${task.title}」の時間計測を停止` : `「${task.title}」の時間計測を開始`);
  card.querySelector(".task-check").setAttribute("aria-label", task.status === "done" ? "未完了に戻す" : "完了にする");
  card.querySelector(".tag-row").replaceWith(makeTagRow(task.tags));
  return card;
}

function canGroupCurrentScope() {
  return !state.activeFilterId && (Boolean(state.activeProject) || ["today", "all", "completed"].includes(state.view));
}

function renderList(tasks) {
  elements.list.replaceChildren();
  if (state.view === "trash") {
    tasks.forEach((task) => {
      const card = document.createElement("article");
      card.className = "task-card trash-card";
      card.dataset.id = task.id;
      const body = document.createElement("div");
      body.className = "task-body";
      const title = document.createElement("p");
      title.className = "task-title";
      title.textContent = task.title;
      const meta = document.createElement("div");
      meta.className = "task-meta";
      meta.textContent = `${task.project} · ${task.deletedAt ? new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(task.deletedAt)) : "削除済み"}`;
      body.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "trash-actions";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.dataset.trashAction = "restore";
      restore.textContent = "復元";
      restore.setAttribute("aria-label", `「${task.title}」を復元`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.trashAction = "delete";
      remove.textContent = "完全削除";
      remove.setAttribute("aria-label", `「${task.title}」を完全に削除`);
      actions.append(restore, remove);
      card.append(body, actions);
      elements.list.append(card);
    });
    return;
  }
  const groupable = state.groupBy !== "none" && canGroupCurrentScope();
  if (!groupable) {
    tasks.forEach((task) => elements.list.append(createListTaskCard(task)));
    return;
  }
  groupTasks(tasks, state.groupBy, getProjects()).forEach((group) => {
    const section = document.createElement("section");
    section.className = "task-group";
    section.dataset.group = group.key;
    section.dataset.groupType = state.groupBy;
    const heading = document.createElement("header");
    heading.className = "task-group-heading";
    const name = document.createElement("h2");
    name.textContent = group.label;
    const count = document.createElement("span");
    count.textContent = `${group.tasks.length}件`;
    heading.append(name, count);
    const stack = document.createElement("div");
    stack.className = "task-group-stack";
    group.tasks.forEach((task) => stack.append(createListTaskCard(task)));
    section.append(heading, stack);
    elements.list.append(section);
  });
}

function makeTableSelect(field, value, options, label, colorType = "") {
  const select = document.createElement("select");
  select.className = "table-field table-select";
  select.dataset.field = field;
  if (colorType) {
    select.classList.add("table-color-field");
    select.dataset.colorType = colorType;
    select.dataset.value = value;
  }
  select.setAttribute("aria-label", label);
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = optionValue === value;
    select.append(option);
  });
  return select;
}

function makeTableInput(field, value, type, label, className = "") {
  const input = document.createElement("input");
  input.className = `table-field ${className}`.trim();
  input.dataset.field = field;
  input.type = type;
  input.value = value ?? "";
  input.setAttribute("aria-label", label);
  if (type === "number") {
    input.min = "0";
    input.step = "0.25";
  }
  return input;
}

function makeTableTitleInput(task) {
  const input = document.createElement("textarea");
  input.className = "table-field table-title-input";
  input.dataset.field = "title";
  input.rows = 2;
  input.value = task.title;
  input.title = task.title;
  input.setAttribute("aria-label", `${task.title}のタスク名`);
  const resize = () => {
    input.style.height = "auto";
    const borderHeight = input.offsetHeight - input.clientHeight;
    input.style.height = `${input.scrollHeight + borderHeight}px`;
  };
  input.addEventListener("input", resize);
  requestAnimationFrame(resize);
  return input;
}

function renderTable(tasks) {
  const grouped = state.groupBy !== "none" && canGroupCurrentScope();
  const groups = grouped
    ? groupTasks(tasks, state.groupBy, getProjects())
    : [{ key: "all", label: "", tasks }];
  elements.table.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "task-table";
  table.innerHTML = `<thead><tr><th class="table-check-column">完了</th><th>タスク名</th><th>プロジェクト</th><th>ステータス</th><th>優先度</th><th>期限</th><th>繰り返し</th><th>タグ</th><th>工数（実績 / 見積）</th><th>サブタスク</th><th><span class="visually-hidden">操作</span></th></tr></thead>`;
  const body = document.createElement("tbody");
  const projects = getProjects();
  groups.forEach((group) => {
  if (grouped) {
    const groupRow = document.createElement("tr");
    groupRow.className = "table-group-row";
    const groupCell = document.createElement("th");
    groupCell.colSpan = 11;
    const heading = document.createElement("div");
    heading.className = "table-group-heading";
    const title = document.createElement("strong");
    title.textContent = group.label;
    if (state.groupBy === "project") applyNamedColor(title, group.key);
    const count = document.createElement("span");
    count.textContent = `${group.tasks.length}件`;
    heading.append(title, count);
    groupCell.append(heading);
    groupRow.append(groupCell);
    body.append(groupRow);
  }
  group.tasks.forEach((task) => {
    const row = document.createElement("tr");
    row.dataset.id = task.id;
    row.classList.toggle("is-completed", task.status === "done");
    row.classList.toggle("is-overdue", Boolean(task.due && task.due < todayISO() && task.status !== "done"));
    row.dataset.dueTone = dueTone(task.due, task.status);

    const checkCell = document.createElement("td");
    checkCell.className = "table-check-cell";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "table-complete-check";
    check.dataset.field = "completed";
    check.checked = task.status === "done";
    check.setAttribute("aria-label", task.status === "done" ? `「${task.title}」を未完了に戻す` : `「${task.title}」を完了にする`);
    checkCell.append(check);

    const titleCell = document.createElement("td");
    titleCell.className = "table-title-cell";
    titleCell.append(makeTableTitleInput(task));

    const projectCell = document.createElement("td");
    const projectSelect = makeTableSelect("project", task.project, projects.map((project) => [project, project]), `${task.title}のプロジェクト`, "project");
    applyNamedColor(projectSelect, task.project);
    projectCell.append(projectSelect);

    const statusCell = document.createElement("td");
    statusCell.append(makeTableSelect("status", task.status, [["todo", "未着手"], ["doing", "進行中"], ["done", "完了"]], `${task.title}のステータス`, "status"));

    const priorityCell = document.createElement("td");
    priorityCell.append(makeTableSelect("priority", task.priority, [["high", "高"], ["normal", "通常"], ["low", "低"]], `${task.title}の優先度`, "priority"));

    const dueCell = document.createElement("td");
    const dueInput = makeTableInput("due", task.due || "", "date", `${task.title}の期限`, "table-date-input table-color-field");
    dueInput.dataset.colorType = "due";
    dueInput.dataset.value = dueTone(task.due, task.status);
    dueCell.append(dueInput);

    const repeatCell = document.createElement("td");
    repeatCell.append(makeTableSelect("repeat", task.repeat, [["none", "なし"], ["daily", "毎日"], ["weekdays", "平日"], ["weekly", "毎週"], ["monthly", "毎月"]], `${task.title}の繰り返し`));

    const tagsCell = document.createElement("td");
    tagsCell.className = "table-tags-cell";
    tagsCell.append(makeTableInput("tags", task.tags.join(", "), "text", `${task.title}のタグ`, "table-tags-input"), makeTagRow(task.tags));

    const effortCell = document.createElement("td");
    effortCell.className = "table-effort-cell";
    effortCell.append(
      makeTableInput("actual", task.actual ? Number(task.actual.toFixed(2)) : "", "number", `${task.title}の実績工数`, "table-hours-input"),
      document.createTextNode(" / "),
      makeTableInput("estimate", task.estimate || "", "number", `${task.title}の見積工数`, "table-hours-input"),
    );

    const completedSubtasks = task.subtasks.filter((item) => item.completed).length;
    const subtaskCell = document.createElement("td");
    subtaskCell.className = "table-subtask-cell";
    const subtaskText = document.createElement("span");
    subtaskText.textContent = task.subtasks.length ? `${completedSubtasks} / ${task.subtasks.length}` : "—";
    subtaskCell.append(subtaskText);
    if (task.subtasks.length) {
      const progress = document.createElement("span");
      progress.className = "table-subtask-progress";
      progress.innerHTML = `<span style="width:${Math.round((completedSubtasks / task.subtasks.length) * 100)}%"></span>`;
      subtaskCell.append(progress);
    }

    const actionCell = document.createElement("td");
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "table-detail-button";
    detailButton.dataset.action = "detail";
    detailButton.textContent = "詳細";
    detailButton.setAttribute("aria-label", `「${task.title}」の詳細を開く`);
    actionCell.append(detailButton);

    row.append(checkCell, titleCell, projectCell, statusCell, priorityCell, dueCell, repeatCell, tagsCell, effortCell, subtaskCell, actionCell);
    body.append(row);
  });
  });
  table.append(body);
  wrapper.append(table);
  elements.table.append(wrapper);
}

function renderBoard() {
  const tasks = getVisibleTasks(true);
  const columns = [
    { id: "todo", title: "未着手", dot: "" },
    { id: "doing", title: "進行中", dot: "status-dot--doing" },
    { id: "done", title: "完了", dot: "status-dot--done" },
  ];
  elements.board.replaceChildren();
  columns.forEach((column) => {
    const columnTasks = tasks.filter((task) => task.status === column.id);
    const section = document.createElement("section");
    section.className = "kanban-column";
    section.dataset.status = column.id;
    section.innerHTML = `<header class="kanban-heading"><div><span class="status-dot ${column.dot}"></span><h2>${column.title}</h2></div><span class="kanban-count">${columnTasks.length}</span></header><div class="kanban-stack"></div>`;
    const stack = section.querySelector(".kanban-stack");
    columnTasks.forEach((task) => {
      const completed = task.subtasks.filter((item) => item.completed).length;
      const progress = task.subtasks.length ? Math.round((completed / task.subtasks.length) * 100) : 0;
      const card = document.createElement("article");
      card.className = "kanban-card";
      card.dataset.id = task.id;
      card.dataset.dueTone = dueTone(task.due, task.status);
      card.draggable = true;
      const title = document.createElement("h3");
      title.textContent = task.title;
      card.append(title, makeTagRow(task.tags));
      if (task.subtasks.length) {
        const bar = document.createElement("div");
        bar.className = "kanban-progress";
        bar.innerHTML = `<span style="width:${progress}%"></span>`;
        card.append(bar);
      }
      const meta = document.createElement("div");
      meta.className = "kanban-card-meta";
      const project = document.createElement("span");
      project.className = "kanban-card-project";
      project.textContent = task.project;
      applyNamedColor(project, task.project);
      const detail = document.createElement("span");
      detail.textContent = `${formatDeadlineLabel(task)}${task.estimate ? ` · ${formatHours(task.estimate)}` : ""}`;
      detail.className = "kanban-card-due";
      detail.dataset.tone = dueTone(task.due, task.status);
      meta.append(project, detail);
      card.append(meta);
      stack.append(card);
    });
    elements.board.append(section);
  });
  return tasks.length;
}

function renderTimeline() {
  const tasks = sortTasks(
    state.tasks.filter((task) => matchesCommonFilters(task) && (state.view !== "completed" || task.status === "done")),
    state.sortPrimary,
    state.sortSecondary,
  );
  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  for (let index = 0; index < 7; index += 1) {
    const iso = addDays(todayISO(), index);
    const dayTasks = tasks.filter((task) => task.due === iso);
    const day = document.createElement("section");
    day.className = `timeline-day${index === 0 ? " is-today" : ""}`;
    const date = new Date(`${iso}T12:00:00`);
    day.innerHTML = `<header class="timeline-day-header"><span>${new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date)}</span><strong>${date.getDate()}</strong></header><div class="timeline-day-list"></div>`;
    const dayList = day.querySelector(".timeline-day-list");
    dayTasks.forEach((task) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "timeline-task";
      item.dataset.id = task.id;
      item.dataset.project = task.project;
      item.dataset.dueTone = dueTone(task.due, task.status);
      applyNamedColor(item, task.project);
      const title = document.createElement("strong");
      title.textContent = task.title;
      const meta = document.createElement("span");
      meta.textContent = `${task.project}${task.estimate ? ` · ${formatHours(task.estimate)}` : ""}`;
      item.append(title, meta);
      dayList.append(item);
    });
    grid.append(day);
  }
  elements.timeline.replaceChildren(grid);
  const undated = tasks.filter((task) => !task.due && task.status !== "done").length;
  if (undated) {
    const note = document.createElement("div");
    note.className = "timeline-undated";
    note.textContent = `○ 期限未設定のタスクが ${undated}件あります`;
    elements.timeline.append(note);
  }
  return tasks.filter((task) => task.due && task.due >= todayISO() && task.due <= addDays(todayISO(), 6)).length;
}

function renderUpcomingCalendar() {
  const start = addDays(todayISO(), state.calendarOffset * 7);
  const end = addDays(start, 6);
  const tasks = sortTasks(
    state.tasks.filter((task) => task.due && task.due >= start && task.due <= end && matchesCommonFilters(task)),
    "due",
    "priority",
  );
  const toolbar = document.createElement("header");
  toolbar.className = "calendar-toolbar";
  const range = document.createElement("div");
  range.className = "calendar-range";
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const completedCount = tasks.filter((task) => task.status === "done").length;
  range.innerHTML = `<strong></strong><span>${tasks.length}件の予定${completedCount ? `（完了 ${completedCount}件）` : ""}</span>`;
  range.firstElementChild.textContent = `${new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(startDate)} — ${new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric" }).format(endDate)}`;
  const actions = document.createElement("div");
  actions.className = "calendar-actions";
  [["prev", "‹", "前の週"], ["today", "今日", "今週へ戻る"], ["next", "›", "次の週"]].forEach(([action, label, aria]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.calendarAction = action;
    button.textContent = label;
    button.setAttribute("aria-label", aria);
    actions.append(button);
  });
  toolbar.append(range, actions);

  const grid = document.createElement("div");
  grid.className = "upcoming-calendar-grid";
  for (let index = 0; index < 7; index += 1) {
    const iso = addDays(start, index);
    const date = new Date(`${iso}T12:00:00`);
    const day = document.createElement("section");
    day.className = `calendar-day${iso === todayISO() ? " is-today" : ""}`;
    const heading = document.createElement("header");
    heading.className = "calendar-day-heading";
    heading.innerHTML = `<span></span><strong></strong>`;
    heading.firstElementChild.textContent = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(date);
    heading.lastElementChild.textContent = date.getDate();
    const list = document.createElement("div");
    list.className = "calendar-task-list";
    const dayTasks = tasks.filter((task) => task.due === iso);
    dayTasks.forEach((task) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-task";
      button.classList.toggle("is-completed", task.status === "done");
      button.dataset.id = task.id;
      button.dataset.dueTone = dueTone(task.due, task.status);
      applyNamedColor(button, task.project);
      const title = document.createElement("strong");
      title.textContent = `${task.status === "done" ? "✓ " : ""}${task.title}`;
      const meta = document.createElement("span");
      meta.textContent = `▰ ${task.project}${task.estimate ? `  ◷ ${formatHours(task.estimate)}` : ""}`;
      button.append(title, meta);
      list.append(button);
    });
    if (!dayTasks.length) {
      const empty = document.createElement("span");
      empty.className = "calendar-day-empty";
      empty.textContent = "予定なし";
      list.append(empty);
    }
    day.append(heading, list);
    grid.append(day);
  }
  elements.upcomingCalendar.replaceChildren(toolbar, grid);
  return tasks.length;
}

function renderDeadlineSummary(stats) {
  elements.deadlineSummary.hidden = ["completed", "trash"].includes(state.view);
  elements.deadlineTotal.textContent = `期限あり ${stats.deadlines.total}件`;
  Object.entries(stats.deadlines).forEach(([key, value]) => {
    const count = elements.deadlineSummary.querySelector(`[data-deadline-count="${key}"]`);
    if (count) count.textContent = value;
  });
  elements.deadlineSummary.classList.toggle("has-overdue", stats.deadlines.overdue > 0);
}

function createReportCard(title, subtitle = "") {
  const card = document.createElement("section");
  card.className = "report-card";
  const heading = document.createElement("header");
  heading.className = "report-card-heading";
  const text = document.createElement("div");
  const titleElement = document.createElement("h2");
  titleElement.textContent = title;
  text.append(titleElement);
  if (subtitle) {
    const note = document.createElement("p");
    note.textContent = subtitle;
    text.append(note);
  }
  heading.append(text);
  const body = document.createElement("div");
  body.className = "report-card-body";
  card.append(heading, body);
  return { card, body, heading };
}

function appendReportBars(container, items, emptyMessage) {
  if (!items.length || items.every((item) => item.count === 0)) {
    const empty = document.createElement("p");
    empty.className = "report-empty";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  const maximum = Math.max(1, ...items.map((item) => item.count));
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "report-bar-row";
    const label = document.createElement("span");
    label.textContent = item.name;
    const track = document.createElement("div");
    track.className = `report-bar-track${item.tone ? ` report-bar-track--${item.tone}` : ""}`;
    const bar = document.createElement("span");
    bar.style.width = `${Math.max(5, (item.count / maximum) * 100)}%`;
    track.append(bar);
    const value = document.createElement("strong");
    value.textContent = `${item.count}件`;
    row.append(label, track, value);
    container.append(row);
  });
}

function renderReport(stats) {
  elements.report.replaceChildren();
  const statusCard = createReportCard("ステータス", `全${stats.total}件・完了率${stats.completionRate}%`);
  const statusTotal = Math.max(1, stats.total);
  const todoEnd = (stats.status.todo / statusTotal) * 100;
  const doingEnd = todoEnd + (stats.status.doing / statusTotal) * 100;
  const statusVisual = document.createElement("div");
  statusVisual.className = "status-chart";
  const donut = document.createElement("div");
  donut.className = "report-donut";
  donut.style.background = stats.total
    ? `conic-gradient(#9b978e 0 ${todoEnd}%, #4677ce ${todoEnd}% ${doingEnd}%, #5a9b70 ${doingEnd}% 100%)`
    : "#dedad2";
  donut.innerHTML = `<div><strong>${stats.completionRate}%</strong><span>完了</span></div>`;
  const statusLegend = document.createElement("div");
  statusLegend.className = "report-legend";
  [["未着手", stats.status.todo, "todo"], ["進行中", stats.status.doing, "doing"], ["完了", stats.status.done, "done"]].forEach(([label, count, tone]) => {
    const row = document.createElement("div");
    row.innerHTML = `<span class="legend-dot legend-dot--${tone}"></span><span></span><strong>${count}件</strong>`;
    row.children[1].textContent = label;
    statusLegend.append(row);
  });
  statusVisual.append(donut, statusLegend);
  statusCard.body.append(statusVisual);

  const priorityCard = createReportCard("優先度", `未完了${stats.active}件の内訳`);
  appendReportBars(priorityCard.body, [
    { name: "高", count: stats.priority.high, tone: "high" },
    { name: "通常", count: stats.priority.normal, tone: "normal" },
    { name: "低", count: stats.priority.low, tone: "low" },
  ], "未完了タスクはありません。");

  const effortCard = createReportCard("工数", "登録タスクの見積と実績");
  effortCard.body.classList.add("effort-summary-grid");
  [["見積合計", stats.effort.estimate, "estimate"], ["実績合計", stats.effort.actual, "actual"], ["差分", stats.effort.actual - stats.effort.estimate, "difference"]].forEach(([label, value, key]) => {
    const item = document.createElement("div");
    item.className = `effort-summary-item effort-summary-item--${key}`;
    const displayValue = key === "difference" && value > 0 ? `+${formatHours(value)}` : formatHours(value);
    item.innerHTML = `<span></span><strong></strong>`;
    item.firstElementChild.textContent = label;
    item.lastElementChild.textContent = displayValue;
    effortCard.body.append(item);
  });

  const projectCard = createReportCard("プロジェクト", "未完了タスクが多い順");
  appendReportBars(projectCard.body, stats.projects.slice(0, 6), "プロジェクト別の未完了タスクはありません。");

  const tagCard = createReportCard("タグ", "使用中のタグ上位");
  appendReportBars(tagCard.body, stats.tags.slice(0, 6), "未完了タスクにタグがありません。");

  const trendCard = createReportCard("完了したタスク", "直近7日間の推移");
  trendCard.card.classList.add("report-card--wide");
  const trend = document.createElement("div");
  trend.className = "completion-chart";
  const maxCompleted = Math.max(1, ...stats.completionTrend.map((item) => item.count));
  stats.completionTrend.forEach((item) => {
    const column = document.createElement("div");
    column.className = "completion-column";
    const value = document.createElement("strong");
    value.textContent = item.count;
    const bar = document.createElement("span");
    bar.style.height = `${item.count ? Math.max(12, (item.count / maxCompleted) * 100) : 3}%`;
    const date = document.createElement("small");
    date.textContent = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(`${item.date}T12:00:00`));
    column.append(value, bar, date);
    trend.append(column);
  });
  trendCard.body.append(trend);
  elements.report.append(statusCard.card, priorityCard.card, effortCard.card, projectCard.card, tagCard.card, trendCard.card);
  return stats.total;
}

function render() {
  const listTasks = getVisibleTasks(false);
  const trashView = state.view === "trash";
  const upcomingView = state.view === "upcoming";
  const reportView = state.view === "report";
  const dashboardTasks = state.activeProject
    ? state.tasks.filter((task) => task.project === state.activeProject)
    : state.tasks;
  const dashboardStats = calculateDashboardStats(dashboardTasks, todayISO());
  document.body.classList.toggle("is-upcoming", upcomingView);
  document.body.classList.toggle("is-wide-layout", upcomingView || reportView || ["table", "board", "timeline"].includes(state.mode));
  const groupingAvailable = !trashView && !upcomingView && !reportView && ["list", "table"].includes(state.mode) && canGroupCurrentScope();
  const addAllowed = !["upcoming", "completed", "trash", "report"].includes(state.view);
  elements.form.hidden = !addAllowed;
  elements.focusAdd.hidden = !addAllowed;
  elements.groupControl.hidden = !groupingAvailable;
  elements.list.hidden = upcomingView || reportView || (trashView ? false : state.mode !== "list");
  elements.table.hidden = upcomingView || reportView || trashView || state.mode !== "table";
  elements.board.hidden = upcomingView || reportView || trashView || state.mode !== "board";
  elements.timeline.hidden = upcomingView || reportView || trashView || state.mode !== "timeline";
  elements.upcomingCalendar.hidden = !upcomingView;
  elements.report.hidden = !reportView;
  elements.viewSwitcher.hidden = trashView || upcomingView || reportView;
  elements.listToolbar.hidden = trashView || upcomingView || reportView;
  elements.progress.hidden = upcomingView || reportView;
  let visibleCount = listTasks.length;
  if (upcomingView) visibleCount = renderUpcomingCalendar();
  else if (reportView) visibleCount = renderReport(dashboardStats);
  else if (trashView || state.mode === "list") renderList(listTasks);
  if (!upcomingView && !reportView && !trashView && state.mode === "table") renderTable(listTasks);
  if (!upcomingView && !reportView && !trashView && state.mode === "board") visibleCount = renderBoard();
  if (!upcomingView && !reportView && !trashView && state.mode === "timeline") visibleCount = renderTimeline();
  const emptyProject = Boolean(state.activeProject) && listTasks.length === 0;
  const showEmpty = !upcomingView && !reportView && (emptyProject || (visibleCount === 0 && state.mode !== "timeline"));
  elements.empty.hidden = !showEmpty;
  if (showEmpty) {
    elements.list.hidden = true;
    elements.table.hidden = true;
    elements.board.hidden = true;
    elements.timeline.hidden = true;
  }
  const emptyCopy = state.activeProject ? ["このプロジェクトは空です。", `上の追加欄から作成すると「${state.activeProject}」へ自動で追加されます。`] : ({
    upcoming: ["近日予定はありません。", "明日以降の期限を設定したタスクがここに表示されます。"],
    completed: ["完了したタスクはありません。", "タスクを完了するとここに成果が残ります。"],
    trash: ["ゴミ箱は空です。", "削除したタスクがここに表示されます。"],
  }[state.view] || ["いい流れです。", "ここに表示するタスクはありません。思いついたら上から追加しましょう。"]);
  [elements.emptyTitle.textContent, elements.emptyMessage.textContent] = emptyCopy;
  elements.summary.textContent = visibleCount ? `${visibleCount}件のタスク` : "タスクはありません";
  document.querySelectorAll(".view-mode-button").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === state.mode));
  renderDeadlineSummary(dashboardStats);
  updateNavigationCounts();
  updateProjectNavigation();
  elements.tagCount.textContent = collectTags(state.tasks, state.tags).length;
  updateFilterNavigation();
  updateHeading();
  updateProgress();
}

function updateNavigationCounts() {
  const today = todayISO();
  const counts = {
    today: state.tasks.filter((task) => task.status !== "done" && task.due && task.due <= today).length,
    all: state.tasks.filter((task) => task.status !== "done").length,
    upcoming: state.tasks.filter((task) => task.status !== "done" && task.due && task.due >= today).length,
    completed: state.tasks.filter((task) => task.status === "done").length,
    trash: state.trash.length,
  };
  Object.entries(counts).forEach(([key, value]) => {
    document.querySelector(`[data-count="${key}"]`).textContent = value;
  });
}

function getProjects() {
  return [...new Set([...state.projects, ...state.tasks.map((task) => task.project).filter(Boolean)])];
}

function createProjectNavigationRow(project, { favoriteSection = false, index = 0 } = {}) {
  const colors = ["dot--blue", "dot--coral", "dot--yellow"];
  const row = document.createElement("div");
  row.className = `project-row${state.activeProject === project ? " is-active" : ""}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-item project-link";
  button.dataset.project = project;
  const marker = document.createElement("span");
  marker.className = favoriteSection ? "project-favorite-marker" : `dot ${colors[index % colors.length]}`;
  marker.textContent = favoriteSection ? "★" : "";
  const label = document.createElement("span");
  label.className = "project-name";
  label.textContent = project;
  const count = document.createElement("span");
  count.className = "project-count";
  count.textContent = state.tasks.filter((task) => task.project === project && task.status !== "done").length;
  button.append(marker, label, count);
  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = `project-favorite-button${state.favoriteProjects.includes(project) ? " is-favorite" : ""}`;
  favorite.dataset.favoriteProject = project;
  favorite.textContent = state.favoriteProjects.includes(project) ? "★" : "☆";
  favorite.setAttribute("aria-label", state.favoriteProjects.includes(project) ? `「${project}」をお気に入りから外す` : `「${project}」をお気に入りに追加`);
  row.append(button, favorite);
  if (!favoriteSection && project !== "未分類") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "project-remove-button";
    remove.dataset.removeProject = project;
    remove.textContent = "×";
    remove.setAttribute("aria-label", `「${project}」プロジェクトを削除`);
    row.append(remove);
  }
  return row;
}

function updateProjectNavigation() {
  elements.projectNavigation.replaceChildren();
  getProjects().forEach((project, index) => elements.projectNavigation.append(createProjectNavigationRow(project, { index })));
  state.favoriteProjects = state.favoriteProjects.filter((project) => getProjects().includes(project));
  elements.favoriteProjectNavigation.replaceChildren(...state.favoriteProjects.map((project, index) => createProjectNavigationRow(project, { favoriteSection: true, index })));
  elements.favoriteProjectSection.hidden = state.favoriteProjects.length === 0;

  const selected = state.activeProject || elements.project.value || "未分類";
  elements.project.replaceChildren(...getProjects().map((project) => new Option(project, project)));
  elements.project.value = getProjects().includes(selected) ? selected : "未分類";
  elements.project.disabled = Boolean(state.activeProject);
  const editSelected = elements.editProject.value;
  elements.editProject.replaceChildren(...getProjects().map((project) => new Option(project, project)));
  if (getProjects().includes(editSelected)) elements.editProject.value = editSelected;
}

function toggleFavoriteProject(project) {
  if (!getProjects().includes(project)) return;
  state.favoriteProjects = state.favoriteProjects.includes(project)
    ? state.favoriteProjects.filter((item) => item !== project)
    : [...state.favoriteProjects, project];
  saveFavoriteProjects();
  render();
  showToast(state.favoriteProjects.includes(project) ? `「${project}」をお気に入りに追加しました` : `「${project}」をお気に入りから外しました`, { showUndo: false });
}

function deleteProject(project) {
  if (project === "未分類") return;
  const taskCount = [...state.tasks, ...state.trash].filter((task) => task.project === project).length;
  const message = taskCount
    ? `「${project}」を削除しますか？\n${taskCount}件のタスクは「未分類」へ移動します。`
    : `「${project}」を削除しますか？`;
  if (!confirm(message)) return;
  const result = removeProject(state.tasks, state.projects, state.favoriteProjects, state.savedFilters, project);
  const trashResult = removeProject(state.trash, [], [], [], project);
  if (!result.removed) return;
  state.tasks = result.tasks;
  state.trash = trashResult.tasks;
  state.projects = result.projects;
  state.favoriteProjects = result.favoriteProjects;
  state.savedFilters = result.savedFilters;
  if (state.activeProject === project) {
    state.activeProject = null;
    state.view = "all";
  }
  saveTasks({ recordUndo: false });
  saveProjects();
  saveFavoriteProjects();
  saveFilters();
  render();
  const moved = result.moved + trashResult.moved;
  showToast(moved ? `プロジェクトを削除し、${moved}件を「未分類」へ移動しました` : "プロジェクトを削除しました", { showUndo: false });
}

function renderTagManager() {
  state.tags = collectTags(state.tasks, state.tags);
  elements.tagManagerList.replaceChildren();
  elements.tagManagerEmpty.hidden = state.tags.length > 0;
  elements.tagCount.textContent = state.tags.length;
  state.tags.forEach((tag) => {
    const row = document.createElement("div");
    row.className = "tag-manager-row";
    row.dataset.tag = tag;
    const marker = document.createElement("span");
    marker.className = "tag-manager-marker";
    marker.textContent = "#";
    applyNamedColor(marker, tag);
    const input = document.createElement("input");
    input.value = tag;
    input.maxLength = 30;
    input.setAttribute("aria-label", `「${tag}」の名前`);
    const count = document.createElement("span");
    count.className = "tag-manager-usage";
    count.textContent = `${state.tasks.filter((task) => task.tags.includes(tag)).length}件`;
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "tag-manager-rename";
    rename.dataset.renameTag = tag;
    rename.textContent = "保存";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-manager-remove";
    remove.dataset.removeTag = tag;
    remove.textContent = "削除";
    row.append(marker, input, count, rename, remove);
    elements.tagManagerList.append(row);
  });
}

function openTagManager() {
  renderTagManager();
  elements.newTagName.value = "";
  elements.tagDialog.showModal();
  requestAnimationFrame(() => elements.newTagName.focus());
}

function addManagedTag() {
  const name = normalizeTagName(elements.newTagName.value);
  if (!name) return;
  if (state.tags.includes(name)) return showToast("同じタグがすでにあります", { showUndo: false });
  state.tags.push(name);
  saveTags();
  elements.newTagName.value = "";
  renderTagManager();
  elements.newTagName.focus();
  showToast("タグを追加しました", { showUndo: false });
}

function renameManagedTag(oldName, newName) {
  const normalized = normalizeTagName(newName);
  if (!normalized) return showToast("タグ名を入力してください", { showUndo: false });
  const result = renameTag(state.tasks, state.tags, state.savedFilters, oldName, normalized);
  const trashResult = renameTag(state.trash, [], [], oldName, normalized);
  if (!result.changed) return;
  state.tasks = result.tasks;
  state.trash = trashResult.tasks;
  state.tags = result.tags;
  state.savedFilters = result.savedFilters;
  saveTasks({ recordUndo: false }); saveTags(); saveFilters();
  render(); renderTagManager();
  showToast(result.affected ? `${result.affected}件のタスクのタグ名を変更しました` : "タグ名を変更しました", { showUndo: false });
}

function deleteManagedTag(name) {
  const usage = [...state.tasks, ...state.trash].filter((task) => task.tags.includes(name)).length;
  const message = usage ? `「#${name}」を削除しますか？\n${usage}件のタスクからも外れます。` : `「#${name}」を削除しますか？`;
  if (!confirm(message)) return;
  const result = removeTag(state.tasks, state.tags, state.savedFilters, name);
  const trashResult = removeTag(state.trash, [], [], name);
  state.tasks = result.tasks;
  state.trash = trashResult.tasks;
  state.tags = result.tags;
  state.savedFilters = result.savedFilters;
  saveTasks({ recordUndo: false }); saveTags(); saveFilters();
  render(); renderTagManager();
  showToast(result.affected ? `${result.affected}件のタスクからタグを削除しました` : "タグを削除しました", { showUndo: false });
}

function updateFilterNavigation() {
  elements.filterNavigation.replaceChildren();
  state.savedFilters.forEach((filter) => {
    const row = document.createElement("div");
    row.className = `saved-filter-row${state.activeFilterId === filter.id ? " is-active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-item saved-filter-button";
    button.dataset.filterId = filter.id;
    button.innerHTML = `<span class="nav-icon">⌁</span><span></span>`;
    button.lastElementChild.textContent = filter.name;
    const count = document.createElement("span");
    count.className = "project-count";
    count.textContent = state.tasks.filter((task) => matchesSavedFilter(task, filter, todayISO())).length;
    button.append(count);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "saved-filter-edit";
    edit.dataset.editFilter = filter.id;
    edit.textContent = "✎";
    edit.setAttribute("aria-label", `「${filter.name}」フィルターを編集`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "saved-filter-remove";
    remove.dataset.removeFilter = filter.id;
    remove.textContent = "×";
    remove.setAttribute("aria-label", `「${filter.name}」フィルターを削除`);
    row.append(button, edit, remove);
    elements.filterNavigation.append(row);
  });
}

function updateHeading() {
  const labels = {
    today: ["今日", "今日に集中しましょう。"],
    all: ["すべてのタスク", "やることを、ひと目で。"],
    upcoming: ["近日予定", "週ごとのカレンダーで、期限付きタスクを先まで見通せます。"],
    completed: ["完了したタスク", "積み重ねた成果です。"],
    trash: ["ゴミ箱", "削除したタスクを復元できます。"],
    report: ["レポート", "期限・進捗・工数をまとめて振り返れます。"],
  };
  const activeFilter = state.savedFilters.find((filter) => filter.id === state.activeFilterId);
  const [title, subtitle] = activeFilter
    ? [activeFilter.name, "保存した条件に一致するタスクです。"]
    : state.activeProject ? [state.activeProject, `${state.activeProject}プロジェクトのタスクです。`] : labels[state.view];
  elements.title.textContent = title;
  elements.subtitle.textContent = state.search ? `「${state.search}」の検索結果` : subtitle;
}

function updateProgress() {
  const scopeTasks = state.activeProject
    ? state.tasks.filter((task) => task.project === state.activeProject)
    : state.tasks.filter((task) => task.due === todayISO());
  const completed = scopeTasks.filter((task) => task.status === "done").length;
  const percent = scopeTasks.length ? Math.round((completed / scopeTasks.length) * 100) : 0;
  const label = state.activeProject ? `${state.activeProject}プロジェクトの進捗率` : "今日の達成率";
  elements.progress.style.setProperty("--progress", `${percent * 3.6}deg`);
  elements.progressValue.textContent = `${percent}%`;
  elements.progress.setAttribute("aria-label", `${label} ${percent}%（${completed} / ${scopeTasks.length}件完了）`);
}

function showToast(message, { showUndo = undoStack.length > 0 } = {}) {
  elements.toastMessage.textContent = message;
  elements.undoButton.hidden = !showUndo;
  elements.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    elements.undoButton.hidden = true;
  }, showUndo ? 8000 : 1800);
}

function undoLastChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) return showToast("元に戻せる変更はありません", { showUndo: false });
  const previous = JSON.parse(snapshot);
  state.tasks = previous.tasks.map(normalizeTask);
  state.trash = previous.trash.map(normalizeTask);
  saveTasks({ recordUndo: false });
  render();
  showToast("直前の変更を元に戻しました", { showUndo: undoStack.length > 0 });
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function refreshCsvPreview() {
  elements.csvImportError.textContent = "";
  elements.csvPreviewHead.replaceChildren();
  elements.csvPreviewBody.replaceChildren();
  if (!state.csvParsed) return;
  const { tasks, skippedRows } = csvRowsToTasks(state.csvParsed, state.csvMapping);
  const headers = ["タスク名", "状態", "優先度", "期限", "プロジェクト"];
  const headerRow = document.createElement("tr");
  headers.forEach((label) => { const th = document.createElement("th"); th.textContent = label; headerRow.append(th); });
  elements.csvPreviewHead.append(headerRow);
  const statusLabels = { todo: "未着手", doing: "進行中", done: "完了" };
  const priorityLabels = { high: "高", normal: "通常", low: "低" };
  tasks.slice(0, 5).forEach((task) => {
    const row = document.createElement("tr");
    [task.title, statusLabels[task.status], priorityLabels[task.priority], task.due || "期限なし", task.project].forEach((value) => {
      const cell = document.createElement("td"); cell.textContent = value; cell.title = value; row.append(cell);
    });
    elements.csvPreviewBody.append(row);
  });
  elements.csvPreviewSummary.textContent = `${tasks.length}件${skippedRows.length ? `・空欄${skippedRows.length}行を除外` : ""}`;
  const hasTitle = Number(state.csvMapping.title) >= 0;
  elements.executeCsvImport.disabled = !hasTitle || !tasks.length;
  if (!hasTitle) elements.csvImportError.textContent = "「タスク名」に使う列を選択してください。";
}

function renderCsvMapping() {
  elements.csvMappingGrid.replaceChildren();
  CSV_FIELDS.forEach((field) => {
    const row = document.createElement("div");
    row.className = "mapping-row";
    const label = document.createElement("label");
    label.textContent = field.label;
    if (field.required) { const required = document.createElement("b"); required.textContent = " 必須"; label.append(required); }
    const select = document.createElement("select");
    select.dataset.field = field.key;
    select.setAttribute("aria-label", `${field.label}に割り当てるCSV列`);
    select.append(new Option("使用しない", "-1"));
    state.csvParsed.headers.forEach((header, index) => select.append(new Option(header, String(index))));
    select.value = String(state.csvMapping[field.key] ?? -1);
    row.append(label, select);
    elements.csvMappingGrid.append(row);
  });
  refreshCsvPreview();
}

async function prepareCsvImport(file) {
  try {
    prepareCsvText(await file.text(), file.name);
  } catch (error) {
    state.csvParsed = null;
    showToast(`CSVを読み込めませんでした：${error.message}`);
  }
}

function prepareCsvText(text, sourceName = "貼り付けたCSV") {
  try {
    const parsed = parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) throw new Error("見出しとデータ行を確認してください");
    state.csvParsed = parsed;
    state.csvMapping = autoMapHeaders(parsed.headers);
    elements.csvFileName.textContent = sourceName;
    elements.csvFileMeta.textContent = `${parsed.rows.length}行・${parsed.headers.length}列`;
    elements.csvImportError.textContent = "";
    elements.csvImportContent.hidden = false;
    renderCsvMapping();
    if (!elements.csvImportDialog.open) elements.csvImportDialog.showModal();
    return true;
  } catch (error) {
    state.csvParsed = null;
    elements.csvImportContent.hidden = true;
    elements.executeCsvImport.disabled = true;
    elements.csvImportError.textContent = `内容を読み取れませんでした：${error.message}`;
    if (!elements.csvImportDialog.open) elements.csvImportDialog.showModal();
    return false;
  }
}

function openCsvPasteDialog() {
  state.csvParsed = null;
  state.csvMapping = {};
  elements.csvPasteInput.value = "";
  elements.csvFileName.textContent = "CSVを貼り付け";
  elements.csvFileMeta.textContent = "Excelの表をコピーしても使えます";
  elements.csvImportError.textContent = "";
  elements.csvImportContent.hidden = true;
  elements.executeCsvImport.disabled = true;
  elements.csvImportDialog.showModal();
  requestAnimationFrame(() => elements.csvPasteInput.focus());
}

function currentBackupSettings() {
  return {
    theme: document.body.classList.contains("is-dark") ? "dark" : "light",
    mode: state.mode,
    sortPrimary: state.sortPrimary,
    sortSecondary: state.sortSecondary,
    groupBy: state.groupBy,
    trash: state.trash,
    savedFilters: state.savedFilters,
    favoriteProjects: state.favoriteProjects,
    tags: state.tags,
  };
}

function createSyncSnapshot() {
  return JSON.parse(createBackup(state.tasks, getProjects(), currentBackupSettings()));
}

function applySyncSnapshot(snapshot) {
  const parsed = parseBackup(JSON.stringify(snapshot));
  applyingSyncSnapshot = true;
  try {
    state.tasks = parsed.tasks;
    state.projects = [...new Set(["未分類", ...parsed.projects])];
    applyBackupSettings(parsed.settings);
    saveTasks({ recordUndo: false, sync: false });
    saveProjects();
    saveTags();
    saveFilters();
    saveFavoriteProjects();
    savedTaskSnapshot = JSON.stringify({ tasks: state.tasks, trash: state.trash });
  } finally {
    applyingSyncSnapshot = false;
  }
  render();
  return true;
}

function applyBackupSettings(settings) {
  if (Array.isArray(settings.trash)) state.trash = settings.trash.map(normalizeTask);
  if (Array.isArray(settings.savedFilters)) {
    state.savedFilters = settings.savedFilters.map(normalizeSavedFilter).filter((filter) => filter.name);
    saveFilters();
  }
  if (Array.isArray(settings.favoriteProjects)) {
    state.favoriteProjects = settings.favoriteProjects.map(normalizeProjectName).filter(Boolean);
    saveFavoriteProjects();
  }
  if (Array.isArray(settings.tags)) state.tags = collectTags(state.tasks, settings.tags);
  if (settings.theme === "dark" || settings.theme === "light") {
    document.body.classList.toggle("is-dark", settings.theme === "dark");
    localStorage.setItem(THEME_KEY, settings.theme);
  }
  if (["list", "table", "board", "timeline"].includes(settings.mode)) {
    state.mode = settings.mode;
    localStorage.setItem(MODE_KEY, settings.mode);
  }
  if (["due", "priority", "status", "newest", "oldest"].includes(settings.sortPrimary)) {
    state.sortPrimary = settings.sortPrimary;
    elements.sortPrimary.value = settings.sortPrimary;
    localStorage.setItem(SORT_PRIMARY_KEY, settings.sortPrimary);
  }
  if (["priority", "due", "status", "project", "none"].includes(settings.sortSecondary)) {
    state.sortSecondary = settings.sortSecondary;
    elements.sortSecondary.value = settings.sortSecondary;
    localStorage.setItem(SORT_SECONDARY_KEY, settings.sortSecondary);
  }
  if (["none", "project", "tag", "priority"].includes(settings.groupBy)) {
    state.groupBy = settings.groupBy;
    elements.groupSelect.value = settings.groupBy;
    localStorage.setItem(GROUP_KEY, settings.groupBy);
  }
}

function setView(view, project = null) {
  state.view = view;
  if (view === "upcoming") state.calendarOffset = 0;
  state.activeProject = project;
  state.activeFilterId = null;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("is-active", !project && item.dataset.view === view));
  closeSidebar();
  render();
}

function setSavedFilter(filterId) {
  if (!state.savedFilters.some((filter) => filter.id === filterId)) return;
  state.view = "all";
  state.activeProject = null;
  state.activeFilterId = filterId;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("is-active"));
  closeSidebar();
  render();
}

function openSidebar() {
  elements.sidebar.classList.add("is-open");
  elements.scrim.classList.add("is-open");
}

function closeSidebar() {
  elements.sidebar.classList.remove("is-open");
  elements.scrim.classList.remove("is-open");
}

function updateEffortPreview() {
  const estimate = Number(elements.editEstimate.value) || 0;
  const actual = Number(elements.editActual.value) || 0;
  if (!estimate) elements.effortBalance.textContent = actual ? `実績 ${formatHours(actual)}` : "未設定";
  else {
    const difference = estimate - actual;
    elements.effortBalance.textContent = difference >= 0 ? `残り ${formatHours(difference)}` : `${formatHours(Math.abs(difference))} 超過`;
  }
}

function syncTimerDisplays(now = Date.now()) {
  document.querySelectorAll("[data-timer-task]").forEach((button) => {
    const task = state.tasks.find((item) => item.id === button.dataset.timerTask);
    if (!task) return;
    const running = Boolean(task.timerStartedAt);
    button.classList.toggle("is-running", running);
    button.querySelector(".timer-icon").textContent = running ? "■" : "▶";
    button.querySelector(".timer-value").textContent = running ? formatTimer(activeTimerSeconds(task, now)) : "開始";
  });
  document.querySelectorAll("[data-effort-task]").forEach((label) => {
    const task = state.tasks.find((item) => item.id === label.dataset.effortTask);
    if (!task || !task.timerStartedAt) return;
    label.textContent = `${formatHours(getLiveActualHours(task, now))}${task.estimate ? ` / ${formatHours(task.estimate)}` : ""}`;
  });
  const dialogTask = state.tasks.find((item) => item.id === elements.editId.value);
  if (elements.dialog.open && dialogTask) {
    const running = Boolean(dialogTask.timerStartedAt);
    elements.timerDisplay.textContent = formatTimer((dialogTask.trackedSeconds || 0) + activeTimerSeconds(dialogTask, now));
    elements.toggleTaskTimer.classList.toggle("is-running", running);
    elements.toggleTaskTimer.innerHTML = running ? "<span>■</span> 計測を停止" : "<span>▶</span> 計測を開始";
  }
}

function toggleTaskTimer(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const now = Date.now();
  if (task.timerStartedAt) {
    Object.assign(task, stopTaskTimer(task, now));
    showToast(`「${task.title}」の計測を停止し、実績へ加算しました`, { showUndo: false });
  } else {
    state.tasks.forEach((item) => {
      if (item.timerStartedAt) Object.assign(item, stopTaskTimer(item, now));
    });
    Object.assign(task, startTaskTimer(task, now));
    showToast(`「${task.title}」の時間計測を開始しました`, { showUndo: false });
  }
  saveTasks();
  if (elements.dialog.open && elements.editId.value === task.id) elements.editActual.value = Number(getLiveActualHours(task, now).toFixed(2)) || "";
  render();
  updateEffortPreview();
  syncTimerDisplays(now);
}

function renderSubtaskEditor() {
  elements.subtaskList.replaceChildren();
  elements.subtaskList.className = "subtask-list";
  state.subtaskDraft.forEach((subtask) => {
    const row = document.createElement("div");
    row.className = `subtask-row${subtask.completed ? " is-done" : ""}`;
    row.dataset.id = subtask.id;
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = subtask.completed;
    check.setAttribute("aria-label", `${subtask.title}を完了にする`);
    const title = document.createElement("span");
    title.textContent = subtask.title;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "subtask-remove";
    remove.setAttribute("aria-label", "サブタスクを削除");
    remove.textContent = "×";
    row.append(check, title, remove);
    elements.subtaskList.append(row);
  });
  const done = state.subtaskDraft.filter((item) => item.completed).length;
  elements.subtaskProgress.textContent = `${done} / ${state.subtaskDraft.length}`;
}

function openTaskDialog(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  elements.taskDialogEyebrow.textContent = "TASK DETAILS";
  elements.taskDialogTitle.textContent = "タスクを編集";
  elements.saveTaskButton.textContent = "変更を保存";
  elements.deleteTaskButton.hidden = false;
  elements.editId.value = task.id;
  elements.editTitle.value = task.title;
  elements.editStatus.value = task.status;
  elements.editPriority.value = task.priority;
  elements.editDue.value = task.due || "";
  elements.editProject.value = task.project;
  elements.editNewProject.value = "";
  elements.editTags.value = task.tags.join(", ");
  elements.editRepeat.value = task.repeat;
  elements.editEstimate.value = task.estimate || "";
  elements.editActual.value = task.actual ? Number(task.actual.toFixed(2)) : "";
  state.subtaskDraft = task.subtasks.map((item) => ({ ...item }));
  renderSubtaskEditor();
  updateEffortPreview();
  elements.timerPanel.hidden = false;
  elements.dialog.showModal();
  syncTimerDisplays();
  requestAnimationFrame(() => elements.editTitle.focus());
}

function getQuickDueDate() {
  if (elements.due.value === "today") return todayISO();
  if (elements.due.value === "tomorrow") return addDays(todayISO(), 1);
  return null;
}

function openNewTaskDialog() {
  elements.taskDialogEyebrow.textContent = "NEW TASK";
  elements.taskDialogTitle.textContent = "タスクを詳しく追加";
  elements.saveTaskButton.textContent = "タスクを追加";
  elements.deleteTaskButton.hidden = true;
  elements.editId.value = "";
  elements.editTitle.value = elements.input.value.trim();
  elements.editStatus.value = "todo";
  elements.editPriority.value = elements.priority.value;
  elements.editDue.value = getQuickDueDate() || "";
  elements.editProject.value = resolveProject(state.activeProject, elements.project.value);
  elements.editNewProject.value = "";
  elements.editTags.value = "";
  elements.editRepeat.value = "none";
  elements.editEstimate.value = "";
  elements.editActual.value = "";
  state.subtaskDraft = [];
  renderSubtaskEditor();
  updateEffortPreview();
  elements.timerPanel.hidden = true;
  elements.dialog.showModal();
  requestAnimationFrame(() => elements.editTitle.focus());
}

function addSubtask() {
  const title = elements.subtaskInput.value.trim();
  if (!title) return;
  state.subtaskDraft.push({ id: makeId(), title, completed: false });
  elements.subtaskInput.value = "";
  renderSubtaskEditor();
  elements.subtaskInput.focus();
}

function createNextOccurrenceIfNeeded(task, previousStatus) {
  if (previousStatus === "done" || task.status !== "done" || task.repeat === "none") return null;
  const next = createNextRecurringTask(task, todayISO());
  if (next) state.tasks.unshift(next);
  return next;
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = elements.input.value.trim();
  if (!title) return;
  const dueChoice = elements.due.value;
  const due = dueChoice === "today" ? todayISO() : dueChoice === "tomorrow" ? addDays(todayISO(), 1) : null;
  state.tasks.unshift(normalizeTask({ title, due, project: resolveProject(state.activeProject, elements.project.value), priority: elements.priority.value, status: "todo", createdAt: Date.now() }));
  saveTasks();
  elements.input.value = "";
  if (state.view === "completed") setView("all");
  else render();
  showToast("タスクを追加しました");
});

document.querySelector("#open-detailed-add").addEventListener("click", openNewTaskDialog);

elements.list.addEventListener("click", (event) => {
  const card = event.target.closest(".task-card");
  if (!card) return;
  if (state.view === "trash") {
    const task = state.trash.find((item) => item.id === card.dataset.id);
    const action = event.target.closest("[data-trash-action]")?.dataset.trashAction;
    if (!task || !action) return;
    if (action === "restore") {
      state.trash = state.trash.filter((item) => item.id !== task.id);
      state.tasks.unshift(normalizeTask({ ...task, deletedAt: null }));
      saveTasks(); render(); showToast(`「${task.title}」を復元しました`);
    }
    if (action === "delete" && confirm(`「${task.title}」を完全に削除しますか？`)) {
      state.trash = state.trash.filter((item) => item.id !== task.id);
      saveTasks(); render(); showToast("完全に削除しました");
    }
    return;
  }
  const task = state.tasks.find((item) => item.id === card.dataset.id);
  if (!task) return;
  if (event.target.closest(".task-check")) {
    if (task.timerStartedAt) Object.assign(task, stopTaskTimer(task));
    const previousStatus = task.status;
    task.status = task.status === "done" ? "todo" : "done";
    task.completed = task.status === "done";
    task.completedAt = task.completed ? Date.now() : null;
    const nextOccurrence = createNextOccurrenceIfNeeded(task, previousStatus);
    saveTasks(); render();
    showToast(nextOccurrence ? `完了しました。次回は${formatDate(nextOccurrence.due)}です` : task.completed ? "おつかれさま！ 1つ完了しました" : "未完了に戻しました");
  } else if (event.target.closest(".task-timer-button")) {
    toggleTaskTimer(task.id);
  } else if (event.target.closest(".priority-button")) {
    task.priority = task.priority === "high" ? "normal" : "high";
    saveTasks(); render();
  } else {
    openTaskDialog(task.id);
  }
});

elements.table.addEventListener("click", (event) => {
  const detailButton = event.target.closest("[data-action='detail']");
  const row = event.target.closest("tr[data-id]");
  if (detailButton && row) openTaskDialog(row.dataset.id);
});

elements.table.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  const row = event.target.closest("tr[data-id]");
  const task = state.tasks.find((item) => item.id === row?.dataset.id);
  if (!field || !task) return;
  const nextField = field === "completed" ? "status" : field;
  const nextValue = field === "completed" ? (event.target.checked ? "done" : "todo") : event.target.value;
  const previousStatus = task.status;
  const updated = applyTableEdit(task, nextField, nextValue);
  if (field === "title" && updated.title === task.title && !String(nextValue).trim()) {
    render();
    return showToast("タスク名は空にできません");
  }
  Object.assign(task, updated);
  if (task.status === "done" && task.timerStartedAt) Object.assign(task, stopTaskTimer(task));
  const nextOccurrence = createNextOccurrenceIfNeeded(task, previousStatus);
  if (nextField === "project" && !state.projects.includes(task.project)) {
    state.projects.push(task.project);
    saveProjects();
  }
  saveTasks();
  render();
  showToast(nextOccurrence ? `完了しました。次回は${formatDate(nextOccurrence.due)}です` : "テーブルの変更を保存しました");
});

elements.table.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("input.table-field, textarea.table-title-input")) {
    event.preventDefault();
    event.target.dispatchEvent(new Event("change", { bubbles: true }));
  }
});

elements.board.addEventListener("click", (event) => {
  const card = event.target.closest(".kanban-card");
  if (card) openTaskDialog(card.dataset.id);
});

elements.timeline.addEventListener("click", (event) => {
  const task = event.target.closest(".timeline-task");
  if (task) openTaskDialog(task.dataset.id);
});

elements.upcomingCalendar.addEventListener("click", (event) => {
  const action = event.target.closest("[data-calendar-action]")?.dataset.calendarAction;
  if (action) {
    if (action === "prev") state.calendarOffset -= 1;
    if (action === "next") state.calendarOffset += 1;
    if (action === "today") state.calendarOffset = 0;
    render();
    return;
  }
  const task = event.target.closest(".calendar-task");
  if (task) openTaskDialog(task.dataset.id);
});

document.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-id][draggable='true']");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("is-dragging");
});

document.addEventListener("dragend", (event) => event.target.closest("[draggable='true']")?.classList.remove("is-dragging"));
elements.board.addEventListener("dragover", (event) => {
  const column = event.target.closest(".kanban-column");
  if (!column) return;
  event.preventDefault();
  document.querySelectorAll(".kanban-column").forEach((item) => item.classList.toggle("is-drag-over", item === column));
});
elements.board.addEventListener("dragleave", (event) => {
  const column = event.target.closest(".kanban-column");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
});
elements.board.addEventListener("drop", (event) => {
  const column = event.target.closest(".kanban-column");
  if (!column) return;
  event.preventDefault();
  const task = state.tasks.find((item) => item.id === event.dataTransfer.getData("text/plain"));
  if (!task) return;
  const previousStatus = task.status;
  if (column.dataset.status === "done" && task.timerStartedAt) Object.assign(task, stopTaskTimer(task));
  task.status = column.dataset.status;
  task.completed = task.status === "done";
  task.completedAt = task.completed ? Date.now() : null;
  const nextOccurrence = createNextOccurrenceIfNeeded(task, previousStatus);
  saveTasks(); render(); showToast(nextOccurrence ? `完了しました。次回は${formatDate(nextOccurrence.due)}です` : `「${column.querySelector("h2").textContent}」へ移動しました`);
});

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
function handleProjectNavigationClick(event) {
  const removeProjectName = event.target.closest("[data-remove-project]")?.dataset.removeProject;
  if (removeProjectName) return deleteProject(removeProjectName);
  const favoriteProject = event.target.closest("[data-favorite-project]")?.dataset.favoriteProject;
  if (favoriteProject) return toggleFavoriteProject(favoriteProject);
  const button = event.target.closest("[data-project]");
  if (button) setView("all", button.dataset.project);
}
elements.projectNavigation.addEventListener("click", handleProjectNavigationClick);
elements.favoriteProjectNavigation.addEventListener("click", handleProjectNavigationClick);
elements.filterNavigation.addEventListener("click", (event) => {
  const editId = event.target.closest("[data-edit-filter]")?.dataset.editFilter;
  if (editId) {
    const filter = state.savedFilters.find((item) => item.id === editId);
    if (filter) openFilterDialog(filter);
    return;
  }
  const removeId = event.target.closest("[data-remove-filter]")?.dataset.removeFilter;
  if (removeId) {
    const filter = state.savedFilters.find((item) => item.id === removeId);
    if (!filter || !confirm(`「${filter.name}」フィルターを削除しますか？`)) return;
    state.savedFilters = state.savedFilters.filter((item) => item.id !== removeId);
    if (state.activeFilterId === removeId) setView("all");
    saveFilters(); render(); showToast("フィルターを削除しました", { showUndo: false });
    return;
  }
  const filterId = event.target.closest("[data-filter-id]")?.dataset.filterId;
  if (filterId) setSavedFilter(filterId);
});
document.querySelectorAll(".view-mode-button").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  localStorage.setItem(MODE_KEY, state.mode);
  scheduleSyncSnapshot();
  render();
}));

elements.search.addEventListener("input", () => { state.search = elements.search.value.trim(); render(); });
elements.sortPrimary.value = state.sortPrimary;
elements.sortSecondary.value = state.sortSecondary;
elements.groupSelect.value = state.groupBy;
elements.groupSelect.addEventListener("change", () => {
  state.groupBy = elements.groupSelect.value;
  localStorage.setItem(GROUP_KEY, state.groupBy);
  scheduleSyncSnapshot();
  render();
});
elements.sortPrimary.addEventListener("change", () => {
  state.sortPrimary = elements.sortPrimary.value;
  localStorage.setItem(SORT_PRIMARY_KEY, state.sortPrimary);
  scheduleSyncSnapshot();
  render();
});
elements.sortSecondary.addEventListener("change", () => {
  state.sortSecondary = elements.sortSecondary.value;
  localStorage.setItem(SORT_SECONDARY_KEY, state.sortSecondary);
  scheduleSyncSnapshot();
  render();
});

elements.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const isCreating = !elements.editId.value;
  const baseTask = isCreating
    ? normalizeTask({ title: elements.editTitle.value.trim(), createdAt: Date.now() })
    : state.tasks.find((item) => item.id === elements.editId.value);
  if (!baseTask || !elements.editTitle.value.trim()) return;
  const task = applyTaskDetails(baseTask, {
    title: elements.editTitle.value,
    status: elements.editStatus.value,
    priority: elements.editPriority.value,
    due: elements.editDue.value,
    project: normalizeProjectName(elements.editNewProject.value) || elements.editProject.value,
    tags: elements.editTags.value,
    estimate: elements.editEstimate.value,
    actual: elements.editActual.value,
    subtasks: state.subtaskDraft,
    repeat: elements.editRepeat.value,
  });
  if (!state.projects.includes(task.project)) {
    state.projects.push(task.project);
    saveProjects();
  }
  if (isCreating) state.tasks.unshift(task);
  else {
    const previousStatus = baseTask.status;
    Object.assign(baseTask, task);
    if (baseTask.status === "done" && baseTask.timerStartedAt) Object.assign(baseTask, stopTaskTimer(baseTask));
    createNextOccurrenceIfNeeded(baseTask, previousStatus);
  }
  saveTasks();
  elements.dialog.close();
  if (isCreating) elements.input.value = "";
  render();
  showToast(isCreating ? "詳しい設定でタスクを追加しました" : "変更を保存しました");
});

document.querySelector("#open-project-dialog").addEventListener("click", () => {
  elements.newProjectName.value = "";
  elements.newProjectFavorite.checked = false;
  elements.projectDialog.showModal();
  requestAnimationFrame(() => elements.newProjectName.focus());
});

document.querySelector("#open-tag-dialog").addEventListener("click", openTagManager);
document.querySelector("#open-tag-manager").addEventListener("click", openTagManager);
document.querySelector("#add-tag").addEventListener("click", addManagedTag);
elements.newTagName.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  addManagedTag();
});
elements.tagManagerList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.target.matches("input")) return;
  event.preventDefault();
  renameManagedTag(event.target.closest("[data-tag]").dataset.tag, event.target.value);
});
elements.tagManagerList.addEventListener("click", (event) => {
  const renameName = event.target.closest("[data-rename-tag]")?.dataset.renameTag;
  if (renameName) {
    const row = event.target.closest("[data-tag]");
    return renameManagedTag(renameName, row.querySelector("input").value);
  }
  const removeName = event.target.closest("[data-remove-tag]")?.dataset.removeTag;
  if (removeName) deleteManagedTag(removeName);
});

function openFilterDialog(filter = null) {
  elements.filterId.value = filter?.id || "";
  elements.filterDialogEyebrow.textContent = filter ? "EDIT FILTER" : "SAVED FILTER";
  elements.filterDialogTitle.textContent = filter ? "フィルターを編集" : "フィルターを保存";
  elements.saveFilterButton.textContent = filter ? "変更を保存" : "保存する";
  elements.filterName.value = filter?.name || "";
  elements.filterProject.replaceChildren(new Option("すべて", "any"), ...getProjects().map((project) => new Option(project, project)));
  elements.filterProject.value = filter?.project || "any";
  elements.filterStatus.value = filter?.status || "any";
  elements.filterPriority.value = filter?.priority || "any";
  elements.filterDue.value = filter?.due || "any";
  elements.filterTag.value = filter?.tag || "";
  elements.filterDialog.showModal();
  requestAnimationFrame(() => elements.filterName.focus());
}

document.querySelector("#open-filter-dialog").addEventListener("click", () => openFilterDialog());

elements.filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const editingId = elements.filterId.value;
  const filter = normalizeSavedFilter({
    id: editingId || undefined,
    name: elements.filterName.value,
    project: elements.filterProject.value,
    status: elements.filterStatus.value,
    priority: elements.filterPriority.value,
    due: elements.filterDue.value,
    tag: elements.filterTag.value,
  });
  if (!filter.name) return;
  if (editingId) {
    const index = state.savedFilters.findIndex((item) => item.id === editingId);
    if (index < 0) return;
    state.savedFilters[index] = filter;
  } else {
    state.savedFilters.push(filter);
  }
  saveFilters();
  elements.filterDialog.close();
  setSavedFilter(filter.id);
  showToast(editingId ? "フィルターを更新しました" : "フィルターを保存しました", { showUndo: false });
});

elements.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const result = addProject(state.projects, elements.newProjectName.value);
  if (!result.name) return;
  state.projects = result.projects;
  if (result.added) {
    saveProjects();
  }
  if (elements.newProjectFavorite.checked && !state.favoriteProjects.includes(result.name)) {
    state.favoriteProjects.push(result.name);
    saveFavoriteProjects();
  }
  elements.projectDialog.close();
  setView("all", result.name);
  showToast(result.added ? "プロジェクトを追加しました" : "既存のプロジェクトを開きました");
});

elements.newProjectName.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  elements.projectForm.requestSubmit();
});

document.querySelector("#csv-import-button").addEventListener("click", () => {
  elements.csvFileInput.value = "";
  elements.csvFileInput.click();
});
document.querySelector("#csv-paste-button").addEventListener("click", openCsvPasteDialog);
document.querySelector("#parse-csv-paste").addEventListener("click", () => prepareCsvText(elements.csvPasteInput.value));
elements.csvPasteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !event.ctrlKey) return;
  event.preventDefault();
  prepareCsvText(elements.csvPasteInput.value);
});
document.querySelector("#change-csv-file").addEventListener("click", () => {
  elements.csvFileInput.value = "";
  elements.csvFileInput.click();
});
elements.csvFileInput.addEventListener("change", () => {
  const file = elements.csvFileInput.files?.[0];
  if (file) prepareCsvImport(file);
});
elements.csvMappingGrid.addEventListener("change", (event) => {
  const select = event.target.closest("select[data-field]");
  if (!select) return;
  state.csvMapping[select.dataset.field] = Number(select.value);
  refreshCsvPreview();
});
elements.csvImportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.csvParsed || Number(state.csvMapping.title) < 0) return refreshCsvPreview();
  const converted = csvRowsToTasks(state.csvParsed, state.csvMapping);
  if (!converted.tasks.length) return refreshCsvPreview();
  const replace = elements.csvImportMode.value === "replace";
  if (replace && !confirm(`現在の${state.tasks.length}件を削除し、CSVのタスクに置き換えますか？`)) return;
  const merged = mergeImportedTasks(state.tasks, converted.tasks, {
    mode: replace ? "replace" : "append",
    skipDuplicates: elements.csvDuplicateMode.value === "skip",
  });
  state.tasks = merged.tasks;
  const importedProjects = converted.tasks.map((task) => task.project);
  state.projects = replace
    ? [...new Set(["未分類", "個人", "仕事", "買い物", ...importedProjects])]
    : [...new Set([...state.projects, ...importedProjects])];
  saveTasks();
  saveProjects();
  elements.csvImportDialog.close();
  setView("all");
  const skippedTotal = merged.skipped + converted.skippedRows.length;
  showToast(`${merged.added}件を取り込みました${skippedTotal ? `（${skippedTotal}件スキップ）` : ""}`);
});

document.querySelector("#csv-export-button").addEventListener("click", () => {
  const date = todayISO().replace(/-/g, "");
  downloadTextFile(`listo-tasks-${date}.csv`, tasksToCSV(state.tasks), "text/csv;charset=utf-8");
  showToast(`${state.tasks.length}件をCSVへ出力しました`);
});

document.querySelector("#json-export-button").addEventListener("click", () => {
  const date = todayISO().replace(/-/g, "");
  downloadTextFile(`listo-backup-${date}.json`, createBackup(state.tasks, state.projects, currentBackupSettings()), "application/json;charset=utf-8");
  showToast("JSONバックアップを保存しました");
});

document.querySelector("#json-import-button").addEventListener("click", () => {
  elements.jsonFileInput.value = "";
  elements.jsonFileInput.click();
});
elements.jsonFileInput.addEventListener("change", async () => {
  const file = elements.jsonFileInput.files?.[0];
  if (!file) return;
  try {
    const backup = parseBackup(await file.text());
    if (!confirm(`現在のデータを、バックアップの${backup.tasks.length}件に置き換えますか？`)) return;
    state.tasks = backup.tasks;
    state.projects = [...new Set(["未分類", ...backup.projects, ...backup.tasks.map((task) => task.project)])];
    applyBackupSettings(backup.settings);
    saveTasks();
    saveProjects();
    saveTags();
    setView("all");
    showToast(`${state.tasks.length}件をバックアップから復元しました`);
  } catch (error) {
    showToast(`JSONを復元できませんでした：${error.message}`);
  }
});

document.addEventListener("click", (event) => {
  const closeButton = event.target.closest("[data-close-dialog]");
  if (!closeButton) return;
  closeDialog(document.getElementById(closeButton.dataset.closeDialog));
});

document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog(dialog);
}));

elements.editEstimate.addEventListener("input", updateEffortPreview);
elements.editActual.addEventListener("input", updateEffortPreview);
elements.toggleTaskTimer.addEventListener("click", () => toggleTaskTimer(elements.editId.value));
document.querySelector("#add-subtask").addEventListener("click", addSubtask);
elements.subtaskInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); addSubtask(); }
});
elements.subtaskList.addEventListener("change", (event) => {
  const row = event.target.closest(".subtask-row");
  const subtask = state.subtaskDraft.find((item) => item.id === row?.dataset.id);
  if (subtask && event.target.matches("input[type='checkbox']")) { subtask.completed = event.target.checked; renderSubtaskEditor(); }
});
elements.subtaskList.addEventListener("click", (event) => {
  const row = event.target.closest(".subtask-row");
  if (row && event.target.closest(".subtask-remove")) {
    state.subtaskDraft = state.subtaskDraft.filter((item) => item.id !== row.dataset.id);
    renderSubtaskEditor();
  }
});

document.querySelector("#delete-task").addEventListener("click", () => {
  const task = state.tasks.find((item) => item.id === elements.editId.value);
  if (!task || !confirm(`「${task.title}」を削除しますか？`)) return;
  if (task.timerStartedAt) Object.assign(task, stopTaskTimer(task));
  state.tasks = state.tasks.filter((item) => item.id !== task.id);
  state.trash.unshift(normalizeTask({ ...task, deletedAt: Date.now() }));
  saveTasks(); elements.dialog.close(); render(); showToast("タスクをゴミ箱へ移動しました");
});

document.querySelector("#clear-completed").addEventListener("click", () => {
  const completedCount = state.tasks.filter((task) => task.status === "done").length;
  if (!completedCount) return showToast("整理する完了タスクはありません");
  if (!confirm(`${completedCount}件の完了タスクを削除しますか？`)) return;
  const completedTasks = state.tasks.filter((task) => task.status === "done");
  state.tasks = state.tasks.filter((task) => task.status !== "done");
  state.trash.unshift(...completedTasks.map((task) => normalizeTask({ ...task, deletedAt: Date.now() })));
  saveTasks(); render(); showToast(`${completedCount}件をゴミ箱へ移動しました`);
});

elements.undoButton.addEventListener("click", undoLastChange);

document.querySelector("#focus-add").addEventListener("click", () => elements.input.focus());
document.querySelector("#menu-button").addEventListener("click", openSidebar);
document.querySelector("#sidebar-close").addEventListener("click", closeSidebar);
elements.scrim.addEventListener("click", closeSidebar);
document.querySelector("#theme-toggle").addEventListener("click", () => {
  const dark = document.body.classList.toggle("is-dark");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  scheduleSyncSnapshot();
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "k") { event.preventDefault(); elements.search.focus(); }
  if (event.ctrlKey && event.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { event.preventDefault(); undoLastChange(); }
  if (event.key === "Escape" && !elements.dialog.open) { elements.search.blur(); closeSidebar(); }
});

if (localStorage.getItem(THEME_KEY) !== "light") document.body.classList.add("is-dark");
elements.dateLabel.textContent = new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
window.TempoAppSyncAdapter = { getSnapshot: createSyncSnapshot, applySnapshot: applySyncSnapshot };
saveTasks({ recordUndo: false, sync: false });
render();
setInterval(() => syncTimerDisplays(), 1000);
