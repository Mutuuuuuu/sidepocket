// Firebase Functions v2と関連モジュールをインポート
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions/v2");
const cors = require("cors")({ origin: true });

// Firebase Admin SDKモジュールをインポート
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Admin SDKを初期化
initializeApp();

// Stripe SDKを初期化
const stripe = require("stripe")("sk_test_YOUR_STRIPE_SECRET_KEY");

// googleapisは初回利用時に遅延読み込みして初期化のタイムアウトを防ぐ
let googleapis;


// --- お問い合わせフォーム機能 ---
exports.sendContactForm = onRequest(async (req, res) => {
    cors(req, res, async () => {
      if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
      }
      try {
        const { name, email, message } = req.body;
        if (!name || !email || !message) {
          return res.status(400).send("Missing required fields.");
        }
        const db = getFirestore();
        const contactRef = db.collection("contacts").doc();
        await contactRef.set({
          name,
          email,
          message,
          createdAt: FieldValue.serverTimestamp(),
          status: '未着手', // 初期ステータスを設定
          isRead: false,
        });
        return res.status(200).send({ message: "Contact form data received and stored." });
      } catch (error) {
        logger.error("Error storing contact form data:", error);
        return res.status(500).send("Internal Server Error");
      }
    });
});

// --- お問い合わせ一覧取得機能 (管理者用) ---
exports.getContacts = onCall({ cors: true }, async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
        throw new HttpsError("permission-denied", "管理者権限が必要です。");
    }
    try {
        const db = getFirestore();
        const snapshot = await db.collection("contacts").orderBy("createdAt", "desc").get();
        const contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return contacts;
    } catch (error) {
        logger.error("お問い合わせ一覧の取得エラー:", error);
        throw new HttpsError("internal", "お問い合わせ一覧の取得に失敗しました。");
    }
});

// --- お問い合わせステータス更新機能 (管理者用) ---
exports.updateContactStatus = onCall({ cors: true }, async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
        throw new HttpsError("permission-denied", "管理者権限が必要です。");
    }
    const { contactId, newStatus } = request.data;
    if (!contactId || !newStatus) {
        throw new HttpsError("invalid-argument", "IDと新しいステータスを指定してください。");
    }

    try {
        const db = getFirestore();
        const contactRef = db.collection("contacts").doc(contactId);
        const doc = await contactRef.get();
        if (!doc.exists) {
            throw new HttpsError("not-found", "該当のお問い合わせが見つかりません。");
        }

        const updateData = { status: newStatus };
        const currentData = doc.data();

        // 最初のステータス変更時に対応開始日を記録
        if (currentData.status === '未着手' && (newStatus === '対応中' || newStatus === '完了')) {
            if (!currentData.startedAt) {
                updateData.startedAt = FieldValue.serverTimestamp();
            }
        }
        // 完了になったら完了日を記録
        if (newStatus === '完了') {
            updateData.completedAt = FieldValue.serverTimestamp();
        }

        await contactRef.update(updateData);
        return { success: true, message: "ステータスを更新しました。" };

    } catch (error) {
        logger.error("お問い合わせステータスの更新エラー:", error);
        throw new HttpsError("internal", "ステータスの更新に失敗しました。");
    }
});


