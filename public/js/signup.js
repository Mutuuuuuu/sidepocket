import { initializeFirebase, getFirebaseServices } from './services/firebaseService.js';
import { handleEmailSignup } from './services/authService.js';
import { toggleLoading, showStatus } from './services/uiService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";

document.addEventListener('DOMContentLoaded', async () => {
    await initializeFirebase();
    const functions = getFirebaseServices().functions;
    const applyReferralCode = httpsCallable(functions, 'applyReferralCode');

    const form = document.getElementById('signup-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);

        const displayName = form.displayName.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
        const passwordConfirm = form.passwordConfirm.value;
        const referralCode = form.referralCode.value.trim(); // 招待コードを取得

        if (password !== passwordConfirm) {
            toggleLoading(false);
            showStatus('パスワードが一致しません。', true);
            return;
        }

        try {
            const user = await handleEmailSignup(email, password, displayName);

            // 招待コードが入力されていれば適用する
            if (referralCode) {
                try {
                   await applyReferralCode({ code: referralCode });
                   showStatus('招待コードを適用しました！', false);
                } catch (referralError) {
                    // 招待コードのエラーは登録成功メッセージの後に表示
                    console.warn('Referral Error:', referralError);
                    showStatus(`登録は成功しましたが、招待コードの適用に失敗しました: ${referralError.message}`, true, 5000);
                }
            }
            
            showStatus('登録に成功しました！リダイレクトします...', false);
            setTimeout(() => {
                window.location.href = '/';
            }, 2500);

        } catch (error) {
            console.error(error);
            const message = error.code === 'auth/email-already-in-use'
                ? 'このメールアドレスはすでに登録されています。'
                : '登録に失敗しました。もう一度お試しください。';
            showStatus(message, true);
        } finally {
            toggleLoading(false);
        }
    });
});