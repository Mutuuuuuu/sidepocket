// Firebase Admin SDKをインポート
const admin = require('firebase-admin');

// ▼▼▼ 自分のJSONファイル名に書き換えてください ▼▼▼
const serviceAccount = require('./side-pocket-dev-firebase-adminsdk-fbsvc-4312ab8d13.json');

// Admin SDKを初期化
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ▼▼▼ 権限を付与したいユーザーのUID ▼▼▼
const uid = 'G0LMsrrcwjY3gpKOYqZqQYVAs383';

// カスタムクレームを設定
admin.auth().setCustomUserClaims(uid, { isAdmin: true })
  .then(() => {
    console.log(`成功: ユーザー (UID: ${uid}) に管理者権限を付与しました。`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('エラー:', error);
    process.exit(1);
  });