import { getFirebaseServices } from './services/firebaseService.js';
import { getUserProfile, updateUserProfile, uploadUserIcon, getCodeUsageHistory } from './services/firestoreService.js';
import { showStatus, toggleLoading } from './services/uiService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFirebaseServices().functions;
const applyCode = httpsCallable(functions, 'applyCode');

export const initProfilePage = async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    // --- DOM要素の取得 ---
    const profileForm = document.getElementById('profile-form');
    const displayNameInput = document.getElementById('display-name-input');
    const lastNameInput = document.getElementById('last-name-input');
    const firstNameInput = document.getElementById('first-name-input');
    const userIconPreview = document.getElementById('user-icon-preview');
    const iconUploadInput = document.getElementById('icon-upload-input');
    
    const currentPlanEl = document.getElementById('current-plan');
    const planPeriodEl = document.getElementById('plan-period');
    const planStartDateEl = document.getElementById('plan-start-date');
    const planEndDateEl = document.getElementById('plan-end-date');

    const myInvitationCodeEl = document.getElementById('my-invitation-code');
    const copyCodeBtn = document.getElementById('copy-code-button');
    const applyCodeInput = document.getElementById('apply-code-input');
    const applyCodeButton = document.getElementById('apply-code-button');
    const codeUsageHistoryEl = document.getElementById('code-usage-history');

    const loadUserProfile = async () => {
        toggleLoading(true);
        try {
            const [userProfile, history] = await Promise.all([
                getUserProfile(user.uid),
                getCodeUsageHistory(user.uid, 5)
            ]);

            if (userProfile) {
                // プロフィール情報
                displayNameInput.value = userProfile.displayName || '';
                lastNameInput.value = userProfile.lastName || '';
                firstNameInput.value = userProfile.firstName || '';
                userIconPreview.src = userProfile.photoURL || 'images/sidepocket_symbol.png';

                // ▼▼▼ 【ここを修正】 ▼▼▼
                // 新しい 'invitationCode' を優先的に参照し、なければ古い 'referralCode' を参照する
                myInvitationCodeEl.value = userProfile.invitationCode || userProfile.referralCode || '';
                // ▲▲▲ 【修正ここまで】 ▲▲▲

                // プラン情報
                const plan = userProfile.plan || 'Free';
                currentPlanEl.textContent = plan;
                if (plan === 'Standard' && userProfile.planStartDate && userProfile.planEndDate) {
                    planPeriodEl.classList.remove('hidden');
                    planStartDateEl.textContent = userProfile.planStartDate.toDate().toLocaleDateString();
                    planEndDateEl.textContent = userProfile.planEndDate.toDate().toLocaleDateString();
                } else {
                    planPeriodEl.classList.add('hidden');
                }
            }
             // コード利用履歴
            renderCodeUsageHistory(history);

        } catch (error) {
            showStatus('プロフィールの読み込みに失敗しました。', true);
            console.error("Profile load error:", error);
        } finally {
            toggleLoading(false);
        }
    };
    
    const renderCodeUsageHistory = (history) => {
        if (!codeUsageHistoryEl) return;
        if (history.length === 0) {
            codeUsageHistoryEl.innerHTML = '<li class="text-sm text-gray-500">利用履歴はありません。</li>';
            return;
        }
        codeUsageHistoryEl.innerHTML = history.map(h => {
            const date = h.usedAt.toDate().toLocaleDateString();
            const actionText = h.action === 'applied' ? '適用' : '提供';
            const icon = h.action === 'applied' 
              ? `<svg class="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`
              : `<svg class="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c1.657 0 3 1.343 3 3s-1.343 3-3 3-3-1.343-3-3 1.343-3 3-3zM3 18c0-3.866 3.134-7 7-7h4c3.866 0 7 3.134 7 7v1h-18v-1z"/></svg>`;
            
            return `<li class="flex items-center justify-between text-sm">
                        <div class="flex items-center gap-2">
                            ${icon}
                            <div>
                                <p class="font-medium text-gray-800">${h.benefitDescription}</p>
                                <p class="text-xs text-gray-500">${actionText} (${date})</p>
                            </div>
                        </div>
                        <span class="text-xs font-mono bg-gray-100 px-2 py-1 rounded">${h.code}</span>
                    </li>`;
        }).join('');
    };


    await loadUserProfile();

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);
        try {
            const updatedProfile = {
                displayName: displayNameInput.value,
                lastName: lastNameInput.value,
                firstName: firstNameInput.value,
            };
            if (iconUploadInput.files && iconUploadInput.files[0]) {
                const file = iconUploadInput.files[0];
                const photoURL = await uploadUserIcon(user.uid, file);
                updatedProfile.photoURL = photoURL;
            }
            await updateUserProfile(user.uid, updatedProfile);
            showStatus('プロフィールを更新しました。');
            // ヘッダー情報も更新
             document.getElementById('header-display-name').textContent = updatedProfile.displayName;
             if(updatedProfile.photoURL) document.getElementById('header-user-icon').src = updatedProfile.photoURL;

        } catch (error) {
            showStatus('プロフィールの更新に失敗しました。', true);
        } finally {
            toggleLoading(false);
        }
    });

    copyCodeBtn.addEventListener('click', () => {
        myInvitationCodeEl.select();
        document.execCommand('copy');
        showStatus('招待コードをコピーしました！');
    });

    applyCodeButton.addEventListener('click', async () => {
        const code = applyCodeInput.value.trim();
        if (!code) {
            showStatus('コードを入力してください。', true);
            return;
        }
        toggleLoading(true);
        try {
            const result = await applyCode({ code: code });
            showStatus(result.data.message, false);
            applyCodeInput.value = '';
            await loadUserProfile(); // 情報を再読み込み
        } catch (error) {
            showStatus(`エラー: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    });
    
    iconUploadInput.addEventListener('change', () => {
        if (iconUploadInput.files && iconUploadInput.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => { userIconPreview.src = e.target.result; };
            reader.readAsDataURL(iconUploadInput.files[0]);
        }
    });
};