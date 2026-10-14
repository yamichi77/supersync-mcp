# 認証とHTTPS公開

## Keycloak

以下は設定例です。実際のRealm名、ドメイン、ユーザーsubは環境に合わせて変更します。

1. Realmと利用ユーザーを用意する。
2. resourceクライアントsp-mcpを作成する。ログイン用途にせず、mcp.read / mcp.writeクライアントロールを作る。
3. 許可ユーザーにmcp.read、書込みを許可する場合はmcp.writeも付与する。
4. 検証済みissuerとユーザーの不変ID（sub）をsecrets/accounts.jsonへ登録し、ユーザー別資格情報とデータディレクトリを対応付ける。[追加手順](USER-ACCOUNTS.md)を参照する。
5. 接続先アプリごとにOAuthクライアントを作る。
   - Authorization Code / Standard Flow有効、PKCE S256必須。
   - ChatGPTなどSecretを扱うアプリはconfidential client。
   - Direct Access Grants、Implicit Flow、Service Accountsは通常不要。
   - クライアントの有効なredirect URIは、接続アプリが提示する値を正確に登録する。
6. default client scopesにbasicとrolesを含め、access tokenにsubとresource_accessが入ることを確認する。
   アプリが必要とする場合にだけprofile/emailなどを追加する。
7. Full Scope Allowedを無効にし、resourceクライアントの必要なロールだけをscope mappingへ追加する。
8. Audience mapperで、access tokenのaudにMCP_RESOURCEのURLを含める。
9. issuerのdiscoveryがS256をcode_challenge_methods_supportedに含むことを確認する。

MCPはRS256署名、issuer、audience、sub、exp、iat、クライアントロールを検証します。
ロールと検証済みissuer・subのアカウント対応が必要です。未登録ユーザーは403になり、各ユーザーの資格情報・キャッシュ・DB・書込みキューは分離されます。
クライアントSecretはKeycloakと接続アプリで管理し、MCPのリポジトリには保存しません。

## nginx

[examples/nginx.conf](../examples/nginx.conf)は**locationとupstreamの参考例**です。
既存のTLS server設定へ組み込み、証明書とホスト名を環境に合わせて設定します。
SuperSync本体と同じホスト名を使う場合、通常の同期URLは元のupstreamのままにします。

- /mcp
- /.well-known/oauth-protected-resource/mcp
- /.well-known/oauth-protected-resource

上記だけをMCPへ転送します。/healthzは内部のヘルスチェック用です。
Keycloakはissuerのdiscovery、JWKS、認可・トークンエンドポイントへ到達可能である必要があります。
OAuthクライアントによってRFC 8414形式のdiscovery経路も必要なので、
リバースプロキシの既存公開範囲を確認してください。
Authorizationヘッダー、認可コード、トークンをアクセスログへ追加しないでください。

## 接続確認

1. 未認証の/mcpが401になり、WWW-Authenticateが公開resource metadata URLを示す。
2. resource metadataが200で、resourceとauthorization_serversが自分の環境の値。
3. 接続アプリへHTTPSの/mcp URLと、必要に応じClient ID/Secretを登録。
4. 許可したユーザーでOAuth認証する。
5. 読取りロールで6ツール、書込みロールもあれば12ツールを確認。
6. get_sync_statusとlist_tasksを実行。必要なら専用の確認用タスクで書込みを確認。

Keycloakのトークン有効期間・更新・SSO期限は各環境で設定します。
長期継続・失効・権限削除後の挙動も運用開始前に確認してください。
