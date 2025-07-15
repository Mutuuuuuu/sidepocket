const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { google } = require("googleapis");

// Google Calendarから予定を取得するCloud Function
//【注意】この関数は雛形です。実際に動作させるには、OAuth2クライアントの設定やエラーハンドリングの実装が必要です。
exports.getCalendarEvents = onCall(async (request) => {
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
    logger.error("Error fetching calendar events:", error);
    throw new functions.https.HttpsError('internal', 'カレンダーの予定取得に失敗しました。');
  }
});