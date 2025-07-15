import { getProjects, getActiveClockIn, getRecentTimestamps, clockIn, clockOut } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

let currentUser;
let activeClockInDoc = null;
let projects = [];

// --- DOM要素 ---
let punchButton, punchStatusDisplay, punchProjectDisplay, recordsContainer;
let projectSelectionArea, projectSelectMain, liveClockElement;

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

    if (!punchButton) return;

    // イベントリスナーを設定
    punchButton.addEventListener('click', handlePunchButtonClick);
    
    // 時計の表示を開始
    updateClock();
    setInterval(updateClock, 1000);
    
    // ▼▼▼ 修正箇所 ▼▼▼
    // 全てのデータ読み込みを待ってからローディングを解除
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
        toggleLoading(false); // 全ての処理が終わった後にローディングを解除
    }
};

const updateClock = () => {
    if (liveClockElement) {
        liveClockElement.textContent = new Date().toLocaleTimeString('ja-JP');
    }
};

// ▼▼▼ 修正箇所 ▼▼▼
// Promiseを返すように変更
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
            // この関数は継続的に監視するため、初回取得時に resolve する
            resolve();
        });
    });
};

// ▼▼▼ 修正箇所 ▼▼▼
// Promiseを返すように変更
const listenForActiveClockIn = () => {
    return new Promise((resolve) => {
        getActiveClockIn(currentUser.uid, (doc) => {
            activeClockInDoc = doc;
            updatePunchUI(doc);
            resolve();
        });
    });
};

// ▼▼▼ 修正箇所 ▼▼▼
// Promiseを返すように変更
const listenForRecentRecords = () => {
    return new Promise((resolve) => {
        getRecentTimestamps(currentUser.uid, 5, (records) => {
            renderPunchRecords(records);
            resolve();
        });
    });
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