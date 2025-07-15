# sidepocket - 稼働時間管理アプリ

フリーランスや副業ワーカー向けの稼働時間管理Webアプリケーションです。

## 主な技術スタック
- フロントエンド: HTML, JavaScript, Tailwind CSS
- バックエンド: Google Firebase (Authentication, Firestore, Storage, Cloud Functions, Hosting)
- ライブラリ: Chart.js, jsPDF

## 開発環境のセットアップ

### 1. 必要なツールをインストール
- [Node.js](https://nodejs.org/) (npmを含む)
- [Firebase CLI](https://firebase.google.com/docs/cli)

### 2. リポジトリをクローンして依存関係をインストール
```bash
# プロジェクトのルートディレクトリで実行
npm install

# functionsディレクトリに移動して、そちらの依存関係もインストール
cd functions
npm install
cd ..