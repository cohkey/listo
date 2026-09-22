// Supabaseを使う場合は、Listoの同期設定画面から同じ値を入力できます。
// 公開可能なProject URLとPublishable/Anon keyだけを設定し、service_role keyは絶対に入れないでください。
window.TEMPO_SYNC_CONFIG = window.TEMPO_SYNC_CONFIG || {
  supabaseUrl: "https://ymfyzgbpcpziwjomotel.supabase.co",
  anonKey: "sb_publishable_kX6CCLB5qJG2JG1aZP_Y9g_gmS5cdB0",
};

// App Storeを使わないiPhoneホーム画面版の公開先。
// GitHub Pagesを別URLで使う場合だけ書き換えてください。
window.TEMPO_PUBLIC_URL = window.TEMPO_PUBLIC_URL || "https://cohkey.github.io/listo/";
