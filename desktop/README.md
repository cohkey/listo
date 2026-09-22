# Listo macOS / iPhone

`../docs` のWeb版をそのまま共有するTauri 2のアプリ外枠です。Web版のHTML・CSS・JavaScriptは複製しません。

## macOSで起動

```bash
cd desktop
npm install
npm run dev
```

配布用アプリは `npm run build` で作成します。生成先は `src-tauri/target/release/bundle/macos/Listo.app` です。

Finderで配布できるDMGも必要な場合は `npm run build:dmg` を実行します。DMG作成はmacOSの画面操作を使うため、通常のMacターミナル上で実行してください。

## iPhone

iOS開発にはフル版Xcodeが必要です。Xcodeをインストールして初回起動を済ませた後、次を実行します。

```bash
cd desktop
npm install
npm run ios:init
npm run ios:dev
```

## Web版との関係

- Web版は `../docs/index.html` だけで動きます。
- macOS/iPhone版は同じファイルをアプリ内へ同梱します。
- Supabase同期を設定しない場合は、各環境のローカル保存だけで利用できます。
- 同期を設定すると、同じアカウントのWeb・Mac・iPhone間でデータを共有できます。
