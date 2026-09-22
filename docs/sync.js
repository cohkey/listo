(function (global) {
  "use strict";

  const Core = global.TempoSyncCore;
  if (!Core) return;

  const CONFIG_KEY = "tempo-sync-config-v1";
  const SESSION_KEY = "tempo-sync-session-v1";
  const PENDING_KEY = "tempo-sync-pending-v1";
  const DEVICE_KEY = "tempo-sync-device-v1";
  const POLL_INTERVAL = 20000;
  const SESSION_REFRESH_MARGIN = 120000;
  let adapter = null;
  let syncTimer = 0;
  let pollingTimer = 0;
  let sessionRefreshTimer = 0;
  let syncing = false;
  let currentState = "local";
  let ui = {};

  function readJSON(key, fallback = null) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function readConfig() {
    const fileConfig = global.TEMPO_SYNC_CONFIG || {};
    const saved = readJSON(CONFIG_KEY, {});
    return {
      supabaseUrl: normalizeUrl(saved.supabaseUrl || fileConfig.supabaseUrl),
      anonKey: String(saved.anonKey || fileConfig.anonKey || "").trim(),
    };
  }

  function isConfigured(config = readConfig()) {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl) && config.anonKey.length > 20;
  }

  function isPrivilegedKey(key) {
    if (String(key).startsWith("sb_secret_")) return true;
    try {
      const part = String(key).split(".")[1];
      if (!part) return false;
      const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      return payload.role === "service_role";
    } catch {
      return false;
    }
  }

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = global.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function readSession() {
    return readJSON(SESSION_KEY, null);
  }

  function saveSession(response) {
    const session = Core.createSession(response, readSession());
    if (!session) throw new Error("ログイン情報を保存できませんでした。もう一度お試しください。");
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    scheduleSessionRefresh(session);
    return session;
  }

  function clearSession() {
    clearTimeout(sessionRefreshTimer);
    sessionRefreshTimer = 0;
    localStorage.removeItem(SESSION_KEY);
  }

  function setAuthFeedback(state, message) {
    if (!ui.authFeedback) return;
    ui.authFeedback.dataset.state = state;
    ui.authFeedback.textContent = message;
  }

  function statusCopy(state) {
    return {
      local: ["この端末だけで保存中", "タスクは自動保存されています。iPhone同期は3ステップで準備できます。", "iPhoneと同期"],
      signedOut: ["同期は未接続です", "接続設定を保存し、同じアカウントでログインしてください。", "ログイン待ち"],
      pending: ["同期待ちの変更があります", "通信できる状態になり次第、自動で送信します。", "同期待ち"],
      syncing: ["同期しています", "クラウドとこの端末の新しいデータを確認しています。", "同期中"],
      synced: ["同期済みです", "この端末の変更はクラウドへ保存されています。", "同期済み"],
      offline: ["オフラインです", "変更は端末へ保存済みです。接続後に自動同期します。", "オフライン"],
      error: ["同期を完了できませんでした", "設定または通信状態を確認し、もう一度お試しください。", "同期エラー"],
    }[state] || ["同期状態を確認中", "", "iPhoneと同期"];
  }

  function setStatus(state, detail = "", error = "") {
    currentState = state;
    const [title, defaultDetail, sidebar] = statusCopy(state);
    if (ui.statusCard) ui.statusCard.dataset.state = state;
    if (ui.statusTitle) ui.statusTitle.textContent = title;
    if (ui.statusDetail) ui.statusDetail.textContent = detail || defaultDetail;
    if (ui.openButton) ui.openButton.dataset.syncState = state;
    if (ui.sidebarLabel) ui.sidebarLabel.textContent = sidebar;
    if (ui.error) ui.error.textContent = error;
  }

  function refreshUi() {
    const config = readConfig();
    const session = readSession();
    if (ui.url) ui.url.value = config.supabaseUrl;
    if (ui.key) ui.key.value = config.anonKey;
    if (ui.authSection) ui.authSection.hidden = Boolean(session?.accessToken);
    if (ui.sessionSection) ui.sessionSection.hidden = !session?.accessToken;
    if (ui.accountEmail) ui.accountEmail.textContent = session?.user?.email || "同期アカウントでログイン中";
    const configured = isConfigured(config);
    const signedIn = Boolean(session?.accessToken);
    if (ui.cloudStep) ui.cloudStep.dataset.state = configured ? "complete" : "current";
    if (ui.accountStep) ui.accountStep.dataset.state = signedIn ? "complete" : configured ? "current" : "upcoming";
    if (ui.iphoneStep) ui.iphoneStep.dataset.state = signedIn ? "current" : "upcoming";
    if (ui.cloudSetup) ui.cloudSetup.open = !configured;
    if (ui.iphoneSection) ui.iphoneSection.dataset.ready = String(configured && signedIn);
    if (!configured) setStatus("local");
    else if (!signedIn && !["error", "offline"].includes(currentState)) setStatus("signedOut");
  }

  async function parseResponse(response) {
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `HTTP ${response.status}`;
      const error = new Error(String(message));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function rawRequest(path, { method = "GET", body = null, token = "", prefer = "" } = {}) {
    const config = readConfig();
    if (!isConfigured(config)) throw new Error("Supabaseの接続設定が完了していません");
    const headers = { apikey: config.anonKey };
    if (body !== null) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${config.supabaseUrl}${path}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
    return parseResponse(response);
  }

  function isPermanentSessionError(error) {
    return [400, 401, 403].includes(Number(error?.status)) || /refresh token|invalid.*token/i.test(error?.message || "");
  }

  async function refreshSession() {
    const session = readSession();
    if (!session?.refreshToken) throw new Error("もう一度ログインしてください");
    try {
      const response = await rawRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refreshToken } });
      return saveSession(response);
    } catch (error) {
      if (isPermanentSessionError(error)) clearSession();
      throw error;
    }
  }

  function scheduleSessionRefresh(session = readSession()) {
    clearTimeout(sessionRefreshTimer);
    sessionRefreshTimer = 0;
    if (!session?.refreshToken) return;
    const delay = Math.max(1000, Number(session.expiresAt || 0) - Date.now() - SESSION_REFRESH_MARGIN);
    sessionRefreshTimer = global.setTimeout(async () => {
      try {
        await refreshSession();
        refreshUi();
        setAuthFeedback("success", "ログイン状態を自動更新しました。");
        await syncNow({ quiet: true });
      } catch (error) {
        if (isPermanentSessionError(error)) {
          clearSession();
          refreshUi();
        }
        setStatus(navigator.onLine ? "error" : "offline", "", Core.authErrorMessage(error));
        setAuthFeedback("error", Core.authErrorMessage(error));
      }
    }, Math.min(delay, 2147483647));
  }

  async function activeSession() {
    const session = readSession();
    if (!session?.accessToken) throw new Error("同期アカウントへログインしてください");
    if (!Core.shouldRefreshSession(session, Date.now(), SESSION_REFRESH_MARGIN)) return session;
    return refreshSession();
  }

  async function restorePersistedSession() {
    const session = readSession();
    if (!session?.accessToken || !session?.refreshToken) return false;
    refreshUi();
    scheduleSessionRefresh(session);
    setAuthFeedback("loading", "保存済みのログイン情報を確認しています…");
    if (!navigator.onLine) {
      setStatus("offline");
      setAuthFeedback("idle", "ログイン情報はこの端末に保存済みです。接続後に自動で再接続します。");
      return true;
    }
    try {
      const active = await activeSession();
      refreshUi();
      setAuthFeedback("success", `${active.user?.email || "同期アカウント"} でログイン状態を復元しました。`);
      await syncNow({ quiet: true });
      return true;
    } catch (error) {
      const permanent = isPermanentSessionError(error);
      if (permanent) {
        clearSession();
        refreshUi();
        setStatus("signedOut", "ログインの有効期限が切れました。もう一度ログインしてください。");
      } else {
        setStatus(navigator.onLine ? "error" : "offline", "", Core.authErrorMessage(error));
      }
      setAuthFeedback("error", Core.authErrorMessage(error));
      return false;
    }
  }

  async function authorizedRequest(path, options = {}) {
    let session = await activeSession();
    try {
      return await rawRequest(path, { ...options, token: session.accessToken });
    } catch (error) {
      if (!/jwt|token|401|expired/i.test(error.message)) throw error;
      session = await refreshSession();
      return rawRequest(path, { ...options, token: session.accessToken });
    }
  }

  async function fetchRemoteEnvelope(userId) {
    const rows = await authorizedRequest(`/rest/v1/tempo_snapshots?user_id=eq.${encodeURIComponent(userId)}&select=payload,client_updated_at,device_id&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? Core.createEnvelope(row.payload, row.client_updated_at, row.device_id) : null;
  }

  async function pushEnvelope(userId, envelope) {
    await authorizedRequest("/rest/v1/tempo_snapshots?on_conflict=user_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        user_id: userId,
        payload: envelope.payload,
        client_updated_at: envelope.clientUpdatedAt,
        device_id: envelope.deviceId,
      },
    });
    const latestPending = Core.parseEnvelope(localStorage.getItem(PENDING_KEY));
    if (latestPending?.clientUpdatedAt === envelope.clientUpdatedAt) localStorage.removeItem(PENDING_KEY);
  }

  async function syncNow({ quiet = false } = {}) {
    if (syncing || !adapter) return false;
    const config = readConfig();
    const session = readSession();
    if (!isConfigured(config) || !session?.accessToken) {
      refreshUi();
      return false;
    }
    if (!navigator.onLine) {
      setStatus("offline");
      return false;
    }
    syncing = true;
    setStatus("syncing");
    try {
      const active = await activeSession();
      const userId = active.user?.id;
      if (!userId) throw new Error("ログイン情報を確認できませんでした");
      const remote = await fetchRemoteEnvelope(userId);
      let local = Core.parseEnvelope(localStorage.getItem(PENDING_KEY));
      if (!local && !remote) local = Core.createEnvelope(adapter.getSnapshot(), Date.now(), deviceId());
      const action = Core.decideSyncAction(local, remote);
      if (action === "push") await pushEnvelope(userId, local);
      if (action === "pull") {
        adapter.applySnapshot(remote.payload);
        localStorage.removeItem(PENDING_KEY);
      }
      setStatus("synced", action === "pull" ? "クラウドの新しいデータをこの端末へ反映しました。" : action === "push" ? "この端末の変更をクラウドへ保存しました。" : "すべての端末で同じデータを利用できます。");
      return true;
    } catch (error) {
      if (!quiet) setStatus("error", "", error.message);
      else setStatus(navigator.onLine ? "error" : "offline");
      return false;
    } finally {
      syncing = false;
    }
  }

  function markLocalChange(snapshot) {
    const envelope = Core.createEnvelope(snapshot, Date.now(), deviceId());
    localStorage.setItem(PENDING_KEY, JSON.stringify(envelope));
    const config = readConfig();
    const session = readSession();
    if (!isConfigured(config) || !session?.accessToken) {
      refreshUi();
      return;
    }
    setStatus(navigator.onLine ? "pending" : "offline");
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow({ quiet: true }), 1200);
  }

  async function signIn() {
    if (!isConfigured()) throw new Error("先にSupabase接続を保存してください");
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || password.length < 8) throw new Error("メールアドレスと8文字以上のパスワードを入力してください");
    setAuthFeedback("loading", "ログインしています…");
    const response = await rawRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
    const session = saveSession(response);
    ui.password.value = "";
    refreshUi();
    setAuthFeedback("success", `${session.user?.email || email} でログインしました。次回から自動で再接続します。`);
    await syncNow();
  }

  async function signUp() {
    if (!isConfigured()) throw new Error("先にSupabase接続を保存してください");
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || password.length < 8) throw new Error("メールアドレスと8文字以上のパスワードを入力してください");
    setAuthFeedback("loading", "アカウントを作成しています…");
    const redirectUrl = publicAppUrl();
    const signupPath = redirectUrl
      ? `/auth/v1/signup?redirect_to=${encodeURIComponent(redirectUrl)}`
      : "/auth/v1/signup";
    const response = await rawRequest(signupPath, { method: "POST", body: { email, password } });
    if (response?.access_token) {
      const session = saveSession(response);
      ui.password.value = "";
      refreshUi();
      setAuthFeedback("success", `${session.user?.email || email} のアカウントを作成し、ログインしました。`);
      await syncNow();
    } else {
      setStatus("signedOut", "確認メールを送信しました。確認後にログインしてください。");
      setAuthFeedback("success", `${email} へ確認メールを送信しました。メール内のリンクを開いてからログインしてください。`);
    }
  }

  function saveConfigFromUi() {
    const config = { supabaseUrl: normalizeUrl(ui.url.value), anonKey: ui.key.value.trim() };
    if (!isConfigured(config)) throw new Error("Project URLと公開用キーを確認してください");
    if (isPrivilegedKey(config.anonKey)) throw new Error("service_roleやsecret keyは保存できません。公開用キーを使用してください");
    const previous = readConfig();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    if (previous.supabaseUrl !== config.supabaseUrl || previous.anonKey !== config.anonKey) clearSession();
    setStatus("signedOut", "接続設定を保存しました。同じアカウントでログインしてください。");
    refreshUi();
  }

  function publicAppUrl() {
    const configured = String(global.TEMPO_PUBLIC_URL || "").trim();
    if (/^https:\/\//i.test(configured)) return configured.endsWith("/") ? configured : `${configured}/`;
    if (/^https?:$/i.test(global.location?.protocol || "")) return new URL("./", global.location.href).href.split("#")[0];
    return "";
  }

  function importSharedConfig() {
    const config = Core.parseSharedConfigFragment(global.location?.hash);
    if (!config || !isConfigured(config) || isPrivilegedKey(config.anonKey)) return false;
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ supabaseUrl: normalizeUrl(config.supabaseUrl), anonKey: config.anonKey.trim() }));
    clearSession();
    if (global.history?.replaceState) global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}`);
    setStatus("signedOut", "iPhone用リンクから接続設定を取り込みました。同じアカウントでログインしてください。");
    return true;
  }

  async function shareIphoneSetup() {
    const config = readConfig();
    if (!isConfigured(config)) throw new Error("先にSupabase接続を保存してください");
    if (isPrivilegedKey(config.anonKey)) throw new Error("公開用キー以外は共有できません");
    const base = publicAppUrl();
    if (!base) throw new Error("iPhone版の公開URLが設定されていません");
    const url = `${base}#${Core.createSharedConfigFragment(config)}`;
    ui.shareLink.value = url;
    ui.shareLinkField.hidden = false;
    if (global.navigator?.share) {
      await global.navigator.share({ title: "Listo iPhone同期設定", text: "iPhoneで開いてListoの同期を設定します。", url });
      setStatus(currentState, "iPhoneへ開くリンクを共有しました。");
    } else if (global.navigator?.clipboard?.writeText) {
      await global.navigator.clipboard.writeText(url);
      setStatus(currentState, "iPhone用リンクをコピーしました。");
    } else {
      ui.shareLink.focus();
      ui.shareLink.select();
      setStatus(currentState, "表示したリンクをコピーしてiPhoneで開いてください。");
    }
  }

  function bindAsync(button, action, options = {}) {
    button?.addEventListener("click", async () => {
      if (ui.error) ui.error.textContent = "";
      const originalLabel = button.textContent;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (options.busyLabel) button.textContent = options.busyLabel;
      try { await action(); }
      catch (error) {
        const message = options.auth ? Core.authErrorMessage(error) : error.message;
        setStatus("error", "", message);
        if (options.auth) setAuthFeedback("error", message);
      }
      finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = originalLabel;
      }
    });
  }

  function init(nextAdapter) {
    if (!nextAdapter || adapter) return;
    adapter = nextAdapter;
    ui = {
      dialog: document.querySelector("#sync-dialog"),
      openButton: document.querySelector("#sync-open-button"),
      sidebarLabel: document.querySelector("#sync-sidebar-label"),
      statusCard: document.querySelector("#sync-status-card"),
      statusTitle: document.querySelector("#sync-status-title"),
      statusDetail: document.querySelector("#sync-status-detail"),
      url: document.querySelector("#sync-supabase-url"),
      key: document.querySelector("#sync-anon-key"),
      email: document.querySelector("#sync-email"),
      password: document.querySelector("#sync-password"),
      authFeedback: document.querySelector("#sync-auth-feedback"),
      authSection: document.querySelector("#sync-auth-section"),
      sessionSection: document.querySelector("#sync-session-section"),
      accountEmail: document.querySelector("#sync-account-email"),
      shareLink: document.querySelector("#sync-share-link"),
      shareLinkField: document.querySelector("#sync-share-link-field"),
      error: document.querySelector("#sync-error"),
      cloudStep: document.querySelector("#sync-step-cloud"),
      accountStep: document.querySelector("#sync-step-account"),
      iphoneStep: document.querySelector("#sync-step-iphone"),
      cloudSetup: document.querySelector("#sync-cloud-setup"),
      iphoneSection: document.querySelector("#sync-iphone-section"),
    };
    ui.openButton?.addEventListener("click", () => { refreshUi(); ui.dialog.showModal(); });
    document.querySelector("#sync-dialog-close")?.addEventListener("click", () => ui.dialog.close());
    ui.dialog?.addEventListener("click", (event) => { if (event.target === ui.dialog) ui.dialog.close(); });
    ui.dialog?.addEventListener("cancel", (event) => { event.preventDefault(); ui.dialog.close(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ui.dialog?.open) {
        event.preventDefault();
        ui.dialog.close();
      }
    });
    bindAsync(document.querySelector("#sync-save-config"), async () => saveConfigFromUi());
    bindAsync(document.querySelector("#sync-share-iphone"), shareIphoneSetup);
    bindAsync(document.querySelector("#sync-sign-in"), signIn, { auth: true, busyLabel: "ログイン中…" });
    bindAsync(document.querySelector("#sync-sign-up"), signUp, { auth: true, busyLabel: "作成中…" });
    bindAsync(document.querySelector("#sync-now"), () => syncNow());
    bindAsync(document.querySelector("#sync-sign-out"), async () => {
      clearSession();
      refreshUi();
      setStatus("signedOut", "この端末からログアウトしました。ローカルデータは残っています。");
      setAuthFeedback("idle", "ログアウトしました。");
    });
    global.addEventListener("online", () => syncNow({ quiet: true }));
    global.addEventListener("offline", () => setStatus("offline"));
    global.addEventListener("focus", () => syncNow({ quiet: true }));
    pollingTimer = global.setInterval(() => syncNow({ quiet: true }), POLL_INTERVAL);
    const importedSharedConfig = importSharedConfig();
    refreshUi();
    if (importedSharedConfig) setStatus("signedOut", "iPhone用リンクから接続設定を取り込みました。同じアカウントでログインしてください。");
    if (isConfigured() && readSession()?.accessToken) restorePersistedSession();
  }

  global.TempoSync = { init, markLocalChange, syncNow, getStatus: () => currentState };
  if (global.TempoAppSyncAdapter) init(global.TempoAppSyncAdapter);
})(window);
