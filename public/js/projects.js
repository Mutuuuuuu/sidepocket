import { getProjects, addProject, updateProject, deleteProject, isProjectInUse, updateProjectNameInTimestamps } from './services/firestoreService.js';
import { toggleLoading, showStatus, openModal, closeModal, setupModalClosers, showConfirmModal } from './services/uiService.js';

let currentUser;
let allProjects = [];
let unsubscribeProjects = null;
let originalProjectName = '';
const domElements = {};

export const initProjectsPage = (user) => {
    currentUser = user;
    
    // ページに必要なDOM要素をまとめて取得
    const ids = [
        'projects-table-body', 'project-modal', 'project-form', 'modal-title', 'status-filter', 'project-id',
        'project-name', 'project-code', 'project-is-active', 'is-active-label', 'contract-type', 'unit-price',
        'monthly-fixed-rate', 'billing-cycle', 'calculation-method', 'billing-start-date', 'billing-end-date',
        'monthly-base-hours', 'billing-adjustment-type', 'monthly-min-hours', 'monthly-max-hours'
    ];
    // DOM要素をまとめて取得 (idをそのまま使用するように変更)
    ids.forEach(id => {
        domElements[id.replace(/-/g, '_')] = document.getElementById(id);
    });
    
    // このページの要素がなければ(他のページでこのJSが誤って呼ばれても)処理を中断
    if (!domElements.projects_table_body) return; 

    document.getElementById('open-add-project-modal').addEventListener('click', () => openProjectModal());
    domElements.project_form.addEventListener('submit', handleFormSubmit);
    domElements.projects_table_body.addEventListener('click', handleTableClick);
    domElements.status_filter.addEventListener('change', listenForProjects);
    domElements.project_is_active.addEventListener('change', updateIsActiveLabel);
    
    setupModalClosers('project-modal');
    listenForProjects();
};

const listenForProjects = () => {
    toggleLoading(true);
    if (unsubscribeProjects) unsubscribeProjects();
    unsubscribeProjects = getProjects(currentUser.uid, domElements.status_filter.value, (projects) => {
        allProjects = projects;
        renderProjects(projects);
        toggleLoading(false);
    });
};

const openProjectModal = (project = null) => {
    domElements.project_form.reset();
    domElements.project_code.disabled = false;
    if (project) { // --- 編集モード ---
        domElements.modal_title.textContent = 'プロジェクトを編集';
        originalProjectName = project.name;
        // DBから取得した値をフォームの各要素に設定
        // キー名をスネークケースからキャメルケースに変換して照合
        const projectDataForForm = {};
        for (const key in project) {
            const camelCaseKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
            projectDataForForm[camelCaseKey] = project[key];
        }

        for (const key in domElements) {
             const element = domElements[key];
             const camelKey = key.replace(/_([a-z])/g, g => g[1].toUpperCase());
             if (element && project[camelKey] !== undefined && element.id !== 'project-form' && element.tagName !== 'BUTTON') {
                 if(element.type === 'checkbox') element.checked = project[camelKey];
                 else element.value = project[camelKey] || '';
             }
        }
        domElements.project_id.value = project.id;
        domElements.project_code.disabled = true;

    } else { // --- 新規モード ---
        domElements.modal_title.textContent = 'プロジェクトを追加';
        originalProjectName = '';
        domElements.project_is_active.checked = true;
        // 新規作成時のデフォルト値
        domElements.contract_type.value = 'hourly';
        domElements.billing_cycle.value = '1';
        domElements.calculation_method.value = 'floor';
    }
    updateIsActiveLabel();
    openModal('project-modal');
};

const handleFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);

    const formData = new FormData(domElements.project_form);
    const projectData = {};

    for(const [key, value] of formData.entries()) {
        const element = document.getElementById(key);
        if (element && element.type === 'checkbox') {
            projectData[key] = element.checked;
        } else {
             projectData[key] = typeof value === 'string' ? value.trim() : value;
        }
    }
    
    // 数値に変換すべきフィールド
    ['unit_price', 'monthly_fixed_rate', 'billing_cycle', 'monthly_base_hours', 'monthly_min_hours', 'monthly_max_hours'].forEach(key => {
        const snakeKey = key.replace(/-/g, '_');
        projectData[snakeKey] = Number(projectData[snakeKey]) || 0;
    });

    const projectId = domElements.project_id.value;

    try {
        if (projectId) { // 更新
            await updateProject(currentUser.uid, projectId, projectData);
            if (projectData['project-name'] !== originalProjectName) {
                showStatus('稼働履歴のプロジェクト名を更新中です...', false, 4000);
                await updateProjectNameInTimestamps(currentUser.uid, projectData['project-code'], projectData['project-name']);
            }
            showStatus('プロジェクトを更新しました。', false);
        } else { // 新規作成
            const code = projectData['project-code'];
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
        handleDeleteProject(project);
        return; // 削除ボタンが押されたら編集モーダルは開かない
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
    if(domElements.is_active_label) {
        domElements.is_active_label.textContent = domElements.project_is_active.checked ? '有効' : '無効';
    }
};

const renderProjects = (projects) => {
    if (!domElements.projects_table_body) return;

    domElements.projects_table_body.innerHTML = '';
    
    if (projects.length === 0) {
        domElements.projects_table_body.innerHTML = '<tr><td colspan="4" class="text-center p-8 text-gray-500">対象のプロジェクトがありません。</td></tr>';
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
        domElements.projects_table_body.appendChild(row);
    });
};