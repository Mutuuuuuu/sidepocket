// Firebase Functions v2と関連モジュールをインポート
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const functions = require("firebase-functions"); // v1 for pubsub schedule
const cors = require("cors")({ origin: true });

// Firebase Admin SDKモジュールをインポート
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp, runTransaction } = require("firebase-admin/firestore");

// Admin SDKを初期化
initializeApp();

// 使用するSecretを定義
const GOOGLE_CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");
/*const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");*/

// googleapisは初回利用時に遅延読み込み
let googleapis;

/**
 * ランダムな英数字の招待コードを生成するヘルパー関数
 * @param {number} length - 生成するコードの長さ
 * @returns {string} 生成されたコード
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

/**
 * 新規ユーザーがAuthに作成された後、Firestoreドキュメントが作成されるのをトリガーに実行
 * ユーザーの初期プラン設定と、ユニークな招待コードの発行を行う
 */
exports.onUserCreate = onDocumentCreated("users/{userId}", async (event) => {
    const userDocRef = event.data.ref;
    const userId = event.params.userId;
    const db = getFirestore();
    const batch = db.batch();

    // 1. ユーザー情報に初期値を設定
    const invitationCode = generateReferralCode();
    batch.update(userDocRef, {
        plan: "Free",
        planStartDate: null,
        planEndDate: null,
        invitationCode: invitationCode,
        autoRenew: false,
        usedInvitationCode: false,
        stripeCustomerId: null,
    });
    logger.info(`Initialized user profile for ${userId}`);

    // 2. 招待コードをcodesコレクションに登録
    const codeDocRef = db.collection("codes").doc(invitationCode);
    batch.set(codeDocRef, {
        code: invitationCode,
        type: "invitation",
        ownerUid: userId,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null,
        maxUses: null,
        useCount: 0,
        benefit: {
            type: "PLAN_EXTENSION",
            durationDays: 30, // 被招待者の特典日数
        },
    });
    logger.info(`Generated invitation code ${invitationCode} for user ${userId}`);

    try {
        await batch.commit();
    } catch (error) {
        logger.error(`Error during user initialization for ${userId}:`, error);
    }
});


// --- Callable Functions ---

/**
 * 招待コード/クーポンコードを適用する
 */
exports.applyCode = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "この操作には認証が必要です。");
    }

    const code = request.data.code?.toUpperCase();
    if (!code || typeof code !== "string") {
        throw new HttpsError("invalid-argument", "コードを正しく入力してください。");
    }

    const refereeId = request.auth.uid;
    const db = getFirestore();

    try {
        const resultMessage = await runTransaction(db, async (transaction) => {
            const codeDocRef = db.collection("codes").doc(code);
            const refereeDocRef = db.collection("users").doc(refereeId);
            const historyRef = db.collection("users").doc(refereeId).collection("codeUsageHistory");

            const [codeDoc, refereeDoc] = await Promise.all([
                transaction.get(codeDocRef),
                transaction.get(refereeDocRef),
            ]);

            // --- バリデーション ---
            if (!codeDoc.exists) throw new HttpsError("not-found", "このコードは存在しません。");
            const codeData = codeDoc.data();
            if (!codeData.isActive) throw new HttpsError("failed-precondition", "このコードは現在無効です。");
            if (codeData.expiresAt && codeData.expiresAt.toDate() < new Date()) throw new HttpsError("failed-precondition", "このコードの有効期限は切れています。");
            if (codeData.maxUses && codeData.useCount >= codeData.maxUses) throw new HttpsError("resource-exhausted", "このコードの利用上限に達しました。");

            const refereeData = refereeDoc.data();
            if (!refereeData) throw new HttpsError("not-found", "ユーザー情報が見つかりません。");

            // --- 履歴チェック ---
            const usageQuery = await historyRef.where("code", "==", code).get();
            if (!usageQuery.empty) {
                 throw new HttpsError("already-exists", "このコードは既に使用済みです。");
            }

            if (codeData.type === "invitation") {
                if (codeData.ownerUid === refereeId) throw new HttpsError("invalid-argument", "自分の招待コードは使用できません。");
                if (refereeData.usedInvitationCode) throw new HttpsError("already-exists", "招待コードは一度しか使用できません。");
            }

            // --- 特典適用処理 ---
            const now = new Date();
            const benefitDescription = `Standardプラン ${codeData.benefit.durationDays}日間`;

            // 1. コード適用者（referee）のプランを更新
            const refereeCurrentEndDate = refereeData.planEndDate ? refereeData.planEndDate.toDate() : now;
            const refereeBaseDate = refereeCurrentEndDate > now ? refereeCurrentEndDate : now;
            const refereeNewEndDate = new Date(refereeBaseDate);
            refereeNewEndDate.setDate(refereeNewEndDate.getDate() + codeData.benefit.durationDays);

            const refereeUpdateData = {
                plan: "Standard",
                planStartDate: refereeData.planStartDate || Timestamp.fromDate(now),
                planEndDate: Timestamp.fromDate(refereeNewEndDate),
            };
            if (codeData.type === "invitation") {
                refereeUpdateData.usedInvitationCode = true;
            }
            transaction.update(refereeDocRef, refereeUpdateData);

            // 2. コード提供者（referrer）のプランを更新 (招待コードの場合のみ)
            if (codeData.type === "invitation") {
                const referrerDocRef = db.collection("users").doc(codeData.ownerUid);
                const referrerDoc = await transaction.get(referrerDocRef);
                const referrerData = referrerDoc.data();

                const referrerCurrentEndDate = referrerData.planEndDate ? referrerData.planEndDate.toDate() : now;
                const referrerBaseDate = referrerCurrentEndDate > now ? referrerCurrentEndDate : now;
                const referrerNewEndDate = new Date(referrerBaseDate);
                referrerNewEndDate.setDate(referrerNewEndDate.getDate() + 60); // 招待者は60日間延長

                transaction.update(referrerDocRef, {
                    plan: "Standard",
                    planStartDate: referrerData.planStartDate || Timestamp.fromDate(now),
                    planEndDate: Timestamp.fromDate(referrerNewEndDate),
                });
                
                 // 招待者の履歴にも記録
                const referrerHistoryRef = db.collection("users").doc(codeData.ownerUid).collection("codeUsageHistory").doc();
                transaction.set(referrerHistoryRef, {
                    code, type: "invitation", action: "provided", usedAt: FieldValue.serverTimestamp(),
                    appliedToUid: refereeId, providerUid: null, benefitDescription: "Standardプラン 60日間"
                });
            }

            // 3. codesコレクションを更新
            transaction.update(codeDocRef, { useCount: FieldValue.increment(1) });

            // 4. 適用者の履歴を記録
            const refereeHistoryRef = historyRef.doc();
            transaction.set(refereeHistoryRef, {
                code, type: codeData.type, action: "applied", usedAt: FieldValue.serverTimestamp(),
                appliedToUid: null, providerUid: codeData.ownerUid || null, benefitDescription
            });

            return { success: true, message: `${benefitDescription}が適用されました！` };
        });
        return resultMessage;
    } catch (error) {
        logger.error("Error applying code:", { code, userId: refereeId, error });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "コードの適用中にエラーが発生しました。");
    }
});

