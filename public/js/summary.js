import { getProjects, getTimestampsForPeriod, addTimestamp, updateTimestamp, deleteTimestamp } from './services/firestoreService.js';
import { toggleLoading, showStatus, showConfirmModal } from './services/uiService.js';
import { exportToCsv } from './utils/csvExporter.js';

const { jsPDF } = window.jspdf;

let currentUser;
let allProjects = [];
let tableTimestamps = [];
const chartInstances = {};
const dom = {};
let currentExportType = ''; 

// 【重要】この部分は、以前の手順で取得したBase64文字列に置き換える必要があります。
const fontData = '';

export const initSummaryPage = async (user) => {
    currentUser = user;
    
    setupDOMReferences();

    if (!dom.monthlyLineChart) {
        console.error("サマリーページの必須要素が見つかりません。");
        return;
    }

    setInitialDateRanges();
    setupEventListeners();
    
    await populateProjectFilter();
    await fetchAndRenderGraph();
    await fetchAndRenderTables();
};

const setupDOMReferences = () => {
    const ids = [
        'monthly-line-chart', 'graph-start-month', 'graph-end-month', 'update-graph-button', 'table-month-selector',
        'table-project-filter', 'timestamps-table-body', 'total-duration', 'total-reward', 
        'monthly-summary-table-body', 'generate-csv-button', 'generate-pdf-button', 'add-timestamp-button',
        'timestamp-modal', 'timestamp-form', 'modal-title', 'timestamp-id', 'modal-date', 
        'modal-project', 'modal-start-time', 'modal-end-time', 'export-modal', 'export-project-selector-container', 
        'export-project-select', 'export-columns-container', 'execute-export-button'
    ];
    ids.forEach(id => {
        const key = id.replace(/-(\w)/g, (_, p1) => p1.toUpperCase());
        dom[key] = document.getElementById(id);
    });
    dom.modalCancelButtons = document.querySelectorAll('.modal-cancel-button');
    dom.modalOverlays = document.querySelectorAll('.modal-overlay');
};

const setupEventListeners = () => {
    dom.updateGraphButton?.addEventListener('click', fetchAndRenderGraph);
    dom.tableMonthSelector?.addEventListener('change', fetchAndRenderTables);
    
    dom.tableProjectFilter?.addEventListener('change', renderAllTables);
    dom.generateCsvButton?.addEventListener('click', () => openExportModal('csv'));
    dom.generatePdfButton?.addEventListener('click', () => openExportModal('pdf'));
    dom.addTimestampButton?.addEventListener('click', () => openTimestampModal(null));
    dom.timestampsTableBody?.addEventListener('click', handleTableClick);
    dom.timestampForm?.addEventListener('submit', handleTimestampFormSubmit);
    dom.executeExportButton?.addEventListener('click', handleExport);
    const closeModal = () => {
        dom.timestampModal.classList.add('hidden');
        dom.exportModal.classList.add('hidden');
    };
    dom.modalCancelButtons.forEach(btn => btn.addEventListener('click', closeModal));
    dom.modalOverlays.forEach(overlay => overlay.addEventListener('click', closeModal));
};

const setInitialDateRanges = () => {
    if (!dom.graphStartMonth || !dom.graphEndMonth || !dom.tableMonthSelector) return;

    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');

    dom.tableMonthSelector.value = `${year}-${month}`;
    
    const graphStart = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    dom.graphStartMonth.value = `${graphStart.getFullYear()}-${(graphStart.getMonth() + 1).toString().padStart(2, '0')}`;
    dom.graphEndMonth.value = `${year}-${month}`;
};

