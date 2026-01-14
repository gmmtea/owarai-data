# お笑い主要データまとめ owarai-data

お笑い芸人やお笑い賞レースの記録を横断して参照できる非公式データ集です。M-1グランプリをはじめとする各種大会の結果、芸人プロフィール、審査員採点などを体系的に管理・表示します。

https://gmmtea.github.io/owarai-data/

## 主な機能

- **大会結果の閲覧**: 各大会の年別結果（決勝結果詳細、準決勝進出者など）
- **芸人一覧**: 大会の結果でフィルタリング、五十音順／結成日順／誕生日順に切り替え
- **芸人詳細**: 読み、誕生日／結成日、大会出場結果、所属ユニット／所属メンバー情報
- **本日誕生日の芸人**: トップページで自動表示

## 技術スタック

- **フロントエンド**: Astro
- **スタイリング**: CSS
- **データベース**: SQLite
- **データ収集**: Playwright（ブラウザ自動化）, Cheerio（HTMLパース）
- **デプロイ**: GitHub Pages（GitHub Actions）

## プロジェクト構成

```
owarai-data/
├── data/                   # SQLiteデータベースファイル
│   └── awards.sqlite
├── seed_csv/               # マスターデータ（CSV形式）
│   ├── comedians.csv                # 芸人情報（名前、読み、誕生日／結成日など）
│   ├── competitions.csv             # 大会情報（M-1、キングオブコントなど）
│   ├── editions.csv                 # 年別大会（「M-1グランプリ2025」など各年の大会）
│   ├── final_results.csv            # 大会最終結果（順位、キャッチコピー、ネタ名、ネタ動画など）
│   ├── judge_scores.csv             # 審査員別得点
│   ├── edition_judges.csv           # 大会別年別審査員の紐付け
│   ├── memberships.csv              # ユニットのメンバー構成
│   └── updates.csv                  # 更新履歴
├── scripts/                # データ収集・インポートスクリプト
│   ├── m1_scrape_multi.js           # M-1データスクレイピング
│   └── import-seed-csv.js           # CSVからDBへインポート
├── src/
│   ├── components/         # 再利用可能なUIコンポーネント
│   │   ├── FinalResultsTable.astro        # 決勝結果テーブル
│   │   ├── JudgeScoresTable.astro         # 審査員採点テーブル
│   │   ├── ResultDataCells.astro          # 結果データのセル表示
│   │   ├── ResultTableCore.astro          # 結果テーブルのコア部分
│   │   ├── RevivalFinalVotesTable.astro   # 敗者復活最終投票テーブル
│   │   └── RevivalMatchesTable.astro      # 敗者復活対戦テーブル
│   ├── pages/              # ルーティング・ページ（ファイルベース）
│   │   ├── index.astro                    # トップページ（大会一覧、本日誕生日の芸人）
│   │   ├── 404.astro                      # 404エラーページ
│   │   ├── [comp]/
│   │   │   ├── index.astro                # 大会別トップ（歴代結果一覧）
│   │   │   └── [year].astro               # 大会年別詳細ページ
│   │   ├── co/
│   │   │   ├── index.astro                # 芸人一覧ページ
│   │   │   └── [id].astro                 # 芸人詳細ページ
│   │   └── updates/
│   │       └── index.astro                # 更新履歴
│   ├── layouts/            # レイアウトテンプレート
│   │   └── Base.astro                     # ベースレイアウト（ヘッダー・フッター）
│   └── lib/                # DB接続・クエリロジック
│       ├── db.ts                          # SQLite接続
│       └── queries.ts                     # データ取得クエリ集
├── public/                 # 静的アセット
├── astro.config.mjs        # Astro設定
└── package.json
```

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/gmmtea/owarai-data.git
cd owarai-data
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. データベースのセットアップ

CSVファイルからSQLiteデータベースを生成します：

```bash
npm run data:seed:csv
```

このコマンドは `seed_csv/` ディレクトリ内のCSVファイルを読み込み、`data/awards.sqlite` データベースを作成・更新します。

### 4. ビルド

データベースからページを生成します：

```bash
npm run build
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:4321](http://localhost:4321) を開いてサイトを確認できます。

## 利用可能なコマンド

プロジェクトルートから以下のコマンドを実行できます：

| コマンド | 説明 |
| :--- | :--- |
| `npm install` | 依存関係をインストール |
| `npm run dev` | 開発サーバーを起動（`localhost:4321`） |
| `npm run build` | 本番用に静的サイトをビルド（`./dist/`に出力） |
| `npm run preview` | ビルドしたサイトをローカルでプレビュー |
| `npm run data:seed:csv` | CSVファイルをSQLiteにインポート |
| `npm run data:scrape:m1` | M-1データをスクレイピング |
| `npm run deploy:actions` | GitHub Actions経由でデプロイをトリガー |

## データ構造

主なデータベーステーブル：

- **`competitions`**: 大会情報
- **`editions`**: 年別大会
- **`comedians`**: 芸人情報
- **`memberships`**: ユニットのメンバー構成
- **`final_results`**: 大会最終結果
- **`judge_scores`**: 審査員別得点
- **`judges`**: 審査員情報
- **`edition_judges`**: 大会別年別審査員の紐付け
- **`updates`**: 更新履歴

詳細なスキーマは `scripts/import-seed-csv.js` のテーブル定義部分を参照してください。

## デプロイ

### GitHub Pagesへの自動デプロイ

このプロジェクトはGitHub Actionsを使用して、毎日0時にGitHub Pagesにデプロイされます。

#### 手動デプロイのトリガー

```bash
npm run deploy:actions
```

このコマンドは `.github/workflows/daily-deploy.yml` ワークフローを手動で起動します。

#### デプロイ設定

- **サイトURL**: `https://gmmtea.github.io/owarai-data/`
- **ベースパス**: `/owarai-data/`（`astro.config.mjs`で設定）
- **ブランチ**: `gh-pages`ブランチにデプロイ
- **自動実行**: 毎日0時に自動デプロイ
