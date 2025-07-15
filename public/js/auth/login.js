import { getFirebaseServices } from '../services/firebaseService.js';
import { handleEmailLogin, handleGoogleLogin } from '../services/authService.js';
import { toggleLoading, showStatus } from '../services/uiService.js';

/**
 * ログインページの初期化とイベントリスナーの設定
 */
export const initLoginPage = () => {
    console.log("1. initLoginPage 関数が呼び出されました。"); // 確認用メッセージ1

    const { auth } = getFirebaseServices();

    const loginForm = document.getElementById('login-form');
    const googleLoginButton = document.getElementById('google-login-button');

    console.log("2. Googleログインボタンを探します:", googleLoginButton); // 確認用メッセージ2

    // メール・パスワードでのログイン処理
    loginForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        toggleLoading(true);
        const email = loginForm.email.value;
        const password = loginForm.password.value;
        try {
            await handleEmailLogin(email, password);
        } catch (error) {
            showStatus('メールアドレスまたはパスワードが正しくありません。', true);
        } finally {
            toggleLoading(false);
        }
    });

    // Googleでのログイン処理
    if (googleLoginButton) {
        console.log("3. ボタンが見つかったので、クリックイベントを設定します。"); // 確認用メッセージ3
        googleLoginButton.addEventListener('click', async () => {
            console.log("4. Googleログインボタンがクリックされました！"); // 確認用メッセージ4
            toggleLoading(true);
            try {
                await handleGoogleLogin();
            } catch (error) {
                console.error('Google Login Error:', error);
                showStatus(`Googleログインに失敗しました: ${error.message}`, true);
            } finally {
                toggleLoading(false);
            }
        });
    } else {
        console.error("エラー: google-login-button が見つかりませんでした。");
    }

    toggleLoading(false);
};