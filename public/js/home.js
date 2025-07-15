import { getProjects, getActiveClockIn, getRecentTimestamps, clockIn, clockOut } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

let currentUser;
let activeClockInDoc = null;
let projects = [];

// --- DOM要素 ---
let punchButton, punchStatusDisplay, punchProjectDisplay, recordsContainer;
let projectSelectionArea, projectSelectMain, liveClockElement;

export const initHomePage = (user) => {
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

    // home.html以外のページでスクリプトが呼ばれた場合、要素がないので処理を中断
    if (!punchButton) return;

    // イベントリスナーを設定
    punchButton.addEventListener('click', handlePunchButtonClick);

    // データの読み込みと監視を開始
    loadActiveProjects();
    listenForActiveClockIn();
    listenForRecentRecords();
    
    // 時計の表示を開始
    updateClock();
    setInterval(updateClock, 1000);
};

const updateClock = () => {
    if (liveClockElement) {
        liveClockElement.textContent = new Date().toLocaleTimeString('ja-JP');
    }
};

const loadActiveProjects = () => {
    getProjects(currentUser.uid, 'active', (activeProjects) => {
        projects = activeProjects;
        if (projectSelectMain) {
            projectSelectMain.innerHTML = projects.length === 0 
                ? '<option value="">打刻可能なプロジェクトがありません</option>' 
                : '<option value="">プロジェクトを選択してください</option>';
            
            projects.forEach(p => {
                projectSelectMain.innerHTML += `<option value="${p.id}">${p.name}</option>`;
            });
        }
    });
};

const listenForActiveClockIn = () => {
    getActiveClockIn(currentUser.uid, (doc) => {
        activeClockInDoc = doc;
        updatePunchUI(doc);
        toggleLoading(false);
    });
};

const listenForRecentRecords = () => {
    getRecentTimestamps(currentUser.uid, 5, renderPunchRecords);
};

const handlePunchButtonClick = async () => {
    punchButton.disabled = true;
    if (activeClockInDoc) {
        try {
            await clockOut(currentUser.uid, activeClockInDoc.id);
            showStatus('退勤しました。お疲れ様でした！', false);
        } catch (error) {
            showStatus('退勤処理中にエラーが発生しました。', true);
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
        }
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
        li.className = 'px-4 py-3 flex items-center justify-between';
        const clockIn = record.clockInTime ? record.clockInTime.toDate().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const clockOut = record.clockOutTime ? record.clockOutTime.toDate().toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : '...';
        const typeText = record.status === 'active' ? '出勤中' : '完了';
        const typeColor = record.status === 'active' ? 'text-green-600' : 'text-gray-500';
        li.innerHTML = `
            <div class="flex items-center space-x-4 flex-grow">
                <span class="font-semibold text-gray-800 w-40 truncate">${record.project.name}</span>
                <span class="text-sm ${typeColor} w-16 text-center">${typeText}</span>
            </div>
            <div class="text-sm text-gray-600 text-right flex-shrink-0">
                <span>${clockIn}</span><span class="mx-1">-</span><span>${clockOut}</span>
            </div>
        `;
        recordsContainer.appendChild(li);
    });
};