// --- Stripe Checkoutセッションを作成する ---
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
                price: priceId,
                quantity: 1,
            }],
            success_url: successUrl || `${request.headers.origin}/profile.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl || `${request.headers.origin}/profile.html`,
            customer_email: request.auth.token.email,
            client_reference_id: uid,
        });

        return { sessionId: session.id };
    } catch (error) {
        logger.error("Stripe Checkoutセッションの作成に失敗しました:", error);
        throw new HttpsError("internal", "決済セッションの作成に失敗しました。");
    }
});

// --- Stripe Webhookを処理する ---
exports.stripeWebhook = onRequest({ cors: true }, async (req, res) => {
    const sig = req.headers["stripe-signature"];
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

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const uid = session.client_reference_id;
            const subscriptionId = session.subscription;

            await db.collection("users").doc(uid).set({
                plan: "Standard",
                subscription: {
                    id: subscriptionId,
                    status: "active",
                    provider: "stripe",
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
                await userDoc.ref.update({
                    plan: "Free",
                    "subscription.status": "canceled"
                });
                logger.info(`ユーザー(UID: ${userDoc.id})のサブスクリプションがキャンセルされ、プランをFreeに更新しました。`);
            }
            break;
        }
    }
    res.json({ received: true });
});


// --- Google Calendar連携 ---
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

// --- 全ユーザーの取得 ---
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
          plan: profile.plan || 'Free',
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

// --- ユーザー詳細の取得 ---
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


// --- 管理者権限の設定 ---
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

// --- 会員プランの設定 ---
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


// --- ダッシュボード分析データ取得 ---
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
            const projectsSnapshot = await db.collection("users").doc(user.uid).collection("projects").get();
            totalProjects += projectsSnapshot.size;
            projectsSnapshot.forEach(doc => {
                const project = doc.data();
                if (project.createdAt) {
                    const month = project.createdAt.toDate().toISOString().slice(0, 7);
                    projectsByMonth[month] = (projectsByMonth[month] || 0) + 1;
                }
            });

            const timestampsSnapshot = await db.collection("users").doc(user.uid).collection("timestamps").get();
            let userIsActiveInLast30Days = false;
            timestampsSnapshot.forEach(doc => {
                const ts = doc.data();
                if (ts.status === 'completed' && ts.clockInTime && ts.clockOutTime) {
                    totalDurationHours += (ts.clockOutTime.toMillis() - ts.clockInTime.toMillis()) / 3600000;
                }
                if (ts.clockInTime) {
                    const clockInDate = ts.clockInTime.toDate();
                    const month = clockInDate.toISOString().slice(0, 7);
                    if (!activeUsersByMonth[month]) activeUsersByMonth[month] = new Set();
                    activeUsersByMonth[month].add(user.uid);
                    if (clockInDate > lastMonth) userIsActiveInLast30Days = true;
                }
            });
            if(userIsActiveInLast30Days) monthlyActiveUsers.add(user.uid);
        }

        // リードタイム計算
        const contactsSnapshot = await db.collection("contacts").where("status", "==", "完了").get();
        let totalL1ResponseLeadTime = 0;
        let totalCloseLeadTime = 0;
        let completedContactsCount = 0;
        contactsSnapshot.forEach(doc => {
            const contact = doc.data();
            if (contact.createdAt && contact.startedAt && contact.completedAt) {
                totalL1ResponseLeadTime += contact.startedAt.toMillis() - contact.createdAt.toMillis();
                totalCloseLeadTime += contact.completedAt.toMillis() - contact.createdAt.toMillis();
                completedContactsCount++;
            }
        });
        const avgL1ResponseLeadTime = completedContactsCount > 0 ? totalL1ResponseLeadTime / completedContactsCount : null;
        const avgCloseLeadTime = completedContactsCount > 0 ? totalCloseLeadTime / completedContactsCount : null;

        // グラフ用データ整形
        const userRegistrationByMonth = {};
        allUsers.forEach(user => {
            if (user.createdAt) {
                const month = user.createdAt.toDate().toISOString().slice(0, 7);
                userRegistrationByMonth[month] = (userRegistrationByMonth[month] || 0) + 1;
            }
        });

        const labels = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(d.toISOString().slice(0, 7));
        }
        
        let cumulativeUsers = 0;
        const cumulativeUserCounts = {};
        Object.keys(userRegistrationByMonth).sort().forEach(month => {
            cumulativeUsers += userRegistrationByMonth[month];
            cumulativeUserCounts[month] = cumulativeUsers;
        });
        
        for(let i=1; i < labels.length; i++) {
            if (!cumulativeUserCounts[labels[i]]) {
                cumulativeUserCounts[labels[i]] = cumulativeUserCounts[labels[i-1]] || 0;
            }
        }

        const userChartData = labels.map(month => ({
            month,
            total: cumulativeUserCounts[month] || 0,
            active: activeUsersByMonth[month] ? activeUsersByMonth[month].size : 0,
        }));

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
            avgL1ResponseLeadTime,
            avgCloseLeadTime,
            userChartData,
            projectChartData,
        };

    } catch (error) {
        logger.error("ダッシュボード分析データの取得中にエラー:", error);
        throw new HttpsError("internal", "分析データの取得に失敗しました。");
    }
});
