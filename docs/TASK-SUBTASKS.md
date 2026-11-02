# サブタスク作成

create_task は任意の parentId を受け付けます。projectId は引き続き必須で、親と同じプロジェクトを指定してください。parentId を省略すると従来どおり通常タスクを作成します。

親は認証済み単一アカウントのアクティブな通常タスクに限定します。アーカイブ、別アカウントのID、サブタスクを親とする多段階層、循環・不整合な親子関係、アーカイブ済みプロジェクトは拒否します。新しい子のIDはサーバー側で生成します。

公式 [Task] Add SubTask を暗号化して既存 /api/sync/ops 経路に送信します。公式 reducer が parentId と subTaskIds を一括更新し、プロジェクトの通常タスク一覧には子を追加しません。公式仕様により最初の子へ親の計測時間・見積りを引き継ぐ場合があります。親の日付・リマインダーは保持します。

予定・期限4フィールドを併用できます。子の予定に関する TODAY / planner 処理と期限処理は既存の公式 action を使用します。expectedServerSeq の競合拒否、requestId の冪等性、通信失敗時の同一暗号化操作再送、write ロールによる公開・実行制限は従来どおりです。複数 action の部分受理は既存 WRITE_PARTIALLY_ACCEPTED で停止します。

新規エラー: PARENT_PROJECT_MISMATCH、INVALID_TASK_HIERARCHY。親がアクティブ領域に存在しない場合は TASK_NOT_FOUND。

例（直前に読取りした serverSeq を使用）:

```json
{"requestId":"unique-request-id","expectedServerSeq":42,"projectId":"INBOX_PROJECT","parentId":"example-parent-id","title":"子タスクの例","deadlineDay":"2026-10-18"}
```

この機能の検証・本番反映では実アカウントの子タスクを作成しません。作成と読戻しは隔離 fixture で検証します。
