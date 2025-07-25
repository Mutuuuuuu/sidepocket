import { getFirebaseServices } from './services/firebaseService.js';
import { getUserProfile, updateUserProfile, uploadUserIcon } from './services/firestoreService.js';
import { showStatus, toggleLoading } from './services/uiService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFirebaseServices().functions;
const createCheckoutSession = httpsCallable(functions, 'createCheckoutSession');
const applyReferralCode = httpsCallable(functions, 'applyReferralCode');

export const initProfilePage = async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    // --- 姓・名のDOM要素を取得 ---
    const profileForm = document.getElementById('profile-form');
    const displayNameInput = document.getElementById('display-name-input');
    const lastNameInput = document.getElementById('last-name-input'); // 姓のinputを追加
    const firstNameInput = document.getElementById('first-name-input'); // 名のinputを追加
    const userIconPreview = document.getElementById('user-icon-preview');
    const iconUploadInput = document.getElementById('icon-upload-input');
    const currentPlanEl = document.getElementById('current-plan');
    const planDescriptionEl = document.getElementById('plan-description');
    const upgradeButton = document.getElementById('upgrade-button');
    const planPeriodEl = document.getElementById('plan-period');
    const planEndDateEl = document.getElementById('plan-end-date');
    const myReferralCodeEl = document.getElementById('my-referral-code');
    const copyReferralCodeBtn = document.getElementById('copy-referral-code');
    const referralCodeInput = document.getElementById('referral-code-input');
    
    // 招待コード適用のボタンを取得
    const applyReferralButton = document.getElementById('apply-referral-button');


    const loadUserProfile = async () => {
        toggleLoading(true);
        try {
            const userProfile = await getUserProfile(user.uid);
            if (userProfile) {
                displayNameInput.value = userProfile.displayName || '';
                // --- 姓・名の値を読み込む ---
                lastNameInput.value = userProfile.lastName || '';
                firstNameInput.value = userProfile.firstName || '';
                
                userIconPreview.src = userProfile.photoURL || 'images/sidepocket_symbol.png';

                const plan = userProfile.plan || 'Free';
                currentPlanEl.textContent = plan;

                if (plan === 'Standard' && userProfile.planEndDate) {
                    planPeriodEl.classList.remove('hidden');
                    planEndDateEl.textContent = userProfile.planEndDate.toDate().toLocaleDateString();
                    planDescriptionEl.textContent = 'Standardプランをご利用いただきありがとうございます！';
                    upgradeButton.classList.add('hidden');
                } else {
                    planPeriodEl.classList.add('hidden');
                    planDescriptionEl.textContent = 'Freeプランです。招待コードを利用してStandardプランをお試しください！';
                    // upgradeButton.classList.remove('hidden'); // Stripe実装時に有効化
                }

                if (userProfile.referralCode) {
                    myReferralCodeEl.value = userProfile.referralCode;
                }
                
                // 招待コードのコンテナを取得
                const referralFormContainer = document.getElementById('referral-form-container');
                if (userProfile.referredBy) {
                    referralFormContainer.classList.add('hidden');
                }
            }
        } catch (error) {
            showStatus('プロフィールの読み込みに失敗しました。', true);
            console.error("Profile load error:", error);
        } finally {
            toggleLoading(false);
        }
    };

    await loadUserProfile();

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);
        try {
            // --- 更新オブジェクトに姓・名を追加 ---
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
        } catch (error) {
            showStatus('プロフィールの更新に失敗しました。', true);
        } finally {
            toggleLoading(false);
        }
    });

    copyReferralCodeBtn.addEventListener('click', () => {
        myReferralCodeEl.select();
        document.execCommand('copy');
        showStatus('招待コードをコピーしました！');
    });

    // --- 招待コード適用ボタンのイベントリスナー修正 ---
    applyReferralButton.addEventListener('click', async () => {
        const code = referralCodeInput.value.trim();
        if (!code) {
            showStatus('招待コードを入力してください。', true);
            return;
        }
        toggleLoading(true);
        try {
            const result = await applyReferralCode({ code: code });
            showStatus(result.data.message, false);
            referralCodeInput.value = '';
            await loadUserProfile();
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