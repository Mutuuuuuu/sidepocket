// Firebase SDK モジュールをインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut, 
    GoogleAuthProvider, 
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// ユーザーから提供されたFirebase設定情報
const firebaseConfig = {
    apiKey: "AIzaSyB1vvfYPaBUuq594vFMYS5g3d-GY2zLq8Y",
    authDomain: "side-pocket-sls.firebaseapp.com",
    projectId: "side-pocket-sls",
    storageBucket: "side-pocket-sls.appspot.com",
    messagingSenderId: "858098732942",
    appId: "1:858098732942:web:82b7b90bf8277459e91edf",
    measurementId: "G-6834DPZ4ZH"
};


// Firebaseの初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

// 設計書に基づき、appIdをグローバルスコープで利用可能にする
const appId = typeof __app_id !== 'undefined' ? __app_id : 'side-pocket-sls';

// --- グローバル関数と変数のエクスポート ---
// 各ページのスクリプトからインポートして使えるように、windowオブジェクトにアタッチします。
window.firebase = {
    app,
    auth,
    db,
    storage,
    provider,
    onAuthStateChanged,
    signOut,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile,
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
    ref,
    uploadBytes,
    getDownloadURL
};
window.appId = appId;


// --- 共通UI操作関数 ---

/**
 * ローディングオーバーレイの表示/非表示を切り替える
 * @param {boolean} show 表示する場合はtrue、非表示はfalse
 */
window.toggleLoading = (show) => {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
        loadingElement.style.display = show ? 'flex' : 'none';
    }
};

/**
 * 画面上部にステータスメッセージを表示する
 * @param {string} targetElementId メッセージを表示する要素のID
 * @param {string} message 表示するメッセージ
 * @param {boolean} isError エラーメッセージの場合はtrue (背景が赤になる)
 * @param {number} duration 表示時間 (ミリ秒)
 */
window.showStatus = (targetElementId, message, isError = false, duration = 3000) => {
    const statusElement = document.getElementById(targetElementId);
    if (!statusElement) return;

    statusElement.textContent = message;
    statusElement.classList.remove('hidden', 'bg-green-500', 'bg-red-500', 'text-white', 'p-2', 'rounded-md', 'text-center');
    statusElement.classList.add(isError ? 'bg-red-100' : 'bg-green-100', isError ? 'text-red-700' : 'text-green-700', 'p-4', 'rounded-lg');
    
    setTimeout(() => {
        statusElement.classList.add('hidden');
    }, duration);
};

/**
 * 共通ヘッダーを読み込んで表示する
 * @param {object} user ログインしているユーザーオブジェクト
 */
const loadHeader = async (user) => {
    const headerPlaceholder = document.getElementById('header-placeholder');
    if (!headerPlaceholder) return;

    try {
        const response = await fetch('header.html');
        if (!response.ok) throw new Error('header.htmlの読み込みに失敗しました。');
        
        const headerHTML = await response.text();
        headerPlaceholder.innerHTML = headerHTML;
        
        // ヘッダー内のUI要素をユーザー情報で更新
        updateHeaderUI(user);
        // ヘッダー内のイベントリスナーを設定
        setupHeaderEventListeners();

    } catch (error) {
        console.error("ヘッダーの読み込みエラー:", error);
        headerPlaceholder.innerHTML = '<p class="text-red-500">ヘッダーの表示に失敗しました。</p>';
    }
};

/**
 * ヘッダーのUIをユーザー情報で更新する
 * @param {object} user ログインしているユーザーオブジェクト
 */
const updateHeaderUI = (user) => {
    if (!user) return;

    const userIcon = document.getElementById('header-user-icon');
    const displayName = document.getElementById('header-display-name');

    if (userIcon) {
        // デフォルト画像を sidepocket_symbol.png に変更
        userIcon.src = user.photoURL || 'images/sidepocket_symbol.png';
        userIcon.onerror = () => { userIcon.src = 'images/sidepocket_symbol.png'; };
    }
    if (displayName) {
        displayName.textContent = user.displayName || 'Guest';
    }
};

/**
 * ヘッダー内のボタンやメニューにイベントリスナーを設定する
 */
const setupHeaderEventListeners = () => {
    // ログアウトボタン（デスクトップとモバイル）
    const logoutButtonDesktop = document.getElementById('logout-button-desktop');
    const logoutButtonMobile = document.getElementById('logout-button-mobile');
    
    const handleLogout = () => {
        toggleLoading(true);
        signOut(auth).then(() => {
            console.log('ログアウトしました。');
            window.location.href = '/login.html';
        }).catch((error) => {
            console.error('ログアウトエラー', error);
            // ログインページに汎用ステータス表示エリアがないため、アラートで代替
            alert(`ログアウトに失敗しました: ${error.message}`);
        }).finally(() => {
            toggleLoading(false);
        });
    };

    if (logoutButtonDesktop) logoutButtonDesktop.addEventListener('click', handleLogout);
    if (logoutButtonMobile) logoutButtonMobile.addEventListener('click', handleLogout);

    // モバイルメニューのトグル
    const menuToggle = document.getElementById('menu-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (menuToggle && sidebar && overlay) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('-translate-x-full');
            overlay.classList.toggle('hidden');
        });
        overlay.addEventListener('click', () => {
            sidebar.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        });
    }
};


// --- ページ初期化処理 ---

/**
 * 全てのページのロード時に実行される初期化関数
 * 認証状態をチェックし、必要に応じてリダイレクトやUIの更新を行う
 */
window.initializePage = (pageConfig = {}) => {
    toggleLoading(true);

    onAuthStateChanged(auth, async (user) => {
        const isAuthPage = pageConfig.isAuthPage || false; // ログイン/新規登録ページか

        if (user) {
            // ユーザーがログインしている場合
            if (isAuthPage) {
                // ログイン/新規登録ページにいる場合は、ホームへリダイレクト
                window.location.replace('/index.html');
                return;
            }
            
            // ユーザー情報をFirestoreから取得（なければ作成）
            const userRef = doc(db, `artifacts/${appId}/users`, user.uid);
            const userDoc = await getDoc(userRef);

            if (!userDoc.exists()) {
                // Firestoreにユーザー情報がない場合、新規作成
                try {
                    await setDoc(userRef, {
                        uid: user.uid,
                        email: user.email,
                        displayName: user.displayName,
                        photoURL: user.photoURL,
                        createdAt: serverTimestamp()
                    }, { merge: true });
                } catch (error) {
                    console.error("Firestoreへのユーザー作成エラー:", error);
                }
            }
            
            // 共通ヘッダーを読み込み
            if (document.getElementById('header-placeholder')) {
                await loadHeader(user);
            }

            // ページ固有の初期化関数を実行
            if (typeof pageConfig.onAuthenticated === 'function') {
                pageConfig.onAuthenticated(user);
            }

        } else {
            // ユーザーがログインしていない場合
            if (!isAuthPage) {
                // 保護されたページにいる場合は、ログインページへリダイレクト
                window.location.replace('/login.html');
                return;
            }
             // ページ固有の初期化関数を実行
            if (typeof pageConfig.onUnauthenticated === 'function') {
                pageConfig.onUnauthenticated();
            }
        }
        
        // 全ての処理が終わったらローディングを解除
        toggleLoading(false);
    });
};
