# 歯周基本治療研究会 セミナー管理システム

Codex詳細仕様書Ver.3.0に基づき段階的に開発しています。認証・管理者MFA、イベント・タスク、参加者・申込時情報の管理に加え、担当者による受付確定と定員管理を実装しています。満席・締切後の確定を拒否し、受付確定から出欠や入金を推定しません。旧セミナー機能も認証後に利用できます。

**本番公開・実データ利用・外部送信は行っていません。正式な技術構成と費用、Google／LINEの認証条件は未決定です。**

Macでの確認用ソースは、[このブランチ](https://github.com/KumagaiYasushi/smile/tree/codex/mac-review-20261101)の **Code → Download ZIP** から取得できます。展開後のフォルダーで `bash scripts/review-mac.sh` を実行します。Node.js 24が必要です。詳しくは下記のMac向け手順をご覧ください。

- [開発手順と架空管理者の作成](docs/runbook.md)
- [Macで自分で画面を操作する確認手順](docs/verify-on-mac.md)
- [確定事項・未決定事項と次の段階](docs/decisions.md)
- [構成・費用の比較とデータ設計](docs/architecture.md)
- [認証と権限](docs/security.md)
- [外部連携の検証計画](docs/integrations.md)
- [受け入れテスト状況](docs/acceptance-tests.md)
