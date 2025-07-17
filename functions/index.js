// 第2世代(v2)の onCall と logger をインポート
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions/v2");

// firebase-adminの各モジュールをインポート
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore} = require("firebase-admin/firestore");

// googleapisは遅延読み込みして初期化のタイムアウトを防ぐ
let googleapis;

// Admin SDKの初期化
initializeApp();

// --- Google Calendar連携 ---
exports.getCalendarEvents = onCall(async (request) => {
  if (!googleapis) {
    googleapis = require("googleapis");
  }
  const {google} = googleapis;

  const {tokens, startDate, endDate} = request.data;
  if (!tokens) {
    logger.error("No authentication tokens provided.");
    throw new HttpsError("unauthenticated", "認証トークンがありません。");
  }
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(tokens);
  const calendar = google.calendar({version: "v3", auth: oauth2Client});
  try {
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    const events = response.data.items.map((event) => ({
      id: event.id,
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    }));
    return {events};
  } catch (error) {
    logger.error("Error fetching calendar events:", error.message, error.stack);
    throw new HttpsError("internal", "カレンダーの予定取得に失敗しました。");
  }
});

// --- 全ユーザーの取得 ---
exports.getAllUsers = onCall(async (request) => {
    // Gen 2では context.auth ではなく request.auth を使用
  if (!request.auth || !request.auth.token.isAdmin) {
    throw new HttpsError("permission-denied", "この操作を実行するには管理者権限が必要です。");
  }
  try {
    const listUsersResult = await getAuth().listUsers(1000);
    const userProfiles = await Promise.all(
        listUsersResult.users.map(async (userRecord) => {
          const userDoc = await getFirestore().collection("users").doc(userRecord.uid).get();
          const profile = userDoc.exists ? userDoc.data() : {};
          return {
            uid: userRecord.uid,
            email: userRecord.email,
            displayName: userRecord.displayName || profile.displayName || "N/A",
            isAdmin: !!userRecord.customClaims?.isAdmin,
            createdAt: userRecord.metadata.creationTime,
          };
        }),
    );
    return userProfiles;
  } catch (error) {
    logger.error("ユーザーリストの取得中にエラーが発生しました:", error);
    throw new HttpsError("internal", "ユーザーの取得に失敗しました。");
  }
});

// --- 管理者権限の設定 ---
exports.setUserAdminRole = onCall(async (request) => {
  if (!request.auth || !request.auth.token.isAdmin) {
    throw new HttpsError("permission-denied", "この操作を実行するには管理者権限が必要です。");
  }
  const {uid, isAdmin} = request.data;
  if (typeof uid !== "string" || typeof isAdmin !== "boolean") {
    throw new HttpsError("invalid-argument", "UID(string)とisAdmin(boolean)を正しく指定してください。");
  }
  try {
    await getAuth().setCustomUserClaims(uid, {isAdmin: isAdmin});
    return {message: `ユーザー(UID: ${uid})の権限をisAdmin:${isAdmin}に更新しました。`};
  } catch (error) {
    logger.error("管理者権限の設定中にエラーが発生しました:", error);
    throw new HttpsError("internal", "権限の更新に失敗しました。");
  }
});

// --- ダッシュボード統計の取得 ---
exports.getDashboardStats = onCall(async (request) => {
  if (!request.auth || !request.auth.token.isAdmin) {
    throw new HttpsError("permission-denied", "管理者権限が必要です。");
  }
  try {
    const db = getFirestore();
    const usersSnapshot = await db.collection("users").get();
    const totalUsers = usersSnapshot.size;
    let totalProjects = 0;
    let totalDurationHours = 0;

    for (const userDoc of usersSnapshot.docs) {
      const projectsSnapshot = await userDoc.ref.collection("projects").get();
      totalProjects += projectsSnapshot.size;
      const timestampsSnapshot = await userDoc.ref.collection("timestamps").where("status", "==", "completed").get();
      timestampsSnapshot.forEach((tsDoc) => {
        const tsData = tsDoc.data();
        if (tsData.clockInTime && tsData.clockOutTime) {
          const durationMillis = tsData.clockOutTime.toMillis() - tsData.clockInTime.toMillis();
          totalDurationHours += durationMillis / 36e5;
        }
      });
    }
    return {
      totalUsers,
      totalProjects,
      totalDurationHours: Math.round(totalDurationHours * 10) / 10,
    };
  } catch (error) {
    logger.error("ダッシュボード統計の計算中にエラー:", error);
    throw new HttpsError("internal", "統計データの取得に失敗しました。");
  }
});