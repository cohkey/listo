(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TempoSyncCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function toTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  function createEnvelope(payload, clientUpdatedAt = Date.now(), deviceId = "unknown") {
    return {
      payload,
      clientUpdatedAt: toTimestamp(clientUpdatedAt) || Date.now(),
      deviceId: String(deviceId || "unknown"),
    };
  }

  function decideSyncAction(localEnvelope, remoteEnvelope) {
    if (!localEnvelope && !remoteEnvelope) return "noop";
    if (localEnvelope && !remoteEnvelope) return "push";
    if (!localEnvelope && remoteEnvelope) return "pull";
    return toTimestamp(localEnvelope.clientUpdatedAt) >= toTimestamp(remoteEnvelope.clientUpdatedAt) ? "push" : "pull";
  }

  function parseEnvelope(value) {
    if (!value) return null;
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (!parsed || typeof parsed.payload !== "object" || !parsed.payload) return null;
      return createEnvelope(parsed.payload, parsed.clientUpdatedAt, parsed.deviceId);
    } catch {
      return null;
    }
  }

  function createSharedConfigFragment(config) {
    const payload = {
      v: 1,
      supabaseUrl: String(config?.supabaseUrl || "").trim(),
      anonKey: String(config?.anonKey || "").trim(),
    };
    return `tempo-sync=${encodeURIComponent(JSON.stringify(payload))}`;
  }

  function parseSharedConfigFragment(fragment) {
    const value = String(fragment || "").replace(/^#/, "");
    if (!value.startsWith("tempo-sync=")) return null;
    try {
      const payload = JSON.parse(decodeURIComponent(value.slice("tempo-sync=".length)));
      if (payload?.v !== 1 || !payload.supabaseUrl || !payload.anonKey) return null;
      return { supabaseUrl: String(payload.supabaseUrl), anonKey: String(payload.anonKey) };
    } catch {
      return null;
    }
  }

  function createSession(response, previousSession = null, now = Date.now()) {
    const accessToken = String(response?.access_token || previousSession?.accessToken || "").trim();
    const refreshToken = String(response?.refresh_token || previousSession?.refreshToken || "").trim();
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Math.max(30, Number(response?.expires_in || 3600) - 30);
    return {
      accessToken,
      refreshToken,
      expiresAt: Number(now) + expiresIn * 1000,
      user: response?.user || previousSession?.user || null,
    };
  }

  function shouldRefreshSession(session, now = Date.now(), marginMs = 120000) {
    if (!session?.accessToken || !session?.refreshToken) return true;
    return Number(session.expiresAt || 0) <= Number(now) + Math.max(0, Number(marginMs) || 0);
  }

  function authErrorMessage(error) {
    const message = String(error?.message || error || "");
    if (/failed to fetch|network|load failed/i.test(message)) return "Supabaseと通信できません。インターネット接続とプロジェクトの稼働状態を確認してください。";
    if (/already registered|already exists/i.test(message)) return "このメールアドレスは登録済みです。「ログインして同期を開始」を押してください。";
    if (/email not confirmed/i.test(message)) return "確認メールのリンクを開いてから、もう一度ログインしてください。";
    if (/invalid login credentials/i.test(message)) return "メールアドレスまたはパスワードが一致しません。";
    if (/refresh token|invalid.*token/i.test(message)) return "ログインの有効期限が切れました。もう一度ログインしてください。";
    if (/rate limit|too many requests/i.test(message) || Number(error?.status) === 429) return "短時間に登録が繰り返されました。少し待ってからお試しください。";
    if (/project.*paused|project is paused/i.test(message) || Number(error?.status) === 540) return "Supabaseプロジェクトが停止中です。DashboardでResume projectを実行してください。";
    return message || "同期アカウントの処理を完了できませんでした。";
  }

  return { toTimestamp, createEnvelope, decideSyncAction, parseEnvelope, createSharedConfigFragment, parseSharedConfigFragment, createSession, shouldRefreshSession, authErrorMessage };
});
