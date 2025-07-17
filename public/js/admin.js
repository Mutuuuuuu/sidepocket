import { addNotification, updateNotification, getNotifications, deleteNotification } from './services/firestoreService.js';
import { showStatus, showConfirmModal, toggleLoading } from './services/uiService.js';
import { getFirebaseServices } from './services/firebaseService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFirebaseServices().functions;

const getAllUsers = httpsCallable(functions, 'getAllUsers');
const setUserAdminRole = httpsCallable(functions, 'setUserAdminRole');
const getDashboardStats = httpsCallable(functions, 'getDashboardStats');

let allUsers = [];

export const initAdminPage = async (user) => {
    if (!user) {
        window.location.href = '/';
        return;
    }

    console.log("管理者ページの初期化を開始。ユーザーUID:", user.uid);
    toggleLoading(true);

    try {
        // IDトークンを強制的にサーバーから再取得します
        const idTokenResult = await user.getIdTokenResult(true);

        // ★★★【重要】デバッグコード★★★
        // 取得したトークンに含まれる全ての権限情報をコンソールに出力します。
        // ここに `isAdmin: true` が含まれているかどうかが、問題解決の鍵となります。
        console.log("取得した認証トークンの権限情報(claims):", idTokenResult.claims);
        // ★★★ここまで★★★

        if (!idTokenResult.claims.isAdmin) {
            toggleLoading(false);
            alert('管理者権限が確認できませんでした。権限が付与されているアカウントで再度ログインしてください。');
            window.location.href = '/';
            return;
        }

        // 権限チェックが成功した場合のみ、ページのセットアップを続行
        setupTabs();
        await setupDashboard();
        setupNotifications();
        await setupUsers();

    } catch (error) {
        console.error("管理者ページの初期化に失敗しました:", error);
        alert("管理者ページの初期化に失敗しました。詳細はコンソールを確認してください。");
        window.location.href = '/';
    } finally {
        toggleLoading(false);
    }
};

const setupTabs = () => {
    const tabs = document.querySelectorAll('#admin-tabs .tab-button');
    const panes = document.querySelectorAll('#tab-content .tab-pane');

    const switchTab = (tabName) => {
        tabs.forEach(tab => {
            const isSelected = tab.dataset.tab === tabName;
            tab.classList.toggle('tab-active', isSelected);
            tab.classList.toggle('text-gray-500', !isSelected);
            tab.classList.toggle('border-transparent', !isSelected);
        });
        panes.forEach(pane => {
            pane.classList.toggle('active', pane.id === `${tabName}-content`);
        });
    };
    
    switchTab('dashboard'); 

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
};

const setupDashboard = async () => {
    try {
        const result = await getDashboardStats();
        const stats = result.data;
        document.getElementById('stats-total-users').textContent = stats.totalUsers;
        document.getElementById('stats-total-projects').textContent = stats.totalProjects;
        document.getElementById('stats-total-hours').textContent = `${stats.totalDurationHours} 時間`;
    } catch (error) {
        console.error("ダッシュボード統計の取得エラー:", error);
        showStatus("統計データの読み込みに失敗しました。", true);
    }
};

