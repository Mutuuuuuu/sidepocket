import { getProjects, getActiveClockIn, getRecentTimestamps, clockIn, clockOut, updateTimestamp } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

let currentUser;
let activeClockInDoc = null;
let projects = [];

// --- DOM要素 ---
let punchButton, punchStatusDisplay, punchProjectDisplay, recordsContainer;
let projectSelectionArea, projectSelectMain, liveClockElement;
let clockOutDetailsModal, clockOutDetailsForm, clockOutTimestampId, skipDetailsButton;


export const initHomePage = async (user) => { // asyncを追加
    if (!user) return;
    currentUser = user;

    // DOM要素を取得
    punchButton = document.getElementById('punch-button');
    punchStatusDisplay = document.getElementById('punch-status-display');
    punchProjectDisplay = document.getElementById('punch-project-display');
    recordsContainer = document.getElementById('punch-records-container');
    projectSelectionArea = document.getElementById('project-selection-area');
    projectSelectMain = document.getElementById('project-select-main');
    liveClockElement = document.getElementById('live-clock');
    clockOutDetailsModal = document.getElementById('clock-out-details-modal');
    clockOutDetailsForm = document.getElementById('clock-out-details-form');
    clockOutTimestampId = document.getElementById('clock-out-timestamp-id');
    skipDetailsButton = document.getElementById('skip-details-button');

    if (!punchButton) return;

    // イベントリスナーを設定
    punchButton.addEventListener('click', handlePunchButtonClick);
    clockOutDetailsForm.addEventListener('submit', handleDetailsFormSubmit);
    skipDetailsButton.addEventListener('click', () => clockOutDetailsModal.classList.add('hidden'));
    
    // 時計の表示を開始
    updateClock();
    setInterval(updateClock, 1000);
    
    try {
        await Promise.all([
            loadActiveProjects(),
            listenForActiveClockIn(),
            listenForRecentRecords()
        ]);
    } catch (error) {
        console.error("ホームページの初期化中にエラーが発生しました:", error);
        showStatus('ページの読み込みに失敗しました。', true);
    } finally {
        toggleLoading(false);
    }
};

const updateClock = () => {
    if (liveClockElement) {
        liveClockElement.textContent = new Date().toLocaleTimeString('ja-JP');
    }
};

const loadActiveProjects = () => {
    return new Promise((resolve) => {
        const unsubscribe = getProjects(currentUser.uid, 'active', (activeProjects) => {
            projects = activeProjects;
            if (projectSelectMain) {
                projectSelectMain.innerHTML = projects.length === 0 
                    ? '<option value="">打刻可能なプロジェクトがありません</option>' 
                    : '<option value="">プロジェクトを選択してください</option>';
                
                projects.forEach(p => {
                    projectSelectMain.innerHTML += `<option value="${p.id}">${p.name}</option>`;
                });
            }
            resolve();
        });
    });
};

const listenForActiveClockIn = () => {
    return new Promise((resolve) => {
        getActiveClockIn(currentUser.uid, (doc) => {
            activeClockInDoc = doc;
            updatePunchUI(doc);
            resolve();
        });
    });
};

const listenForRecentRecords = () => {
    return new Promise((resolve) => {
        getRecentTimestamps(currentUser.uid, 5, (records) => {
            renderPunchRecords(records);
            resolve();
        });
    });
};

