import { getProjects, addProject, updateProject, deleteProject, isProjectInUse, updateProjectNameInTimestamps } from './services/firestoreService.js';
import { toggleLoading, showStatus, openModal, closeModal, setupModalClosers, showConfirmModal } from './services/uiService.js';

let currentUser;
let allProjects = [];
let unsubscribeProjects = null;
let originalProjectName = '';
// DOM要素をキャッシュするオブジェクト
const domElements = {};

// ページで使う要素のIDをリスト化
const elementIds = [
    'projects-table-body', 'project-modal', 'project-form', 'modal-title', 'status-filter', 
    'project-id', 'project-name', 'project-code', 'project-is-active', 'is-active-label', 
    'contract-type', 'unit-price', 'monthly-fixed-rate', 'billing-cycle', 'calculation-method', 
    'billing-start-date', 'billing-end-date', 'monthly-base-hours', 'billing-adjustment-type', 
    'monthly-min-hours', 'monthly-max-hours'
];

export const initProjectsPage = (user) => {
    currentUser = user;
    
    // IDリストからDOM要素を取得してキャッシュ
    elementIds.forEach(id => {
        domElements[id] = document.getElementById(id);
    });
    
    // このページの必須要素がなければ処理を中断
    if (!domElements['projects-table-body']) return; 

    document.getElementById('open-add-project-modal').addEventListener('click', () => openProjectModal());
    domElements['project-form'].addEventListener('submit', handleFormSubmit);
    domElements['projects-table-body'].addEventListener('click', handleTableClick);
    domElements['status-filter'].addEventListener('change', listenForProjects);
    domElements['project-is-active'].addEventListener('change', updateIsActiveLabel);
    
    setupModalClosers('project-modal');
    listenForProjects();
};

const listenForProjects = () => {
    toggleLoading(true);
    if (unsubscribeProjects) unsubscribeProjects();
    
    const filterValue = domElements['status-filter'].value === 'active';
    unsubscribeProjects = getProjects(currentUser.uid, domElements['status-filter'].value, (projects) => {
        allProjects = projects;
        renderProjects(projects);
        toggleLoading(false);
    });
};

const openProjectModal = (project = null) => {
    const form = domElements['project-form'];
    form.reset();
    domElements['project-code'].disabled = false;

    if (project) { // --- 編集モード ---
        domElements['modal-title'].textContent = 'プロジェクトを編集';
        originalProjectName = project.name;
        
        // projectオブジェクトの各キーに対応するフォーム要素に値を設定
        domElements['project-id'].value = project.id || '';
        domElements['project-name'].value = project.name || '';
        domElements['project-code'].value = project.code || '';
        domElements['project-is-active'].checked = project.isActive || false;
        domElements['billing-start-date'].value = project.billingStartDate || '';
        domElements['billing-end-date'].value = project.billingEndDate || '';
        domElements['contract-type'].value = project.contractType || 'hourly';
        domElements['unit-price'].value = project.unitPrice || '';
        domElements['monthly-fixed-rate'].value = project.monthlyFixedRate || '';
        domElements['monthly-base-hours'].value = project.monthlyBaseHours || '';
        domElements['billing-adjustment-type'].value = project.billingAdjustmentType || 'per_item';
        domElements['monthly-min-hours'].value = project.monthlyMinHours || '';
        domElements['monthly-max-hours'].value = project.monthlyMaxHours || '';
        domElements['billing-cycle'].value = project.billingCycle || '1';
        domElements['calculation-method'].value = project.calculationMethod || 'floor';

        domElements['project-code'].disabled = true;

    } else { // --- 新規モード ---
        domElements['modal-title'].textContent = 'プロジェクトを追加';
        originalProjectName = '';
        domElements['project-is-active'].checked = true;
        // 新規作成時のデフォルト値
        domElements['contract-type'].value = 'hourly';
        domElements['billing-cycle'].value = '1';
        domElements['calculation-method'].value = 'floor';
    }
    updateIsActiveLabel();
    openModal('project-modal');
};

const handleFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);

    const formData = new FormData(domElements['project-form']);
    const projectData = {};

    // FormDataからデータを取得し、キャメルケースのキーを持つオブジェクトを生成
    for (const [key, value] of formData.entries()) {
        const element = domElements[key.replace(/([A-Z])/g, "-$1").toLowerCase()]; // HTMLのIDに再変換
        if (element && element.type === 'checkbox') {
            projectData[key] = domElements[key.replace(/-/g, '_')].checked;
        } else {
            projectData[key] = value;
        }
    }
     // isActiveが未チェックの場合、FormDataに含まれないため明示的にfalseを設定
    if (!projectData.isActive) {
        projectData.isActive = false;
    }
    
    // 数値に変換すべきフィールド
    ['unitPrice', 'monthlyFixedRate', 'billingCycle', 'monthlyBaseHours', 'monthlyMinHours', 'monthlyMaxHours'].forEach(key => {
        projectData[key] = Number(projectData[key]) || 0;
    });

    const projectId = projectData.id;

    try {
        if (projectId) { // 更新
            await updateProject(currentUser.uid, projectId, projectData);
            if (projectData.name !== originalProjectName) {
                showStatus('稼働履歴のプロジェクト名を更新中です...', false, 4000);
                await updateProjectNameInTimestamps(currentUser.uid, projectData.code, projectData.name);
            }
            showStatus('プロジェクトを更新しました。', false);
        } else { // 新規作成
            const code = projectData.code;
            const codeExists = allProjects.some(p => p.code === code);
            if (codeExists) throw new Error(`プロジェクトコード '${code}' は既に使用されています。`);
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
    if (!row) return;
    
    const projectId = row.dataset.id;
    const project = allProjects.find(p => p.id === projectId);
    
    if (!project) return;

    if (e.target.closest('button.delete-btn')) {
        e.stopPropagation(); // イベントの伝播を停止
        handleDeleteProject(project);
        return; 
    }
    
    openProjectModal(project);
};

const handleDeleteProject = async (project) => {
    toggleLoading(true);
    const inUse = await isProjectInUse(currentUser.uid, project.code);
    toggleLoading(false);
    
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

const renderProjects = (projects) => {
    const tableBody = domElements['projects-table-body'];
    if (!tableBody) return;

    tableBody.innerHTML = '';
    
    if (projects.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-gray-500">対象のプロジェクトがありません。</td></tr>';
        return;
    }

    projects.forEach(project => {
        const statusClass = project.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
        const statusText = project.isActive ? '有効' : '無効';
        const row = document.createElement('tr');
        row.className = 'bg-white border-b hover:bg-gray-50 cursor-pointer clickable-row';
        row.dataset.id = project.id;

        row.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">${project.name}</td>
            <td class="px-6 py-4 text-gray-600">${project.code}</td>
            <td class="px-6 py-4">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                    ${statusText}
                </span>
            </td>
            <td class="px-6 py-4 text-right">
                <button class="delete-btn font-medium text-red-600 hover:underline focus:outline-none" aria-label="${project.name}を削除">削除</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
};