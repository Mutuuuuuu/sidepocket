import {
    getClientsAndContacts,
    addClient,
    updateClient,
    deleteClient,
    addContact,
    updateContact,
    deleteContact,
    batchCreateClientsAndContacts
} from './services/firestoreService.js';

// --- Module-level variables ---
let currentUser;
let clientsData = [];
let selectedClientId = null;
let selectedContactId = null;

const dom = {};
const clientFormFields = ['id', 'name', 'name-kana', 'name-en', 'corporate-number', 'invoice-number', 'url', 'address', 'memo'];
const contactFormFields = ['id', 'client-id', 'name', 'name-kana', 'name-en', 'email', 'phone', 'department', 'title', 'memo'];

// --- Helper Functions ---
const toCamelCase = (s) => s.replace(/-(\w)/g, (_, p1) => p1.toUpperCase());
const cacheDOMElements = () => { const mainIds = [ 'clients-column', 'contacts-column', 'contact-details-column', 'client-modal', 'contact-modal', 'client-form', 'contact-form', 'client-modal-title', 'contact-modal-title', 'open-add-client-modal', 'import-modal', 'open-import-modal-btn', 'csv-file-input', 'import-execute-btn', 'download-template-btn', 'export-modal', 'open-export-modal-btn', 'export-execute-btn', 'export-type-select', 'loading-overlay', 'status-message-container' ]; mainIds.forEach(id => dom[toCamelCase(id)] = document.getElementById(id)); clientFormFields.forEach(field => dom[toCamelCase(`client-${field}`)] = document.getElementById(`client-${field}`)); contactFormFields.forEach(field => dom[toCamelCase(`contact-${field}`)] = document.getElementById(`contact-${field}`)); };

// --- Self-contained UI Functions ---
const toggleLoading = (isLoading) => dom.loadingOverlay?.classList.toggle('hidden', !isLoading);
const showStatus = (message, isError = false, duration = 3000) => { if (!dom.statusMessageContainer) return; const msgDiv = document.createElement('div'); const bgColor = isError ? 'bg-red-500' : 'bg-green-500'; msgDiv.className = `p-4 mb-4 text-white ${bgColor} rounded-lg shadow-lg transition-opacity duration-300 opacity-0`; msgDiv.textContent = message; dom.statusMessageContainer.appendChild(msgDiv); setTimeout(() => msgDiv.classList.remove('opacity-0'), 10); setTimeout(() => { msgDiv.classList.add('opacity-0'); msgDiv.addEventListener('transitionend', () => msgDiv.remove()); }, duration); };
const showConfirmModal = (title, message) => Promise.resolve(window.confirm(`${title}\n\n${message}`));
const openModal = (modalId) => document.getElementById(modalId)?.classList.remove('hidden');
const closeModal = (modalId) => document.getElementById(modalId)?.classList.add('hidden');
const setupModalClosers = () => { document.querySelectorAll('#client-modal, #contact-modal, #import-modal, #export-modal').forEach(modal => { modal.querySelector('.modal-close-btn')?.addEventListener('click', () => closeModal(modal.id)); modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal.id); }); }); };

// --- Modal Openers ---
const openClientModal = (client = null) => { dom.clientForm.reset(); if (client) { dom.clientModalTitle.textContent = '取引先を編集'; clientFormFields.forEach(f => { const key = toCamelCase(`client-${f}`); if (dom[key] && client[toCamelCase(f)] !== undefined) dom[key].value = client[toCamelCase(f)] || ''; }); } else { dom.clientModalTitle.textContent = '取引先を新規登録'; dom.clientId.value = ''; } openModal('client-modal'); };
const openContactModal = (clientId, contact = null) => { dom.contactForm.reset(); dom.contactClientId.value = clientId; if (contact) { dom.contactModalTitle.textContent = '担当者を編集'; contactFormFields.forEach(f => { const key = toCamelCase(`contact-${f}`); if (dom[key] && contact[toCamelCase(f)] !== undefined) dom[key].value = contact[toCamelCase(f)] || ''; }); } else { dom.contactModalTitle.textContent = '担当者を新規登録'; dom.contactId.value = ''; } openModal('contact-modal'); };

