import {
    getProjects,
    addProject,
    updateProject,
    deleteProject,
    isProjectInUse,
    updateProjectNameInTimestamps,
    getActiveClients
} from './services/firestoreService.js';
import { toggleLoading, showStatus, openModal, closeModal, setupModalClosers, showConfirmModal } from './services/uiService.js';

let currentUser;
let allProjects = [];
let allClients = [];
let originalProjectName = '';
const domElements = {};

let currentSort = { key: 'createdAt', direction: 'desc' };

const elementIds = [
    'projects-table-body', 'project-modal', 'project-form', 'modal-title', 'status-filter',
    'project-id', 'project-name', 'project-code', 'project-is-active', 'is-active-label',
    'contract-type', 'unit-price', 'monthly-fixed-rate', 'billing-cycle', 'calculation-method',
    'billing-start-date', 'billing-end-date', 'monthly-base-hours', 'billing-adjustment-type',
    'monthly-min-hours', 'monthly-max-hours', 'project-client'
];

const getContractTypeName = (type) => ({ hourly: '時間単価', monthly: '月額固定' }[type] || '未設定');
const getCalculationMethodName = (method) => ({ floor: '切り捨て', round: '四捨五入', ceil: '切り上げ' }[method] || '未設定');
const formatYen = (amount) => `¥${Number(amount || 0).toLocaleString()}`;

const getRateDetails = (project) => {
    if (project.contractType === 'hourly') {
        return `<dt class="font-medium text-gray-500">時給単価</dt><dd class="text-gray-900">${formatYen(project.unitPrice)}</dd>`;
    }
    if (project.contractType === 'monthly') {
        return `
            <dt class="font-medium text-gray-500">固定単価</dt>
            <dd class="text-gray-900">${formatYen(project.monthlyFixedRate)}</dd>
            <dt class="font-medium text-gray-500">基準時間</dt>
            <dd class="text-gray-900">${project.monthlyBaseHours || 'N/A'} h</dd>
            <dt class="font-medium text-gray-500">対象時間(下限)</dt>
            <dd class="text-gray-900">${project.monthlyMinHours || 'N/A'} h</dd>
            <dt class="font-medium text-gray-500">対象時間(上限)</dt>
            <dd class="text-gray-900">${project.monthlyMaxHours || 'N/A'} h</dd>
        `;
    }
    return '';
};

export const initProjectsPage = async (user) => {
    currentUser = user;
    elementIds.forEach(id => { domElements[id] = document.getElementById(id); });
    if (!domElements['projects-table-body']) return;

    // 先に取引先リストを取得
    try {
        allClients = await getActiveClients(currentUser.uid);
    } catch (error) {
        showStatus('取引先リストの読み込みに失敗しました。', true);
        console.error("Failed to load clients:", error);
    }

    document.getElementById('open-add-project-modal').addEventListener('click', () => openProjectModal());
    document.querySelector('thead').addEventListener('click', handleSortClick);
    domElements['project-form'].addEventListener('submit', handleFormSubmit);
    domElements['projects-table-body'].addEventListener('click', handleTableClick);
    domElements['status-filter'].addEventListener('change', listenForProjects);
    domElements['project-is-active'].addEventListener('change', updateIsActiveLabel);

    setupModalClosers('project-modal');
    listenForProjects();
};

const listenForProjects = () => {
    toggleLoading(true);
    getProjects(currentUser.uid, domElements['status-filter'].value, (projects) => {
        allProjects = projects;
        renderProjects();
        toggleLoading(false);
    });
};

