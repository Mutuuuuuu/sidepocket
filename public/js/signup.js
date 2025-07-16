import { initializeFirebase } from './services/firebaseService.js';
import { handleEmailSignup } from './services/authService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

document.addEventListener('DOMContentLoaded', async () => {
    await initializeFirebase();  // ✅ Firebase を初期化

    const form = document.getElementById('signup-form');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);

        const displayName = form.displayName.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
        const passwordConfirm = form.passwordConfirm.value;

        if (password !== passwordConfirm) {
            toggleLoading(false);
            showStatus('パスワードが一致しません。', true);
            return;
        }

        try {
            await handleEmailSignup(email, password, displayName);
            showStatus('登録に成功しました！リダイレクトします...', false);
            setTimeout(() => {
                window.location.href = '/';
            }, 1500);
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
