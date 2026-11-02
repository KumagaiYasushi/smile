# Renderで検証ページを公開する手順

## 今回用意した構成

リポジトリの `render.yaml` に、Renderの `Free` プランを指定した検証用Webサービスを定義した。
このファイルには、有料プラン・永続ディスクの作成を含めていない。
申込時の提供条件・利用可能なプランはRender側の画面で確認する。

Node.js 24.19.0でビルドし、起動時に専用DB・ログイン用アカウント・架空サンプル3種類を自動準備する。
Renderが設定する `RENDER_EXTERNAL_URL` をHTTPS Originとして利用するため、手動でURLをソースへ書き込む必要はない。
検証用のメール・パスワードはRenderの秘密設定で入力し、GitHubへ保存しない。

## アカウント作成後の操作

1. [Renderの管理画面](https://dashboard.render.com/)にGitHubでログインする。
2. **New → Blueprint** を開き、GitHubの `KumagaiYasushi/smile` を連携対象にする。
3. ブランチに **`codex/verification-preview`**、設定ファイルに **`render.yaml`** を指定する。
4. 表示されるWebサービス名が `smile-verification`、プランが **Free** であることを確認する。
5. 次の2項目を入力する。

   | 設定名 | 入力内容 |
   | --- | --- |
   | `SMILE_VERIFICATION_EMAIL` | 検証ページのログインに使うメールアドレス |
   | `SMILE_VERIFICATION_PASSWORD` | 検証ページ専用の12〜128文字のパスワード |

6. Blueprintをデプロイする。ビルドと初期化が終わるまで待つ。
7. Renderに表示されたサービスのHTTPS URLを開き、設定したメール・パスワードでログインする。
8. 上部メニューの **検証ページ** を開く。パスは `/verification`。

Renderの画面名は変更される場合がある。画面が異なる場合も、対象リポジトリ・ブランチ・設定ファイル・Freeプランを確認する。
こちらのクラウド環境にはRenderのログイン情報やデプロイAPIが接続されていないため、アカウント作成とGitHub連携は利用者の画面で行う。
この設定ファイルをGitHubへ置いただけでは、Renderにサービスや共有URLは作成されない。

## データの保存条件

今回は操作確認用の**一時保存**。`/tmp/smile-verification` に架空データを保存する。
サーバーの再起動・再配置等でファイルが失われると、初期サンプルへ戻り、以前の編集やセッションも失われる。
画面上にも一時保存であることを表示する。実在する参加者や実際の注文を登録しない。
ファイルが残っている間は、再起動でパスワードや手動編集を上書きしない。

自動デプロイは無効にしている。GitHubを更新した後、必要なタイミングでRender側から再デプロイする。
データを残したい段階では、別途、永続ディスクを利用できる構成へ変更し、料金と保存先を確認する。

## 起動処理と検証

`npm run verification:hosted` が次を順に行う。

1. メール・パスワード・専用保存先・HTTPS URLを検証する。
2. 初期化スクリプトへパスワードを標準入力で渡す。コマンド引数やログにパスワードを出さない。
3. 初期化が成功した場合のみ、本番形式のNext.jsサーバーを起動する。
4. サーバーには初期化用パスワードを環境変数として引き継がない。

検証コマンド：`npm test`、`npm run build`、`npm run test:hosted`。
`test:hosted` は一時DBとランダムな資格情報で公開用起動を実行し、サンプル、ログイン必須、HTTPS Originの検証、Secure Cookie、一時保存の表示を確認する。
ローカルのテストではHTTPS終端後のサーバーへの転送を想定してAPIを呼ぶ。Renderの実アカウント・HTTPS経路・公開URLの検証は、利用者がデプロイした後に行う。

サービス条件の確認先：[Renderの料金](https://render.com/pricing)、[Blueprintの仕様](https://render.com/docs/blueprint-spec)。