const fetchAndRenderGraph = async () => {
    toggleLoading(true);
    if (!dom.graphStartMonth?.value || !dom.graphEndMonth?.value) {
        showStatus('グラフの開始月と終了月を指定してください。', true);
        toggleLoading(false); return;
    }
    const [startYear, startMonth] = dom.graphStartMonth.value.split('-').map(Number);
    const [endYear, endMonth] = dom.graphEndMonth.value.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 0, 23, 59, 59);
    
    try {
        const graphTimestamps = await getTimestampsForPeriod(currentUser.uid, startDate, endDate);
        renderMonthlyLineChart(graphTimestamps, startDate, endDate);
    } catch (error) {
        showStatus(`グラフデータの取得に失敗しました: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
};

const fetchAndRenderTables = async () => {
    toggleLoading(true);
    if (!dom.tableMonthSelector?.value) {
        showStatus('表示月を指定してください。', true);
        toggleLoading(false); return;
    }
    const [year, month] = dom.tableMonthSelector.value.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    try {
        tableTimestamps = await getTimestampsForPeriod(currentUser.uid, startDate, endDate);
        renderAllTables();
    } catch (error) {
        showStatus(`テーブルデータの取得に失敗しました: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
};

const renderAllTables = () => {
    if (!dom.tableProjectFilter) return;
    const selectedProjectCode = dom.tableProjectFilter.value;
    const filteredTimestamps = (selectedProjectCode === 'all' 
        ? tableTimestamps 
        : tableTimestamps.filter(t => t.project.code === selectedProjectCode));
    
    const processedData = filteredTimestamps.map(ts => {
        const project = allProjects.find(p => p.code === ts.project.code);
        const actualHours = ts.durationHours || 0;
        let billedHours = actualHours;
        if (project && project.billingAdjustmentType === 'per_item') {
            billedHours = calculateBilledHours(actualHours, project);
        }
        return { ...ts, actualHours, billedHours };
    });

    renderDetailedTable(processedData);
    renderSummaryTable(processedData); // 月次集計はフィルターされたデータで計算
};

// ▼▼▼ この関数を変更 ▼▼▼
const populateProjectFilter = () => {
    return new Promise(resolve => {
        getProjects(currentUser.uid, 'all', (projects) => {
            allProjects = projects;
            if (dom.tableProjectFilter) {
                dom.tableProjectFilter.innerHTML = '<option value="all">すべてのプロジェクト</option>';
                projects.forEach(p => {
                    // client.name が存在すれば表示に追加する
                    const clientName = p.client?.name ? `${p.client.name} ` : '';
                    const optionText = `${p.code} ${clientName}${p.name}`;
                    dom.tableProjectFilter.innerHTML += `<option value="${p.code}">${optionText}</option>`;
                });
            }
            resolve();
        });
    });
};
// ▲▲▲ ここまで ▲▲▲

const calculateBilledHours = (actualHours, projectSettings) => {
    if (!projectSettings) return actualHours;
    const { billingCycle = 1, calculationMethod = 'floor' } = projectSettings;
    const actualMinutes = actualHours * 60;
    let billedMinutes;
    switch (calculationMethod) {
        case 'ceil': billedMinutes = Math.ceil(actualMinutes / billingCycle) * billingCycle; break;
        case 'round': billedMinutes = Math.round(actualMinutes / billingCycle) * billingCycle; break;
        default: billedMinutes = Math.floor(actualMinutes / billingCycle) * billingCycle;
    }
    return billedMinutes / 60;
};

const renderDetailedTable = (processedData) => {
    if (!dom.timestampsTableBody) return;
    dom.timestampsTableBody.innerHTML = '';
    
    if (processedData.length === 0) {
        dom.timestampsTableBody.innerHTML = '<tr><td colspan="7" class="text-center p-8 text-gray-500">対象の稼働実績はありません。</td></tr>';
        return;
    }
    
    processedData.sort((a,b) => b.clockInTime.toDate() - a.clockInTime.toDate()).forEach(data => {
        const clockInDate = data.clockInTime.toDate();
        const clockOutDate = data.clockOutTime ? data.clockOutTime.toDate() : null;

        const row = dom.timestampsTableBody.insertRow();
        row.dataset.id = data.id;
        row.className = 'bg-white border-b hover:bg-gray-50';
        row.innerHTML = `
            <td class="px-6 py-4">${clockInDate.toLocaleDateString('ja-JP')}</td>
            <td class="px-6 py-4">${data.project.name}</td>
            <td class="px-6 py-4">${clockInDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</td>
            <td class="px-6 py-4">${clockOutDate ? clockOutDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : ''}</td>
            <td class="px-6 py-4 text-right">${(data.actualHours || 0).toFixed(2)}</td>
            <td class="px-6 py-4 text-right">${(data.billedHours || 0).toFixed(2)}</td>
            <td class="px-6 py-4 text-center">
                <button class="edit-btn text-indigo-600 hover:text-indigo-900 font-medium">編集</button>
                <button class="delete-btn text-red-600 hover:text-red-900 font-medium ml-2">削除</button>
            </td>
        `;
    });
};

const renderSummaryTable = (processedData) => {
    if (!dom.monthlySummaryTableBody || !dom.totalDuration || !dom.totalReward) return;
    dom.monthlySummaryTableBody.innerHTML = '';

    const summary = {};
    // 月次集計はフィルター前の `tableTimestamps` を使う
    tableTimestamps.forEach(data => {
        const project = allProjects.find(p => p.code === data.project.code);
        const actualHours = data.durationHours || 0;
        let billedHours = actualHours;
        if (project && project.billingAdjustmentType === 'per_item') {
            billedHours = calculateBilledHours(actualHours, project);
        }

        if (!summary[data.project.code]) {
            summary[data.project.code] = {
                name: data.project.name,
                totalActualHours: 0,
                totalBilledHours: 0,
                totalReward: 0,
                projectSettings: project
            };
        }
        summary[data.project.code].totalActualHours += actualHours;
        summary[data.project.code].totalBilledHours += billedHours;
    });

    Object.values(summary).forEach(proj => {
        const settings = proj.projectSettings;
        if (settings) {
            if (settings.billingAdjustmentType === 'monthly_total') {
                proj.totalBilledHours = calculateBilledHours(proj.totalActualHours, settings);
            }
            if (settings.contractType === 'monthly') {
                if (proj.totalActualHours >= (settings.monthlyMinHours || 0) && proj.totalActualHours <= (settings.monthlyMaxHours || Infinity)) {
                    proj.totalReward = settings.monthlyFixedRate || 0;
                } else {
                    proj.totalReward = proj.totalBilledHours * (settings.unitPrice || 0);
                }
            } else {
                proj.totalReward = proj.totalBilledHours * (settings.unitPrice || 0);
            }
        }
        
        dom.monthlySummaryTableBody.innerHTML += `
            <tr class="bg-white border-b">
                <td class="px-6 py-4 font-medium text-gray-900">${proj.name}</td>
                <td class="px-6 py-4 text-right">${proj.totalActualHours.toFixed(2)}</td>
                <td class="px-6 py-4 text-right">${proj.totalBilledHours.toFixed(2)}</td>
                <td class="px-6 py-4 text-right font-semibold">¥${Math.round(proj.totalReward).toLocaleString()}</td>
            </tr>
        `;
    });

    // 表示中リストの合計はフィルター後の `processedData` で計算
    const grandTotalBilledHours = processedData.reduce((sum, d) => sum + (d.billedHours || 0), 0);
    const grandTotalReward = processedData.reduce((sum, d) => {
        const settings = allProjects.find(p => p.code === d.project.code);
        if (settings && settings.contractType !== 'monthly') { // 月額固定は個別報酬に加算しない
            return sum + (d.billedHours * (settings.unitPrice || 0));
        }
        return sum;
    }, 0);

    // 月額固定の報酬を一度だけ加算
    const monthlyRewards = Object.values(summary)
        .filter(proj => proj.projectSettings && proj.projectSettings.contractType === 'monthly')
        .reduce((sum, proj) => sum + proj.totalReward, 0);

    dom.totalDuration.textContent = grandTotalBilledHours.toFixed(2);
    dom.totalReward.textContent = `¥${Math.round(grandTotalReward + monthlyRewards).toLocaleString()}`;
};


const handleTableClick = (e) => {
    const target = e.target;
    const timestampId = target.closest('tr')?.dataset.id;
    if (!timestampId) return;

    if (target.classList.contains('edit-btn')) {
        const timestamp = tableTimestamps.find(ts => ts.id === timestampId);
        openTimestampModal(timestamp);
    } else if (target.classList.contains('delete-btn')) {
        handleDeleteTimestamp(timestampId);
    }
};

const openTimestampModal = (timestamp) => {
    dom.timestampForm.reset();
    dom.modalProject.innerHTML = allProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    if (timestamp) {
        dom.modalTitle.textContent = '稼働実績の編集';
        dom.timestampId.value = timestamp.id;
        
        const localDate = timestamp.clockInTime.toDate();
        const year = localDate.getFullYear();
        const month = (localDate.getMonth() + 1).toString().padStart(2, '0');
        const day = localDate.getDate().toString().padStart(2, '0');
        dom.modalDate.value = `${year}-${month}-${day}`;
        
        dom.modalProject.value = timestamp.project.id;
        dom.modalStartTime.value = timestamp.clockInTime.toDate().toTimeString().slice(0, 5);
        if (timestamp.clockOutTime) {
            dom.modalEndTime.value = timestamp.clockOutTime.toDate().toTimeString().slice(0, 5);
        }
    } else {
        dom.modalTitle.textContent = '稼働実績の新規追加';
        dom.timestampId.value = '';
        dom.modalDate.value = new Date().toISOString().split('T')[0];
    }
    dom.timestampModal.classList.remove('hidden');
};

const handleTimestampFormSubmit = async (e) => {
    e.preventDefault();
    toggleLoading(true);

    const id = dom.timestampId.value;
    const projectId = dom.modalProject.value;
    const project = allProjects.find(p => p.id === projectId);
    
    const clockInTime = new Date(`${dom.modalDate.value}T${dom.modalStartTime.value}`);
    const clockOutTime = new Date(`${dom.modalDate.value}T${dom.modalEndTime.value}`);

    if (clockInTime >= clockOutTime) {
        showStatus('終了時刻は開始時刻より後に設定してください。', true);
        toggleLoading(false);
        return;
    }
    
    const data = {
        project: { code: project.code, name: project.name, id: project.id },
        clockInTime,
        clockOutTime,
        status: 'completed',
    };

    try {
        if (id) {
            await updateTimestamp(currentUser.uid, id, data);
            showStatus('稼働実績を更新しました。', false);
        } else {
            await addTimestamp(currentUser.uid, data);
            showStatus('稼働実績を追加しました。', false);
        }
        dom.timestampModal.classList.add('hidden');
        await fetchAndRenderTables();
    } catch (error) {
        showStatus(`エラー: ${error.message}`, true);
    } finally {
        toggleLoading(false);
    }
};

const handleDeleteTimestamp = async (timestampId) => {
    const confirmed = await showConfirmModal('削除の確認', 'この稼働実績を本当に削除しますか？');
    if (confirmed) {
        toggleLoading(true);
        try {
            await deleteTimestamp(currentUser.uid, timestampId);
            showStatus('稼働実績を削除しました。', false);
            await fetchAndRenderTables();
        } catch (error) {
            showStatus(`削除中にエラーが発生しました: ${error.message}`, true);
        } finally {
            toggleLoading(false);
        }
    }
};

const openExportModal = (type) => {
    currentExportType = type;
    dom.exportColumnsContainer.innerHTML = '';
    
    const columns = {
        date:        { label: '日付',        checked: true,  disabled: true },
        project:     { label: 'プロジェクト名',  checked: true,  disabled: true },
        startTime:   { label: '出勤',        checked: false, disabled: false },
        endTime:     { label: '退勤',        checked: false, disabled: false },
        actualHours: { label: '実稼働(h)',     checked: false, disabled: false },
        performance: { label: '実績(h)',     checked: true,  disabled: false },
    };
    
    if (type === 'pdf') {
        dom.exportProjectSelectorContainer.classList.remove('hidden');
        dom.exportProjectSelect.innerHTML = allProjects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    } else {
        dom.exportProjectSelectorContainer.classList.add('hidden');
        columns.startTime.checked = true;
        columns.endTime.checked = true;
        columns.actualHours.checked = true;
    }

    Object.entries(columns).forEach(([key, { label, checked, disabled }]) => {
        dom.exportColumnsContainer.innerHTML += `
            <label class="flex items-center"><input type="checkbox" name="export-column" value="${key}" class="h-4 w-4 text-indigo-600 border-gray-300 rounded" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="ml-2 text-sm text-gray-700">${label}</span></label>`;
    });

    dom.exportModal.classList.remove('hidden');
};

const handleExport = () => {
    const selectedColumns = [...dom.exportColumnsContainer.querySelectorAll('input:checked')].map(cb => cb.value);
    
    if (currentExportType === 'csv') {
        const dataForExport = tableTimestamps.map(ts => {
            const project = allProjects.find(p => p.code === ts.project.code);
            return {
                date: ts.clockInTime.toDate().toLocaleDateString('ja-JP'),
                project: ts.project.name,
                startTime: ts.clockInTime.toDate().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}),
                endTime: ts.clockOutTime ? ts.clockOutTime.toDate().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '',
                actualHours: (ts.durationHours || 0).toFixed(2),
                performance: calculateBilledHours(ts.durationHours || 0, project).toFixed(2),
            };
        });

        const headers = { date: '日付', project: 'プロジェクト', startTime: '出勤', endTime: '退勤', actualHours: '実稼働(h)', performance: '実績(h)' };
        const filteredHeaders = Object.fromEntries(Object.entries(headers).filter(([key]) => selectedColumns.includes(key)));

        exportToCsv(dataForExport, filteredHeaders, `稼働実績一覧.csv`);
    } else { 
        const selectedProjectName = dom.exportProjectSelect.value;
        generatePdf(selectedColumns, selectedProjectName);
    }
    
    dom.exportModal.classList.add('hidden');
};