const renderProjects = () => {
    const tableBody = domElements['projects-table-body'];
    if (!tableBody) return;

    const sorted = [...allProjects].sort((a, b) => {
        const key = currentSort.key;
        if (!key) return 0;
        const direction = currentSort.direction === 'asc' ? 1 : -1;
        
        let valA, valB;
        if (key.includes('.')) {
            const keys = key.split('.');
            valA = (a[keys[0]]?.[keys[1]] || '').toString().toLowerCase();
            valB = (b[keys[0]]?.[keys[1]] || '').toString().toLowerCase();
        } else {
            valA = (a[key] || '').toString().toLowerCase();
            valB = (b[key] || '').toString().toLowerCase();
        }

        return valA.localeCompare(valB) * direction;
    });

    tableBody.innerHTML = '';
    if (sorted.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center p-8 text-gray-500">対象のプロジェクトがありません。</td></tr>';
        return;
    }

    sorted.forEach(project => {
        const statusClass = project.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
        const statusText = project.isActive ? '有効' : '無効';
        const clientName = project.client?.name || '未設定';

        const mainRow = document.createElement('tr');
        mainRow.className = 'bg-white border-b hover:bg-gray-50 clickable-row';
        mainRow.dataset.id = project.id;
        mainRow.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">${project.name}</td>
            <td class="px-6 py-4 text-gray-600">${clientName}</td>
            <td class="px-6 py-4"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span></td>
            <td class="px-6 py-4 text-right">
                <button class="edit-project-btn font-medium text-indigo-600 hover:underline" data-id="${project.id}">編集</button>
                <button class="delete-btn font-medium text-red-600 hover:underline ml-4" data-id="${project.id}">削除</button>
            </td>
        `;

        const detailsRow = document.createElement('tr');
        detailsRow.className = 'project-details hidden bg-gray-50';
        detailsRow.dataset.detailsFor = project.id;
        detailsRow.innerHTML = `<td colspan="5" class="p-6 border-b">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                <div>
                    <h4 class="font-bold text-gray-800 mb-2">契約・報酬設定</h4>
                    <dl class="grid grid-cols-2 gap-y-1">${getRateDetails(project)}</dl>
                </div>
                <div>
                    <h4 class="font-bold text-gray-800 mb-2">契約・清算ルール</h4>
                    <dl class="grid grid-cols-2 gap-y-1">
                        <dt class="font-medium text-gray-500">取引先</dt><dd class="text-gray-900">${clientName}</dd>
                        <dt class="font-medium text-gray-500">契約開始日</dt><dd class="text-gray-900">${project.billingStartDate || '未設定'}</dd>
                        <dt class="font-medium text-gray-500">契約終了日</dt><dd class="text-gray-900">${project.billingEndDate || '未設定'}</dd>
                        <dt class="font-medium text-gray-500">稼働単位</dt><dd class="text-gray-900">${project.billingCycle} 分</dd>
                        <dt class="font-medium text-gray-500">端数処理</dt><dd class="text-gray-900">${getCalculationMethodName(project.calculationMethod)}</dd>
                    </dl>
                </div>
            </div>
        </td>`;

        tableBody.appendChild(mainRow);
        tableBody.appendChild(detailsRow);
    });
    updateSortHeaders();
};

const handleSortClick = (e) => {
    const header = e.target.closest('[data-sort-by]');
    if (!header) return;
    const sortKey = header.dataset.sortBy;
    if (currentSort.key === sortKey) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.key = sortKey;
        currentSort.direction = 'asc';
    }
    renderProjects();
};

const updateSortHeaders = () => {
    document.querySelectorAll('th[data-sort-by]').forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        th.classList.remove('sort-asc', 'sort-desc');
        indicator.textContent = '';
        if (th.dataset.sortBy === currentSort.key) {
            th.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            indicator.textContent = currentSort.direction === 'asc' ? '▲' : '▼';
        }
    });
};

const openProjectModal = (project = null) => {
    const form = domElements['project-form'];
    form.reset();
    domElements['project-code'].disabled = false;

    // 取引先ドロップダウンを生成
    const clientSelect = domElements['project-client'];
    clientSelect.innerHTML = '<option value="">取引先を選択しない</option>';
    allClients.forEach(c => {
        clientSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });

    if (project) {
        domElements['modal-title'].textContent = 'プロジェクトを編集';
        originalProjectName = project.name;
        form.id.value = project.id || '';
        form.name.value = project.name || '';
        form.code.value = project.code || '';
        form.isActive.checked = project.isActive === true;
        form.billingStartDate.value = project.billingStartDate || '';
        form.billingEndDate.value = project.billingEndDate || '';
        form.contractType.value = project.contractType || 'hourly';
        form.unitPrice.value = project.unitPrice || '';
        form.monthlyFixedRate.value = project.monthlyFixedRate || '';
        form.monthlyBaseHours.value = project.monthlyBaseHours || '';
        form.billingAdjustmentType.value = project.billingAdjustmentType || 'per_item';
        form.monthlyMinHours.value = project.monthlyMinHours || '';
        form.monthlyMaxHours.value = project.monthlyMaxHours || '';
        form.billingCycle.value = project.billingCycle || '1';
        form.calculationMethod.value = project.calculationMethod || 'floor';
        
        // 紐付いている取引先を選択状態にする
        if (project.client && project.client.id) {
            clientSelect.value = project.client.id;
        }

        domElements['project-code'].disabled = true;
    } else {
        domElements['modal-title'].textContent = 'プロジェクトを追加';
        originalProjectName = '';
        domElements['project-is-active'].checked = true;
        form.contractType.value = 'hourly';
        form.billingCycle.value = '1';
        form.calculationMethod.value = 'floor';
    }
    updateIsActiveLabel();
    openModal('project-modal');
};

const handleFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);
    const form = domElements['project-form'];
    const projectId = form.id.value;

    const selectedClientId = form.client.value;
    const selectedClient = allClients.find(c => c.id === selectedClientId);

    const projectData = {
        name: form.name.value.trim(), code: form.code.value.trim(), isActive: form.isActive.checked,
        billingStartDate: form.billingStartDate.value || null, billingEndDate: form.billingEndDate.value || null,
        contractType: form.contractType.value, unitPrice: Number(form.unitPrice.value) || 0,
        monthlyFixedRate: Number(form.monthlyFixedRate.value) || 0, monthlyBaseHours: Number(form.monthlyBaseHours.value) || 0,
        billingAdjustmentType: form.billingAdjustmentType.value, monthlyMinHours: Number(form.monthlyMinHours.value) || 0,
        monthlyMaxHours: Number(form.monthlyMaxHours.value) || 0, billingCycle: Number(form.billingCycle.value) || 1,
        calculationMethod: form.calculationMethod.value,
        client: selectedClient ? { id: selectedClient.id, name: selectedClient.name } : null
    };
    try {
        if (projectId) {
            const dataToUpdate = { ...projectData };
            delete dataToUpdate.id; delete dataToUpdate.code;
            await updateProject(currentUser.uid, projectId, dataToUpdate);
            if (projectData.name !== originalProjectName) {
                await updateProjectNameInTimestamps(currentUser.uid, projectData.code, projectData.name);
            }
            showStatus('プロジェクトを更新しました。', false);
        } else {
            if (allProjects.some(p => p.code === projectData.code)) throw new Error(`プロジェクトコード '${projectData.code}' は既に使用されています。`);
            await addProject(currentUser.uid, projectData);
            showStatus('プロジェクトを追加しました。', false);
        }
        closeModal('project-modal');
    } catch (error) {
        showStatus(error.message, true);
    } finally {
        toggleLoading(false);
    }
};

const handleTableClick = (e) => {
    const row = e.target.closest('tr.clickable-row');
    const deleteButton = e.target.closest('button.delete-btn');
    const editButton = e.target.closest('button.edit-project-btn');

    if (deleteButton) {
        e.stopPropagation();
        const project = allProjects.find(p => p.id === deleteButton.dataset.id);
        if (project) handleDeleteProject(project);
        return;
    }
    if (editButton) {
        e.stopPropagation();
        const project = allProjects.find(p => p.id === editButton.dataset.id);
        if (project) openProjectModal(project);
        return;
    }
    if (row) {
        // クリックされた行以外の詳細を閉じる
        document.querySelectorAll('tr.project-details').forEach(detailsRow => {
            if (detailsRow.dataset.detailsFor !== row.dataset.id) {
                detailsRow.classList.add('hidden');
            }
        });
        // クリックされた行の詳細を開閉する
        const detailsRow = document.querySelector(`tr[data-details-for="${row.dataset.id}"]`);
        if (detailsRow) {
            detailsRow.classList.toggle('hidden');
        }
    }
};

const handleDeleteProject = async (project) => {
    const inUse = await isProjectInUse(currentUser.uid, project.code);
    if (inUse) {
        showStatus(`「${project.name}」には稼働実績があるため削除できません。`, true, 4000);
        return;
    }
    const confirmed = await showConfirmModal('プロジェクト削除', `「${project.name}」を本当に削除しますか？この操作は取り消せません。`);
    if (confirmed) {
        toggleLoading(true);
        try {
            await deleteProject(currentUser.uid, project.id);
            showStatus('プロジェクトを削除しました。', false);
        } catch (error) {
            showStatus(`削除中にエラーが発生しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    }
};

const updateIsActiveLabel = () => {
    if(domElements['is-active-label']) {
        domElements['is-active-label'].textContent = domElements['project-is-active'].checked ? '有効' : '無効';
    }
};