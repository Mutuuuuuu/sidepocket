import { addNotification } from './services/firestoreService.js';
import { showStatus } from './services/uiService.js';

export const initAdminPage = async (user) => {
    // ユーザーがいない場合はトップページにリダイレクト
    if (!user) {
        window.location.href = '/';
        return;
    }

    // ユーザーが管理者かどうかをチェック
    const idTokenResult = await user.getIdTokenResult();
    if (!idTokenResult.claims.isAdmin) {
        alert('このページへのアクセス権がありません。');
        window.location.href = '/';
        return;
    }

    const form = document.getElementById('notification-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = form.title.value;
        const category = form.category.value;

        if (!title || !category) {
            showStatus('タイトルとカテゴリーを両方入力してください。', true);
            return;
        }

        try {
            await addNotification({ title, category });
            showStatus('お知らせを正常に投稿しました。');
            form.reset();
        } catch (error) {
            console.error("お知らせの投稿に失敗:", error);
            showStatus(`エラーが発生しました: ${error.message}`, true);
        }
    });
};