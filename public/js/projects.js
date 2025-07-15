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
        'tableBody', 'projectModal', 'projectForm', 'modalTitle', 'statusFilter', 'projectId', 
        'projectName', 'projectCode', 'isActive', 'isActiveLabel', 'contractType', 'unitPrice', 
        'monthlyFixedRate', 'billingCycle', 'calculationMethod', 'billingStartDate', 'billingEndDate', 
        'monthlyBaseHours', 'billingAdjustmentType', 'monthlyMinHours', 'monthlyMaxHours'
    ];
    ids.forEach(id => {
        const snakeCaseId = id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        domElements[id] = document.getElementById(snakeCaseId);
    });
    
    // このページの要素がなければ(他のページでこのJSが誤って呼ばれても)処理を中断
    if (!domElements.tableBody) return; 

    document.getElementById('open-add-project-modal').addEventListener('click', () => openProjectModal());
    domElements.projectForm.addEventListener('submit', handleFormSubmit);
    domElements.tableBody.addEventListener('click', handleTableClick);
    domElements.statusFilter.addEventListener('change', listenForProjects);
    domElements.isActive.addEventListener('change', updateIsActiveLabel);
    
    setupModalClosers('project-modal');
    listenForProjects();
};

const listenForProjects = () => {
    toggleLoading(true);
    if (unsubscribeProjects) unsubscribeProjects();
    unsubscribeProjects = getProjects(currentUser.uid, domElements.statusFilter.value, (projects) => {
        allProjects = projects;
        renderProjects(projects);
        toggleLoading(false);
    });
};

const openProjectModal = (project = null) => {
    domElements.projectForm.reset();
    domElements.projectCode.disabled = false;
    if (project) { // --- 編集モード ---
        domElements.modalTitle.textContent = 'プロジェクトを編集';
        originalProjectName = project.name;
        // DBから取得した値をフォームの各要素に設定
        Object.keys(domElements).forEach(key => {
            const element = domElements[key];
            if (element && project[key] !== undefined && element.id !== 'project-form' && element.tagName !== 'BUTTON') {
                if(element.type === 'checkbox') element.checked = project[key];
                else element.value = project[key] || '';
            }
        });
        domElements.projectId.value = project.id;
        domElements.projectCode.disabled = true;
    } else { // --- 新規モード ---
        domElements.modalTitle.textContent = 'プロジェクトを追加';
        originalProjectName = '';
        domElements.isActive.checked = true;
        // 新規作成時のデフォルト値
        domElements.contractType.value = 'hourly';
        domElements.billingCycle.value = '1';
        domElements.calculationMethod.value = 'floor';
    }
    updateIsActiveLabel();
    openModal('project-modal');
};

const handleFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);
    const projectData = {};
    Object.keys(domElements).forEach(key => {
        const element = domElements[key];
        if (element?.id && element.tagName !== 'FORM' && element.tagName !== 'BUTTON') {
            let value = element.type === 'checkbox' ? element.checked : element.value;
            if(typeof value === 'string') value = value.trim();
            projectData[key] = value;
        }
    });
    ['unitPrice', 'monthlyFixedRate', 'billingCycle', 'monthlyBaseHours', 'monthlyMinHours', 'monthlyMaxHours'].forEach(key => {
        projectData[key] = Number(projectData[key]) || 0;
    });
    projectData.name = domElements.projectName.value.trim();
    projectData.code = domElements.projectCode.value.trim();
    try {
        if (projectData.projectId) {
            await updateProject(currentUser.uid, projectData.projectId, projectData);
            if (projectData.name !== originalProjectName) {
                showStatus('稼働履歴のプロジェクト名を更新中です...', false, 4000);
                await updateProjectNameInTimestamps(currentUser.uid, projectData.code, projectData.name);
            }
            showStatus('プロジェクトを更新しました。', false);
        } else {
            const codeExists = allProjects.some(p => p.code === projectData.code);
            if (codeExists) throw new Error(`プロジェクトコード '${projectData.code}' は既に使用されています。`);
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
        return;
    }
    openProjectModal(project);
};

const handleDeleteProject = async (project) => {
    toggleLoading(true);
    const inUse = await isProjectInUse(currentUser.uid, project.code);
    toggleLoading(false);
    if (inUse) {
        showStatus(`「${project.name}」には稼働実績があるため削除できません。`, true);
        return;
    }
    const confirmed = await showConfirmModal('プロジェクト削除', `「${project.name}」を本当に削除しますか？`);
    if (confirmed) {
        toggleLoading(true);
        try {
            await deleteProject(currentUser.uid, project.id);
            showStatus('プロジェクトを削除しました。', false);
        } catch (error) {
            showStatus('削除中にエラーが発生しました。', true);
        } finally {
            toggleLoading(false);
        }
    }
};

const updateIsActiveLabel = () => {
    if(domElements.isActiveLabel) {
        domElements.isActiveLabel.textContent = domElements.isActive.checked ? '有効' : '無効';
    }
};

const renderProjects = (projects) => {
    if (!domElements.tableBody) return;
    domElements.tableBody.innerHTML = '';
    if (projects.length === 0) {
        domElements.tableBody.innerHTML = '<tr><td colspan="4" class="text-center p-8">対象のプロジェクトがありません。</td></tr>';
        return;
    }
    projects.forEach(project => {
        const statusClass = project.isActive ? 'text-green-600' : 'text-gray-400';
        const statusText = project.isActive ? '有効' : '無効';
        const row = document.createElement('tr');
        row.className = 'bg-white border-b hover:bg-gray-50 clickable-row';
        row.dataset.id = project.id;
        row.innerHTML = `
            <td class="px-6 py-4 font-medium text-gray-900">${project.name}</td>
            <td class="px-6 py-4">${project.code}</td>
            <td class="px-6 py-4 font-semibold ${statusClass}">${statusText}</td>
            <td class="px-6 py-4 text-right">
                <button class="delete-btn font-medium text-red-600 hover:underline">削除</button>
            </td>
        `;
        domElements.tableBody.appendChild(row);
    });
};