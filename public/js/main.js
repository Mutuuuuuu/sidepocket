import { initializeFirebase } from './services/firebaseService.js';
import { attachAuthListener, loadHeader } from './services/authService.js';
import { getUserProfile, getNotifications } from './services/firestoreService.js';

const appContainer = document.getElementById('app-container');
const loadingOverlay = document.getElementById('loading-overlay');

/**
 * ページの初期化
 */
const initializePage = async () => {
    await initializeFirebase();
    const user = await attachAuthListener();
    if (user) {
        await loadHeader();
        // DOMの描画が完了してからUI初期化を実行
        setTimeout(async () => {
            await initializeUI(user);
        }, 0);
    }
    loadPageScript(user);
    if (appContainer) appContainer.classList.remove('opacity-0');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
};

/**
 * ログイン後の共通UIを初期化
 * @param {object} user ログインユーザーオブジェクト
 */
const initializeUI = async (user) => {
    const userProfile = await getUserProfile(user.uid);
    const displayName = userProfile?.displayName || user.displayName || 'Guest';
    const photoURL = userProfile?.photoURL || user.photoURL || 'images/sidepocket_symbol.png';

    // ヘッダーのユーザー情報を設定
    const headerDisplayName = document.getElementById('header-display-name');
    const headerUserIcon = document.getElementById('header-user-icon');
    if (headerDisplayName) headerDisplayName.textContent = displayName;
    if (headerUserIcon) headerUserIcon.src = photoURL;

    // --- ▼▼▼ 管理者リンクの表示制御 ▼▼▼ ---
    const idTokenResult = await user.getIdTokenResult();
    if (idTokenResult.claims.isAdmin) {
        const adminLink = document.getElementById('admin-link');
        if (adminLink) adminLink.classList.remove('hidden');
    }
    // --- ▲▲▲ ここまで ▲▲▲ ---

    // --- ▼▼▼ 【追加】会員プランに応じた広告表示 ▼▼▼ ---
    // Freeプランの場合、広告を表示する
    if (userProfile?.plan === 'Free') {
        showAds();
    }
    // --- ▲▲▲ 【ここまで】 ▲▲▲ ---

    // 現在のページに応じてナビゲーションのスタイルを適用
    const currentPath = window.location.pathname;
    document.querySelectorAll('[data-nav-link]').forEach(link => {
        const linkPath = link.getAttribute('href');
        if (linkPath === currentPath || (currentPath === '/' && link.dataset.navLink === 'index.html')) {
            link.classList.add('bg-gray-700', 'font-bold');
        }
    });

    // メニュー開閉ロジックのセットアップ
    setupSidebarMenu();

    // お知らせパネルのセットアップ
    setupNotificationPanel();
};

/**
 * 【追加】広告表示エリアに広告を挿入する
 * この関数はFreeプランのユーザーにのみ呼び出されます。
 * 各ページのHTMLに <div id="ad-container" class="hidden"></div> のような要素を配置してください。
 */
const showAds = () => {
    const adContainer = document.getElementById('ad-container');
    if (adContainer) {
        adContainer.innerHTML = `
            <div class="w-full my-4 p-4 bg-gray-100 border border-gray-300 rounded-lg text-center">
                <p class="text-sm text-gray-600">【広告】Standardプランにアップグレードして、この広告を非表示にしましょう！</p>
                <!-- ここに実際の広告配信タグを挿入します -->
            </div>
        `;
        adContainer.classList.remove('hidden');
    }
};


/**
 * サイドバーメニューの開閉ロジック
 */
