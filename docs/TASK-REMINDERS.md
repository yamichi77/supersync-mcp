# タスク通知

create_task / update_task の scheduleReminder（予定）と deadlineReminder（期限）:

```json
{"scheduleReminder":{"minutesBefore":60},"deadlineReminder":{"minutesBefore":0}}
```

minutesBefore は SP 標準 UI と同じ 0 / 5 / 10 / 15 / 30 / 60。0 は日時ちょうど。null は Never。更新時の未指定は保持、作成時の未指定は通知なし。タイトルやノートのみの更新は通知を変更しない。

非 null の通知には、その組の時刻付き日時（dueWithTime / deadlineWithTime）が必要。同じ要求で設定しても、既存の日時を利用してもよい。日付のみから通知時刻は推測しない。日時を更新すると既存の時間差を正確に再計算する。他のクライアントでスヌーズされた場合も、丸めず既存の時間差を維持する。日付のみへ変更するときに既存通知がある場合は REMINDER_REQUIRES_TIME となるため、通知を null にする意思を同じ要求で指定する。予定／期限自体の null は対応する通知も解除する。

get_task / list_tasks / list_archived_tasks は次の値を返す:

```json
{"scheduleReminder":{"minutesBefore":60,"remindAt":4098682800000},"deadlineReminder":null}
```

remindAt は SP が保存した絶対 Unix ミリ秒。minutesBefore は現在の日時との差から導出し、独自の設定保存領域を追加しない。既存の日時なし通知では minutesBefore は null。完了済み・アーカイブ内でも保存された設定は表示するが、配信中を意味しない。

標準 scheduleTaskWithTime / setDeadline 操作に日時と通知時刻を一緒に含める。通知だけの解除は dismissReminderOnly / clearDeadlineReminder を使う。予定と期限は別々の標準通知として扱う。期限変更に伴う標準自動計画が別の予定通知を消す場合は REMINDER_SCHEDULE_CONFLICT で全要求を送信前に拒否する。通知を解除するか、保持する予定を適切に指定して再実行する。

タスク完了は SP 標準セレクターにより予定・期限両方の通知対象から除外する。保存設定を消さないので、再開時には再び対象となる。過去時刻の通知は標準 SP の overdue 処理に従う。

expectedServerSeq / requestId と既存 outbox の競合・再送契約は維持する。各日時と対応通知は同じ操作なので片方だけの適用は起こらない。本文・予定・期限など複数操作の要求全体は SuperSync のサーバー側トランザクションではない。従来どおり部分拒否は WRITE_PARTIALLY_ACCEPTED として成功扱いせず、読み直して残る意図を確認する。独自の通知サービスや配信先は追加しない。

配信は同期先 SP アプリの標準 reminder worker と OS 通知許可に依存する。MCP サーバーは通知を配信しない。アプリ停止中の OS 配送は保証しない。接続アプリが古いツール定義を保持する場合はツール更新／再接続が必要。
