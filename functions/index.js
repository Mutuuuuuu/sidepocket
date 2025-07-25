// Firebase Functions v2と関連モジュールをインポート
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions/v2");
const functions = require("firebase-functions"); // v1 for pubsub schedule
const cors = require("cors")({ origin: true });

// Firebase Admin SDKモジュールをインポート
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
// Firestoreのモジュールを正しくインポート
const { getFirestore, FieldValue, Timestamp, query, collection, where, getDocs } = require("firebase-admin/firestore");

// Admin SDKを初期化
initializeApp();

// Stripe SDKを初期化
const stripe = require("stripe")("sk_test_YOUR_STRIPE_SECRET_KEY");

// googleapisは初回利用時に遅延読み込み
let googleapis;

/**
 * ランダムな英数字の招待コードを生成するヘルパー関数
 */
const generateReferralCode = (length = 8) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};


// --- Firestore Triggers ---
// 新規ユーザーがFirestoreに作成された時に招待コードを自動生成する
exports.generateUserReferralCode = onDocumentCreated("users/{userId}", async (event) => {
    const userDocRef = event.data.ref;
    const referralCode = generateReferralCode();
    try {
        await userDocRef.update({
            referralCode: referralCode,
            plan: "Free", // 初期プランをFreeに設定
            referredUsers: [], // 紹介したユーザーリストを初期化
        });
        logger.info(`Generated referral code ${referralCode} for user ${event.params.userId}`);
    } catch (error) {
        logger.error(`Error generating referral code for user ${event.params.userId}:`, error);
    }
});


// --- Callable Functions ---
// ▼▼▼【修正】全ての onCall から { cors: true } を削除 ▼▼▼