// --- Delete Handlers ---
const handleDeleteClient = async (clientId) => { const client = clientsData.find(c => c.id === clientId); if (!client) return; if (client.contacts?.length > 0) return showStatus('この取引先には担当者が紐付いているため削除できません。', true, 5000); if (await showConfirmModal('取引先の削除', `取引先「${client.name}」を本当に削除しますか？`)) { toggleLoading(true); try { await deleteClient(currentUser.uid, clientId); showStatus('取引先を削除しました。'); selectedClientId = null; selectedContactId = null; renderAllColumns(); } catch (error) { showStatus(`エラー: ${error.message}`, true); } finally { toggleLoading(false); } } };
const handleDeleteContact = async (contactId) => { if (await showConfirmModal('担当者の削除', 'この担当者を本当に削除しますか？')) { toggleLoading(true); try { await deleteContact(currentUser.uid, contactId); showStatus('担当者を削除しました。'); selectedContactId = null; renderAllColumns(); } catch (error) { showStatus(`エラー: ${error.message}`, true); } finally { toggleLoading(false); } } };

// --- Main Event Handler ---
const handleColumnClick = (e) => {
    const target = e.target.closest('button, [data-client-id], [data-contact-id]');
    if (!target) return;
    e.stopPropagation();
    const { clientId, contactId, columnToClose } = target.dataset;
    if (target.classList.contains('close-column-btn')) {
        if (columnToClose === '2') selectedClientId = null;
        selectedContactId = null;
        return renderAllColumns();
    }
    if (target.tagName === 'BUTTON') {
        if (target.classList.contains('edit-client-btn')) openClientModal(clientsData.find(c => c.id === clientId));
        else if (target.classList.contains('delete-client-btn')) handleDeleteClient(clientId);
        else if (target.classList.contains('add-contact-btn')) openContactModal(clientId);
        else if (target.classList.contains('edit-contact-btn')) {
            const client = clientsData.find(c => c.id === clientId);
            openContactModal(clientId, client.contacts.find(con => con.id === contactId));
        } else if (target.classList.contains('delete-contact-btn')) handleDeleteContact(contactId);
        return;
    }
    if (target.closest('[data-contact-id]')) selectedContactId = contactId;
    else if (target.closest('[data-client-id]')) { selectedClientId = clientId; selectedContactId = null; }
    renderAllColumns();
};

// --- Form Submit Handlers ---
async function handleFormSubmit(e, formType) { e.preventDefault(); toggleLoading(true); const isClient = formType === 'client'; const formFields = isClient ? clientFormFields : contactFormFields; const data = {}; formFields.slice(isClient ? 1 : 2).forEach(f => data[toCamelCase(f)] = dom[toCamelCase(`${formType}-${f}`)]?.value.trim() || null); const id = dom[toCamelCase(`${formType}-id`)]?.value; const clientId = isClient ? id : dom.contactClientId.value; const modalId = `${formType}-modal`; try { if (isClient) { if (id) await updateClient(currentUser.uid, id, data); else await addClient(currentUser.uid, data); } else { if (id) await updateContact(currentUser.uid, id, data); else await addContact(currentUser.uid, clientId, data); } showStatus(`${isClient ? '取引先' : '担当者'}情報を${id ? '更新' : '登録'}しました。`); closeModal(modalId); } catch (error) { showStatus(`エラー: ${error.message}`, true); } finally { toggleLoading(false); } }

// --- Rendering Logic ---
const renderAllColumns = () => {
    renderClientsColumn();
    renderContactsColumn();
    renderContactDetailsColumn();
};

const renderClientsColumn = () => {
    if (!dom.clientsColumn) return;
    const listHtml = clientsData.length === 0 ? '<p class="p-4 text-sm text-gray-500">取引先がありません。</p>' :
        clientsData.map(client => `
            <div class="p-4 border-b cursor-pointer hover:bg-gray-100 column-item ${client.id === selectedClientId ? 'active' : ''}" data-client-id="${client.id}">
                <p class="font-semibold text-gray-800">${client.name}</p>
                <p class="text-sm text-gray-500">${client.contacts?.length || 0}人の担当者</p>
            </div>`).join('');
    dom.clientsColumn.innerHTML = `<div class="column-header"><h2>取引先</h2></div><div class="flex-1 overflow-y-auto">${listHtml}</div>`;
};