const generatePdf = (columns, projectName) => {
    if (!fontData) {
        showStatus('PDF出力用のフォントデータが設定されていません。', true);
        console.error('fontData is not set.');
        return;
    }
    
    const doc = new jsPDF();
    
    doc.addFileToVFS('NotoSansJP-Regular.ttf', fontData);
    doc.addFont('NotoSansJP-Regular.ttf', 'NotoSansJP', 'normal');
    doc.setFont('NotoSansJP');

    doc.setFontSize(18);
    doc.text("稼働実績報告書", 14, 22);

    doc.setFontSize(11);
    doc.text(`プロジェクト: ${projectName}`, 14, 32);

    const filteredData = tableTimestamps.filter(ts => ts.project.name === projectName);
    
    const dataForExport = filteredData.map(ts => {
        const project = allProjects.find(p => p.code === ts.project.code);
        return {
            date: ts.clockInTime.toDate().toLocaleDateString('ja-JP'),
            project: ts.project.name,
            startTime: ts.clockInTime.toDate().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}),
            endTime: ts.clockOutTime ? ts.clockOutTime.toDate().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) : '',
            actualHours: (ts.durationHours || 0).toFixed(2),
            performance: calculateBilledHours(ts.durationHours || 0, project).toFixed(2),
        };
    });

    const nameMap = { date: '日付', project: 'プロジェクト名', startTime: '出勤', endTime: '退勤', actualHours: '実稼働(h)', performance: '実績(h)' };
    const head = [columns.map(col => nameMap[col])];
    const body = dataForExport.map(row => columns.map(col => row[col]));
    
    doc.autoTable({
        head: head,
        body: body,
        startY: 40,
        styles: { font: 'NotoSansJP', fontStyle: 'normal' },
        headStyles: { font: 'NotoSansJP', fontStyle: 'normal' }
    });
    
    doc.save(`稼働実績報告書_${projectName}.pdf`);
};