const setupNotifications = () => {
    const form = document.getElementById('notification-form');
    const listBody = document.getElementById('notifications-list-body');
    const formTitle = document.getElementById('form-title');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    let allNotifications = [];

    const resetForm = () => {
        form.reset();
        form.id.value = '';
        formTitle.textContent = '新規投稿';
        cancelBtn.classList.add('hidden');
    };
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { title: form.title.value.trim(), category: form.category.value, content: form.content.value.trim() };
        const id = form.id.value;

        if (!data.title || !data.category || !data.content) {
            showStatus('すべての項目を入力してください。', true);
            return;
        }

        toggleLoading(true);
        try {
            if (id) {
                await updateNotification(id, data);
                showStatus('お知らせを更新しました。');
            } else {
                await addNotification(data);
                showStatus('お知らせを投稿しました。');
            }
            resetForm();
        } catch (error) {
            console.error("保存エラー:", error);
            showStatus(`エラーが発生しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    });

    cancelBtn.addEventListener('click', resetForm);
    
    listBody.addEventListener('click', async (e) => {
        const target = e.target;
        const id = target.dataset.id;
        if (!id) return;
        
        if (target.classList.contains('edit-btn')) {
            const notification = allNotifications.find(n => n.id === id);
            if (notification) {
                form.id.value = notification.id;
                form.title.value = notification.title;
                form.category.value = notification.category;
                form.content.value = notification.content;
                formTitle.textContent = 'お知らせを編集';
                cancelBtn.classList.remove('hidden');
                form.scrollIntoView({ behavior: 'smooth' });
            }
        }
        if (target.classList.contains('delete-btn')) {
            const confirmed = await showConfirmModal('削除の確認', `お知らせ「${target.dataset.title}」を本当に削除しますか？`);
            if (confirmed) {
                toggleLoading(true);
                try {
                    await deleteNotification(id);
                    showStatus('お知らせを削除しました。');
                } catch (error) {
                    console.error('削除エラー:', error);
                    showStatus(`削除中にエラーが発生しました: ${error.message}`, true);
                } finally {
                    toggleLoading(false);
                }
            }
        }
    });
    
    getNotifications((notifications) => {
        allNotifications = notifications;
        const listBody = document.getElementById('notifications-list-body');
        listBody.innerHTML = '';
        if (notifications.length === 0) {
            listBody.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-gray-500">投稿済みのお知らせはありません。</td></tr>';
            return;
        }
        notifications.forEach(n => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            const createdAt = n.createdAt ? n.createdAt.toDate().toLocaleString('ja-JP') : '日時不明';
            tr.innerHTML = `
                <td class="px-6 py-4">${createdAt}</td>
                <td class="px-6 py-4"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">${n.category}</span></td>
                <td class="px-6 py-4 font-medium text-gray-900">${n.title}</td>
                <td class="px-6 py-4 text-right space-x-4">
                    <button class="edit-btn font-medium text-indigo-600 hover:underline" data-id="${n.id}">編集</button>
                    <button class="delete-btn font-medium text-red-600 hover:underline" data-id="${n.id}" data-title="${n.title}">削除</button>
                </td>
            `;
            listBody.appendChild(tr);
        });
    });
};

const setupUsers = async () => {
    const listBody = document.getElementById('users-list-body');
    const searchInput = document.getElementById('user-search-input');

    const renderUsers = (users) => {
        listBody.innerHTML = '';
        if (users.length === 0) {
            listBody.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-gray-500">ユーザーが見つかりません。</td></tr>';
            return;
        }
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            const joinedAt = u.createdAt ? new Date(u.createdAt).toLocaleString('ja-JP') : '不明';
            tr.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${u.displayName}</td>
                <td class="px-6 py-4">${u.email}</td>
                <td class="px-6 py-4">${joinedAt}</td>
                <td class="px-6 py-4 text-center">
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer admin-toggle" data-uid="${u.uid}" ${u.isAdmin ? 'checked' : ''}>
                        <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-300 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </td>
            `;
            listBody.appendChild(tr);
        });
    };
    
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredUsers = allUsers.filter(u => u.email && u.email.toLowerCase().includes(searchTerm));
        renderUsers(filteredUsers);
    });

    listBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('admin-toggle')) {
            const checkbox = e.target;
            const uid = checkbox.dataset.uid;
            const isAdmin = checkbox.checked;
            
            const confirmed = await showConfirmModal('権限の変更', `ユーザー(${uid})の管理者権限を${isAdmin ? '付与' : '剥奪'}しますか？`);
            if (confirmed) {
                toggleLoading(true);
                try {
                    await setUserAdminRole({ uid, isAdmin });
                    showStatus('ユーザー権限を更新しました。');
                    const user = allUsers.find(u => u.uid === uid);
                    if (user) user.isAdmin = isAdmin;
                } catch (error) {
                    console.error('権限更新エラー:', error);
                    showStatus(`エラーが発生しました: ${error.message}`, true);
                    checkbox.checked = !isAdmin;
                } finally {
                    toggleLoading(false);
                }
            } else {
                checkbox.checked = !isAdmin;
            }
        }
    });

    try {
        const result = await getAllUsers();
        allUsers = result.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        renderUsers(allUsers);
    } catch (error) {
        console.error("ユーザーリスト取得エラー:", error);
        showStatus("ユーザーリストの読み込みに失敗しました。", true);
        listBody.innerHTML = `<tr><td colspan="4" class="text-center p-8 text-red-500">エラー: ${error.message}</td></tr>`;
    }
};