const renderContactsColumn = () => {
    if (!dom.contactsColumn) return;
    const client = clientsData.find(c => c.id === selectedClientId);
    if (!client) {
        dom.contactsColumn.classList.add('hidden');
        return;
    }
    dom.contactsColumn.classList.remove('hidden');
    const contactsListHtml = (client.contacts?.length > 0) ? client.contacts.map(c => `
        <div class="p-4 border-b cursor-pointer hover:bg-gray-100 column-item ${c.id === selectedContactId ? 'active' : ''}" data-contact-id="${c.id}" data-client-id="${client.id}">
            <p class="font-semibold text-gray-800">${c.name}</p><p class="text-sm text-gray-500">${c.department || ''} ${c.title || ''}</p>
        </div>`).join('') : '<p class="p-4 text-sm text-gray-500">担当者がいません。</p>';

    dom.contactsColumn.innerHTML = `
        <div class="column-header">
            <h2 class="truncate" title="${client.name}">${client.name}</h2>
            <button class="close-column-btn" data-column-to-close="2" title="閉じる">&times;</button>
        </div>
        <div class="flex-1 overflow-y-auto">
            <div class="section-header">
                <h3>取引先情報</h3>
                <div>
                    <button class="action-btn edit edit-client-btn" data-client-id="${client.id}">編集</button>
                    <button class="action-btn delete delete-client-btn" data-client-id="${client.id}">削除</button>
                </div>
            </div>
            <dl class="detail-grid text-xs">
                <dt>カナ:</dt><dd>${client.nameKana || '-'}</dd>
                <dt>英名:</dt><dd>${client.nameEn || '-'}</dd>
                <dt>法人番号:</dt><dd>${client.corporateNumber || '-'}</dd>
                <dt>請求書番号:</dt><dd>${client.invoiceNumber || '-'}</dd>
                <dt>住所:</dt><dd>${client.address || '-'}</dd>
                <dt>URL:</dt><dd>${client.url ? `<a href="${client.url.startsWith('http') ? client.url : `https://${client.url}`}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${client.url}</a>` : '-'}</dd>
            </dl>
            <div class="section-header">
                <h3>担当者</h3>
                <button class="action-btn add add-contact-btn" data-client-id="${client.id}">追加</button>
            </div>
            <div class="contacts-list">${contactsListHtml}</div>
        </div>`;
};

const renderContactDetailsColumn = () => {
    if (!dom.contactDetailsColumn) return;
    const client = clientsData.find(c => c.id === selectedClientId);
    const contact = client?.contacts.find(p => p.id === selectedContactId);
    if (!contact) {
        dom.contactDetailsColumn.classList.add('hidden');
        return;
    }
    dom.contactDetailsColumn.classList.remove('hidden');
    dom.contactDetailsColumn.innerHTML = `
        <div class="column-header">
            <div class="flex-1 min-w-0">
                <h2 class="truncate" title="${contact.name}">${contact.name}</h2>
                <p class="text-xs text-gray-500 truncate">${contact.department || ''} ${contact.title || ''}</p>
            </div>
            <div class="flex-shrink-0 ml-4">
                 <button class="action-btn edit edit-contact-btn" data-contact-id="${contact.id}" data-client-id="${client.id}">編集</button>
                 <button class="action-btn delete delete-contact-btn" data-contact-id="${contact.id}">削除</button>
            </div>
            <button class="close-column-btn flex-shrink-0 ml-2" data-column-to-close="3" title="閉じる">&times;</button>
        </div>
        <div class="flex-1 overflow-y-auto">
             <dl class="detail-grid text-sm">
                <dt>カナ:</dt><dd>${contact.nameKana || '-'}</dd>
                <dt>英語名:</dt><dd>${contact.nameEn || '-'}</dd>
                <dt>Email:</dt><dd>${contact.email ? `<a href="mailto:${contact.email}" class="text-blue-600 hover:underline">${contact.email}</a>` : '-'}</dd>
                <dt>電話番号:</dt><dd>${contact.phone || '-'}</dd>
                <dt>メモ:</dt><dd class="whitespace-pre-wrap">${contact.memo || '-'}</dd>
            </dl>
        </div>`;
};


// --- Initialization ---
const setupEventListeners = () => {
    document.querySelector('.columns-container')?.addEventListener('click', handleColumnClick);
    dom.openAddClientModal?.addEventListener('click', () => openClientModal());
    dom.clientForm?.addEventListener('submit', (e) => handleFormSubmit(e, 'client'));
    dom.contactForm?.addEventListener('submit', (e) => handleFormSubmit(e, 'contact'));
    dom.openImportModalBtn?.addEventListener('click', () => openModal('import-modal'));
    dom.openExportModalBtn?.addEventListener('click', () => openModal('export-modal'));
    dom.downloadTemplateBtn?.addEventListener('click', downloadCSVTemplate);
    dom.exportExecuteBtn?.addEventListener('click', handleExport);
    dom.importExecuteBtn?.addEventListener('click', handleImport);
    dom.csvFileInput?.addEventListener('change', () => { dom.importExecuteBtn.disabled = !dom.csvFileInput.files.length; });
    setupModalClosers();
};

const listenForData = () => { toggleLoading(true); getClientsAndContacts(currentUser.uid, (data) => { clientsData = data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja')); renderAllColumns(); toggleLoading(false); }); };
export function initClientsPage(user) { if (!user || !document.getElementById('clients-column')) return; currentUser = user; cacheDOMElements(); setupEventListeners(); listenForData(); }

// --- CSV Functions ---
const downloadCSVTemplate = () => { const headers = ["clientName", "clientNameKana", "clientNameEn", "corporateNumber", "invoiceNumber", "url", "address", "clientMemo", "contactName", "contactNameKana", "contactNameEn", "email", "phone", "department", "title", "contactMemo"]; const bom = "\uFEFF"; const csvContent = "data:text/csv;charset=utf-8," + bom + headers.join(","); const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", "import_template.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link); };
const handleExport = () => { toggleLoading(true); const exportType = dom.exportTypeSelect.value; const bom = new Uint8Array([0xEF, 0xBB, 0xBF]); const formatCsvField = (field) => { const str = String(field || ''); if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`; return str; }; let csvRows = [], headers = []; if (exportType === 'clients') { headers = clientFormFields.slice(1).map(toCamelCase); csvRows = clientsData.map(c => headers.map(h => formatCsvField(c[h])).join(',')); } else { const clientHeaders = clientFormFields.slice(1).map(f => `client_${f}`).map(toCamelCase); const contactHeaders = contactFormFields.slice(2).map(f => `contact_${f}`).map(toCamelCase); headers = [...clientHeaders, ...contactHeaders]; clientsData.forEach(client => { const clientRow = clientFormFields.slice(1).map(toCamelCase).map(h => formatCsvField(client[h])); if (client.contacts && client.contacts.length > 0) { client.contacts.forEach(contact => { const contactRow = contactFormFields.slice(2).map(toCamelCase).map(h => formatCsvField(contact[h])); csvRows.push([...clientRow, ...contactRow].join(',')); }); } else { const emptyContactRow = contactFormFields.slice(2).map(() => ''); csvRows.push([...clientRow, ...emptyContactRow].join(',')); } }); } const headerRow = headers.map(h => h.replace(/([A-Z])/g, '_$1').toLowerCase()).join(','); const csvContent = [headerRow, ...csvRows].join('\n'); const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `${exportType}_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); toggleLoading(false); closeModal('export-modal'); showStatus('データをエクスポートしました。'); };
const handleImport = () => { const file = dom.csvFileInput.files[0]; if (!file) return showStatus('ファイルが選択されていません。', true); toggleLoading(true); const reader = new FileReader(); reader.onload = async (e) => { try { const lines = e.target.result.split(/\r\n|\n/).filter(line => line.trim() !== ''); if (lines.length < 2) throw new Error('CSVにはヘッダーとデータ行が必要です。'); const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '')); const dataRows = lines.slice(1); const newClients = new Map(), newContacts = [], existingClientNames = new Set(clientsData.map(c => c.name)); dataRows.forEach(row => { const values = row.split(',').map(v => v.trim().replace(/"/g, '')); const record = headers.reduce((obj, h, i) => { obj[toCamelCase(h)] = values[i] || null; return obj; }, {}); if (record.clientName && !existingClientNames.has(record.clientName) && !newClients.has(record.clientName)) { newClients.set(record.clientName, { name: record.clientName, nameKana: record.clientNameKana, nameEn: record.clientNameEn, corporateNumber: record.corporateNumber, invoiceNumber: record.invoiceNumber, url: record.url, address: record.address, memo: record.clientMemo }); } if (record.contactName && record.clientName) { newContacts.push({ clientName: record.clientName, name: record.contactName, nameKana: record.contactNameKana, nameEn: record.contactNameEn, email: record.email, phone: record.phone, department: record.department, title: record.title, memo: record.contactMemo }); } }); const clientsToCreate = Array.from(newClients.values()); if (clientsToCreate.length === 0 && newContacts.length === 0) throw new Error('インポートする新規データがありません。'); await batchCreateClientsAndContacts(currentUser.uid, clientsToCreate, newContacts); showStatus(`インポート完了: ${clientsToCreate.length}件の新規取引先と${newContacts.length}件の担当者が処理されました。`); closeModal('import-modal'); dom.csvFileInput.value = ''; dom.importExecuteBtn.disabled = true; } catch (error) { showStatus(`インポートエラー: ${error.message}`, true, 8000); } finally { toggleLoading(false); } }; reader.readAsText(file, 'UTF-8'); };