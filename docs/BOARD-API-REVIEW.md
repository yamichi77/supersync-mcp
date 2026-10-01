# Board API 0.3.0（公開前レビュー済み）

0.3.0のツール・引数・制約と、旧専用APIからの切替条件を記載します。
下記の公開前レビューを経て、2026-10-01に反映・pushが承認されました。

## 公開ツール一覧

write権限ありでは16ツール、read権限のみでは7ツールです。
公開mainの12ツールはそのまま保持し、次の4ツールを追加します。

| ツール | 権限 | 引数 | 結果・変更範囲 |
|---|---|---|---|
| create_project | write | requestId, expectedServerSeq, title | projectId。公式既定値で作成。同名は拒否。既存のローカル追加を保持 |
| get_board | read | id | serverSeq, board。存在しないIDはboard:null |
| create_board | write | requestId, expectedServerSeq, projectId, title, columns, cols? | boardId。指定projectに汎用ボードを追加 |
| update_board | write | requestId, expectedServerSeq, id, title?, cols?, columns? | boardId。ボード名・表示列数・既存列の設定だけを変更 |

維持する12ツール：get_sync_status、list_tasks、list_archived_tasks、list_projects、list_tags、get_task、create_task、update_task、update_task_tags、set_task_kanban_status、complete_task、reopen_task。
既存12ツールの入力・出力・権限は変更しません。

現在の稼働版だけにあるcreate_workflow_boardとset_workflow_board_exclusionsは公開面から外します。
公開mainにはこの2ツールはありませんが、稼働版の利用者にとっては破壊的変更です。
旧名の再送や読み替えを新サーバーへ黙って流す互換エイリアスは設けません。

## 列設定

作成時のcolumnsの各要素：

| 引数 | 型・既定値 | 意味 |
|---|---|---|
| title | 必須文字列 | 列名 |
| includedTagIds / excludedTagIds | ID配列、既定[] | 既存タグの包含・除外。自動で他列のタグを除外しない |
| includedTagsMatch / excludedTagsMatch | all / any、既定all / any | 各フィルタの一致方式 |
| taskDoneState | all / done / undone、既定all | 完了状態 |
| scheduledState | all / scheduled / not_scheduled、既定all | 予定の有無 |
| backlogState | all / no_backlog / only_backlog、既定all | backlogの範囲 |
| isParentTasksOnly | boolean、既定false | 親タスクだけを表示 |

更新時は列idを必須にし、同じ設定項目を部分指定します。指定がない項目・列は保持します。
get_boardは上記設定に加え、列id・taskIds・projectIdsを返します。
update_boardからtaskIds・projectIdsは変更できません。列の追加・削除・並べ替えも対象外です。
指定した列パッチの順序で列を並べ替えることはありません。
除外タグ配列を指定した場合は、その配列が新しい設定になります。普通のタグを残すには含めてください。
カード本体のタグはボード設定変更では書き換えません。

## 残す制約と根拠

| 制約 | 根拠 |
|---|---|
| 列数1〜50、タグ配列100件以下、表示列数colsは1〜12 | MCP単一要求のサイズ・処理量を抑える実装上限。SPの8状態仕様ではない |
| cols省略時はmin(3, 列数) | 表示既定値。列数を3や4へ固定する制約ではない |
| 名前はtrim後1〜200文字、制御文字不可。IDは1〜255文字 | MCP入力検証。ボード・列の名前を任意に指定可能 |
| タグ配列内重複・更新列idの重複・存在しない列idを拒否 | 設定の誤りや不明な更新対象を拒否。全パッチ検証後に操作を構築 |
| 作成projectは存在し、非アーカイブ。指定タグは存在する | SP実体との整合性 |
| TODAYをタグフィルタの指定から除外 | 仮想の当日予定ビュー。予定の有無にはscheduledStateを使うが「今日」の指定機能ではない |
| 全書込みにrequestId・expectedServerSeq、writeロール | 既存の再送・競合・認可契約を維持 |

8列・完了列がちょうど1つ・表示4列・相互排他・親タスク限定という業務ルールは公開SPにありません。
完了列なし／複数、同じタグを持つ複数列、タグなしの列、存在するKANBAN_IN_PROGRESSタグも利用できます。
private Controllerが必要な8状態・タグ排他・表示4列を明示引数として生成します。

## 架空の3列例

project-example、tag-ideas、tag-workは既存IDの架空例です。実環境では一覧で確認したIDを指定します。

```json
{
  "requestId": "request-example-001",
  "expectedServerSeq": 42,
  "projectId": "project-example",
  "title": "Example board",
  "cols": 3,
  "columns": [
    {"title": "Ideas", "includedTagIds": ["tag-ideas"]},
    {"title": "Work", "includedTagIds": ["tag-work"]},
    {"title": "Finished", "taskDoneState": "done"}
  ]
}
```

## 切替と既存データ

既存ボード・カード・タグを再作成／自動修正しません。
旧2ツールの通信結果不明要求は、旧稼働版のうちに同じ名前・requestId・引数で解決する必要があります。
旧要求の結果が分からないまま新ツール名・新requestIdへ置換すると重複作成の危険があります。
private側は保存済み旧boardRequestを識別して旧ツールのまま再送し、新要求だけcreate_boardを使います。
新サーバーへ切替後に旧要求を送ると未対応ツールとして停止します。自動的に別要求を作りません。

切替の操作順：旧要求が残っていないことを確認し、SP MCPとControllerのAPI切替を揃え、処理が空のときControllerを再起動し、ChatGPTのツール一覧を更新します。
これらの実施状況は運用側で確認します。認証・秘密情報・実環境設定は公開差分に含めません。
