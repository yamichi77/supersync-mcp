# SuperSync MCP

暗号化されたSuperSyncデータを、リモートMCPから読み書きする非公式ブリッジです。
Super ProductivityのGUIを常駐させず、Node.jsとDockerで動作します。

**単一ユーザー・単一SuperSyncアカウント向けの実験的実装です。**
Super Productivity公式プロジェクトとは独立しています。

## 機能

| 種別 | ツール |
|---|---|
| 状態・参照 | get_sync_status / list_tasks / get_task |
| 一覧 | list_projects / list_tags / list_archived_tasks |
| 作成・本文 | create_task / update_task |
| 完了・再開 | complete_task / reopen_task |
| タグ差分 | update_task_tags |
| 標準Kanban | set_task_kanban_status |

全12ツールに入力・出力スキーマを定義しています。
成功結果はstructuredContentと互換用JSONテキストで返します。
書込みはreadロールに加えてwriteロールがある場合だけ公開・実行されます。

- タグ変更は指定しないタグを保持します。TODAYは予定日で管理される仮想タグのため対象外です。
- Kanbanはtodo / in_progress / doneを指定します。進行中はKANBAN_IN_PROGRESSタグを使います。
- 本文更新はtitle / notesのみ。アーカイブ復元・削除・予定日変更・プロジェクト作成・列内並べ替えは未提供です。
- MCPは /mcp のStreamable HTTP（ステートレス）で提供します。

## 必要なもの

- LinuxホストとDocker Compose（検証環境）。Node.js 24とtarでも開発できます。
- 接続済み・暗号化済みのSuperSyncアカウントと、そのアクセストークン・暗号化パスワード。
- KeycloakのRealmとユーザー。OIDCのresource_accessクライアントロール形式に依存します。
- HTTPSで公開するMCP URLと、外部から到達可能なHTTPSのKeycloak issuer。
- 公式ソース・npm依存・コンテナを取得するネットワーク接続。

## 初回構築

このリポジトリをcloneしたディレクトリで実行します。

```sh
cp .env.example .env
mkdir -p secrets data
chmod 700 secrets data
cp examples/supersync.json secrets/supersync.json
cp examples/authorization.json secrets/authorization.json
chmod 600 secrets/*.json

# .envとsecrets/*.jsonのプレースホルダーを自分の値へ変更
# Linuxホストのuid/gidが1000以外なら .env のLOCAL_UID/LOCAL_GIDも変更
docker compose run --rm dev npm ci
docker compose run --rm dev npm run setup
docker compose run --rm dev npm run build
docker compose run --rm dev npm run check
docker compose run --rm dev npm test
```

`npm run setup` は[upstream.json](upstream.json)に固定した公式ソースを取得し、
SHA-256を検証してvendor-source/へ展開します。
取得に失敗した場合やチェックサムが違う場合は停止します。
vendor-source/を編集したり、既存ディレクトリに別版を混在させないでください。
公式ソースの変更は、このpinとvendor/・抽出コード・回帰試験を一緒に更新してください。

[認証・公開手順](docs/DEPLOYMENT.md)に沿ってKeycloakとリバースプロキシを設定後：

```sh
docker compose up -d mcp
docker compose exec -T mcp node --import tsx src/smoke-read.ts
```

公開用の初期バインドは127.0.0.1:1901です。
別ホストのプロキシから接続する場合だけ、MCP_BIND_ADDRESSをプライベートIPに変更し、
ファイアウォールでプロキシからの接続に限定してください。

## 設定

| ファイル / 項目 | 内容 |
|---|---|
| .env / OIDC_ISSUER | KeycloakのHTTPS Realm URL。末尾のスラッシュも含めissuerと一致させる |
| .env / MCP_RESOURCE | 外部HTTPS URL。パスは /mcp 固定。JWT audienceにも使用 |
| .env / OIDC_ROLE_CLIENT_ID | ロールを持つresourceクライアント。既定sp-mcp |
| .env / OIDC_READ_ROLE・OIDC_WRITE_ROLE | 既定mcp.read / mcp.write |
| .env / MCP_BIND_ADDRESS・MCP_HOST_PORT | Dockerホスト側の待受。既定127.0.0.1:1901 |
| secrets/supersync.json | SuperSync URL・accessToken・encryptionPassword |
| secrets/authorization.json | 許可するKeycloakユーザーの不変sub |

秘密情報と実環境設定はGit管理対象外です。
認証トークン、復号パスワード、DB、バックアップをIssueやログに貼り付けないでください。
Linux上で資格情報ファイルに所有者以外の権限があると読取りを拒否します。
ネイティブWindowsのファイル権限運用は検証していません。Linuxコンテナを使用してください。

## 書込みと再送

各書込みには一意のrequestIdと、直前の読取り結果のexpectedServerSeqが必要です。
通信結果が不明な場合は、**同じrequestId・同じ引数**で再実行してください。

- STALE_REVISION_READ_AGAIN: 最新状態を読み直し、意図を確認して新しい要求IDで実行。
- WRITE_PENDING_RETRY_SAME_REQUEST: 送信待ち結果を同じ要求で確認。別要求の新規書込みは停止。
- WRITE_REJECTED: サーバー側で拒否。競合を自動上書きしません。

暗号化した送信本文をSQLiteのoutboxへ記録してから送信します。
成功済み要求は記録済み結果を返し、再送しません。
詳細は[運用と制限](docs/OPERATIONS.md)を参照してください。

## 開発・検証

Node.js 24とtarのある環境：

```sh
npm ci
npm run setup
npm run build
npm run check
npm test
```

通常のテストは公開fixtureと模擬通信を使用し、個人の資格情報は不要です。
GitHub Actionsもこの順で実行します。

**src/smoke-write.tsは実アカウントにタスクを作成・変更します。**
通常のテストやCIには含めていません。専用テストアカウントで明示的に実行してください。
src/probe.ts / inspect-shapes.tsは診断用です。公開Issueへ診断結果を出す前に内容を確認してください。

## 対応範囲

[upstream.json](upstream.json)の公式リビジョンとschema version 4を基準にしています。
別バージョンとの互換性や全ての公式操作を保証するものではありません。

未知の操作・新schema・復号失敗・解消できないログ欠落・因果関係を確認できない修復操作では停止します。
GUIの通知・外部Issue更新などブラウザEffectsは実行しません。
暗号化ログはディスク、復号状態はプロセスメモリに保持します。
このプロセスは同期データを復号できるため、信頼するホストで実行してください。

## コミット前の秘密情報検査

.pre-commit-config.yamlでBetterleaks v1.7.3を使用します。
cloneした環境ごとにpre-commitをインストールし、`pre-commit install --install-hooks`を実行してください。
以後、git commit時にステージ済み差分を検査し、検出時はコミットを停止します。
初回は検査ツールの取得にネットワーク接続が必要です。
設定ファイルだけをcloneしてもGitフックは自動で有効になりません。

この設定のBetterleaksフックはステージ済み差分を検査します。
`pre-commit run --all-files`でも未ステージの全ファイルを検査する設定にはなりません。
.gitignoreの除外も併用し、トークン、鍵、data/、secrets/を強制追加しないでください。
フックをスキップしたコミットや、全種類の秘密情報の検出を保証するものではありません。

## ライセンス

このプロジェクトは[MIT License](LICENSE)です。
公式から取り込んだコードの著作権表示は保持しています。
対象と取得元は[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)を参照してください。
