const admin = require('firebase-admin');
// あなたのサービスアカウントのJSONファイルを指定
const serviceAccount = require('./side-pocket-sls-firebase-adminsdk-fbsvc-de8f39c10d.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ★★★ あなたのUIDを指定してください ★★★
const uid = 'weJvyD7VUxgO2S0cfX2FJLlAKzI2';

// カスタムクレームを空に設定して権限をリセットします
admin.auth().setCustomUserClaims(uid, {})
  .then(() => {
    console.log(`成功: ユーザー (UID: ${uid}) の管理者権限をリセットしました。`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('リセットエラー:', error);
    process.exit(1);
  });