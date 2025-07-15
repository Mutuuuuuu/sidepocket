import { getFirebaseServices } from './firebaseService.js';
import { doc, getDoc, setDoc, serverTimestamp, collection, addDoc, query, where, orderBy, limit, onSnapshot, writeBatch, getDocs, deleteDoc, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const db = () => getFirebaseServices().db;

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