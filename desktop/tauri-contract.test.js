import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, "src-tauri", "tauri.conf.json"), "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

function pngColorType(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return bytes[25];
}

test("Web版と同じフロントエンドをMac・iPhone版から利用する", () => {
  assert.equal(config.build.frontendDist, "../../docs");
  assert.ok(fs.existsSync(path.resolve(here, "src-tauri", config.build.frontendDist, "index.html")));
  assert.ok(fs.existsSync(path.resolve(here, "src-tauri", config.build.frontendDist, "script.js")));
  assert.ok(fs.existsSync(path.resolve(here, "src-tauri", config.build.frontendDist, "sync.js")));
});

test("Listoの表示名と互換識別子、Mac・iPhoneの最低バージョンが固定されている", () => {
  assert.equal(config.productName, "Listo");
  assert.equal(config.app.windows[0].title, "Listo");
  assert.equal(packageJson.name, "listo-desktop-mobile");
  // Bundle IDは既存インストールとローカルデータを引き継ぐため変更しない。
  assert.equal(config.identifier, "com.cohkey.tempo");
  assert.equal(config.bundle.macOS.minimumSystemVersion, "11.0");
  assert.equal(config.bundle.iOS.minimumSystemVersion, "15.0");
});

test("Supabase以外へ不要な外部通信を許可しない", () => {
  const csp = config.app.security.csp;
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
  assert.doesNotMatch(csp, /connect-src[^;]*\s\*/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);
});

test("MacビルドとiPhone初期化コマンドを用意する", () => {
  assert.equal(packageJson.scripts.build, "tauri build --bundles app");
  assert.equal(packageJson.scripts["build:dmg"], "tauri build --bundles dmg");
  assert.equal(packageJson.scripts["ios:init"], "tauri ios init");
  assert.equal(packageJson.scripts["ios:build"], "tauri ios build");
});

test("Macは透過角丸、iPhoneはOSマスク用の不透明アイコンを使う", () => {
  const webIcons = path.resolve(here, "..", "docs", "assets", "icons");
  assert.equal(pngColorType(path.join(webIcons, "tempo-icon-master.png")), 6);
  assert.equal(pngColorType(path.join(webIcons, "tempo-icon-maskable.png")), 2);
  assert.equal(pngColorType(path.join(here, "src-tauri", "icons", "ios", "AppIcon-60x60@3x.png")), 2);
  assert.ok(fs.statSync(path.join(here, "src-tauri", "icons", "icon.icns")).size > 10000);
});
