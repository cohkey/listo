(function initializeTodoistImport(root, factory) {
  const core = typeof module !== "undefined" && module.exports ? require("./task-core.js") : root.TempoCore;
  const api = factory(core);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ListoTodoist = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTodoistImport(Core) {
  const textDecoder = new TextDecoder("utf-8");

  function projectNameFromFileName(fileName) {
    const base = String(fileName || "").split(/[\\/]/).pop().replace(/\.csv$/i, "");
    return base.replace(/\s+\[[^\]]+\]\s*$/, "").trim() || "未分類";
  }

  function headerIndex(headers) {
    return Object.fromEntries(headers.map((header, index) => [String(header).trim().toUpperCase(), index]));
  }

  function isTodoistCSV(parsed) {
    const names = new Set(parsed.headers.map((header) => String(header).trim().toUpperCase()));
    return ["TYPE", "CONTENT", "PRIORITY", "INDENT", "DATE"].every((name) => names.has(name));
  }

  function extractLabels(content) {
    const tags = [];
    const title = String(content || "").replace(/(^|\s)@([^\s@]+)/g, (match, prefix, label) => {
      const cleaned = label.replace(/[、,.;:!?！？。、]+$/, "").trim();
      if (cleaned && !tags.includes(cleaned)) tags.push(cleaned);
      return prefix;
    }).replace(/\s{2,}/g, " ").trim();
    return { title: title || String(content || "").trim(), tags };
  }

  function isoFromDate(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function dateFromISO(iso) {
    const value = new Date(`${iso}T12:00:00`);
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  function nextWeekday(reference, targetDay) {
    const date = new Date(reference);
    let offset = (targetDay - date.getDay() + 7) % 7;
    date.setDate(date.getDate() + offset);
    return isoFromDate(date);
  }

  function nextBusinessDay(reference) {
    const date = new Date(reference);
    while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
    return isoFromDate(date);
  }

  function parseTodoistDate(value, referenceISO) {
    const raw = String(value || "").trim();
    if (!raw) return { due: null, repeat: "none", warning: null };
    const reference = dateFromISO(referenceISO);
    const normalized = raw.replace(/\s+/g, "");
    if (normalized === "今日") return { due: isoFromDate(reference), repeat: "none", warning: null };
    if (normalized === "明日") {
      reference.setDate(reference.getDate() + 1);
      return { due: isoFromDate(reference), repeat: "none", warning: null };
    }
    if (/毎日/.test(normalized)) return { due: isoFromDate(reference), repeat: "daily", warning: null };
    if (/平日/.test(normalized)) return { due: nextBusinessDay(reference), repeat: "weekdays", warning: null };
    const weekday = normalized.match(/毎週(?:の)?([日月火水木金土])曜?/);
    if (weekday) {
      const day = "日月火水木金土".indexOf(weekday[1]);
      return { due: nextWeekday(reference, day), repeat: "weekly", warning: null };
    }
    if (/毎週/.test(normalized)) return { due: isoFromDate(reference), repeat: "weekly", warning: null };
    if (/毎月/.test(normalized)) return { due: isoFromDate(reference), repeat: "monthly", warning: null };
    const iso = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const japanese = normalized.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?/);
    const parts = iso ? [iso[1], iso[2], iso[3]] : japanese ? [japanese[1] || String(reference.getFullYear()), japanese[2], japanese[3]] : null;
    if (parts) {
      const candidate = `${parts[0]}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
      const parsed = dateFromISO(candidate);
      if (isoFromDate(parsed) === candidate) return { due: candidate, repeat: "none", warning: null };
    }
    return { due: null, repeat: "none", warning: `期限「${raw}」を日付へ変換できませんでした` };
  }

  function todoistPriority(value) {
    const number = Number(value);
    if (number >= 4) return "high";
    if (number === 1) return "low";
    return "normal";
  }

  function durationHours(value, unit) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const normalized = String(unit || "").toLowerCase();
    if (/minute|min|分/.test(normalized)) return amount / 60;
    if (/day|日/.test(normalized)) return amount * 8;
    return amount;
  }

  function convertTodoistCSV(text, fileName, options = {}) {
    const parsed = Core.parseCSV(text);
    if (!isTodoistCSV(parsed)) throw new Error(`${fileName} はTodoistのCSV形式ではありません`);
    const indexes = headerIndex(parsed.headers);
    const read = (row, name) => indexes[name] >= 0 ? String(row[indexes[name]] ?? "").trim() : "";
    const project = projectNameFromFileName(fileName);
    const referenceISO = options.referenceDate || isoFromDate(new Date());
    const tasks = [];
    const warnings = [];
    const stats = { sourceRows: parsed.rows.length, tasks: 0, subtasks: 0, sections: 0, reminders: 0, ignored: 0, descriptions: 0, unsupportedDates: 0 };
    let section = "";
    let parent = null;
    parsed.rows.forEach((row, rowIndex) => {
      const type = read(row, "TYPE").toLowerCase();
      if (type === "section") {
        section = read(row, "CONTENT");
        stats.sections += 1;
        return;
      }
      if (type === "reminder") { stats.reminders += 1; return; }
      if (type !== "task") { stats.ignored += 1; return; }
      const content = extractLabels(read(row, "CONTENT"));
      if (!content.title) { stats.ignored += 1; return; }
      const indent = Math.max(1, Number(read(row, "INDENT")) || 1);
      if (indent > 1 && parent) {
        parent.subtasks.push({ id: Core.makeId(), title: content.title, completed: false });
        content.tags.forEach((tag) => { if (!parent.tags.includes(tag)) parent.tags.push(tag); });
        stats.subtasks += 1;
        return;
      }
      const dateResult = parseTodoistDate(read(row, "DATE") || read(row, "DEADLINE"), referenceISO);
      if (dateResult.warning) {
        stats.unsupportedDates += 1;
        warnings.push({ fileName, row: rowIndex + 2, message: dateResult.warning });
      }
      const description = read(row, "DESCRIPTION");
      const tags = [...content.tags];
      if (section && !tags.includes(section)) tags.push(section);
      parent = Core.normalizeTask({
        id: Core.makeId(),
        title: content.title,
        project,
        status: "todo",
        priority: todoistPriority(read(row, "PRIORITY")),
        due: dateResult.due,
        repeat: dateResult.repeat,
        tags,
        estimate: durationHours(read(row, "DURATION"), read(row, "DURATION_UNIT")),
        subtasks: [],
        createdAt: (options.now || Date.now()) + rowIndex,
      });
      if (description) {
        parent.subtasks.push({ id: Core.makeId(), title: `メモ：${description}`, completed: false });
        stats.descriptions += 1;
        stats.subtasks += 1;
        warnings.push({ fileName, row: rowIndex + 2, message: "説明文を「メモ」サブタスクとして保持しました" });
      }
      tasks.push(parent);
      stats.tasks += 1;
    });
    return { fileName, project, tasks, warnings, stats };
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("このブラウザーはZIP展開に対応していません。ZIPを展開してCSVを複数選択してください");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function findEndOfCentralDirectory(view) {
    const minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function extractZipCSVFiles(arrayBuffer, inflater = inflateRaw) {
    const view = new DataView(arrayBuffer);
    const end = findEndOfCentralDirectory(view);
    if (end < 0) throw new Error("ZIPの終端情報を読み取れませんでした");
    const entryCount = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const files = [];
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("ZIPのファイル一覧が壊れています");
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(arrayBuffer, offset + 46, fileNameLength);
      const name = textDecoder.decode(nameBytes);
      if ((flags & 1) !== 0) throw new Error("パスワード付きZIPには対応していません");
      if (/\.csv$/i.test(name) && !name.split("/").some((part) => part.startsWith("__MACOSX"))) {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`${name} のZIP情報が壊れています`);
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = new Uint8Array(arrayBuffer, dataOffset, compressedSize);
        const bytes = method === 0 ? compressed : method === 8 ? await inflater(compressed) : null;
        if (!bytes) throw new Error(`${name} の圧縮方式には対応していません`);
        files.push({ name, text: textDecoder.decode(bytes) });
      }
      offset += 46 + fileNameLength + extraLength + commentLength;
    }
    if (!files.length) throw new Error("ZIP内にTodoistのCSVが見つかりませんでした");
    return files;
  }

  async function readSelectedFiles(fileList) {
    const selected = Array.from(fileList || []);
    if (!selected.length) return [];
    const output = [];
    for (const file of selected) {
      if (/\.zip$/i.test(file.name)) output.push(...await extractZipCSVFiles(await file.arrayBuffer()));
      else if (/\.csv$/i.test(file.name)) output.push({ name: file.name, text: await file.text() });
    }
    if (!output.length) throw new Error("TodoistのZIPまたはCSVを選択してください");
    return output;
  }

  function combineConversions(conversions) {
    const tasks = conversions.flatMap((item) => item.tasks);
    const warnings = conversions.flatMap((item) => item.warnings);
    const projects = [...new Set(conversions.map((item) => item.project))];
    const totals = conversions.reduce((sum, item) => {
      Object.keys(item.stats).forEach((key) => { sum[key] = (sum[key] || 0) + item.stats[key]; });
      return sum;
    }, {});
    return { tasks, warnings, projects, totals, conversions };
  }

  return { projectNameFromFileName, isTodoistCSV, extractLabels, parseTodoistDate, todoistPriority, durationHours, convertTodoistCSV, extractZipCSVFiles, readSelectedFiles, combineConversions };
});
