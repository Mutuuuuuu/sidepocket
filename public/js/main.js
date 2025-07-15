import { initializeFirebase } from './services/firebaseService.js';
import { attachAuthListener, loadHeader } from './services/authService.js';
import { getUserProfile } from './services/firestoreService.js';

const appContainer = document.getElementById('app-container');
const loadingOverlay = document.getElementById('loading-overlay');

const initializePage = async () => {
    await initializeFirebase();
    const user = await attachAuthListener();
    
    if (user) {
        await loadHeader(user);
        initializeTopBar(user);
    }
    
    loadPageScript(user); // ページ固有のJSを読み込む

    appContainer.classList.remove('opacity-0');
    loadingOverlay.classList.add('hidden');
};

const initializeTopBar = async (user) => {
    const userProfile = await getUserProfile(user.uid);
    const displayName = userProfile?.displayName || user.displayName || 'Guest';
    const photoURL = userProfile?.photoURL || user.photoURL || 'images/sidepocket_symbol.png';

    const headerDisplayName = document.getElementById('header-display-name');
    const headerUserIcon = document.getElementById('header-user-icon');
    if(headerDisplayName) headerDisplayName.textContent = displayName;
    if(headerUserIcon) headerUserIcon.src = photoURL;

    // 現在のページに応じてナビゲーションのスタイルを適用
    const currentPath = window.location.pathname.replace(/\/$/, ''); // 末尾のスラッシュを削除
    document.querySelectorAll('[data-nav-link]').forEach(link => {
        const linkPath = '/' + link.dataset.navLink.replace('.html', '');
        if (currentPath === linkPath || (currentPath === '' && linkPath === '/index')) {
            link.classList.add('bg-gray-700', 'font-bold');
        }
    });

    const menuToggle = document.getElementById('menu-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (menuToggle && appContainer && sidebarOverlay) {
        const toggle = () => {
            const isMobile = window.innerWidth < 768;
            appContainer.classList.toggle(isMobile ? 'sidebar-mobile-open' : 'sidebar-open');
        };
        menuToggle.addEventListener('click', toggle);
        sidebarOverlay.addEventListener('click', () => appContainer.classList.remove('sidebar-mobile-open'));
    }
};

const loadPageScript = (user) => {
    // ▼▼▼ このページの判別方法を修正 ▼▼▼
    const path = window.location.pathname.replace(/^\/|\.html$/g, '') || 'index';

    if (!user && path !== 'login' && path !== 'signup') return;

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
        case 'login':
            import('./auth/login.js').then(m => m.initLoginPage());
            break;
        case 'signup':
            import('./auth/signup.js').then(m => m.initSignupPage());
            break;
    }
};

document.addEventListener('DOMContentLoaded', initializePage);