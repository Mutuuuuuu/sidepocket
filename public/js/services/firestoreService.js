import { getFirebaseServices } from './firebaseService.js';
import { 
    doc, getDoc, setDoc, serverTimestamp, collection, addDoc, 
    query, where, orderBy, limit, onSnapshot, writeBatch, 
    getDocs, deleteDoc, Timestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const db = () => getFirebaseServices().db;
const storage = () => getFirebaseServices().storage;

// === User Profile ===
export const createUserProfile = (uid, data) => {
    return setDoc(doc(db(), 'users', uid), { ...data, createdAt: serverTimestamp() }, { merge: true });
};
export const getUserProfile = async (uid) => {
    const userDoc = await getDoc(doc(db(), 'users', uid));
    return userDoc.data();
};
export const updateUserProfile = (uid, data) => {
    return setDoc(doc(db(), 'users', uid), data, { merge: true });
};

/**
 * ユーザーのプロフィール画像をFirebase Storageにアップロードし、ダウンロードURLを返す
 * @param {string} uid ユーザーID
 * @param {File} file アップロードする画像ファイル
 * @returns {Promise<string>} アップロードされた画像のダウンロードURL
 */
export const uploadUserIcon = async (uid, file) => {
    const filePath = `profile-icons/${uid}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage(), filePath);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);
    return downloadURL;
};

export const getUserDetails = async (uid) => {
    const userProfile = await getUserProfile(uid);
    
    const projectsQuery = query(collection(db(), 'users', uid, 'projects'), orderBy('createdAt', 'desc'));
    const projectsSnapshot = await getDocs(projectsQuery);
    const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const timestampsQuery = query(collection(db(), 'users', uid, 'timestamps'), orderBy('clockInTime', 'desc'), limit(10));
    const timestampsSnapshot = await getDocs(timestampsQuery);
    const timestamps = timestampsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    return { profile: userProfile, projects, timestamps };
};

// === Projects ===
export const getProjects = (uid, status, callback) => {
    let q = query(collection(db(), 'users', uid, 'projects'));
    if (status !== 'all') {
        q = query(q, where('isActive', '==', status === 'active'));
    }
    q = query(q, orderBy('createdAt', 'desc'));
    return onSnapshot(q, s => callback(s.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addProject = (uid, data) => {
    return addDoc(collection(db(), 'users', uid, 'projects'), { ...data, createdAt: serverTimestamp() });
};
export const updateProject = (uid, pid, data) => {
    return setDoc(doc(db(), 'users', uid, 'projects', pid), data, { merge: true });
};
export const deleteProject = (uid, pid) => {
    return deleteDoc(doc(db(), 'users', uid, 'projects', pid));
};
export const isProjectInUse = async (uid, code) => {
    const q = query(collection(db(), 'users', uid, 'timestamps'), where('project.code', '==', code), limit(1));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
};
export const updateProjectNameInTimestamps = async (userId, projectCode, newName) => {
    const timestampsRef = collection(db(), 'users', userId, 'timestamps');
    const q = query(timestampsRef, where('project.code', '==', projectCode));
    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;
        const batch = writeBatch(db());
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { "project.name": newName });
        });
        await batch.commit();
    } catch (error) {
        console.error("タイムスタンプのプロジェクト名更新中にエラー:", error);
        throw new Error("稼働履歴のプロジェクト名更新に失敗しました。");
    }
};

// === Timestamps ===
export const getActiveClockIn = (uid, cb) => {
    const q = query(collection(db(), 'users', uid, 'timestamps'), where('status', '==', 'active'), limit(1));
    return onSnapshot(q, s => cb(s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() }));
};
export const getRecentTimestamps = (uid, count, cb) => {
    const q = query(collection(db(), 'users', uid, 'timestamps'), orderBy('clockInTime', 'desc'), limit(count));
    return onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const clockIn = (uid, proj) => {
    return addDoc(collection(db(), 'users', uid, 'timestamps'), { project: proj, clockInTime: serverTimestamp(), clockOutTime: null, status: 'active' });
};
export const clockOut = (uid, docId) => {
    return setDoc(doc(db(), 'users', uid, 'timestamps', docId), { clockOutTime: serverTimestamp(), status: 'completed' }, { merge: true });
};
export const getTimestampsForPeriod = async (uid, start, end) => {
    const q = query(collection(db(), 'users', uid, 'timestamps'), where('status', '==', 'completed'), where('clockInTime', '>=', start), where('clockInTime', '<', end));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => {
        const data = d.data();
        if (!data.clockInTime || !data.clockOutTime) return { id: d.id, ...data, durationHours: 0 };
        const durationHours = (data.clockOutTime.toDate() - data.clockInTime.toDate()) / 36e5;
        return { id: d.id, ...data, durationHours };
    });
};
export const addTimestamp = (uid, data) => {
    const firestoreData = {
        ...data,
        clockInTime: Timestamp.fromDate(data.clockInTime),
        clockOutTime: Timestamp.fromDate(data.clockOutTime),
    };
    return addDoc(collection(db(), 'users', uid, 'timestamps'), firestoreData);
};
export const updateTimestamp = (uid, timestampId, data) => {
    const firestoreData = {
        ...data,
        clockInTime: Timestamp.fromDate(data.clockInTime),
        clockOutTime: Timestamp.fromDate(data.clockOutTime),
    };
    return setDoc(doc(db(), 'users', uid, 'timestamps', timestampId), firestoreData, { merge: true });
};
export const deleteTimestamp = (uid, timestampId) => {
    return deleteDoc(doc(db(), 'users', uid, 'timestamps', timestampId));
};

// ▼▼▼ 【ここから追加】カレンダーの予定をタイムスタンプとして登録する関数 ▼▼▼
export const addCalendarEventsAsTimestamps = async (uid, events) => {
    const batch = writeBatch(db());
    const timestampsCol = collection(db(), 'users', uid, 'timestamps');

    events.forEach(event => {
        const newDocRef = doc(timestampsCol);
        batch.set(newDocRef, {
            project: event.project,
            clockInTime: Timestamp.fromDate(new Date(event.start)),
            clockOutTime: Timestamp.fromDate(new Date(event.end)),
            status: 'completed',
            memo: `[Calendar Event] ${event.summary || ''}`.trim(),
            calendarEventId: event.id
        });
    });

    await batch.commit();
};
// ▲▲▲ ここまで ▲▲▲

// === Notifications ===
export const addNotification = (notificationData) => {
    const notificationsCol = collection(db(), 'notifications');
    return addDoc(notificationsCol, {
        ...notificationData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
};
export const updateNotification = (id, data) => {
    const notificationDoc = doc(db(), 'notifications', id);
    return updateDoc(notificationDoc, {
        ...data,
        updatedAt: serverTimestamp()
    });
};
export const getNotifications = (callback) => {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db(), 'notifications'), 
        where('startDate', '<=', today),
        orderBy('startDate', 'desc'),
        orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, (querySnapshot) => {
        const notifications = querySnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(n => !n.endDate || n.endDate >= today); // endDateが未設定か、今日以降
        callback(notifications);
    }, (error) => {
        console.error("お知らせの取得に失敗しました:", error);
    });
};
export const deleteNotification = (notificationId) => {
    return deleteDoc(doc(db(), 'notifications', notificationId));
};
