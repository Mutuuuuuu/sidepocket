import { getProjects, getTimestampsForPeriod } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';
import { exportToCsv } from './utils/csvExporter.js';
import { exportToPdf } from './utils/pdfExporter.js';

let currentUser;
let allTimestamps = [];
const chartInstances = {};

let startMonthInput, endMonthInput, updateGraphButton, tableProjectFilter;
let lineChartCanvas, tableBody, totalDurationSpan, totalRewardSpan;

export const initSummaryPage = async (user) => {
    currentUser = user;
    lineChartCanvas = document.getElementById('monthly-line-chart');
    if (!lineChartCanvas) return;
    startMonthInput = document.getElementById('graph-start-month');
    endMonthInput = document.getElementById('graph-end-month');
    updateGraphButton = document.getElementById('update-graph-button');
    tableProjectFilter = document.getElementById('table-project-filter');
    tableBody = document.getElementById('timestamps-table-body');
    totalDurationSpan = document.getElementById('total-duration');
    totalRewardSpan = document.getElementById('total-reward');

    updateGraphButton.addEventListener('click', () => fetchAndRenderData());
    tableProjectFilter.addEventListener('change', renderTable);
    document.getElementById('generate-csv-button').addEventListener('click', handleCsvExport);
    document.getElementById('generate-pdf-button').addEventListener('click', handlePdfExport);
    
    await populateProjectFilter();
    const { initialStartDate, initialEndDate } = setInitialDateRange();
    await fetchAndRenderData(initialStartDate, initialEndDate);
};

const populateProjectFilter = () => {
    return new Promise(resolve => {
        const unsubscribe = getProjects(currentUser.uid, 'all', (projects) => {
            if (!tableProjectFilter) return;
            tableProjectFilter.innerHTML = '<option value="all">すべてのプロジェクト</option>';
            projects.forEach(p => {
                tableProjectFilter.innerHTML += `<option value="${p.code}">${p.name}</option>`;
            });
            unsubscribe();
            resolve();
        });
    });
};

const setInitialDateRange = () => {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    endMonthInput.value = `${end.getFullYear()}-${(end.getMonth() + 1).toString().padStart(2, '0')}`;
    startMonthInput.value = `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`;
    return { initialStartDate: start, initialEndDate: new Date(end.getFullYear(), end.getMonth() + 1, 1) };
};

const fetchAndRenderData = async (argStartDate, argEndDate) => {
    toggleLoading(true);
    let startDate, endDate;
    if (argStartDate && argEndDate) {
        startDate = argStartDate;
        endDate = argEndDate;
    } else {
        if (!startMonthInput.value || !endMonthInput.value) {
            showStatus('開始月と終了月を指定してください。', true);
            toggleLoading(false); return;
        }
        const [startYear, startMonth] = startMonthInput.value.split('-').map(Number);
        const [endYear, endMonth] = endMonthInput.value.split('-').map(Number);
        startDate = new Date(startYear, startMonth - 1, 1);
        endDate = new Date(endYear, endMonth, 1);
    }
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        showStatus('日付の形式が無効です。', true);
        toggleLoading(false); return;
    }
    try {
        allTimestamps = await getTimestampsForPeriod(currentUser.uid, startDate, endDate);
        renderMonthlyLineChart(allTimestamps, startDate, endDate);
        await renderTable();
    } catch (error) {
        showStatus('データの取得に失敗しました。', true);
        console.error(error);
    } finally {
        toggleLoading(false);
    }
};

const renderMonthlyLineChart = (timestamps, chartStartDate, chartEndDate) => {
    if (!lineChartCanvas) return;
    const ctx = lineChartCanvas.getContext('2d');
    const monthlyProjectHours = {};
    const labels = [];
    let currentDate = new Date(chartStartDate);
    while (currentDate < chartEndDate) {
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
        options: { scales: { y: { beginAtZero: true, ticks: { callback: value => `${value}h` } } } }
    });
};

