# User-specific SuperSync accounts

The HTTP MCP service verifies the Keycloak issuer, audience, signature and read/write client roles. Its account mapping uses the verified `(issuer, sub)` pair; usernames are not account keys. A role-bearing identity with no mapping receives HTTP 403 `account_not_linked` and never opens a credential file or sync database. The same MCP endpoint and read/write tool names remain available.

Set `MCP_ACCOUNTS_FILE` to a private JSON file (default `secrets/accounts.json`, already Git-ignored):

```json
{
  "accounts": [
    {
      "issuer": "https://login.example.org/realms/team",
      "subject": "existing-keycloak-subject",
      "credentialsPath": "secrets/supersync.json",
      "dataDir": "data"
    }
  ]
}
```

Paths resolve relative to the service working directory, not the mapping file. Each additional user needs a separately authorized SuperSync account, its own credential file, and a distinct, non-overlapping data directory. Provisioning those credentials or assigning Keycloak roles is a separate administrative action. Never map separate users to credentials for the same SuperSync account, even through different filenames. The mapping is trusted private administrative configuration; the MCP does not provision or authenticate an account on behalf of a new user.

For existing-owner migration, explicitly map the existing verified issuer/subject to the existing `secrets/supersync.json` and `data` directory. Do not copy credentials, cache, or outbox to another user. Back up the running service configuration, source and SQLite using a consistent SQLite backup before deployment. The first account access binds the existing SQLite metadata to that issuer/subject, preserving encrypted operations, cursor, outbox, client ID and counter. Reassigning a bound directory to another identity fails closed. Removing the mapping revokes that identity; restart after configuration changes.

The service refuses duplicate identities, canonical credential paths, and equal or nested data directories on startup. Every configured account has separate in-memory projections, in-flight downloads, write queue, SQLite operations/outbox and persistent device identity. A write invalidates only its own account cache. The HTTP service always injects that account's reader and writer; legacy local probe/smoke scripts remain single-account administrative tools and are not HTTP authorization paths. They should not be used to access other users' directories.

Rollback uses the backed-up source and original configuration. The added `accountIdentity` metadata key is compatible with the earlier SQLite reader. Do not delete or reset the outbox or device identity during migration or rollback.

## Adding a user with Docker Compose

1. Obtain the user's verified Keycloak issuer and immutable `sub`. Assign the configured resource client's read role (`sp-mcp:mcp.read` by default); also assign `mcp.write` for write access. Read remains required when write is assigned. The access token must include the configured MCP audience. Do not use the display username as a mapping key.
2. Create a separate SuperSync account and obtain its SuperSync access token and matching E2EE encryption password. These credentials are separate from the Keycloak login token. Store them privately in `secrets/user-b.json` using the structure of `examples/supersync.json`.
3. Create a sibling data directory `data-user-b`, not a directory inside the existing `data`. Set private files to mode `0600` and private directories to `0700`, owned by the service's `LOCAL_UID`/`LOCAL_GID`. The credential loader rejects group/other file access. `secrets/` and `data-*/` are Git-ignored; ensure any custom data path is also ignored.
4. Append this entry to `secrets/accounts.json`, preserving every existing entry:

```json
{
  "issuer": "https://login.example.org/realms/team",
  "subject": "<VERIFIED_NEW_USER_SUBJECT>",
  "credentialsPath": "secrets/user-b.json",
  "dataDir": "data-user-b"
}
```

5. Add these volumes under the `mcp` service, retaining the existing account mapping and volumes:

```yaml
- ./secrets/user-b.json:/workspace/secrets/user-b.json:ro
- ./data-user-b:/workspace/data-user-b
```

6. Recreate the service with `docker compose up -d --no-deps --force-recreate mcp`. This reloads the mapping and binds replacement files and added volumes. Have the new user log in normally, call `get_sync_status`, and confirm that task reads show only their own SuperSync account. A read-only user must have no write tools; an identity without a mapping must receive HTTP 403. Never repurpose another identity's existing data directory or copy its credentials.
