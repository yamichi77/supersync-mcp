# タスクの予定と期限

create_task / update_task に以下の省略可能な引数を追加する。既存引数と結果、ロール、expectedServerSeq、requestId は維持する。

| 引数 | 意味 | 形式 |
|---|---|---|
| dueDay | 予定日 | YYYY-MM-DD |
| dueWithTime | 予定日時 | Unix ミリ秒（整数） |
| deadlineDay | 期限日 | YYYY-MM-DD |
| deadlineWithTime | 期限日時 | Unix ミリ秒（整数） |

同じ組の日付と日時は、null を含めて同時指定を拒否する。日付は実在する 1970〜9999 年の暦日。日時は 0 より大きく 9999 年内の日本時間として表現できる範囲。文字列・秒への暗黙変換は行わない。

update の未指定は保持。create の未指定は公式デフォルト。組のどちらかへの null は予定／期限全体を解除する。非 null を指定すると同じ組のもう一方はクリアされる。予定と期限は独立して指定できる。

この単一ユーザー環境のタイムゾーンは Asia/Tokyo。日付は日本時間の暦日、日時は絶対時刻。例: 2026-10-15 09:00 JST は 1792022400000。時刻のない文字列を日時として解釈しない。論理日の境界は SP の misc.startOfNextDayTime / startOfNextDay を公式関数で解釈する。

予定変更は公式 unscheduleTask と Plan Task for Day / scheduleTaskWithTime、期限変更は setDeadline / removeDeadline を暗号化同期経由で送る。事前に同じ公式 reducer で全操作を検証する。通知は scheduleReminder / deadlineReminder で設定・解除する。未指定の通知は保持し、日時変更時は相対時刻を再計算する。詳しくは [TASK-REMINDERS.md](TASK-REMINDERS.md) を参照。ブラウザー Effects や独自の配信サービスは提供しない。

TODAY は task.tagIds に追加しない。公式処理が TODAY の順序と Planner を更新する。今日の期限を指定したときは公式の自動計画ルールを適用するため、未計画／過去の予定は今日に移る場合がある。将来の明示的な予定と完了タスクは公式ルールで保持される。

本文と日付の複合要求は複数の公式操作を単一の永続 outbox／HTTP 要求に記録する。サーバーは操作ごとの受付結果を返すため、全操作の受理を確認してから成功を返す。応答欠落は同じ requestId・同じ引数で再送する。WRITE_PARTIALLY_ACCEPTED は一部だけ受理された場合であり、成功扱い・自動上書き・ロールバックは行わない。最新状態を読み直し、残った意図を確認して新しい requestId で実行する。WRITE_REJECTED は全操作が拒否された場合。

デプロイ後、接続アプリが古い tools/list を保持している場合は Super Productivity 接続を再接続／ツール更新する。四つの引数と get_task/list_tasks の deadlineWithTime を確認する。認証設定やロールの追加は不要。