const renderTable = async () => {
    if (!tableBody) return;
    let projects = [];
    await new Promise(resolve => {
        const unsubscribe = getProjects(currentUser.uid, 'all', projs => {
            projects = projs;
            unsubscribe();
            resolve();
        });
    });
    const selectedProjectCode = tableProjectFilter.value;
    const filteredTimestamps = (selectedProjectCode === 'all' ? allTimestamps : allTimestamps.filter(t => t.project.code === selectedProjectCode));
    const monthlyGroups = {};
    filteredTimestamps.forEach(ts => {
        const d = ts.clockInTime.toDate();
        const monthKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!monthlyGroups[monthKey]) monthlyGroups[monthKey] = {};
        if (!monthlyGroups[monthKey][ts.project.code]) {
            monthlyGroups[monthKey][ts.project.code] = { totalHours: 0, timestamps: [] };
        }
        monthlyGroups[monthKey][ts.project.code].totalHours += ts.durationHours || 0;
        monthlyGroups[monthKey][ts.project.code].timestamps.push(ts);
    });
    let finalTimestamps = [];
    Object.values(monthlyGroups).forEach(projectGroups => {
        Object.values(projectGroups).forEach(group => {
            const projectInfo = projects.find(p => p.code === group.timestamps[0].project.code);
            let monthlyReward = 0;
            if (projectInfo && projectInfo.contractType === 'monthly' && group.totalHours >= (projectInfo.monthlyMinHours || 0) && group.totalHours <= (projectInfo.monthlyMaxHours || Infinity)) {
                monthlyReward = projectInfo.monthlyFixedRate || 0;
            }
            group.timestamps.forEach(ts => {
                let reward = 0;
                if (monthlyReward > 0) {
                    reward = (ts.durationHours / group.totalHours) * monthlyReward;
                } else {
                    reward = calculateHourlyReward(ts.durationHours || 0, projectInfo);
                }
                finalTimestamps.push({ ...ts, reward });
            });
        });
    });
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center p-8">対象の稼働実績はありません。</td></tr>';
    totalDurationSpan.textContent = '0.00';
    if(totalRewardSpan) totalRewardSpan.textContent = '¥0';
    if (finalTimestamps.length > 0) {
        tableBody.innerHTML = '';
        let grandTotalDuration = 0, grandTotalReward = 0;
        finalTimestamps.sort((a,b) => b.clockInTime.toDate() - a.clockInTime.toDate()).forEach(ts => {
            grandTotalDuration += ts.durationHours || 0;
            grandTotalReward += ts.reward || 0;
            const clockInDate = new Date(ts.clockInTime.toDate());
            const clockOutDate = ts.clockOutTime ? new Date(ts.clockOutTime.toDate()) : null;
            tableBody.innerHTML += `
                <tr class="bg-white border-b hover:bg-gray-50">
                    <td class="px-6 py-4">${clockInDate.toLocaleDateString('ja-JP')}</td>
                    <td class="px-6 py-4">${ts.project.name}</td>
                    <td class="px-6 py-4">${clockInDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</td>
                    <td class="px-6 py-4">${clockOutDate ? clockOutDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : ''}</td>
                    <td class="px-6 py-4 text-right">${(ts.durationHours || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 text-right font-semibold">¥${Math.round(ts.reward || 0).toLocaleString()}</td>
                </tr>`;
        });
        totalDurationSpan.textContent = grandTotalDuration.toFixed(2);
        if(totalRewardSpan) totalRewardSpan.textContent = `¥${Math.round(grandTotalReward).toLocaleString()}`;
    }
};

function calculateHourlyReward(durationHours, project) {
    if (!project || project.contractType !== 'hourly' || !project.unitPrice) return 0;
    const { unitPrice, billingCycle = 1, calculationMethod = 'floor' } = project;
    const durationMinutes = durationHours * 60;
    let calculatedMinutes;
    switch (calculationMethod) {
        case 'ceil': calculatedMinutes = Math.ceil(durationMinutes / billingCycle) * billingCycle; break;
        case 'round': calculatedMinutes = Math.round(durationMinutes / billingCycle) * billingCycle; break;
        default: calculatedMinutes = Math.floor(durationMinutes / billingCycle) * billingCycle;
    }
    return (calculatedMinutes / 60) * unitPrice;
}

const handlePdfExport = () => { /* ... */ };
const handleCsvExport = () => { /* ... */ };