const setupSidebarMenu = () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mobileMenuButton = document.getElementById('mobile-menu-button');

    // デスクトップ用：マウスホバー
    sidebar?.addEventListener('mouseenter', () => {
        if (window.innerWidth >= 768) appContainer?.classList.add('sidebar-open');
    });
    sidebar?.addEventListener('mouseleave', () => {
        if (window.innerWidth >= 768) appContainer?.classList.remove('sidebar-open');
    });

    // モバイル用：クリック
    mobileMenuButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar) sidebar.style.transform = 'translateX(0)';
        if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
        appContainer?.classList.add('sidebar-open');
    });

    const closeMobileMenu = () => {
        if (sidebar) sidebar.style.transform = 'translateX(-100%)';
        if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
        appContainer?.classList.remove('sidebar-open');
    };
    sidebarOverlay?.addEventListener('click', closeMobileMenu);
};

/**
 * お知らせパネルのセットアップ
 */
const setupNotificationPanel = () => {
    const notificationButton = document.getElementById('notification-button');
    const notificationPanel = document.getElementById('notification-panel');
    const notificationList = document.getElementById('notification-list');
    let notificationsLoaded = false;
    let allNotifications = [];

    const detailModal = document.getElementById('notification-detail-modal');
    const closeModalButton = document.getElementById('close-notification-modal');
    const modalTitle = document.getElementById('notification-modal-title');
    const modalDate = document.getElementById('notification-modal-date');
    const modalContent = document.getElementById('notification-modal-content');

    const categoryColors = {
        'メンテナンス': 'bg-orange-400 text-white',
        'リリース': 'bg-sky-500 text-white',
        'サポート': 'bg-emerald-500 text-white'
    };

    const renderNotifications = (notifications) => {
        allNotifications = notifications;
        if (!notificationList) return;
        notificationList.innerHTML = notifications.length === 0
            ? `<li class="p-4 text-sm text-gray-500">新しいお知らせはありません。</li>`
            : notifications.map(n => {
                const categoryColor = categoryColors[n.category] || 'bg-gray-400 text-white';
                const date = n.createdAt.toDate().toLocaleDateString('ja-JP');
                return `<li class="p-4 hover:bg-gray-50 cursor-pointer" data-id="${n.id}">
                    <div class="flex items-start gap-3">
                        <div class="flex-1 min-w-0">
                            <p class="text-sm text-gray-800 font-semibold truncate" title="${n.title}">${n.title}</p>
                            <div class="flex items-center gap-2 mt-1.5">
                                <span class="text-xs font-bold px-2 py-0.5 rounded-full ${categoryColor}">${n.category}</span>
                                <p class="text-xs text-gray-500">${date}</p>
                            </div>
                        </div>
                    </div>
                </li>`;
            }).join('');
    };

    notificationButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        notificationPanel.classList.toggle('hidden');
        if (!notificationPanel.classList.contains('hidden') && !notificationsLoaded) {
            getNotifications((notifications) => {
                renderNotifications(notifications);
                notificationsLoaded = true;
            });
        }
    });

    document.addEventListener('click', (e) => {
        if (!notificationPanel?.contains(e.target) && !notificationButton?.contains(e.target)) {
            notificationPanel?.classList.add('hidden');
        }
    });

    notificationList?.addEventListener('click', (e) => {
        const targetLi = e.target.closest('li');
        if (!targetLi || !targetLi.dataset.id) return;
        const notification = allNotifications.find(n => n.id === targetLi.dataset.id);
        if (notification) {
            modalTitle.textContent = notification.title;
            modalDate.textContent = notification.createdAt.toDate().toLocaleDateString('ja-JP');
            // contentをHTMLとして解釈させることでリンクを有効化
            modalContent.innerHTML = notification.content || '詳細な内容はありません。';
            detailModal.classList.remove('hidden');
        }
    });

    const closeModal = () => detailModal?.classList.add('hidden');
    closeModalButton?.addEventListener('click', closeModal);
    detailModal?.addEventListener('click', (e) => {
        if (e.target === detailModal) closeModal();
    });
};

/**
 * 現在のURLに応じてページ固有のスクリプトを読み込む
 * @param {object} user ログインユーザーオブジェクト
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
        case 'admin': 
            import('./admin.js').then(m => m.initAdminPage(user)); 
            break;
    }
};

document.addEventListener('DOMContentLoaded', initializePage);