const renderMonthlyLineChart = (timestamps, chartStartDate, chartEndDate) => {
    if (!dom.monthlyLineChart) return;
    const ctx = dom.monthlyLineChart.getContext('2d');
    const monthlyProjectHours = {};
    const labels = [];
    let currentDate = new Date(chartStartDate);
    while (currentDate <= chartEndDate) {
        const monthKey = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
        labels.push(monthKey);
        currentDate.setMonth(currentDate.getMonth() + 1);
    }
    timestamps.forEach(ts => {
        const d = ts.clockInTime.toDate();
        const monthKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        const projectName = ts.project.name || '未分類';
        if (!monthlyProjectHours[projectName]) monthlyProjectHours[projectName] = {};
        monthlyProjectHours[projectName][monthKey] = (monthlyProjectHours[projectName][monthKey] || 0) + (ts.durationHours || 0);
    });
    const projects = [...new Set(timestamps.map(ts => ts.project.name || '未分類'))];
    const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'];
    const datasets = projects.map((projectName, index) => ({
        label: projectName,
        data: labels.map(label => (monthlyProjectHours[projectName]?.[label] || 0).toFixed(2)),
        borderColor: colors[index % colors.length],
        tension: 0.1,
        fill: false
    }));
    if (chartInstances.line) chartInstances.line.destroy();
    chartInstances.line = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            scales: { y: { beginAtZero: true, ticks: { callback: value => `${value}h` } } },
            maintainAspectRatio: false,
        }
    });
};