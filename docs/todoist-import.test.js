const test = require("node:test");
const assert = require("node:assert/strict");
const { projectNameFromFileName, extractLabels, parseTodoistDate, todoistPriority, convertTodoistCSV, extractZipCSVFiles, combineConversions } = require("./todoist-import.js");

const headers = "TYPE,CONTENT,DESCRIPTION,IS_COLLAPSED,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG,REMINDER_TYPE,REMINDER_OFFSET,REMINDER_DATE,REMINDER_DATE_LANG";
const sample = `\uFEFF${headers}\r\nmeta,view_style=list,,,,,,,,,,,,,,,,,\r\nsection,掃除,,,,,,,,,,,,,,,,,\r\ntask,床を掃除 @家事,週末に実施,FALSE,4,1,user,,毎週火曜,ja,Asia/Tokyo,30,minute,,,,,,\r\ntask,洗剤を補充,,FALSE,1,2,user,,,,Asia/Tokyo,,,,,,,,\r\nreminder,床を掃除,,,,,user,user,,,,,,,,relative,15,,\r\ntask,期限不明,,FALSE,2,1,user,,いつか,ja,Asia/Tokyo,,,,,,,,`;

test("Todoistのファイル名からプロジェクトIDを除いて名称を取得する", () => {
  assert.equal(projectNameFromFileName("🏠家 [6MMjpVhQhrgx7FHh].csv"), "🏠家");
  assert.equal(projectNameFromFileName("folder/仕事.csv"), "仕事");
});

test("Todoistラベルをタスク名から分離する", () => {
  assert.deepEqual(extractLabels("床を掃除 @家事 @週末"), { title: "床を掃除", tags: ["家事", "週末"] });
});

test("Todoist優先度と日本語の繰り返し期限をListo形式へ変換する", () => {
  assert.equal(todoistPriority("4"), "high");
  assert.equal(todoistPriority("3"), "normal");
  assert.equal(todoistPriority("1"), "low");
  assert.deepEqual(parseTodoistDate("毎日", "2026-09-22"), { due: "2026-09-22", repeat: "daily", warning: null });
  assert.deepEqual(parseTodoistDate("平日8:30", "2026-09-26"), { due: "2026-09-28", repeat: "weekdays", warning: null });
  assert.deepEqual(parseTodoistDate("毎週火曜", "2026-09-23"), { due: "2026-09-29", repeat: "weekly", warning: null });
  assert.deepEqual(parseTodoistDate("10月13日", "2026-09-22"), { due: "2026-10-13", repeat: "none", warning: null });
});

test("Todoist CSVはタスクだけを取り込み子タスク・セクション・警告を保持する", () => {
  const result = convertTodoistCSV(sample, "🏠家 [id].csv", { referenceDate: "2026-09-22", now: 1000 });
  assert.equal(result.project, "🏠家");
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].title, "床を掃除");
  assert.equal(result.tasks[0].priority, "high");
  assert.equal(result.tasks[0].repeat, "weekly");
  assert.equal(result.tasks[0].estimate, 0.5);
  assert.deepEqual(result.tasks[0].tags, ["家事", "掃除"]);
  assert.equal(result.tasks[0].subtasks[0].title, "メモ：週末に実施");
  assert.equal(result.tasks[0].subtasks[1].title, "洗剤を補充");
  assert.equal(result.stats.reminders, 1);
  assert.equal(result.stats.ignored, 1);
  assert.equal(result.stats.unsupportedDates, 1);
  assert.equal(result.stats.descriptions, 1);
  assert.match(result.warnings.map((item) => item.message).join(" "), /いつか/);
  assert.match(result.warnings.map((item) => item.message).join(" "), /メモ/);
});

function storedZip(name, content) {
  const fileName = Buffer.from(name);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(local.length + fileName.length + data.length, 16);
  const zip = Buffer.concat([local, fileName, data, central, fileName, end]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

test("ZIPから日本語名のTodoist CSVを抽出する", async () => {
  const files = await extractZipCSVFiles(storedZip("🏠家 [id].csv", sample));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "🏠家 [id].csv");
  assert.match(files[0].text, /TYPE,CONTENT/);
});

test("複数プロジェクトの変換結果を集約する", () => {
  const first = convertTodoistCSV(sample, "家 [id].csv", { referenceDate: "2026-09-22" });
  const second = convertTodoistCSV(sample, "仕事 [id].csv", { referenceDate: "2026-09-22" });
  const combined = combineConversions([first, second]);
  assert.deepEqual(combined.projects, ["家", "仕事"]);
  assert.equal(combined.tasks.length, 4);
  assert.equal(combined.totals.reminders, 2);
});
