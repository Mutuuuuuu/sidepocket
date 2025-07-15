import { getFirebaseServices } from './services/firebaseService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { getProjects, addCalendarEventsAsTimestamps } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

// --- Google API & OAuth 関連 ---
// 注: このクライアントIDは、Google Cloud Consoleで作成した自身のものに置き換えてください。
//     Firebaseの環境変数に設定し、Cloud Functions経由で取得するのがより安全です。
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com'; 
const GOOGLE_API_KEY = 'YOUR_GOOGLE_API_KEY';
const GOOGLE_DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

let gapi, google;
let tokenClient;
let currentUser;
let allProjects = [];

// --- DOM要素 ---
let authContainer, eventContainer, authorizeButton, signoutButton;
let fetchEventsButton, eventsList, importForm, importSubmitButton;
let startDateInput, endDateInput;


/**
 * カレンダーページの初期化
 * @param {object} user - ログインユーザーオブジェクト
 */
export const initCalendarPage = (user) => {
    currentUser = user;

    // DOM要素の取得
    authContainer = document.getElementById('auth-container');
    eventContainer = document.getElementById('event-container');
    authorizeButton = document.getElementById('authorize-button');
    signoutButton = document.getElementById('signout-button');
    fetchEventsButton = document.getElementById('fetch-events-button');
    eventsList = document.getElementById('events-list');
    importForm = document.getElementById('import-events-form');
    importSubmitButton = document.getElementById('import-submit-button');
    startDateInput = document.getElementById('calendar-start-date');
    endDateInput = document.getElementById('calendar-end-date');
    
    // イベントリスナーの設定
    authorizeButton.addEventListener('click', handleAuthClick);
    signoutButton.addEventListener('click', handleSignoutClick);
    fetchEventsButton.addEventListener('click', handleFetchEvents);
    importForm.addEventListener('submit', handleImportSubmit);
    
    // gapiスクリプトの読み込み完了を待つ
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.onload = gapiLoaded;
    document.body.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.onload = gisLoaded;
    document.body.appendChild(gisScript);

    // 初期日付の設定
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    startDateInput.valueAsDate = firstDay;
    endDateInput.valueAsDate = today;

    // プロジェクト一覧を取得
    getProjects(currentUser.uid, 'active', (projects) => {
        allProjects = projects;
    });

    toggleLoading(false);
};

// --- Google API 初期化 ---
function gapiLoaded() {
    gapi = window.gapi;
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: GOOGLE_API_KEY,
        discoveryDocs: GOOGLE_DISCOVERY_DOCS,
    });
}

function gisLoaded() {
    google = window.google;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: '', // トークン取得後の処理はPromiseでハンドリングするため空
    });
}

// --- 認証フロー ---
function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        // ここでトークンが取得できたのでUIを更新
        updateUiForSignedIn();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            updateUiForSignedOut();
        });
    }
}

function updateUiForSignedIn() {
    authContainer.querySelector('p').textContent = 'Google Calendarと連携済みです。';
    authorizeButton.classList.add('hidden');
    signoutButton.classList.remove('hidden');
    eventContainer.classList.remove('hidden');
}

function updateUiForSignedOut() {
    authContainer.querySelector('p').textContent = 'Google Calendarと連携して、予定を稼働実績として取り込みます。';
    authorizeButton.classList.remove('hidden');
    signoutButton.classList.add('hidden');
    eventContainer.classList.add('hidden');
}


// --- イベント処理 ---
async function handleFetchEvents() {
    const token = gapi.client.getToken();
    if (token === null) {
        showStatus('Google Calendarと連携してください。', true);
        return;
    }

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!startDate || !endDate) {
        showStatus('開始日と終了日を指定してください。', true);
        return;
    }

    toggleLoading(true);
    try {
        const { functions } = getFirebaseServices();
        const getCalendarEvents = httpsCallable(functions, 'getCalendarEvents');
        const result = await getCalendarEvents({ 
            tokens: token, 
            startDate: startDate, 
            endDate: new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] // 終了日を+1日
        });
        
        renderEventsList(result.data.events);
    } catch (error) {
        console.error('Error fetching calendar events:', error);
        showStatus(`予定の取得に失敗しました: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
}

async function handleImportSubmit(e) {
    e.preventDefault();
    
    const eventsToImport = [];
    const eventCheckboxes = document.querySelectorAll('.event-checkbox:checked');
    
    eventCheckboxes.forEach(checkbox => {
        const eventItem = checkbox.closest('.event-item');
        const projectSelect = eventItem.querySelector('.project-assign-select');
        const selectedOption = projectSelect.options[projectSelect.selectedIndex];
        
        if (selectedOption && selectedOption.value) {
            eventsToImport.push({
                id: checkbox.dataset.eventId,
                start: checkbox.dataset.eventStart,
                end: checkbox.dataset.eventEnd,
                project: JSON.parse(selectedOption.dataset.projectData)
            });
        }
    });

    if (eventsToImport.length === 0) {
        showStatus('登録する予定が選択されていないか、プロジェクトが割り当てられていません。', true);
        return;
    }

    toggleLoading(true);
    try {
        await addCalendarEventsAsTimestamps(currentUser.uid, eventsToImport);
        showStatus(`${eventsToImport.length}件の予定を稼働実績として登録しました。`, false);
        // 登録済みのイベントをリストから削除
        eventCheckboxes.forEach(checkbox => checkbox.closest('.event-item').remove());
        if(eventsList.children.length === 0) {
             eventsList.innerHTML = '<p class="p-4 text-center text-gray-500">すべての予定が登録されました。</p>';
        }
    } catch (error) {
        console.error('Error importing events:', error);
        showStatus('予定の登録中にエラーが発生しました。', true);
    } finally {
        toggleLoading(false);
    }
}


// --- 描画処理 ---
function renderEventsList(events) {
    eventsList.innerHTML = '';
    if (events.length === 0) {
        eventsList.innerHTML = '<p class="p-4 text-center text-gray-500">指定された期間に予定はありませんでした。</p>';
        importSubmitButton.disabled = true;
        return;
    }

    const projectOptionsHtml = allProjects.map(p => 
        `<option value="${p.id}" data-project-data='${JSON.stringify(p)}'>${p.name}</option>`
    ).join('');

    events.forEach(event => {
        const startDate = new Date(event.start);
        const endDate = new Date(event.end);
        const itemHtml = `
            <div class="event-item p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div class="flex-shrink-0 flex items-center">
                    <input type="checkbox" class="event-checkbox h-5 w-5 text-indigo-600 border-gray-300 rounded" 
                        data-event-id="${event.id}"
                        data-event-start="${event.start}"
                        data-event-end="${event.end}">
                </div>
                <div class="flex-grow">
                    <p class="font-bold text-gray-800">${event.summary}</p>
                    <p class="text-sm text-gray-600">${startDate.toLocaleString('ja-JP')} - ${endDate.toLocaleString('ja-JP')}</p>
                </div>
                <div class="flex-shrink-0 w-full sm:w-48">
                    <select class="project-assign-select mt-1 block w-full border-gray-300 rounded-md shadow-sm sm:text-sm">
                        <option value="">プロジェクトを選択...</option>
                        ${projectOptionsHtml}
                    </select>
                </div>
            </div>
        `;
        eventsList.insertAdjacentHTML('beforeend', itemHtml);
    });
    importSubmitButton.disabled = false;
}