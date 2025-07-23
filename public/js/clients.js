import {
    getClientsAndContacts,
    addClient,
    updateClient,
    addContact,
    updateContact,
    deleteContact,
    batchCreateClientsAndContacts
} from './services/firestoreService.js';
import {
    toggleLoading,
    showStatus,
    openModal,
    closeModal,
    setupModalClosers,
    showConfirmModal
} from './services/uiService.js';

let currentUser;
let clientsData = [];
let selectedClientId = null;
let selectedContactId = null;

const dom = {};
const clientFormFields = ['id', 'name', 'name-kana', 'name-en', 'corporate-number', 'invoice-number', 'url', 'address', 'memo'];
const contactFormFields = ['id', 'client-id', 'name', 'name-kana', 'name-en', 'email', 'phone', 'department', 'title', 'memo'];

// --- Helper Functions ---
const toCamelCase = (s) => s.replace(/-(\w)/g, (_, p1) => p1.toUpperCase());

// --- Modal Handlers ---
function openClientModal(client = null) {
    dom.clientForm.reset();
    if (client) {
        dom.clientModalTitle.textContent = '取引先を編集';
        clientFormFields.forEach(field => {
            const camelField = toCamelCase(field);
            const key = toCamelCase(`client-${field}`);
            if (dom[key] && client[camelField] !== undefined) dom[key].value = client[camelField] || '';
        });
    } else {
        dom.clientModalTitle.textContent = '取引先を新規登録';
        dom.clientId.value = '';
    }
    openModal('client-modal');
}

function openContactModal(clientId, contact = null) {
    dom.contactForm.reset();
    dom.contactClientId.value = clientId;
    if (contact) {
        dom.contactModalTitle.textContent = '担当者を編集';
        contactFormFields.forEach(field => {
            const camelField = toCamelCase(field);
            const key = toCamelCase(`contact-${field}`);
            if (dom[key] && contact[camelField] !== undefined) dom[key].value = contact[camelField] || '';
        });
    } else {
        dom.contactModalTitle.textContent = '担当者を新規登録';
        dom.contactId.value = '';
    }
    openModal('contact-modal');
}

