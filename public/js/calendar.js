import { getFirebaseServices } from './services/firebaseService.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { getProjects, addCalendarEventsAsTimestamps } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';

// --- Google API & OAuth 関連 ---
const GOOGLE_CLIENT_ID = '887116583823-rjg8ibt6p37pnjqo2sosaer155id82v5.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyCQ9wFRgAFXzmzlUim01eO0XQPlMW5KMIk';
const GOOGLE_DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"];
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly";
const TOKEN_STORAGE_KEY = 'google_auth_token';

let gapi, google;
let tokenClient;
let currentUser;
let allProjects = [];

// --- DOM要素 ---
let authContainer, eventContainer, importContainer, authorizeButton, signoutButton;
let calendarListContainer, fetchEventsButton, eventsList, importForm, importSubmitButton;
let startDateInput, endDateInput;

/**
 * カレンダーページの初期化
 */
export const initCalendarPage = (user) => {
    currentUser = user;

    // DOM要素の取得
    authContainer = document.getElementById('auth-container');
    eventContainer = document.getElementById('event-container');
    importContainer = document.getElementById('import-container');
    authorizeButton = document.getElementById('authorize-button');
    signoutButton = document.getElementById('signout-button');
    calendarListContainer = document.getElementById('calendar-list-container');
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
    
    // スクリプトの読み込み
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
    const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (storedToken) {
        try {
            const token = JSON.parse(storedToken);
            if (token.expires_at > Date.now()) {
                gapi.client.setToken(token);
                updateUiForSignedIn();
            } else {
                localStorage.removeItem(TOKEN_STORAGE_KEY);
                updateUiForSignedOut();
            }
        } catch (e) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    }
}

function gisLoaded() {
    google = window.google;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error) {
                console.error(tokenResponse.error);
                return;
            }
            const tokenWithExpiry = { ...tokenResponse, expires_at: Date.now() + (tokenResponse.expires_in * 1000) };
            localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokenWithExpiry));
            gapi.client.setToken(tokenResponse);
            updateUiForSignedIn();
        },
    });
}

// --- 認証フロー ---
function handleAuthClick() {
    if (!tokenClient) return;
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            updateUiForSignedOut();
        });
    }
}

// --- UI更新 ---
function updateUiForSignedIn() {
    authContainer.querySelector('p').textContent = 'Google Calendarと連携済みです。';
    authorizeButton.classList.add('hidden');
    signoutButton.classList.remove('hidden');
    eventContainer.classList.remove('hidden');
    importContainer.classList.remove('hidden');
    fetchAndRenderCalendarList();
}

function updateUiForSignedOut() {
    authContainer.querySelector('p').textContent = 'Google Calendarと連携して、予定を稼働実績として取り込みます。';
    authorizeButton.classList.remove('hidden');
    signoutButton.classList.add('hidden');
    eventContainer.classList.add('hidden');
    importContainer.classList.add('hidden');
    calendarListContainer.innerHTML = '<p class="text-gray-500">連携後にカレンダーが表示されます。</p>';
    eventsList.innerHTML = '<p class="p-4 text-center text-gray-500">連携後、日付を指定して予定を読み込んでください。</p>';
    importSubmitButton.disabled = true;
}

// --- カレンダー & イベント処理 ---
async function fetchAndRenderCalendarList() {
    calendarListContainer.innerHTML = '<p class="text-gray-500">カレンダーを読み込んでいます...</p>';
    try {
        const response = await gapi.client.calendar.calendarList.list();
        const calendars = response.result.items;
        calendarListContainer.innerHTML = '';
        if (!calendars || calendars.length === 0) {
            calendarListContainer.innerHTML = '<p class="text-red-500">利用可能なカレンダーが見つかりませんでした。</p>';
            return;
        }
        calendars.forEach(calendar => {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-2';
            item.innerHTML = `
                <input type="checkbox" id="cal-${calendar.id}" value="${calendar.id}" class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 calendar-checkbox" ${calendar.primary ? 'checked' : ''}>
                <label for="cal-${calendar.id}" class="text-sm text-gray-700">${calendar.summary}</label>
            `;
            calendarListContainer.appendChild(item);
        });
    } catch (err) {
        console.error('Calendar list fetch error', err);
        showStatus('カレンダー一覧の取得に失敗しました。再度連携を試してください。', true);
        calendarListContainer.innerHTML = '<p class="text-red-500">カレンダー一覧の取得に失敗しました。</p>';
        if (err.result?.error?.status === 'UNAUTHENTICATED') {
            handleSignoutClick();
        }
    }
}