/**
 * クーポンコードを作成する (管理者用)
 */
exports.createCouponCode = onCall(async (request) => {
    if (!request.auth || !request.auth.token.isAdmin) {
        throw new HttpsError("permission-denied", "管理者権限が必要です。");
    }

    const { code, durationDays, expiresAt, maxUses } = request.data;
    if (!code || !durationDays) {
        throw new HttpsError("invalid-argument", "コードと特典日数は必須です。");
    }

    const db = getFirestore();
    const codeDocRef = db.collection("codes").doc(code.toUpperCase());

    const doc = await codeDocRef.get();
    if (doc.exists) {
        throw new HttpsError("already-exists", "このクーポンコードは既に使用されています。");
    }

    try {
        await codeDocRef.set({
            code: code.toUpperCase(),
            type: "coupon",
            ownerUid: null,
            isActive: true,
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
            maxUses: maxUses || null,
            useCount: 0,
            benefit: {
                type: "PLAN_EXTENSION",
                durationDays: Number(durationDays),
            },
        });
        return { success: true, message: `クーポン「${code.toUpperCase()}」を作成しました。` };
    } catch (error) {
        logger.error("Error creating coupon code:", error);
        throw new HttpsError("internal", "クーポン作成中にエラーが発生しました。");
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
/*
exports.createCheckoutSession = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "この操作には認証が必要です。");
    }

    // ▼▼▼ 関数内でStripeを初期化 ▼▼▼
    const stripe = require("stripe")(STRIPE_SECRET_KEY.value());
    
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
exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (req, res) => {
    // ▼▼▼ 関数内でStripeを初期化 ▼▼▼
    const stripe = require("stripe")(STRIPE_SECRET_KEY.value());

    const sig = req.headers["stripe-signature"];
    const endpointSecret = STRIPE_WEBHOOK_SECRET.value();
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
            const usersCollection = db.collection("users");
            const userQuery = usersCollection.where("subscription.id", "==", subscription.id);
            const userSnapshot = await userQuery.get();
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
*/

// --- Google Calendar連携 ---
exports.getCalendarList = onCall({ secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET] }, async (request) => {
  if (!googleapis) {
    googleapis = require("googleapis");
  }
  const { google } = googleapis;
  const { tokens } = request.data;
  if (!tokens) {
    logger.error("No authentication tokens provided for getCalendarList.");
    throw new HttpsError("unauthenticated", "認証トークンがありません。");
  }

  const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID.value(),
      GOOGLE_CLIENT_SECRET.value()
  );
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

exports.getCalendarEvents = onCall({ secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET] }, async (request) => {
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

  const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID.value(),
      GOOGLE_CLIENT_SECRET.value()
  );
  oauth2Client.setCredentials(tokens);

  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  try {
    logger.info(`Fetching events for calendarId: ${calendarId}`);
    const response = await calendar.events.list({
      calendarId: calendarId,
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
/**
 * 毎日午前3時に実行し、プランの有効期限をチェックする
 */
exports.scheduledPlanCheck = functions.region('asia-northeast1').pubsub.schedule("every day 03:00")
    .timeZone("Asia/Tokyo")
    .onRun(async (context) => {
        const db = getFirestore();
        const now = Timestamp.now();
        const usersRef = db.collection("users");

        const q = usersRef.where("plan", "==", "Standard").where("planEndDate", "<=", now);
        const snapshot = await q.get();

        if (snapshot.empty) {
            logger.info("No expired Standard plan users found.");
            return null;
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            const userData = doc.data();
            // 将来の自動決済ロジックをここに追加
            if (userData.autoRenew && userData.stripeCustomerId) {
                // Stripe決済処理を呼び出す (今回は未実装)
                logger.info(`Skipping downgrade for user with autoRenew: ${doc.id}`);
            } else {
                logger.info(`Downgrading plan for user: ${doc.id} due to expiration.`);
                batch.update(doc.ref, {
                    plan: "Free",
                    planStartDate: null,
                    planEndDate: null,
                });
            }
        });

        try {
            await batch.commit();
            logger.info(`Successfully processed ${snapshot.size} users.`);
        } catch (error) {
            logger.error("Error during plan downgrading cron job:", error);
        }
        return null;
    });