async function handleDeleteContact(contactId) {
    const confirmed = await showConfirmModal('担当者の削除', 'この担当者を本当に削除しますか？');
    if (confirmed) {
        toggleLoading(true);
        try {
            await deleteContact(currentUser.uid, contactId);
            showStatus('担当者を削除しました。');
        } catch (error) {
            showStatus(`エラーが発生しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    }
}

// --- Event Handlers ---
function handleColumnClick(e) {
    const target = e.target;
    const clientItem = target.closest('[data-client-id]');
    const contactItem = target.closest('[data-contact-id]');

    if (target.closest('button')) {
        const button = target.closest('button');
        if (button.classList.contains('edit-client-btn')) {
            const client = clientsData.find(c => c.id === button.dataset.clientId);
            openClientModal(client);
        } else if (button.classList.contains('add-contact-btn')) {
            openContactModal(button.dataset.clientId);
        } else if (button.classList.contains('edit-contact-btn')) {
            const { contactId, clientId } = button.dataset;
            const client = clientsData.find(c => c.id === clientId);
            const contact = client.contacts.find(con => con.id === contactId);
            openContactModal(clientId, contact);
        } else if (button.classList.contains('delete-contact-btn')) {
            handleDeleteContact(button.dataset.contactId);
        }
        return;
    }

    if (clientItem && !contactItem) {
        selectedClientId = clientItem.dataset.clientId;
        selectedContactId = null;
        renderAllColumns();
    } else if (contactItem) {
        selectedContactId = contactItem.dataset.contactId;
        renderAllColumns();
    }
}

async function handleClientFormSubmit(e) {
    e.preventDefault();
    toggleLoading(true);
    const clientData = {};
    clientFormFields.slice(1).forEach(field => {
        const camelField = toCamelCase(field);
        clientData[camelField] = dom[toCamelCase(`client-${field}`)]?.value.trim() || null;
    });
    const clientId = dom.clientId.value;
    try {
        if (clientId) {
            await updateClient(currentUser.uid, clientId, clientData);
            showStatus('取引先情報を更新しました。');
        } else {
            await addClient(currentUser.uid, clientData);
            showStatus('取引先を登録しました。');
        }
        closeModal('client-modal');
    } catch (error) {
        showStatus(`エラーが発生しました: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
}

async function handleContactFormSubmit(e) {
    e.preventDefault();
    toggleLoading(true);
    const contactData = {};
    contactFormFields.slice(2).forEach(field => {
        const camelField = toCamelCase(field);
        contactData[camelField] = dom[toCamelCase(`contact-${field}`)]?.value.trim() || null;
    });
    const contactId = dom.contactId.value;
    const clientId = dom.contactClientId.value;
    if (!clientId) {
        showStatus('取引先IDが不明です。ページをリロードしてください。', true);
        toggleLoading(false);
        return;
    }
    try {
        if (contactId) {
            await updateContact(currentUser.uid, contactId, contactData);
            showStatus('担当者情報を更新しました。');
        } else {
            await addContact(currentUser.uid, clientId, contactData);
            showStatus('担当者を登録しました。');
        }
        closeModal('contact-modal');
    } catch (error) {
        showStatus(`エラーが発生しました: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
}

// --- Rendering Logic ---
function renderAllColumns() {
    renderClientsColumn();
    renderContactsColumn();
    renderContactDetailsColumn();
}

function renderClientsColumn() {
    if (!dom.clientsList) return;
    dom.clientsList.innerHTML = '';
    if (clientsData.length === 0) {
        dom.clientsList.innerHTML = '<p class="p-4 text-sm text-gray-500">取引先がありません。</p>';
        return;
    }
    clientsData.forEach(client => {
        const item = document.createElement('div');
        item.className = `p-4 border-b cursor-pointer hover:bg-gray-100 column-item ${client.id === selectedClientId ? 'active' : ''}`;
        item.dataset.clientId = client.id;
        item.innerHTML = `
            <p class="font-semibold text-gray-800">${client.name}</p>
            <p class="text-sm text-gray-500">${client.contacts.length}人の担当者</p>
        `;
        dom.clientsList.appendChild(item);
    });
}

function renderContactsColumn() {
    if (!dom.contactsColumn) return;
    if (!selectedClientId) {
        dom.contactsColumn.classList.add('hidden');
        return;
    }
    const client = clientsData.find(c => c.id === selectedClientId);
    if (!client) return;

    dom.contactsColumn.classList.remove('hidden');
    dom.contactsColumn.classList.add('flex');
    dom.contactsColumn.innerHTML = `
        <div class="p-4 border-b">
            <div class="flex justify-between items-center">
                <h2 class="font-bold text-lg truncate">${client.name}</h2>
                <button class="edit-client-btn text-sm font-medium text-indigo-600 hover:underline" data-client-id="${client.id}">編集</button>
            </div>
        </div>
        <div class="p-4 border-b text-xs space-y-1">
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">法人番号:</strong> ${client.corporateNumber || '-'}</div>
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">住所:</strong> ${client.address || '-'}</div>
        </div>
        <div class="p-4 border-b">
            <div class="flex justify-between items-center">
                <h3 class="font-semibold text-md">担当者</h3>
                <button class="add-contact-btn bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold py-1 px-3 rounded-md transition-colors" data-client-id="${client.id}">追加</button>
            </div>
        </div>
        <div class="flex-1 overflow-y-auto">
            ${client.contacts.length > 0 ? client.contacts.map(contact => `
                <div class="p-4 border-b cursor-pointer hover:bg-gray-100 column-item ${contact.id === selectedContactId ? 'active' : ''}" data-contact-id="${contact.id}">
                    <p class="font-semibold text-gray-800">${contact.name}</p>
                    <p class="text-sm text-gray-500">${contact.department || ''} ${contact.title || ''}</p>
                </div>
            `).join('') : '<p class="p-4 text-sm text-gray-500">担当者がいません。</p>'}
        </div>
    `;
}

function renderContactDetailsColumn() {
    if (!dom.contactDetailsColumn) return;
    if (!selectedContactId) {
        dom.contactDetailsColumn.classList.add('hidden');
        return;
    }
    const client = clientsData.find(c => c.id === selectedClientId);
    if (!client) return;
    const contact = client.contacts.find(p => p.id === selectedContactId);
    if (!contact) return;

    dom.contactDetailsColumn.classList.remove('hidden');
    dom.contactDetailsColumn.classList.add('flex');
    dom.contactDetailsColumn.innerHTML = `
        <div class="p-4 border-b">
            <div class="flex justify-between items-center">
                <h2 class="font-bold text-lg truncate">${contact.name}</h2>
                <div>
                    <button class="edit-contact-btn text-sm font-medium text-indigo-600 hover:underline" data-contact-id="${contact.id}" data-client-id="${client.id}">編集</button>
                    <button class="delete-contact-btn text-sm font-medium text-red-600 hover:underline ml-2" data-contact-id="${contact.id}">削除</button>
                </div>
            </div>
            <p class="text-sm text-gray-500">${contact.department || ''} ${contact.title || ''}</p>
        </div>
        <div class="flex-1 p-4 text-sm space-y-2 overflow-y-auto">
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">カナ:</strong> ${contact.nameKana || '-'}</div>
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">英語名:</strong> ${contact.nameEn || '-'}</div>
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">Email:</strong> ${contact.email ? `<a href="mailto:${contact.email}" class="text-blue-600 hover:underline">${contact.email}</a>` : '-'}</div>
            <div><strong class="font-semibold text-gray-500 w-24 inline-block">電話番号:</strong> ${contact.phone || '-'}</div>
            <div><strong class="font-semibold text-gray-500 w-24 inline-block align-top">メモ:</strong><div class="inline-block whitespace-pre-wrap">${contact.memo || '-'}</div></div>
        </div>
    `;
}

// --- 初期化処理 ---
// ★★★ エラー修正点 ★★★
// 以下の関数は `initClientsPage` より先に定義します。
function cacheDOMElements() {
    const mainIds = [
        'clients-table-body', 'client-modal', 'contact-modal', 'client-form', 'contact-form',
        'client-modal-title', 'contact-modal-title', 'open-add-client-modal',
        'import-modal', 'open-import-modal-btn', 'csv-file-input', 'import-execute-btn', 'download-template-btn',
        'export-modal', 'open-export-modal-btn', 'export-execute-btn',
        'clients-column', 'contacts-column', 'contact-details-column', 'clients-list'
    ];
    mainIds.forEach(id => dom[toCamelCase(id)] = document.getElementById(id));
    clientFormFields.forEach(field => dom[toCamelCase(`client-${field}`)] = document.getElementById(`client-${field}`));
    contactFormFields.forEach(field => dom[toCamelCase(`contact-${field}`)] = document.getElementById(`contact-${field}`));
}

function setupEventListeners() {
    if (dom.openAddClientModal) dom.openAddClientModal.addEventListener('click', () => openClientModal());
    if (dom.clientForm) dom.clientForm.addEventListener('submit', handleClientFormSubmit);
    if (dom.contactForm) dom.contactForm.addEventListener('submit', handleContactFormSubmit);
    if (dom.clientsColumn) dom.clientsColumn.addEventListener('click', handleColumnClick);
    if (dom.contactsColumn) dom.contactsColumn.addEventListener('click', handleColumnClick);
    // (CSV関連のリスナーもここに含まれます)
}

function listenForData() {
    toggleLoading(true);
    getClientsAndContacts(currentUser.uid, (data) => {
        clientsData = data.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        renderAllColumns();
        toggleLoading(false);
    });
}

export function initClientsPage(user) {
    if (!user) return;
    currentUser = user;
    cacheDOMElements();
    if (!dom.clientsColumn) return;
    setupEventListeners();
    listenForData();
}