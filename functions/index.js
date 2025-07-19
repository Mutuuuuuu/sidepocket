// Firebase Functions v2と関連モジュールをインポート
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");

// Firebase Admin SDKモジュールをインポート
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

// Admin SDKを初期化
initializeApp();

// Stripe SDKを初期化 (シークレットキーは環境変数に設定することを強く推奨します)
// 例: firebase functions:config:set stripe.secret_key="sk_test_..."
// const functions = require("firebase-functions");
// const stripe = require("stripe")(functions.config().stripe.secret_key);
// 下記はデモ用の仮キーです。本番環境では必ず環境変数を使用してください。
const stripe = require("stripe")("sk_test_YOUR_STRIPE_SECRET_KEY");


// googleapisは初回利用時に遅延読み込みして初期化のタイムアウトを防ぐ
let googleapis;

// --- 【新規追加】Stripe Checkoutセッションを作成する ---
exports.createCheckoutSession = onCall({ cors: true }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "この操作には認証が必要です。");
    }
    const uid = request.auth.uid;
    const { priceId, successUrl, cancelUrl } = request.data;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "subscription",
            line_items: [{
                price: priceId, // (例: 月額プランや年額プランのPrice ID)
                quantity: 1,
            }],
            success_url: successUrl || `${request.headers.origin}/profile.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl || `${request.headers.origin}/profile.html`,
            customer_email: request.auth.token.email, // Stripe顧客にメールアドレスを事前入力
            client_reference_id: uid, // Webhookでユーザーを特定するためにUIDを渡す
        });

        return { sessionId: session.id };
    } catch (error) {
        logger.error("Stripe Checkoutセッションの作成に失敗しました:", error);
        throw new HttpsError("internal", "決済セッションの作成に失敗しました。");
    }
});

// --- 【新規追加】Stripe Webhookを処理する ---
exports.stripeWebhook = onRequest({ cors: true }, async (req, res) => {
    const sig = req.headers["stripe-signature"];
    // Webhookのシークレットキー (環境変数に設定してください)
    // firebase functions:config:set stripe.webhook_secret="whsec_..."
    const endpointSecret = "whsec_YOUR_STRIPE_WEBHOOK_SECRET";

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        logger.error("Webhook署名の検証に失敗しました。", err);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }
    
    const db = getFirestore();

    // イベントタイプに応じて処理を分岐
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const uid = session.client_reference_id;
            const subscriptionId = session.subscription;

            // ユーザーのプランをStandardに更新
            await db.collection("users").doc(uid).set({
                plan: "Standard",
                subscription: {
                    id: subscriptionId,
                    status: "active",
                    provider: "stripe",
                    // Stripeから返される他のサブスクリプション情報もここに保存可能
                }
            }, { merge: true });
            
            logger.info(`ユーザー(UID: ${uid})のプランをStandardに更新しました。`);
            break;
        }
        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const userQuery = await db.collection("users").where("subscription.id", "==", subscription.id).get();
            
            if (!userQuery.empty) {
                const userDoc = userQuery.docs[0];
                // ユーザーのプランをFreeにダウングレード
                await userDoc.ref.update({
                    plan: "Free",
                    "subscription.status": "canceled"
                });
                logger.info(`ユーザー(UID: ${userDoc.id})のサブスクリプションがキャンセルされ、プランをFreeに更新しました。`);
            }
            break;
        }
        // 他のイベントタイプ (例: customer.subscription.updated) の処理も追加可能
    }

    res.json({ received: true });
});


// --- Google Calendar連携 (既存) ---
exports.getCalendarEvents = onCall({ cors: true }, async (request) => {
  if (!googleapis) {
    googleapis = require("googleapis");
  }
  const { google } = googleapis;

  const { tokens, startDate, endDate } = request.data;
  if (!tokens) {
    logger.error("No authentication tokens provided.");
    throw new HttpsError("unauthenticated", "認証トークンがありません。");
  }
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
    const events = response.data.items.map((event) => ({
      id: event.id,
      summary: event.summary,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    }));
    return { events };
  } catch (error) {
    logger.error("Error fetching calendar events:", error.message, error.stack);
    throw new HttpsError("internal", "カレンダーの予定取得に失敗しました。");
  }
});

// --- 全ユーザーの取得 (【更新】plan情報を追加) ---
exports.getAllUsers = onCall({ cors: true }, async (request) => {
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
          plan: profile.plan || 'Free', // plan情報を追加
          createdAt: userRecord.metadata.creationTime,
        };
      })
    );
    return userProfiles;
  } catch (error) {
    logger.error("ユーザーリストの取得中にエラーが発生しました:", error);
    throw new HttpsError("internal", "ユーザーの取得に失敗しました。");
  }
});

// --- ユーザー詳細の取得 (既存) ---
exports.getUserDetails = onCall({ cors: true }, async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
        throw new HttpsError("permission-denied", "この操作を実行するには管理者権限が必要です。");
    }
    const { uid } = request.data;
    if (!uid) {
        throw new HttpsError("invalid-argument", "UIDを指定してください。");
    }
    try {
        const db = getFirestore();
        const userDoc = await db.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            throw new HttpsError("not-found", "ユーザーが見つかりません。");
        }
        const profile = userDoc.data();

        const projectsSnapshot = await db.collection("users").doc(uid).collection("projects").orderBy("createdAt", "desc").get();
        const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const timestampsSnapshot = await db.collection("users").doc(uid).collection("timestamps").orderBy("clockInTime", "desc").limit(10).get();
        const timestamps = timestampsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return { profile, projects, timestamps };

    } catch (error) {
        logger.error(`ユーザー詳細(${uid})の取得中にエラー:`, error);
        throw new HttpsError("internal", "ユーザー詳細の取得に失敗しました。");
    }
});


// --- 管理者権限の設定 (既存) ---
exports.setUserAdminRole = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.token.isAdmin) {
    throw new HttpsError("permission-denied", "この操作を実行するには管理者権限が必要です。");
  }
  const { uid, isAdmin } = request.data;
  if (typeof uid !== "string" || typeof isAdmin !== "boolean") {
    throw new HttpsError("invalid-argument", "UID(string)とisAdmin(boolean)を正しく指定してください。");
  }
  try {
    await getAuth().setCustomUserClaims(uid, { isAdmin: isAdmin });
    return { message: `ユーザー(UID: ${uid})の権限をisAdmin:${isAdmin}に更新しました。` };
  } catch (error) {
    logger.error("管理者権限の設定中にエラーが発生しました:", error);
    throw new HttpsError("internal", "権限の更新に失敗しました。");
  }
});

// --- 【新規追加】会員プランの設定 ---
exports.setUserPlan = onCall({ cors: true }, async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
      throw new HttpsError("permission-denied", "この操作を実行するには管理者権限が必要です。");
    }
    const { uid, plan } = request.data;
    if (typeof uid !== "string" || (plan !== "Free" && plan !== "Standard")) {
      throw new HttpsError("invalid-argument", "UID(string)とplan('Free'または'Standard')を正しく指定してください。");
    }
    try {
      await getFirestore().collection("users").doc(uid).set({ plan: plan }, { merge: true });
      return { message: `ユーザー(UID: ${uid})のプランを ${plan} に更新しました。` };
    } catch (error) {
      logger.error("プランの設定中にエラーが発生しました:", error);
      throw new HttpsError("internal", "プランの更新に失敗しました。");
    }
});


// --- ダッシュボード分析データ取得 (既存) ---
exports.getDashboardAnalytics = onCall({ cors: true }, async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
        throw new HttpsError("permission-denied", "管理者権限が必要です。");
    }

    try {
        const db = getFirestore();
        const usersSnapshot = await db.collection("users").get();
        const allUsers = usersSnapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));

        let totalProjects = 0;
        let totalDurationHours = 0;
        const projectsByMonth = {};
        const activeUsersByMonth = {};
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() -1, now.getDate());

        let monthlyActiveUsers = new Set();

        for (const user of allUsers) {
            // プロジェクト数を集計
            const projectsSnapshot = await db.collection("users").doc(user.uid).collection("projects").get();
            totalProjects += projectsSnapshot.size;

            // プロジェクト作成月を集計
            projectsSnapshot.forEach(doc => {
                const project = doc.data();
                if (project.createdAt) {
                    const month = project.createdAt.toDate().toISOString().slice(0, 7); // YYYY-MM
                    projectsByMonth[month] = (projectsByMonth[month] || 0) + 1;
                }
            });

            // 稼働時間とアクティブユーザーを集計
            const timestampsSnapshot = await db.collection("users").doc(user.uid).collection("timestamps").get();
            let userIsActiveInLast30Days = false;
            timestampsSnapshot.forEach(doc => {
                const ts = doc.data();
                // 総稼働時間の計算
                if (ts.status === 'completed' && ts.clockInTime && ts.clockOutTime) {
                    totalDurationHours += (ts.clockOutTime.toMillis() - ts.clockInTime.toMillis()) / 3600000;
                }
                // アクティブユーザーの判定
                if (ts.clockInTime) {
                    const clockInDate = ts.clockInTime.toDate();
                    const month = clockInDate.toISOString().slice(0, 7);
                    if (!activeUsersByMonth[month]) {
                        activeUsersByMonth[month] = new Set();
                    }
                    activeUsersByMonth[month].add(user.uid);

                    if (clockInDate > lastMonth) {
                        userIsActiveInLast30Days = true;
                    }
                }
            });
            if(userIsActiveInLast30Days) monthlyActiveUsers.add(user.uid);
        }

        // グラフ用にデータを整形
        const userRegistrationByMonth = {};
        allUsers.forEach(user => {
            if (user.createdAt) {
                const month = user.createdAt.toDate().toISOString().slice(0, 7);
                userRegistrationByMonth[month] = (userRegistrationByMonth[month] || 0) + 1;
            }
        });

        // 月のラベルを生成 (過去12ヶ月分)
        const labels = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(d.toISOString().slice(0, 7));
        }
        
        let cumulativeUsers = 0;
        const cumulativeUserCounts = {};
        // 全期間の累計ユーザー数を計算
        Object.keys(userRegistrationByMonth).sort().forEach(month => {
            cumulativeUsers += userRegistrationByMonth[month];
            cumulativeUserCounts[month] = cumulativeUsers;
        });
        
        // 直近月の累計ユーザー数を過去の月に引き継ぐ
        for(let i=1; i < labels.length; i++) {
            if (!cumulativeUserCounts[labels[i]]) {
                cumulativeUserCounts[labels[i]] = cumulativeUserCounts[labels[i-1]] || 0;
            }
        }

        const userChartData = labels.map(month => {
            return {
                month,
                total: cumulativeUserCounts[month] || 0,
                active: activeUsersByMonth[month] ? activeUsersByMonth[month].size : 0,
            };
        });

        const projectChartData = labels.map(month => ({
            month,
            count: projectsByMonth[month] || 0
        }));

        const activeRate = allUsers.length > 0 ? (monthlyActiveUsers.size / allUsers.length) * 100 : 0;

        return {
            totalUsers: allUsers.length,
            totalProjects,
            totalDurationHours: Math.round(totalDurationHours * 10) / 10,
            activeRate: Math.round(activeRate * 10) / 10,
            userChartData,
            projectChartData,
        };

    } catch (error) {
        logger.error("ダッシュボード分析データの取得中にエラー:", error);
        throw new HttpsError("internal", "分析データの取得に失敗しました。");
    }
});
