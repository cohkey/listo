const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnvelope, decideSyncAction, parseEnvelope, createSharedConfigFragment, parseSharedConfigFragment, createSession, shouldRefreshSession, authErrorMessage } = require("./sync-core.js");

test("同期対象がローカルだけならクラウドへ送る", () => {
  assert.equal(decideSyncAction(createEnvelope({ tasks: [] }, 100, "mac"), null), "push");
});

test("クラウドだけにデータがある初回端末では取り込む", () => {
  assert.equal(decideSyncAction(null, createEnvelope({ tasks: [] }, 100, "iphone")), "pull");
});

test("ローカルとクラウドの新しい方を採用する", () => {
  const local = createEnvelope({ value: "local" }, 200, "mac");
  const remote = createEnvelope({ value: "remote" }, 300, "iphone");
  assert.equal(decideSyncAction(local, remote), "pull");
  assert.equal(decideSyncAction(createEnvelope({ value: "local" }, 400, "mac"), remote), "push");
});

test("壊れた同期待ちデータは安全に無視する", () => {
  assert.equal(parseEnvelope("not-json"), null);
  assert.equal(parseEnvelope(JSON.stringify({ clientUpdatedAt: 10 })), null);
  assert.deepEqual(parseEnvelope(JSON.stringify(createEnvelope({ tasks: [1] }, 10, "web"))), createEnvelope({ tasks: [1] }, 10, "web"));
});

test("iPhone用リンクは公開用接続設定だけを往復できる", () => {
  const config = { supabaseUrl: "https://example.supabase.co", anonKey: "public-anon-key" };
  const fragment = createSharedConfigFragment(config);
  assert.match(fragment, /^tempo-sync=/);
  assert.deepEqual(parseSharedConfigFragment(`#${fragment}`), config);
  assert.equal(parseSharedConfigFragment("#tempo-sync=broken"), null);
});

test("ログイン情報は更新トークンを含めて永続化できる", () => {
  const session = createSession({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, user: { id: "u1", email: "a@example.com" } }, null, 1000);
  assert.equal(session.accessToken, "access-1");
  assert.equal(session.refreshToken, "refresh-1");
  assert.equal(session.user.email, "a@example.com");
  assert.ok(session.expiresAt > 1000);
  const refreshed = createSession({ access_token: "access-2", expires_in: 3600 }, session, 2000);
  assert.equal(refreshed.accessToken, "access-2");
  assert.equal(refreshed.refreshToken, "refresh-1");
  assert.equal(refreshed.user.email, "a@example.com");
});

test("有効期限の前にセッション更新が必要か判定できる", () => {
  const session = { accessToken: "access", refreshToken: "refresh", expiresAt: 10000 };
  assert.equal(shouldRefreshSession(session, 7000, 2000), false);
  assert.equal(shouldRefreshSession(session, 8000, 2000), true);
  assert.equal(shouldRefreshSession(null, 0, 0), true);
});

test("登録エラーを操作しやすい日本語に変換する", () => {
  assert.match(authErrorMessage(new Error("User already registered")), /登録済み/);
  assert.match(authErrorMessage(new Error("Email not confirmed")), /確認メール/);
  assert.match(authErrorMessage(new Error("Failed to fetch")), /通信できません/);
  assert.match(authErrorMessage(new Error("Invalid Refresh Token")), /有効期限/);
});
