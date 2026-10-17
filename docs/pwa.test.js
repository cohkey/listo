const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("pwa.js", "utf8");

function createRuntime({ controlled = true } = {}) {
  const windowListeners = {};
  const documentListeners = {};
  const workerListeners = {};
  const registrationListeners = {};
  let updateCount = 0;
  let reloadCount = 0;
  let registered = null;

  const registration = {
    installing: null,
    addEventListener(type, listener) { registrationListeners[type] = listener; },
    async update() { updateCount += 1; },
  };
  const context = {
    Boolean,
    navigator: {
      serviceWorker: {
        controller: controlled ? {} : null,
        addEventListener(type, listener) { workerListeners[type] = listener; },
        async register(url, options) { registered = { url, options }; return registration; },
      },
    },
    location: {
      protocol: "https:",
      reload() { reloadCount += 1; },
    },
    document: {
      visibilityState: "visible",
      addEventListener(type, listener) { documentListeners[type] = listener; },
    },
    window: {
      addEventListener(type, listener) { windowListeners[type] = listener; },
      setInterval() { return 1; },
    },
  };
  vm.runInNewContext(source, context);
  return {
    context, windowListeners, documentListeners, workerListeners, registrationListeners,
    registration: () => registered,
    updateCount: () => updateCount,
    reloadCount: () => reloadCount,
  };
}

test("通常URLの起動時にHTTPキャッシュを使わず新版を確認する", async () => {
  const runtime = createRuntime();
  await runtime.windowListeners.load();
  assert.equal(runtime.registration().url, "./service-worker.js?v=0.2.4");
  assert.equal(runtime.registration().options.updateViaCache, "none");
  assert.equal(runtime.updateCount(), 1);
});

test("画面復帰とオンライン復帰で更新確認を再実行する", async () => {
  const runtime = createRuntime();
  await runtime.windowListeners.load();
  await runtime.windowListeners.pageshow();
  await runtime.windowListeners.online();
  await runtime.documentListeners.visibilitychange();
  assert.equal(runtime.updateCount(), 4);
});

test("新しいService Workerへの切替時は一度だけ再読み込みする", () => {
  const runtime = createRuntime({ controlled: true });
  runtime.workerListeners.controllerchange();
  runtime.workerListeners.controllerchange();
  assert.equal(runtime.reloadCount(), 1);
});

test("初回登録では不要な再読み込みをしない", () => {
  const runtime = createRuntime({ controlled: false });
  runtime.workerListeners.controllerchange();
  assert.equal(runtime.reloadCount(), 0);
});
