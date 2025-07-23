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
            .filter(n => !n.endDate || n.endDate >= today);
        callback(notifications);
    }, (error) => {
        console.error("お知らせの取得に失敗しました:", error);
    });
};
export const deleteNotification = (notificationId) => {
    return deleteDoc(doc(db(), 'notifications', notificationId));
};

// === Clients & Contacts ===
export const addClient = (uid, data) => {
    return addDoc(collection(db(), `users/${uid}/clients`), { ...data, createdAt: serverTimestamp() });
};
export const updateClient = (uid, clientId, data) => {
    return updateDoc(doc(db(), `users/${uid}/clients`, clientId), data);
};
export const deleteClient = (uid, clientId) => {
    return deleteDoc(doc(db(), `users/${uid}/clients`, clientId));
};
export const addContact = (uid, clientId, data) => {
    return addDoc(collection(db(), `users/${uid}/contacts`), { ...data, clientId, createdAt: serverTimestamp() });
};
export const updateContact = (uid, contactId, data) => {
    return updateDoc(doc(db(), `users/${uid}/contacts`, contactId), data);
};
export const deleteContact = (uid, contactId) => {
    return deleteDoc(doc(db(), `users/${uid}/contacts`, contactId));
};
export const getClientsAndContacts = (uid, callback) => {
    const clientsQuery = query(collection(db(), `users/${uid}/clients`), orderBy('name'));
    const contactsQuery = query(collection(db(), `users/${uid}/contacts`), orderBy('name'));

    return onSnapshot(clientsQuery, clientSnapshot => {
        onSnapshot(contactsQuery, contactSnapshot => {
            const contacts = contactSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const clients = clientSnapshot.docs.map(doc => {
                const clientData = { id: doc.id, ...doc.data() };
                clientData.contacts = contacts.filter(c => c.clientId === clientData.id);
                return clientData;
            });
            callback(clients);
        });
    });
};

/**
 * 有効な取引先リストを取得する（プロジェクト管理画面のドロップダウン用）
 * @param {string} uid ユーザーID
 * @returns {Promise<Array>} 有効な取引先の配列を返すPromise
 */
export const getActiveClients = async (uid) => {
    const clientsRef = collection(db(), `users/${uid}/clients`);
    // Firestoreのクエリでは、isActiveフィールドがtrueのものを対象とします。
    const q = query(clientsRef, where("isActive", "==", true), orderBy("name"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};


// ★★★★★ ここからが追記されたCSVインポート用の関数です ★★★★★
// === Batch Operations for CSV Import ===
export const batchCreateClientsAndContacts = async (uid, newClients, newContacts) => {
    const batch = writeBatch(db());
    const clientsRef = collection(db(), `users/${uid}/clients`);
    const contactsRef = collection(db(), `users/${uid}/contacts`);

    const clientNameToIdMap = {};
    const existingClientsSnapshot = await getDocs(query(clientsRef));
    existingClientsSnapshot.forEach(doc => {
        clientNameToIdMap[doc.data().name] = doc.id;
    });

    newClients.forEach(clientData => {
        const newClientRef = doc(clientsRef);
        batch.set(newClientRef, { ...clientData, createdAt: serverTimestamp() });
        clientNameToIdMap[clientData.name] = newClientRef.id;
    });

    newContacts.forEach(contactData => {
        const clientId = clientNameToIdMap[contactData.clientName];
        if (clientId) {
            const newContactRef = doc(contactsRef);
            const dataToSave = { ...contactData, clientId, createdAt: serverTimestamp() };
            delete dataToSave.clientName;
            batch.set(newContactRef, dataToSave);
        }
    });

    return batch.commit();
};