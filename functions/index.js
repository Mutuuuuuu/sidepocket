const { logger } = require("firebase-functions");

// このファイルは、将来的にCloud Functionsを実装するための雛形です。
// 現時点では、デプロイエラーを避けるために具体的な処理は記述しません。

// 例：後からユーザー作成時に何か処理を追加する場合
// const { onDocumentCreated } = require("firebase-functions/v2/firestore");
// exports.onUserCreate = onDocumentCreated("users/{userId}", (event) => {
//   logger.info("A new user was created:", event.params.userId);
//   // 何か処理を行う...
//   return;
// });