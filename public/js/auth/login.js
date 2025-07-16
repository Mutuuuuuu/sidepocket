import { getFirebaseServices } from '../services/firebaseService.js';
// ▼ sendPasswordResetEmail を import に追加
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
    // 【追加】パスワードリセット用のリンク要素を取得
    const forgotPasswordLink = document.getElementById('forgot-password-link');

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
    
    // 【追加】パスワードリセット処理
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = loginForm.email.value;
            if (!email) {
                showStatus('パスワードをリセットするために、まずメールアドレスを入力してください。', true, 4000);
                return;
            }
            toggleLoading(true);
            try {
                await sendPasswordResetEmail(auth, email);
                showStatus(`'${email}' にパスワード再設定用のメールを送信しました。`, false, 5000);
            } catch (error) {
                console.error('Password Reset Error:', error);
                showStatus(`パスワードリセットメールの送信に失敗しました: ${error.message}`, true, 5000);
            } finally {
                toggleLoading(false);
            }
        });
    }


    toggleLoading(false);
};