import { initializeFirebase } from './services/firebaseService.js';
import { attachAuthListener, loadHeader } from './services/authService.js';
import { getUserProfile, getNotifications } from './services/firestoreService.js';

const appContainer = document.getElementById('app-container');
const loadingOverlay = document.getElementById('loading-overlay');

/** ページの初期化 */
const initializePage = async () => {
    await initializeFirebase();
    const user = await attachAuthListener();
    if (user) {
        await loadHeader();
        await initializeTopBar(user);
    }
    loadPageScript(user);
    if (appContainer) appContainer.classList.remove('opacity-0');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
};

/** ヘッダーとサイドバー、通知機能のUIを初期化 */
const initializeTopBar = async (user) => {
    const userProfile = await getUserProfile(user.uid);
    const displayName = userProfile?.displayName || user.displayName || 'Guest';
    const photoURL = userProfile?.photoURL || user.photoURL || 'images/sidepocket_symbol.png';
    const headerDisplayName = document.getElementById('header-display-name');
    const headerUserIcon = document.getElementById('header-user-icon');
    if (headerDisplayName) headerDisplayName.textContent = displayName;
    if (headerUserIcon) headerUserIcon.src = photoURL;

    const currentPath = window.location.pathname;
    document.querySelectorAll('[data-nav-link]').forEach(link => {
        const linkPath = link.getAttribute('href');
        if (linkPath === currentPath || (currentPath === '/' && link.dataset.navLink === 'index.html')) {
            link.classList.add('bg-gray-700', 'font-bold');
        }
    });

    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const menuToggle = document.getElementById('menu-toggle');
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const openMobileSidebar = () => { if (sidebar && sidebarOverlay && appContainer) { sidebar.classList.remove('-translate-x-full'); sidebarOverlay.classList.remove('hidden'); appContainer.classList.add('sidebar-open'); } };
    const closeMobileSidebar = () => { if (sidebar && sidebarOverlay && appContainer) { appContainer.classList.remove('sidebar-open'); sidebar.classList.add('-translate-x-full'); sidebarOverlay.classList.add('hidden'); } };
    const toggleDesktopSidebar = () => { if (appContainer) appContainer.classList.toggle('sidebar-open'); };
    mobileMenuButton?.addEventListener('click', openMobileSidebar);
    sidebarOverlay?.addEventListener('click', closeMobileSidebar);
    menuToggle?.addEventListener('click', toggleDesktopSidebar);

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
        notificationList.innerHTML = '';
        if (notifications.length === 0) {
            notificationList.innerHTML = `<li class="p-4 text-sm text-gray-500">新しいお知らせはありません。</li>`;
            return;
        }
        notifications.forEach(n => {
            const li = document.createElement('li');
            li.className = 'p-4 hover:bg-gray-50 cursor-pointer';
            li.dataset.id = n.id;
            const categoryColor = categoryColors[n.category] || 'bg-gray-400 text-white';
            const date = n.createdAt.toDate().toLocaleDateString('ja-JP');
            li.innerHTML = `<div class="flex items-start gap-3 pointer-events-none"><div class="flex-1"><p class="text-sm text-gray-800 font-semibold">${n.title}</p><div class="flex items-center gap-2 mt-1"><span class="text-xs font-bold px-2 py-0.5 rounded-full ${categoryColor}">${n.category}</span><p class="text-xs text-gray-500">${date}</p></div></div></div>`;
            notificationList.appendChild(li);
        });
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
        const notificationId = targetLi.dataset.id;
        const notificationData = allNotifications.find(n => n.id === notificationId);
        if (notificationData) {
            modalTitle.textContent = notificationData.title;
            modalDate.textContent = notificationData.createdAt.toDate().toLocaleDateString('ja-JP');
            modalContent.textContent = notificationData.content || '詳細な内容はありません。';
            detailModal.classList.remove('hidden');
        }
    });

    const closeModal = () => detailModal.classList.add('hidden');
    closeModalButton?.addEventListener('click', closeModal);
    detailModal?.addEventListener('click', (e) => { if (e.target === detailModal) closeModal(); });
};

/** ページ固有のスクリプトを読み込む */
const loadPageScript = (user) => {
    const path = window.location.pathname.replace(/^\/|\.html$/g, '') || 'index';
    switch (path) {
        case 'index': import('./home.js').then(m => m.initHomePage(user)); break;
        case 'projects': import('./projects.js').then(m => m.initProjectsPage(user)); break;
        case 'summary': import('./summary.js').then(m => m.initSummaryPage(user)); break;
        case 'profile': import('./profile.js').then(m => m.initProfilePage(user)); break;
        case 'calendar': import('./calendar.js').then(m => m.initCalendarPage(user)); break;
        case 'login': import('./auth/login.js').then(m => m.initLoginPage()); break;
        case 'signup': import('./auth/signup.js').then(m => m.initSignupPage()); break;
        case 'admin': import('./admin.js').then(m => m.initAdminPage(user)); break;
    }
};

document.addEventListener('DOMContentLoaded', initializePage);