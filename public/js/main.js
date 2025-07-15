import { initializeFirebase } from './services/firebaseService.js';
import { attachAuthListener, loadHeader } from './services/authService.js';
import { getUserProfile } from './services/firestoreService.js';

const appContainer = document.getElementById('app-container');
const loadingOverlay = document.getElementById('loading-overlay');

/**
 * ページの初期化
 */
const initializePage = async () => {
    // 1. firebaseServiceを使ってFirebaseを初期化
    await initializeFirebase();

    // 2. 認証状態を監視し、ユーザー情報を取得
    const user = await attachAuthListener();

    // 3. ユーザーがログインしている場合、ヘッダーを読み込む
    if (user) {
        await loadHeader();
        await initializeTopBar(user);
    }

    // 4. ページ固有のスクリプトを読み込む
    loadPageScript(user);

    // 5. ローディング画面を非表示にし、アプリ本体を表示
    // ▼▼▼ 修正箇所 ▼▼▼
    // 各要素が存在するかどうかをチェックしてからクラスを操作する
    if (appContainer) {
        appContainer.classList.remove('opacity-0');
    }
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
};

/**
 * ヘッダーとサイドバーのUIを初期化
 * @param {object} user - Firebase Authのユーザーオブジェクト
 */
const initializeTopBar = async (user) => {
    // Firestoreから詳細なプロフィール情報を取得
    const userProfile = await getUserProfile(user.uid);

    // 表示名とアイコン画像を決定 (Firestore優先)
    const displayName = userProfile?.displayName || user.displayName || 'Guest';
    const photoURL = userProfile?.photoURL || user.photoURL || 'images/sidepocket_symbol.png';

    // ヘッダーのUI要素を更新
    const headerDisplayName = document.getElementById('header-display-name');
    const headerUserIcon = document.getElementById('header-user-icon');
    if (headerDisplayName) headerDisplayName.textContent = displayName;
    if (headerUserIcon) headerUserIcon.src = photoURL;

    // 現在のページに応じてナビゲーションのスタイルを適用
    const currentPath = window.location.pathname.replace(/^\/|\.html$/g, '') || 'index';
    document.querySelectorAll('[data-nav-link]').forEach(link => {
        const linkPath = link.dataset.navLink.replace('.html', '');
        if (currentPath === linkPath || (currentPath === '' && linkPath === 'index')) {
            link.classList.add('bg-gray-700', 'font-bold');
        }
    });

    // サイドバーの開閉イベント
    const menuToggle = document.getElementById('menu-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (menuToggle && appContainer && sidebarOverlay) {
        const toggleSidebar = () => {
            const isMobile = window.innerWidth < 768;
            // モバイルの場合は別のクラスを付与して制御
            if (isMobile) {
                document.getElementById('sidebar').classList.toggle('-translate-x-full');
                sidebarOverlay.classList.toggle('hidden');
            } else {
                appContainer.classList.toggle('sidebar-open');
            }
        };
        menuToggle.addEventListener('click', toggleSidebar);
        sidebarOverlay.addEventListener('click', toggleSidebar);
    }
};

/**
 * ページ固有のスクリプトを読み込む
 * @param {object|null} user - Firebase Authのユーザーオブジェクト
 */
const loadPageScript = (user) => {
    const path = window.location.pathname.replace(/^\/|\.html$/g, '') || 'index';

    switch (path) {
        case 'index':
            import('./home.js').then(m => m.initHomePage(user));
            break;
        case 'projects':
            import('./projects.js').then(m => m.initProjectsPage(user));
            break;
        case 'summary':
            import('./summary.js').then(m => m.initSummaryPage(user));
            break;
        case 'profile':
            import('./profile.js').then(m => m.initProfilePage(user));
            break;
        case 'calendar':
            import('./calendar.js').then(m => m.initCalendarPage(user));
            break;
        case 'login':
            import('./auth/login.js').then(m => m.initLoginPage());
            break;
        case 'signup':
            import('./auth/signup.js').then(m => m.initSignupPage());
            break;
    }
};

// DOMの読み込みが完了したらページの初期化処理を開始
document.addEventListener('DOMContentLoaded', initializePage);