// 招待コードを適用し、特典を付与する
exports.applyReferralCode = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "この操作には認証が必要です。");
    }

    const referredByCode = request.data.code;
    if (!referredByCode || typeof referredByCode !== 'string') {
        throw new HttpsError("invalid-argument", "招待コードが正しくありません。");
    }

    const refereeId = request.auth.uid;
    const db = getFirestore();

    const refereeDocRef = db.collection("users").doc(refereeId);
    const refereeDoc = await refereeDocRef.get();
    const refereeData = refereeDoc.data();

    if (!refereeData) {
         throw new HttpsError("not-found", "ユーザー情報が見つかりません。");
    }
    if (refereeData.referredBy) {
        throw new HttpsError("already-exists", "すでに招待コードを使用しています。");
    }
    if (refereeData.plan === 'Standard') {
        throw new HttpsError("failed-precondition", "Standardプランのユーザーは招待コードを使用できません。");
    }

    const usersCollection = collection(db, "users");
    const referrerQuery = query(usersCollection, where("referralCode", "==", referredByCode.toUpperCase()));
    const referrerSnapshot = await getDocs(referrerQuery);

    if (referrerSnapshot.empty) {
        throw new HttpsError("not-found", "この招待コードは存在しません。");
    }

    const referrerDoc = referrerSnapshot.docs[0];
    const referrerId = referrerDoc.id;

    if (referrerId === refereeId) {
        throw new HttpsError("invalid-argument", "自分の招待コードは使用できません。");
    }

    const batch = db.batch();
    const now = new Date();

    // 被紹介者への特典: 1ヶ月無料
    const refereeEndDate = new Date(now);
    refereeEndDate.setMonth(refereeEndDate.getMonth() + 1);
    batch.update(refereeDocRef, {
        referredBy: referrerId,
        plan: "Standard",
        planStartDate: Timestamp.fromDate(now),
        planEndDate: Timestamp.fromDate(refereeEndDate),
    });
    logger.info(`Applied 1-month trial for referee: ${refereeId}`);


    // 紹介者への特典: 2ヶ月延長
    const referrerDocRef = referrerDoc.ref;
    const referrerData = referrerDoc.data();
    const currentEndDate = referrerData.planEndDate ? referrerData.planEndDate.toDate() : new Date();
    const newStartDate = referrerData.planStartDate ? referrerData.planStartDate.toDate() : now;
    const baseDateForExtension = currentEndDate > now ? currentEndDate : now;
    
    const newEndDate = new Date(baseDateForExtension);
    newEndDate.setMonth(newEndDate.getMonth() + 2);

    batch.update(referrerDocRef, {
        referredUsers: FieldValue.arrayUnion(refereeId),
        plan: "Standard",
        planStartDate: Timestamp.fromDate(newStartDate),
        planEndDate: Timestamp.fromDate(newEndDate),
    });
    logger.info(`Extended plan for 2 months for referrer: ${referrerId}`);

    try {
        await batch.commit();
        return { success: true, message: "招待コードを適用しました！Standardプランが有効になりました。" };
    } catch (error) {
        logger.error("Error applying referral code:", error);
        throw new HttpsError("internal", "招待コードの適用中にエラーが発生しました。");
    }
});


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
          status: '未着手',
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
exports.getContacts = onCall(async (request) => {
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
exports.updateContactStatus = onCall(async (request) => {
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
        if (currentData.status === '未着手' && (newStatus === '対応中' || newStatus === '完了')) {
            if (!currentData.startedAt) {
                updateData.startedAt = FieldValue.serverTimestamp();
            }
        }
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
exports.createCheckoutSession = onCall(async (request) => {
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
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const planStartDate = new Date(subscription.current_period_start * 1000);
            const planEndDate = new Date(subscription.current_period_end * 1000);
            await db.collection("users").doc(uid).set({
                plan: "Standard",
                planStartDate: Timestamp.fromDate(planStartDate),
                planEndDate: Timestamp.fromDate(planEndDate),
                subscription: { id: subscriptionId, status: "active", provider: "stripe" }
            }, { merge: true });
            logger.info(`ユーザー(UID: ${uid})のプランをStandardに更新しました。`);
            break;
        }
        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const usersCollection = collection(db, "users");
            const userQuery = query(usersCollection, where("subscription.id", "==", subscription.id));
            const userSnapshot = await getDocs(userQuery);
            if (!userSnapshot.empty) {
                const userDoc = userSnapshot.docs[0];
                await userDoc.ref.update({
                    plan: "Free",
                    planStartDate: null,
                    planEndDate: null,
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
exports.getCalendarList = onCall(async (request) => {
  if (!googleapis) {
    googleapis = require("googleapis");
  }
  const { google } = googleapis;
  const { tokens } = request.data;
  if (!tokens) {
    logger.error("No authentication tokens provided for getCalendarList.");
    throw new HttpsError("unauthenticated", "認証トークンがありません。");
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    const response = await calendar.calendarList.list();
    const calendars = response.data.items.map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary || false,
    }));
    return { calendars };
  } catch (error) {
    logger.error("Error fetching calendar list:", error.message);
    throw new HttpsError("internal", "カレンダーリストの取得に失敗しました。");
  }
});

exports.getCalendarEvents = onCall(async (request) => {
  if (!googleapis) googleapis = require("googleapis");
  const { google } = googleapis;

  const { tokens, startDate, endDate, calendarId } = request.data;
  if (!tokens) {
    logger.error("getCalendarEvents call missing 'tokens'");
    throw new HttpsError("unauthenticated", "認証トークンがありません。");
  }
  if (!calendarId) {
    logger.error("getCalendarEvents call missing 'calendarId'");
    throw new HttpsError("invalid-argument", "カレンダーIDが指定されていません。");
  }

  const { client_id, client_secret } = functions.config().googleapis;
  if (!client_id || !client_secret) {
      logger.error("Google API client_id or client_secret not configured in Firebase Functions.");
      throw new HttpsError("failed-precondition", "サーバー設定に不備があります。");
  }
  const oauth2Client = new google.auth.OAuth2(client_id, client_secret);
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    logger.info(`Fetching events for calendarId: ${calendarId}`);
    const response = await calendar.events.list({
      calendarId: calendarId, // 受け取ったIDを使用
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: "startTime",
    });
    return { events: response.data.items.map(e => ({ id: e.id, summary: e.summary, start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date })) };
  } catch (error) {
    logger.error("Google Calendar API Error in getCalendarEvents:", {
        message: error.message,
        code: error.code,
        errors: error.errors,
    });
    throw new HttpsError("internal", `カレンダー「${calendarId}」の予定取得に失敗しました。アクセス権限を確認してください。`);
  }
});

// --- 全ユーザーの取得 ---
exports.getAllUsers = onCall(async (request) => {
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
exports.getUserDetails = onCall(async (request) => {
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
exports.setUserAdminRole = onCall(async (request) => {
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
exports.setUserPlan = onCall(async (request) => {
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
exports.getDashboardAnalytics = onCall(async (request) => {
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
        const userRegistrationByMonth = {};
        allUsers.forEach(user => {
            const userCreationTime = getAuth().getUser(user.uid).then(u => u.metadata.creationTime);
            if(userCreationTime) {
              const month = new Date(userCreationTime).toISOString().slice(0, 7);
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


// --- スケジュールされた関数 ---
// 毎日午前1時に実行し、プランの有効期限をチェックする
exports.updateUserPlans = functions.region('asia-northeast1').pubsub.schedule("every day 01:00")
    .timeZone("Asia/Tokyo")
    .onRun(async (context) => {
        const db = getFirestore();
        const now = Timestamp.now();
        const usersCollection = collection(db, "users");
        
        // Stripe管理下のユーザーは除外
        const q = query(
            usersCollection,
            where("plan", "==", "Standard"),
            where("planEndDate", "<=", now)
        );
        const snapshot = await getDocs(q);
        
        const expiredNonStripeUsers = snapshot.docs.filter(doc => doc.data().subscription?.provider !== 'stripe');

        if (expiredNonStripeUsers.length === 0) {
            logger.info("No expired Standard plan users (non-Stripe) found.");
            return null;
        }

        const batch = db.batch();
        expiredNonStripeUsers.forEach(doc => {
            logger.info(`Downgrading plan for user: ${doc.id} due to expiration.`);
            batch.update(doc.ref, {
                plan: "Free",
                planStartDate: null,
                planEndDate: null
            });
        });

        try {
            await batch.commit();
            logger.info(`Successfully downgraded ${expiredNonStripeUsers.length} users.`);
        } catch (error) {
            logger.error("Error during plan downgrading cron job:", error);
        }
        return null;
    });