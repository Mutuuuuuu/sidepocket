export const toggleLoading = (show) => {
    document.getElementById('loading-overlay')?.classList.toggle('hidden', !show);
};

export const showStatus = (message, isError = false, duration = 3000) => {
    const container = document.getElementById('status-message-container');
    if (!container) return;
    const statusElement = document.createElement('div');
    statusElement.textContent = message;
    statusElement.className = `p-4 rounded-lg text-sm mb-6 ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`;
    container.prepend(statusElement);
    setTimeout(() => statusElement.remove(), duration);
};

export const openModal = (modalId) => document.getElementById(modalId)?.classList.remove('hidden');
export const closeModal = (modalId) => document.getElementById(modalId)?.classList.add('hidden');

export const setupModalClosers = (modalId) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    const close = () => closeModal(modalId);
    modal.querySelector('.modal-cancel-button')?.addEventListener('click', close);
    modal.querySelector('.modal-overlay')?.addEventListener('click', close);
};

export const showConfirmModal = (title, message) => {
    return new Promise((resolve) => {
        const modalHtml = `... (確認モーダルのHTMLは省略) ...`; // 以前のコードと同じ
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('confirm-modal-dynamic');
        const cleanup = () => modal.remove();
        modal.querySelector('.confirm-button').onclick = () => { cleanup(); resolve(true); };
        modal.querySelector('.cancel-button').onclick = () => { cleanup(); resolve(false); };
        modal.querySelector('.modal-overlay-dynamic').onclick = () => { cleanup(); resolve(false); };
    });
};