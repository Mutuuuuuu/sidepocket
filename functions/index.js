const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

// Google Calendarから予定を取得するCloud Function
exports.getCalendarEvents = onCall(async (request) => {
  // ライブラリの読み込みを関数内で行う
  const { google } = require("googleapis");

  // 認証情報とリクエストデータを取り出す
  const { tokens, startDate, endDate } = request.data;
  if (!tokens) {
    logger.error("No authentication tokens provided.");
    throw new functions.https.HttpsError('unauthenticated', '認証トークンがありません。');
  }

  // OAuth2クライアントを初期化
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
    }));
    
    return { events };

  } catch (error) {
    logger.error("Error fetching calendar events:", error.message, error.stack);
    // クライアントに返すエラーは具体的にしすぎない方が安全な場合もある
    throw new functions.https.HttpsError('internal', 'カレンダーの予定取得に失敗しました。詳細はログを確認してください。');
  }
});