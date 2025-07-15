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
        const modalHtml = `
            <div id="confirm-modal-dynamic" class="fixed inset-0 z-50 overflow-y-auto">
                <div class="flex items-center justify-center min-h-screen p-4">
                    <div class="fixed inset-0 bg-black bg-opacity-50 modal-overlay-dynamic"></div>
                    <div class="bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full z-50">
                        <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                            <div class="sm:flex sm:items-start">
                                <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                                    <svg class="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                </div>
                                <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                                    <h3 class="text-lg leading-6 font-medium text-gray-900">${title}</h3>
                                    <div class="mt-2">
                                        <p class="text-sm text-gray-500">${message}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                            <button type="button" class="confirm-button w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 sm:ml-3 sm:w-auto sm:text-sm">
                                削除
                            </button>
                            <button type="button" class="cancel-button mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 sm:mt-0 sm:w-auto sm:text-sm">
                                キャンセル
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('confirm-modal-dynamic');
        
        const cleanupAndResolve = (value) => {
            modal.remove();
            resolve(value);
        };
        
        modal.querySelector('.confirm-button').addEventListener('click', () => cleanupAndResolve(true));
        modal.querySelector('.cancel-button').addEventListener('click', () => cleanupAndResolve(false));
        modal.querySelector('.modal-overlay-dynamic').addEventListener('click', () => cleanupAndResolve(false));
    });
};