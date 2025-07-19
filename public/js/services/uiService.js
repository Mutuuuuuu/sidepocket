/**
 * 画面上部にステータスメッセージを表示し、自動で消去する
 * @param {string} message 表示するメッセージ
 * @param {boolean} [isError=false] エラーメッセージかどうか
 * @param {number} [duration=3000] 表示時間（ミリ秒）
 */
export const showStatus = (message, isError = false, duration = 3000) => {
    const container = document.getElementById('status-message-container');
    if (!container) return;

    const messageId = `status-${Date.now()}`;
    const bgColor = isError ? 'bg-red-500' : 'bg-green-500';
    const messageDiv = document.createElement('div');
    messageDiv.id = messageId;
    messageDiv.className = `p-4 mb-4 text-white ${bgColor} rounded-lg shadow-lg transition-opacity duration-300`;
    messageDiv.textContent = message;

    container.appendChild(messageDiv);

    setTimeout(() => {
        const el = document.getElementById(messageId);
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }
    }, duration);
};

/**
 * ローディングオーバーレイの表示/非表示を切り替える
 * @param {boolean} show 表示する場合はtrue
 */
export const toggleLoading = (show) => {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.toggle('hidden', !show);
    }
};

/**
 * 確認モーダルダイアログを表示する
 * @param {string} title モーダルのタイトル
 * @param {string} message 確認メッセージ
 * @param {object} [options] ボタンのテキストや色、アイコンをカスタマイズするオプション
 * @param {string} [options.confirmText='はい'] 確認ボタンのテキスト
 * @param {string} [options.cancelText='キャンセル'] キャンセルボタンのテキスト
 * @param {string} [options.confirmColor='indigo'] 確認ボタンの色 (Tailwindのカラー名)
 * @param {'warning' | 'question'} [options.iconType='warning'] アイコンの種類
 * @returns {Promise<boolean>} ユーザーが確認した場合はtrue、それ以外はfalse
 */
export const showConfirmModal = (title, message, options = {}) => {
    const {
        confirmText = 'はい',
        cancelText = 'キャンセル',
        confirmColor = 'indigo',
        iconType = 'question'
    } = options;

    const icons = {
        warning: `
            <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                <svg class="h-6 w-6 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>`,
        question: `
            <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                <svg class="h-6 w-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </div>`
    };

    const confirmButtonClasses = `bg-${confirmColor}-600 hover:bg-${confirmColor}-700 focus:ring-${confirmColor}`;

    return new Promise((resolve) => {
        const existingModal = document.getElementById('confirm-modal-dynamic');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHTML = `
            <div id="confirm-modal-dynamic" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex justify-center items-center z-50 p-4" style="animation: fadeIn 0.1s ease-out;">
                <div class="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden transform transition-all" style="animation: zoomIn 0.2s ease-out;">
                    <div class="p-6">
                        <div class="sm:flex sm:items-start">
                            ${icons[iconType] || icons.question}
                            <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                                <h3 class="text-lg leading-6 font-medium text-gray-900">${title}</h3>
                                <div class="mt-2">
                                    <p class="text-sm text-gray-500">${message}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="bg-gray-50 px-6 py-4 sm:flex sm:flex-row-reverse">
                        <button type="button" id="confirm-btn-dynamic" class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 text-base font-medium text-white sm:ml-3 sm:w-auto sm:text-sm ${confirmButtonClasses}">
                            ${confirmText}
                        </button>
                        <button type="button" id="cancel-btn-dynamic" class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:w-auto sm:text-sm">
                            ${cancelText}
                        </button>
                    </div>
                </div>
            </div>
            <style>
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes zoomIn { from { transform: scale(0.9); } to { transform: scale(1); } }
            </style>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const confirmBtn = document.getElementById('confirm-btn-dynamic');
        const cancelBtn = document.getElementById('cancel-btn-dynamic');
        const modal = document.getElementById('confirm-modal-dynamic');

        const closeModal = (result) => {
            modal.remove();
            resolve(result);
        };

        confirmBtn.onclick = () => closeModal(true);
        cancelBtn.onclick = () => closeModal(false);
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeModal(false);
            }
        };
    });
};