async function handleFetchEvents() {
    const token = gapi.client.getToken();
    if (token === null) {
        showStatus('Google Calendarと連携してください。', true);
        handleSignoutClick();
        return;
    }

    const selectedCalendars = Array.from(document.querySelectorAll('.calendar-checkbox:checked')).map(cb => cb.value);
    if (selectedCalendars.length === 0) {
        showStatus('読み込むカレンダーを1つ以上選択してください。', true);
        return;
    }
    
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    if (!startDate || !endDate) {
        showStatus('開始日と終了日を指定してください。', true);
        return;
    }
    
    toggleLoading(true);
    let allEvents = [];
    try {
        const requests = selectedCalendars.map(calendarId => 
            gapi.client.calendar.events.list({
                'calendarId': calendarId,
                'timeMin': (new Date(startDate)).toISOString(),
                'timeMax': (new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000)).toISOString(),
                'showDeleted': false,
                'singleEvents': true
            })
        );
        
        const responses = await Promise.all(requests);
        responses.forEach(response => {
            allEvents.push(...response.result.items);
        });

        // 開始時間でソート
        allEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

        renderEventsList(allEvents);

    } catch (err) {
        console.error('Execute error', err);
        showStatus(`予定の取得に失敗しました: ${err.result?.error?.message || err.message}`, true);
        if (err.result?.error?.status === 'UNAUTHENTICATED') {
            handleSignoutClick();
        }
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
                summary: checkbox.dataset.eventSummary,
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
        eventCheckboxes.forEach(checkbox => checkbox.closest('.event-item').remove());
        if(eventsList.children.length === 0) {
             eventsList.innerHTML = '<p class="p-4 text-center text-gray-500">すべての予定が登録されました。</p>';
             importSubmitButton.disabled = true;
        }
    } catch (error) {
        console.error('Error importing events:', error);
        showStatus('予定の登録中にエラーが発生しました。', true);
    } finally {
        toggleLoading(false);
    }
}

function renderEventsList(events) {
    eventsList.innerHTML = '';
    const eventsWithTime = events.filter(event => event.start.dateTime);

    if (eventsWithTime.length === 0) {
        eventsList.innerHTML = '<p class="p-4 text-center text-gray-500">指定された期間に時間指定のある予定はありませんでした。</p>';
        importSubmitButton.disabled = true;
        return;
    }

    const projectOptionsHtml = allProjects.map(p => 
        `<option value="${p.id}" data-project-data='${JSON.stringify({code: p.code, name: p.name, id: p.id})}'>${p.name}</option>`
    ).join('');

    eventsWithTime.forEach(event => {
        const startDate = new Date(event.start.dateTime);
        const endDate = new Date(event.end.dateTime);

        const itemHtml = `
            <div class="event-item p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4 hover:bg-gray-50">
                <div class="flex-shrink-0 flex items-center">
                    <input type="checkbox" class="event-checkbox h-5 w-5 text-indigo-600 border-gray-300 rounded" 
                        data-event-id="${event.id}"
                        data-event-summary="${event.summary || ''}"
                        data-event-start="${event.start.dateTime}"
                        data-event-end="${event.end.dateTime}">
                </div>
                <div class="flex-grow">
                    <p class="font-bold text-gray-800">${event.summary || '(タイトルなし)'}</p>
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