import { getFirebaseServices } from './services/firebaseService.js';
import { getUserProfile, updateUserProfile, uploadUserIcon } from './services/firestoreService.js';
import { showStatus, toggleLoading } from './services/uiService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

const functions = getFirebaseServices().functions;
const createCheckoutSession = httpsCallable(functions, 'createCheckoutSession');

// StripeのPrice ID (Stripeダッシュボードで作成したものに置き換えてください)
const MONTHLY_PLAN_PRICE_ID = 'price_xxxxxxxxxxxxxxxxx'; // 月額プラン
const YEARLY_PLAN_PRICE_ID = 'price_yyyyyyyyyyyyyyyyy'; // 年額プラン (もしあれば)

export const initProfilePage = async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    const profileForm = document.getElementById('profile-form');
    const displayNameInput = document.getElementById('display-name-input');
    const lastNameInput = document.getElementById('last-name-input');
    const firstNameInput = document.getElementById('first-name-input');
    const userIconPreview = document.getElementById('user-icon-preview');
    const iconUploadInput = document.getElementById('icon-upload-input');
    const currentPlanEl = document.getElementById('current-plan');
    const planDescriptionEl = document.getElementById('plan-description');
    const upgradeButton = document.getElementById('upgrade-button');

    toggleLoading(true);
    try {
        const userProfile = await getUserProfile(user.uid);
        if (userProfile) {
            displayNameInput.value = userProfile.displayName || '';
            lastNameInput.value = userProfile.lastName || '';
            firstNameInput.value = userProfile.firstName || '';
            userIconPreview.src = userProfile.photoURL || 'images/sidepocket_symbol.png';
            
            // --- ▼▼▼ プラン情報の表示処理 ▼▼▼ ---
            const plan = userProfile.plan || 'Free';
            currentPlanEl.textContent = plan;

            if (plan === 'Free') {
                // 課金準備ができていないため、UIを変更
                planDescriptionEl.textContent = '現在プランの変更はできません。freeプランですべての機能をご利用いただけます。';
                upgradeButton.classList.remove('hidden'); // ボタンは表示
                upgradeButton.disabled = true; // ボタンを無効化
                upgradeButton.classList.add('bg-gray-400', 'cursor-not-allowed'); // スタイルをグレーアウトに変更
                upgradeButton.classList.remove('bg-amber-500', 'hover:bg-amber-600'); // 元のスタイルを削除
            } else if (plan === 'Standard') {
                planDescriptionEl.textContent = 'Standardプランをご利用いただきありがとうございます！全ての機能をご利用いただけます。';
                upgradeButton.classList.add('hidden');
            }
            // --- ▲▲▲ ここまで ▲▲▲ ---
        }
    } catch (error) {
        showStatus('プロフィールの読み込みに失敗しました。', true);
        console.error("Profile load error:", error);
    } finally {
        toggleLoading(false);
    }

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);
        try {
            const updatedProfile = {
                displayName: displayNameInput.value,
                lastName: lastNameInput.value,
                firstName: firstNameInput.value,
            };

            // アイコン画像が選択されている場合はアップロード
            if (iconUploadInput.files && iconUploadInput.files[0]) {
                const file = iconUploadInput.files[0];
                const photoURL = await uploadUserIcon(user.uid, file);
                updatedProfile.photoURL = photoURL;
            }

            await updateUserProfile(user.uid, updatedProfile);
            showStatus('プロフィールを更新しました。');
        } catch (error) {
            showStatus('プロフィールの更新に失敗しました。', true);
            console.error("Profile update error:", error);
        } finally {
            toggleLoading(false);
        }
    });

    iconUploadInput.addEventListener('change', () => {
        if (iconUploadInput.files && iconUploadInput.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                userIconPreview.src = e.target.result;
            };
            reader.readAsDataURL(iconUploadInput.files[0]);
        }
    });

    // --- ▼▼▼ アップグレードボタンのクリック処理 ▼▼▼ ---
    upgradeButton.addEventListener('click', async () => {
        // ボタンが無効化されている場合は何もしない
        if (upgradeButton.disabled) {
            return;
        }

        toggleLoading(true);
        try {
            // ここで月額か年額かを選択させるUIを将来的に追加できます
            const priceId = MONTHLY_PLAN_PRICE_ID;

            const result = await createCheckoutSession({ 
                priceId: priceId,
                successUrl: `${window.location.origin}/profile.html?upgraded=true`,
                cancelUrl: window.location.href,
            });
            
            const { sessionId } = result.data;
            // Stripe.jsを使用してStripe Checkoutにリダイレクト
            // このためには、HTMLにStripe.jsのスクリプトタグを追加する必要があります。
            // 例: <script src="https://js.stripe.com/v3/"></script>
            const stripe = Stripe('pk_test_YOUR_STRIPE_PUBLISHABLE_KEY'); // ★自身の公開可能キーに置き換える
            await stripe.redirectToCheckout({ sessionId });

        } catch (error) {
            showStatus('決済ページの作成に失敗しました。時間をおいて再度お試しください。', true);
            console.error("Stripe session creation error:", error);
        } finally {
            toggleLoading(false);
        }
    });
};