// ▼▼▼ この関数を修正 ▼▼▼
const handlePunchButtonClick = async () => {
    punchButton.disabled = true;
    if (activeClockInDoc) {
        // 退勤処理の前に、更新対象のドキュメントIDをローカル変数に保持しておく
        const docIdToUpdate = activeClockInDoc.id;
        try {
            await clockOut(currentUser.uid, docIdToUpdate);
            showStatus('退勤しました。お疲れ様でした！', false);
            // 保持しておいたIDを使ってモーダルを開く
            openDetailsModal(docIdToUpdate);
        } catch (error) {
            console.error("退勤処理エラー:", error);
            showStatus('退勤処理中にエラーが発生しました。', true);
            punchButton.disabled = false; // エラー時はボタンを再度有効化
        }
    } else {
        const selectedProjectId = projectSelectMain.value;
        if (!selectedProjectId) {
            showStatus('プロジェクトを選択してください。', true);
            punchButton.disabled = false;
            return;
        }
        const selectedProject = projects.find(p => p.id === selectedProjectId);
        const projectData = { id: selectedProject.id, name: selectedProject.name, code: selectedProject.code };
        try {
            await clockIn(currentUser.uid, projectData);
            showStatus('出勤しました。おはようございます！', false);
        } catch (error) {
            showStatus('出勤処理中にエラーが発生しました。', true);
            punchButton.disabled = false; // エラー時はボタンを再度有効化
        }
    }
};
// ▲▲▲ ここまで修正 ▲▲▲

const openDetailsModal = (timestampId) => {
    clockOutDetailsForm.reset();
    clockOutTimestampId.value = timestampId;
    clockOutDetailsModal.classList.remove('hidden');
};

const handleDetailsFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);
    const timestampId = clockOutTimestampId.value;
    const memo = document.getElementById('clock-out-memo').value.trim();
    const categories = Array.from(document.querySelectorAll('#clock-out-category-options input:checked')).map(cb => cb.value);

    try {
        await updateTimestamp(currentUser.uid, timestampId, { memo, categories });
        showStatus('作業内容を保存しました。');
        clockOutDetailsModal.classList.add('hidden');
    } catch (error) {
        showStatus('作業内容の保存に失敗しました。', true);
    } finally {
        toggleLoading(false);
    }
};

const updatePunchUI = (doc) => {
    if (!punchButton) return;
    punchButton.disabled = false;
    if (doc) {
        projectSelectionArea.classList.add('hidden');
        punchStatusDisplay.textContent = '出勤中';
        punchProjectDisplay.textContent = doc.project.name;
        punchButton.textContent = '退勤';
        punchButton.className = 'w-full text-white font-bold py-4 px-4 rounded-lg text-2xl transition duration-300 bg-red-600 hover:bg-red-700';
    } else {
        projectSelectionArea.classList.remove('hidden');
        punchStatusDisplay.textContent = '未打刻';
        punchProjectDisplay.textContent = '';
        punchButton.textContent = '出勤';
        punchButton.className = 'w-full text-white font-bold py-4 px-4 rounded-lg text-2xl transition duration-300 bg-green-600 hover:bg-green-700';
    }
};

const renderPunchRecords = (records) => {
    if (!recordsContainer) return;
    recordsContainer.innerHTML = records.length === 0 ? '<li class="p-4 text-center text-gray-500">稼働履歴はありません。</li>' : '';
    records.forEach(record => {
        const li = document.createElement('li');
        li.className = 'px-4 py-3 flex items-center justify-between text-sm';
        
        const clockIn = record.clockInTime ? record.clockInTime.toDate().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const clockOut = record.clockOutTime ? record.clockOutTime.toDate().toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : '...';
        const typeText = record.status === 'active' ? '出勤中' : '完了';
        const typeColor = record.status === 'active' ? 'text-green-600' : 'text-gray-500';

        li.innerHTML = `
            <div class="flex-1 truncate pr-4">
                <span class="font-semibold text-gray-800">${record.project.name}</span>
            </div>
            <div class="flex items-center flex-shrink-0">
                <span class="w-12 text-center text-xs ${typeColor}">${typeText}</span>
                <div class="w-40 text-right text-xs text-gray-600 ml-2" style="font-feature-settings: 'tnum';">
                    <span>${clockIn}</span>
                    <span class="mx-1">-</span>
                    <span>${clockOut}</span>
                </div>
            </div>
        `;
        recordsContainer.appendChild(li);
    });
};