# Listo 同期セットアップ

同期は任意です。設定しない場合、Web・Mac・iPhoneはこれまでどおり各端末のローカル領域へ自動保存します。

## 1. Supabaseプロジェクトを用意

1. Supabaseで新しいプロジェクトを作成します。
2. DashboardのSQL Editorで [`supabase/schema.sql`](supabase/schema.sql) を実行します。
3. AuthenticationでEmailログインを有効にします。
4. Project URLとPublishable key（旧Anon key）を控えます。

`service_role`、Secret key、データベースパスワードはListoへ入力しないでください。Listoの画面側でもこれらのキーは拒否します。

## 2. 各端末で接続

1. サイドバーの「同期設定」を開きます。
2. 同じProject URLとPublishable / Anon keyを保存します。
3. 最初の端末でアカウントを作成します。
4. メール確認が有効な場合は確認後にログインします。
5. ほかの端末でも同じメールアドレスでログインします。

## iPhoneで使う（App Store不要）

iPhone版はApp Storeへ公開せず、Safariのホーム画面アプリとして使えます。GitHub Pagesの公開先は `https://cohkey.github.io/listo/` です。

1. GitHubのリポジトリ設定で **Pages → Source → GitHub Actions** を選びます。
2. `main` へマージすると `.github/workflows/pages.yml` が `docs` だけを公開します。タスクデータは公開物に含まれません。
3. MacまたはWeb版の「同期設定」でSupabase接続を保存し、「iPhone用リンクを作る」を押します。
4. リンクをiPhoneのSafariで開きます。Project URLとPublishable / Anon keyだけが自動設定されます。
5. Macと同じメールアドレスでログインします。
6. Safariの共有メニューから「ホーム画面に追加」を選びます。

リンクにパスワード、タスク、メールアドレスは含みません。Publishable / Anon keyは公開用ですが、RLSが有効な `supabase/schema.sql` を必ず実行してください。

### iPhone専用アプリが必要になった場合

`desktop` はListo用のTauri iOS設定も保持しています。フル版Xcodeを入れれば、App Storeへ出さずに自分のiPhoneへ直接インストールできます。ただし署名の管理が必要なため、日常利用はホーム画面版を推奨します。

## 同期動作

- 変更は最初に端末へ保存されるため、オフラインでも操作できます。
- オンライン時は変更から約1秒後にクラウドへ送信します。
- アプリを開いた時、オンラインへ戻った時、画面へ戻った時、20秒ごとに新しいデータを確認します。
- 同時編集が発生した場合は、最後に更新した端末のスナップショットを採用します。
- JSON保存は同期とは別の手動バックアップとして引き続き利用できます。

## 現在のデータを移行

クラウドが空の状態で最初にログインすると、その端末に保存済みのタスク・プロジェクト・タグ・フィルター・表示設定を自動登録します。念のため、初回同期前に「JSON保存」も実行してください。
