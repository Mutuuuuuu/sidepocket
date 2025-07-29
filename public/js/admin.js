import { addNotification, updateNotification, getNotifications, deleteNotification } from './services/firestoreService.js';
import { showStatus, showConfirmModal, toggleLoading } from './services/uiService.js';
import { getFirebaseServices } from './services/firebaseService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFirebaseServices().functions;

// Cloud Functions
const getAllUsers = httpsCallable(functions, 'getAllUsers');
const setUserAdminRole = httpsCallable(functions, 'setUserAdminRole');
const getUserDetails = httpsCallable(functions, 'getUserDetails');
const getDashboardAnalytics = httpsCallable(functions, 'getDashboardAnalytics');
const setUserPlan = httpsCallable(functions, 'setUserPlan');
const getContacts = httpsCallable(functions, 'getContacts');
const updateContactStatus = httpsCallable(functions, 'updateContactStatus');
const getCoupons = httpsCallable(functions, 'getCoupons');
const updateCoupon = httpsCallable(functions, 'updateCoupon');
const deleteCoupon = httpsCallable(functions, 'deleteCoupon');
const createCouponCode = httpsCallable(functions, 'createCouponCode');

let allUsers = [];
let userChart = null;
let projectChart = null;

const toDate = (timestamp) => {
    if (!timestamp) return null;
    let date;
    if (timestamp._seconds !== undefined) {
        date = new Date(timestamp._seconds * 1000 + (timestamp._nanoseconds || 0) / 1000000);
    } else if (typeof timestamp === 'string') {
        date = new Date(timestamp);
    } else if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
    } else {
        return null;
    }
    if (isNaN(date.getTime())) return null;
    return date;
};

const toDisplayableDate = (timestamp, format = 'toLocaleString') => {
    const date = toDate(timestamp);
    if (!date) return '日時不明';

    if (format === 'toLocaleString') return date.toLocaleString('ja-JP');
    if (format === 'toString') return date.toString(); // 計算用にDateオブジェクトを返す
    return date.toLocaleTimeString('ja-JP');
};

const formatLeadTime = (milliseconds) => {
    if (milliseconds === null || isNaN(milliseconds) || milliseconds < 0) return '---';
    const seconds = milliseconds / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    if (days >= 1) return `${days.toFixed(1)}日`;
    if (hours >= 1) return `${hours.toFixed(1)}時間`;
    if (minutes >= 1) return `${minutes.toFixed(1)}分`;
    return `${seconds.toFixed(0)}秒`;
};

export const initAdminPage = async (user) => {
    if (!user) {
        window.location.href = '/';
        return;
    }
    toggleLoading(true);
    try {
        const idTokenResult = await user.getIdTokenResult(true);
        if (!idTokenResult.claims.isAdmin) {
            toggleLoading(false);
            alert('管理者権限が確認できませんでした。権限が付与されているアカウントで再度ログインしてください。');
            window.location.href = '/';
            return;
        }
        setupTabs();
        await setupDashboard();
        await setupContacts();
        setupNotifications();
        await setupUsers();
        setupCoupons();
        setupUserDetailModal();
    } catch (error) {
        console.error("管理者ページの初期化に失敗しました:", error);
        alert("管理者ページの初期化に失敗しました。詳細はコンソールを確認してください。");
    } finally {
        toggleLoading(false);
    }
};

