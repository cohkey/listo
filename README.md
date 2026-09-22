# Listo

ローカル保存を基本に、必要なときだけSupabaseで同期できるTODOアプリです。Web、Mac、iPhoneで同じタスクを扱えます。

## 構成

- `docs/`: HTML・CSS・JavaScriptだけで動くWeb版。GitHub Pagesの公開元です。
- `desktop/`: Web版を同梱するTauri製MacアプリとiPhone用ラッパーです。
- `desktop/supabase/schema.sql`: 端末間同期に使うSupabaseのテーブルとRLS設定です。

## Web版

`docs/index.html` を直接開けば、同期なしのローカルTODOとして利用できます。GitHub Pages公開後は次のURLをiPhoneのSafariで開けます。

https://cohkey.github.io/listo/

同期を利用する場合は、Listoの「iPhoneと同期」からSupabaseのProject URLとPublishable keyを設定し、同じメールアドレスでログインしてください。

## Mac版

```bash
cd desktop
npm install
npm run dev
```

配布用アプリは `npm run build` で生成します。

詳しい同期設定は [`desktop/SYNC_SETUP.md`](desktop/SYNC_SETUP.md)、テスト項目は [`docs/TESTING.md`](docs/TESTING.md) を参照してください。
