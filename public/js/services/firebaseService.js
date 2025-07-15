import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

let firebaseApp, auth, db, storage;

export const initializeFirebase = async () => {
    if (firebaseApp) return;
    try {
        const response = await fetch('/__/firebase/init.json');
        const firebaseConfig = await response.json();
        firebaseApp = initializeApp(firebaseConfig);
        auth = getAuth(firebaseApp);
        db = getFirestore(firebaseApp);
        storage = getStorage(firebaseApp);
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        document.body.innerHTML = '<h1>アプリケーションの初期化に失敗しました</h1>';
    }
};

export const getFirebaseServices = () => {
    if (!firebaseApp) throw new Error("Firebase has not been initialized.");
    return { auth, db, storage };
};