const setupTabs = () => {
    const tabs = document.querySelectorAll('#admin-tabs .tab-button');
    const panes = document.querySelectorAll('#tab-content .tab-pane');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-content`).classList.add('active');
        });
    });
};

const setupDashboard = async () => {
    toggleLoading(true);
    try {
        const result = await getDashboardAnalytics();
        const data = result.data;

        document.getElementById('stats-total-users').textContent = data.totalUsers;
        document.getElementById('stats-total-projects').textContent = data.totalProjects;
        document.getElementById('stats-total-hours').textContent = `${data.totalDurationHours} 時間`;
        document.getElementById('stats-active-rate').textContent = `${data.activeRate}%`;
        document.getElementById('stats-avg-l1-lead-time').textContent = data.avgL1ResponseLeadTime ? formatLeadTime(data.avgL1ResponseLeadTime) : 'データなし';
        document.getElementById('stats-avg-close-lead-time').textContent = data.avgCloseLeadTime ? formatLeadTime(data.avgCloseLeadTime) : 'データなし';
        
        if(userChart) userChart.destroy();
        if(projectChart) projectChart.destroy();

        const userCtx = document.getElementById('user-trends-chart').getContext('2d');
        userChart = new Chart(userCtx, {
            type: 'bar',
            data: {
                labels: data.userChartData.map(d => d.month),
                datasets: [{
                    label: '総ユーザー数',
                    data: data.userChartData.map(d => d.total),
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    order: 2,
                }, {
                    label: 'アクティブユーザー数 (MAU)',
                    data: data.userChartData.map(d => d.active),
                    type: 'line',
                    borderColor: 'rgba(236, 72, 153, 1)',
                    backgroundColor: 'rgba(236, 72, 153, 0.2)',
                    yAxisID: 'y1',
                    order: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: false },
                    y: { beginAtZero: true, title: { display: true, text: '総ユーザー数' } },
                    y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: 'アクティブユーザー数' } }
                }
            }
        });

        const projectCtx = document.getElementById('project-trends-chart').getContext('2d');
        projectChart = new Chart(projectCtx, {
            type: 'line',
            data: {
                labels: data.projectChartData.map(d => d.month),
                datasets: [{
                    label: '月間プロジェクト作成数',
                    data: data.projectChartData.map(d => d.count),
                    borderColor: 'rgba(16, 185, 129, 1)',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

    } catch (error) {
        console.error("ダッシュボードデータの取得エラー:", error);
        showStatus("ダッシュボードデータの読み込みに失敗しました。", true);
    } finally {
        toggleLoading(false);
    }
};

const setupNotifications = () => {
    const form = document.getElementById('notification-form');
    if (!form) return;

    const listBody = document.getElementById('notifications-list-body');
    const formTitle = document.getElementById('form-title');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    let allNotifications = [];
    const defaultContent = '<a href="URLを記載してください" target="_blank" style="color:#0000ff" >表示されるテキストを記載してください</a>';

    const resetForm = () => {
        form.reset();
        form.id.value = '';
        formTitle.textContent = '新規投稿';
        cancelBtn.classList.add('hidden');
        form.content.value = defaultContent;
    };

    resetForm();
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = { 
            title: form.title.value.trim(), 
            category: form.category.value, 
            content: form.content.value.trim(),
            startDate: form.startDate.value,
            endDate: form.endDate.value || null
        };
        const id = form.id.value;
        if (!data.title || !data.category || !data.content || !data.startDate) {
            showStatus('タイトル、カテゴリー、詳細、表示開始日は必須です。', true);
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
            showStatus(`エラーが発生しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    });

    cancelBtn.addEventListener('click', resetForm);
    
    listBody.addEventListener('click', async (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        const id = target.dataset.id;
        if (!id) return;
        
        if (target.classList.contains('edit-btn')) {
            const notification = allNotifications.find(n => n.id === id);
            if (notification) {
                form.id.value = notification.id;
                form.title.value = notification.title;
                form.category.value = notification.category;
                form.content.value = notification.content;
                form.startDate.value = notification.startDate;
                form.endDate.value = notification.endDate || '';
                formTitle.textContent = 'お知らせを編集';
                cancelBtn.classList.remove('hidden');
                form.scrollIntoView({ behavior: 'smooth' });
            }
        }
        if (target.classList.contains('delete-btn')) {
            const confirmed = await showConfirmModal(
                '削除の確認', 
                `お知らせ「${target.dataset.title}」を本当に削除しますか？`,
                { confirmText: '削除', confirmColor: 'red', iconType: 'warning' }
            );
            if (confirmed) {
                toggleLoading(true);
                try {
                    await deleteNotification(id);
                    showStatus('お知らせを削除しました。');
                } catch (error) {
                    showStatus(`削除中にエラーが発生しました: ${error.message}`, true);
                } finally {
                    toggleLoading(false);
                }
            }
        }
    });
    
    getNotifications((notifications) => {
        allNotifications = notifications;
        if (!listBody) return;
        listBody.innerHTML = '';
        if (notifications.length === 0) {
            listBody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-gray-500">投稿済みのお知らせはありません。</td></tr>';
            return;
        }
        notifications.forEach(n => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            const createdAt = toDisplayableDate(n.createdAt);
            const period = `${n.startDate} ~ ${n.endDate || '無期限'}`;
            tr.innerHTML = `
                <td class="px-6 py-4">${createdAt}</td>
                <td class="px-6 py-4"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">${n.category}</span></td>
                <td class="px-6 py-4 font-medium text-gray-900">${n.title}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${period}</td>
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
    if (!listBody) return;
    const searchInput = document.getElementById('user-search-input');

    const renderUsers = (users) => {
        listBody.innerHTML = '';
        if (users.length === 0) {
            listBody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-gray-500">ユーザーが見つかりません。</td></tr>';
            return;
        }
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            const joinedAt = toDisplayableDate(u.createdAt);
            tr.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900"><a href="#" class="user-detail-link text-indigo-600 hover:underline" data-uid="${u.uid}">${u.displayName}</a></td>
                <td class="px-6 py-4">${u.email}</td>
                <td class="px-6 py-4">${joinedAt}</td>
                <td class="px-6 py-4">
                    <select class="plan-selector bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5" data-uid="${u.uid}">
                        <option value="Free" ${u.plan === 'Free' ? 'selected' : ''}>Free</option>
                        <option value="Standard" ${u.plan === 'Standard' ? 'selected' : ''}>Standard</option>
                    </select>
                </td>
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
        const filteredUsers = allUsers.filter(u => 
            (u.email && u.email.toLowerCase().includes(searchTerm)) || 
            (u.displayName && u.displayName.toLowerCase().includes(searchTerm))
        );
        renderUsers(filteredUsers);
    });

    listBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('admin-toggle')) {
            const checkbox = e.target;
            const uid = checkbox.dataset.uid;
            const isAdmin = checkbox.checked;
            const confirmed = await showConfirmModal(
                '権限の変更', 
                `ユーザー(${uid})の管理者権限を${isAdmin ? '付与' : '剥奪'}しますか？`,
                { confirmText: 'はい、変更する', cancelText: 'いいえ', confirmColor: 'indigo', iconType: 'question' }
            );
            if (confirmed) {
                toggleLoading(true);
                try {
                    await setUserAdminRole({ uid, isAdmin });
                    showStatus('ユーザー権限を更新しました。');
                    const user = allUsers.find(u => u.uid === uid);
                    if (user) user.isAdmin = isAdmin;
                } catch (error) {
                    showStatus(`エラーが発生しました: ${error.message}`, true);
                    checkbox.checked = !isAdmin;
                } finally {
                    toggleLoading(false);
                }
            } else {
                checkbox.checked = !isAdmin;
            }
        }

        if (e.target.classList.contains('plan-selector')) {
            const selector = e.target;
            const uid = selector.dataset.uid;
            const plan = selector.value;
            const user = allUsers.find(u => u.uid === uid);
            const originalPlan = user?.plan;

            const confirmed = await showConfirmModal(
                'プランの変更', 
                `ユーザー(${uid})のプランを「${plan}」に変更しますか？`,
                { confirmText: 'はい、変更する', cancelText: 'いいえ', confirmColor: 'indigo', iconType: 'question' }
            );
            if (confirmed) {
                toggleLoading(true);
                try {
                    await setUserPlan({ uid, plan });
                    showStatus('ユーザープランを更新しました。');
                    if (user) user.plan = plan;
                } catch (error) {
                    showStatus(`エラーが発生しました: ${error.message}`, true);
                    selector.value = originalPlan;
                } finally {
                    toggleLoading(false);
                }
            } else {
                selector.value = originalPlan;
            }
        }
    });

    listBody.addEventListener('click', async (e) => {
        e.preventDefault();
        const link = e.target.closest('.user-detail-link');
        if(link) {
            const uid = link.dataset.uid;
            openUserDetailModal(uid);
        }
    });

    try {
        const result = await getAllUsers();
        allUsers = result.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        renderUsers(allUsers);
    } catch (error) {
        showStatus("ユーザーリストの読み込みに失敗しました。", true);
        listBody.innerHTML = `<tr><td colspan="5" class="text-center p-8 text-red-500">エラー: ${error.message}</td></tr>`;
    }
};

const setupUserDetailModal = () => {
    const modal = document.getElementById('user-detail-modal');
    const closeButton = document.getElementById('close-user-detail-modal');
    if (modal && closeButton) {
        closeButton.addEventListener('click', () => modal.classList.add('hidden'));
    }
};

const openUserDetailModal = async (uid) => {
    const modal = document.getElementById('user-detail-modal');
    const title = document.getElementById('user-detail-modal-title');
    const content = document.getElementById('user-detail-modal-content');
    
    title.textContent = "ユーザー詳細";
    content.innerHTML = '<p>読み込み中...</p>';
    modal.classList.remove('hidden');
    
    toggleLoading(true);
    try {
        const result = await getUserDetails({ uid });
        const userDetails = result.data;
        
        title.textContent = `${userDetails.profile.displayName || '名前未設定'}さんの詳細`;
        
        let projectsHtml = '<h3>登録プロジェクト</h3><ul class="list-disc pl-5 mt-2">';
        if (userDetails.projects && userDetails.projects.length > 0) {
            userDetails.projects.forEach(p => {
                projectsHtml += `<li>${p.name} (${p.code}) - ${p.isActive ? '有効' : '無効'}</li>`;
            });
        } else {
            projectsHtml += '<li>登録プロジェクトはありません。</li>';
        }
        projectsHtml += '</ul>';

        let timestampsHtml = '<h3 class="mt-4">最近の稼働履歴 (10件)</h3><ul class="list-disc pl-5 mt-2">';
        if (userDetails.timestamps && userDetails.timestamps.length > 0) {
            userDetails.timestamps.forEach(t => {
                const clockInStr = toDisplayableDate(t.clockInTime, 'toLocaleString');
                const clockOutStr = t.clockOutTime ? toDisplayableDate(t.clockOutTime, 'toLocaleTimeString') : '記録なし';
                timestampsHtml += `<li>${clockInStr} ~ ${clockOutStr} - ${t.project.name}</li>`;
            });
        } else {
            timestampsHtml += '<li>稼働履歴はありません。</li>';
        }
        timestampsHtml += '</ul>';
        
        const registeredDateStr = toDisplayableDate(userDetails.profile.createdAt);
        const plan = userDetails.profile.plan || 'Free';
        const planBadgeColor = plan === 'Standard' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';

        content.innerHTML = `
            <div class="space-y-4">
                <p><strong>UID:</strong> ${uid}</p>
                <p><strong>Email:</strong> ${userDetails.profile.email}</p>
                <p><strong>登録日:</strong> ${registeredDateStr}</p>
                <p><strong>プラン:</strong> <span class="font-semibold px-2 py-1 rounded-full ${planBadgeColor}">${plan}</span></p>
                <hr>
                ${projectsHtml}
                <hr>
                ${timestampsHtml}
            </div>
        `;

    } catch(error) {
        console.error("ユーザー詳細の取得エラー:", error);
        content.innerHTML = `<p class="text-red-500">ユーザー詳細の取得に失敗しました: ${error.message}</p>`;
    } finally {
        toggleLoading(false);
    }
};

const setupContacts = async () => {
    const listBody = document.getElementById('contacts-list-body');
    const statusFilter = document.getElementById('contact-status-filter');
    if (!listBody || !statusFilter) return;

    let allContacts = []; 

    const renderContacts = (contacts) => {
        listBody.innerHTML = '';
        if (contacts.length === 0) {
            listBody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-gray-500">お問い合わせはありません。</td></tr>';
            return;
        }

        contacts.forEach(c => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';
            
            const createdAtDate = toDate(c.createdAt);
            const startedAtDate = toDate(c.startedAt);
            const completedAtDate = toDate(c.completedAt);

            const createdAtStr = createdAtDate ? createdAtDate.toLocaleString('ja-JP') : '日時不明';
            
            const l1LeadTime = (startedAtDate && createdAtDate) ? formatLeadTime(startedAtDate.getTime() - createdAtDate.getTime()) : '---';
            const closeLeadTime = (completedAtDate && createdAtDate) ? formatLeadTime(completedAtDate.getTime() - createdAtDate.getTime()) : '---';

            tr.innerHTML = `
                <td class="px-4 py-4 whitespace-nowrap">${createdAtStr}</td>
                <td class="px-4 py-4">
                    <select class="contact-status-selector bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2" data-id="${c.id}">
                        <option value="未着手" ${c.status === '未着手' ? 'selected' : ''}>未着手</option>
                        <option value="対応中" ${c.status === '対応中' ? 'selected' : ''}>対応中</option>
                        <option value="完了" ${c.status === '完了' ? 'selected' : ''}>完了</option>
                    </select>
                </td>
                <td class="px-4 py-4 font-medium text-gray-900">${c.name}</td>
                <td class="px-4 py-4">${c.email}</td>
                <td class="px-4 py-4 text-sm text-gray-600 max-w-xs truncate" title="${c.message}">${c.message}</td>
                <td class="px-4 py-4 whitespace-nowrap">${l1LeadTime}</td>
                <td class="px-4 py-4 whitespace-nowrap">${closeLeadTime}</td>
            `;
            listBody.appendChild(tr);
        });
    };
    
    const filterAndRender = () => {
        const filterValue = statusFilter.value;
        
        const filteredContacts = filterValue === 'all'
            ? allContacts
            : allContacts.filter(c => c.status === filterValue);
        
        const statusOrder = { '未着手': 1, '対応中': 2, '完了': 3 };
        
        const sortedContacts = filteredContacts.sort((a, b) => {
            const statusA = statusOrder[a.status] || 99;
            const statusB = statusOrder[b.status] || 99;
            if (statusA !== statusB) {
                return statusA - statusB;
            }
            const dateA = toDate(a.createdAt)?.getTime() || 0;
            const dateB = toDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
        });

        renderContacts(sortedContacts);
    };

    statusFilter.addEventListener('change', filterAndRender);

    listBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('contact-status-selector')) {
            const selector = e.target;
            const id = selector.dataset.id;
            const newStatus = selector.value;
            
            toggleLoading(true);
            try {
                await updateContactStatus({ contactId: id, newStatus });
                showStatus('ステータスを更新しました。');
                
                const result = await getContacts();
                allContacts = result.data;
                filterAndRender();

            } catch (error) {
                showStatus(`エラーが発生しました: ${error.message}`, true);
            } finally {
                toggleLoading(false);
            }
        }
    });

    try {
        const result = await getContacts();
        allContacts = result.data;
        filterAndRender();
    } catch (error) {
        showStatus("お問い合わせの読み込みに失敗しました。", true);
        listBody.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-red-500">エラー: ${error.message}</td></tr>`;
    }
};

const setupCoupons = () => {
    const form = document.getElementById('coupon-form');
    const listBody = document.getElementById('coupons-list-body');
    if (!form || !listBody) return;

    let allCoupons = [];
    let isEditMode = false;
    let editCouponId = null;

    const formTitle = document.getElementById('coupon-form-title');
    const submitButton = form.querySelector('button[type="submit"]');
    const codeInput = document.getElementById('coupon-code');

    // フォームをリセットする関数
    const resetForm = () => {
        form.reset();
        isEditMode = false;
        editCouponId = null;
        formTitle.textContent = 'クーポン新規発行';
        submitButton.textContent = 'クーポンを発行';
        codeInput.disabled = false;
        
        // キャンセルボタンがあれば隠す
        const cancelBtn = document.getElementById('cancel-coupon-edit-btn');
        if (cancelBtn) cancelBtn.remove();
    };

    // クーポンリストを描画する関数
    const renderCoupons = (coupons) => {
        listBody.innerHTML = '';
        if (coupons.length === 0) {
            listBody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-gray-500">発行済みのクーポンはありません。</td></tr>';
            return;
        }

        coupons.forEach(c => {
            const tr = document.createElement('tr');
            tr.className = 'bg-white border-b hover:bg-gray-50';

            const expiresAt = c.expiresAt ? toDate(c.expiresAt).toLocaleDateString('ja-JP') : '無期限';
            const useCount = c.useCount || 0;
            const maxUses = c.maxUses || '∞';
            const status = c.isActive ? 
                '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">有効</span>' :
                '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">無効</span>';

            tr.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${c.id}</td>
                <td class="px-6 py-4">${c.benefit.durationDays}日</td>
                <td class="px-6 py-4">${useCount} / ${maxUses} 回</td>
                <td class="px-6 py-4">${expiresAt}</td>
                <td class="px-6 py-4">${status}</td>
                <td class="px-6 py-4 text-right space-x-4">
                    <button class="edit-coupon-btn font-medium text-indigo-600 hover:underline" data-id="${c.id}">編集</button>
                    <button class="delete-coupon-btn font-medium text-red-600 hover:underline" data-id="${c.id}">削除</button>
                </td>
            `;
            listBody.appendChild(tr);
        });
    };
    
    // クーポンを読み込んで描画するメインの関数
    const loadAndRenderCoupons = async () => {
        toggleLoading(true);
        try {
            const result = await getCoupons();
            allCoupons = result.data;
            renderCoupons(allCoupons);
        } catch (error) {
            showStatus(`クーポンリストの読み込みに失敗しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    };

    // フォームの送信イベント
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);

        const data = {
            durationDays: parseInt(form.duration.value, 10),
            expiresAt: form.expires.value || null,
            maxUses: parseInt(form.maxUses.value, 10) || null,
        };

        try {
            if (isEditMode) {
                data.id = editCouponId;
                // 編集モードでは有効/無効の切り替えも可能にする（もしフォームに追加する場合）
                // data.isActive = document.getElementById('coupon-is-active').checked;
                data.isActive = true; // ここでは単純に有効のまま更新
                const result = await updateCoupon(data);
                showStatus(result.data.message, false);
            } else {
                data.code = form.code.value.trim();
                if (!data.code || !data.durationDays) {
                    showStatus('クーポンコードと特典日数は必須です。', true);
                    toggleLoading(false);
                    return;
                }
                const result = await createCouponCode(data);
                showStatus(result.data.message, false);
            }
            resetForm();
            await loadAndRenderCoupons(); // リストを再読み込み
        } catch (error) {
            showStatus(`エラー: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    });

    // リスト内のボタン（編集・削除）のクリックイベント
    listBody.addEventListener('click', async (e) => {
        const target = e.target;
        const id = target.dataset.id;
        if (!id) return;

        // 編集ボタンが押された場合
        if (target.classList.contains('edit-coupon-btn')) {
            const coupon = allCoupons.find(c => c.id === id);
            if (coupon) {
                isEditMode = true;
                editCouponId = coupon.id;
                
                formTitle.textContent = `クーポン「${coupon.id}」を編集`;
                submitButton.textContent = '更新する';

                codeInput.value = coupon.id;
                codeInput.disabled = true;
                
                form.duration.value = coupon.benefit.durationDays;
                form.expires.value = coupon.expiresAt ? toDate(coupon.expiresAt).toISOString().split('T')[0] : '';
                form.maxUses.value = coupon.maxUses || 0;
                
                // キャンセルボタンを追加
                if (!document.getElementById('cancel-coupon-edit-btn')) {
                    const cancelBtn = document.createElement('button');
                    cancelBtn.type = 'button';
                    cancelBtn.id = 'cancel-coupon-edit-btn';
                    cancelBtn.textContent = 'キャンセル';
                    cancelBtn.className = 'bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg ml-4';
                    cancelBtn.onclick = resetForm;
                    submitButton.after(cancelBtn);
                }
                
                form.scrollIntoView({ behavior: 'smooth' });
            }
        }

        // 削除ボタンが押された場合
        if (target.classList.contains('delete-coupon-btn')) {
            const confirmed = await showConfirmModal(
                '削除の確認', 
                `クーポン「${id}」を本当に削除しますか？この操作は取り消せません。`,
                { confirmText: '削除', confirmColor: 'red', iconType: 'warning' }
            );

            if (confirmed) {
                toggleLoading(true);
                try {
                    await deleteCoupon({ id });
                    showStatus(`クーポン「${id}」を削除しました。`);
                    await loadAndRenderCoupons(); // リストを再読み込み
                } catch (error) {
                    showStatus(`削除中にエラーが発生しました: ${error.message}`, true);
                } finally {
                    toggleLoading(false);
                }
            }
        }
    });

    // 初期表示
    loadAndRenderCoupons();
};