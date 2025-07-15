import { getProjects, getTimestampsForPeriod } from './services/firestoreService.js';
import { toggleLoading, showStatus } from './services/uiService.js';
import { exportToCsv } from './utils/csvExporter.js';

let currentUser;
let allTimestamps = [];
let allProjects = [];
const chartInstances = {};

let startMonthInput, endMonthInput, updateSummaryButton, tableProjectFilter;
let lineChartCanvas, tableBody, totalDurationSpan, totalRewardSpan, monthlySummaryTableBody, csvButton;

export const initSummaryPage = async (user) => {
    currentUser = user;
    lineChartCanvas = document.getElementById('monthly-line-chart');
    if (!lineChartCanvas) {
        console.error("サマリーページの必須要素が見つかりません。処理を中断します。");
        return;
    }

    startMonthInput = document.getElementById('graph-start-month');
    endMonthInput = document.getElementById('graph-end-month');
    updateSummaryButton = document.getElementById('update-summary-button');
    tableProjectFilter = document.getElementById('table-project-filter');
    tableBody = document.getElementById('timestamps-table-body');
    totalDurationSpan = document.getElementById('total-duration');
    totalRewardSpan = document.getElementById('total-reward');
    monthlySummaryTableBody = document.getElementById('monthly-summary-table-body');
    csvButton = document.getElementById('generate-csv-button');

    if(updateSummaryButton) updateSummaryButton.addEventListener('click', fetchAndRenderData);
    if(tableProjectFilter) tableProjectFilter.addEventListener('change', renderAllTables);
    if(csvButton) csvButton.addEventListener('click', handleCsvExport);
    
    await populateProjectFilter();
    setInitialDateRange();
    await fetchAndRenderData();
};

const populateProjectFilter = async () => {
    return new Promise(resolve => {
        getProjects(currentUser.uid, 'all', (projects) => {
            allProjects = projects;
            if (!tableProjectFilter) return resolve();
            tableProjectFilter.innerHTML = '<option value="all">すべてのプロジェクト</option>';
            projects.forEach(p => {
                tableProjectFilter.innerHTML += `<option value="${p.code}">${p.name}</option>`;
            });
            resolve();
        });
    });
};

const setInitialDateRange = () => {
    if (!startMonthInput || !endMonthInput) return;
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    endMonthInput.value = `${end.getFullYear()}-${(end.getMonth() + 1).toString().padStart(2, '0')}`;
    startMonthInput.value = `${start.getFullYear()}-${(start.getMonth() + 1).toString().padStart(2, '0')}`;
};

const fetchAndRenderData = async () => {
    toggleLoading(true);
    if (!startMonthInput?.value || !endMonthInput?.value) {
        showStatus('開始月と終了月を指定してください。', true);
        toggleLoading(false); return;
    }
    const [startYear, startMonth] = startMonthInput.value.split('-').map(Number);
    const [endYear, endMonth] = endMonthInput.value.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 1);
    
    try {
        allTimestamps = await getTimestampsForPeriod(currentUser.uid, startDate, endDate);
        renderMonthlyLineChart(allTimestamps, startDate, endDate);
        renderAllTables();
    } catch (error) {
        showStatus('データの取得に失敗しました。', true);
        console.error(error);
    } finally {
        toggleLoading(false);
    }
};

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

const renderAllTables = () => {
    const selectedProjectCode = tableProjectFilter?.value || 'all';
    const filteredTimestamps = (selectedProjectCode === 'all' ? allTimestamps : allTimestamps.filter(t => t.project.code === selectedProjectCode));
    
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
    renderSummaryTable(processedData);
};

const renderDetailedTable = (processedData) => {
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    if (processedData.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center p-8 text-gray-500">対象の稼働実績はありません。</td></tr>';
        return;
    }
    
    processedData.sort((a,b) => b.clockInTime.toDate() - a.clockInTime.toDate()).forEach(data => {
        const clockInDate = data.clockInTime.toDate();
        const clockOutDate = data.clockOutTime ? data.clockOutTime.toDate() : null;

        tableBody.innerHTML += `
            <tr class="bg-white border-b hover:bg-gray-50">
                <td class="px-6 py-4">${clockInDate.toLocaleDateString('ja-JP')}</td>
                <td class="px-6 py-4">${data.project.name}</td>
                <td class="px-6 py-4">${clockInDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'})}</td>
                <td class="px-6 py-4">${clockOutDate ? clockOutDate.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'}) : ''}</td>
                <td class="px-6 py-4 text-right">${data.actualHours.toFixed(2)}</td>
                <td class="px-6 py-4 text-right">${data.billedHours.toFixed(2)}</td>
            </tr>`;
    });
};

const renderSummaryTable = (processedData) => {
    if (!monthlySummaryTableBody || !totalDurationSpan || !totalRewardSpan) return;
    monthlySummaryTableBody.innerHTML = '';

    const summary = {};
    processedData.forEach(data => {
        if (!summary[data.project.code]) {
            summary[data.project.code] = {
                name: data.project.name,
                totalActualHours: 0,
                projectSettings: allProjects.find(p => p.code === data.project.code)
            };
        }
        summary[data.project.code].totalActualHours += data.actualHours;
    });

    let grandTotalBilledHours = 0;
    let grandTotalReward = 0;

    Object.values(summary).forEach(proj => {
        let totalBilledHours = 0;
        let totalReward = 0;
        const settings = proj.projectSettings;

        if (settings) {
            if (settings.billingAdjustmentType === 'monthly_total') {
                totalBilledHours = calculateBilledHours(proj.totalActualHours, settings);
            } else {
                totalBilledHours = processedData.filter(d => d.project.code === settings.code).reduce((sum, d) => sum + d.billedHours, 0);
            }

            if (settings.contractType === 'monthly') {
                if (proj.totalActualHours >= (settings.monthlyMinHours || 0) && proj.totalActualHours <= (settings.monthlyMaxHours || Infinity)) {
                    totalReward = settings.monthlyFixedRate || 0;
                } else {
                    totalReward = totalBilledHours * (settings.unitPrice || 0);
                }
            } else {
                totalReward = totalBilledHours * (settings.unitPrice || 0);
            }
        }
        grandTotalBilledHours += totalBilledHours;
        grandTotalReward += totalReward;

        monthlySummaryTableBody.innerHTML += `
            <tr class="bg-white border-b">
                <td class="px-6 py-4 font-medium text-gray-900">${proj.name}</td>
                <td class="px-6 py-4 text-right">${proj.totalActualHours.toFixed(2)}</td>
                <td class="px-6 py-4 text-right">${totalBilledHours.toFixed(2)}</td>
                <td class="px-6 py-4 text-right font-semibold">¥${Math.round(totalReward).toLocaleString()}</td>
            </tr>
        `;
    });

    totalDurationSpan.textContent = grandTotalBilledHours.toFixed(2);
    totalRewardSpan.textContent = `¥${Math.round(grandTotalReward).toLocaleString()}`;
};

const handleCsvExport = () => {
    const selectedProjectCode = tableProjectFilter?.value || 'all';
    const filteredTimestamps = (selectedProjectCode === 'all' ? allTimestamps : allTimestamps.filter(t => t.project.code === selectedProjectCode));
    
    const dataForExport = filteredTimestamps.map(ts => {
        const project = allProjects.find(p => p.code === ts.project.code);
        const actualHours = ts.durationHours || 0;
        let billedHours = actualHours;
        if (project && project.billingAdjustmentType === 'per_item') {
            billedHours = calculateBilledHours(actualHours, project);
        }
        
        return {
            date: ts.clockInTime.toDate().toLocaleDateString('ja-JP'),
            project: ts.project.name, clockIn: ts.clockInTime.toDate().toLocaleTimeString('ja-JP'),
            clockOut: ts.clockOutTime ? ts.clockOutTime.toDate().toLocaleTimeString('ja-JP') : '',
            actualHours: actualHours.toFixed(2), billedHours: billedHours.toFixed(2),
        };
    }).sort((a, b) => new Date(b.date + ' ' + b.clockIn) - new Date(a.date + ' ' + a.clockIn));

    const headers = {
        date: '日付', project: 'プロジェクト', clockIn: '出勤', clockOut: '退勤',
        actualHours: '実稼働(h)', billedHours: '実績(h)'
    };
    const date = new Date();
    const formattedDate = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
    exportToCsv(dataForExport, headers, `sidepocket-summary-${formattedDate}.csv`);
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
        options: {
            scales: { y: { beginAtZero: true, ticks: { callback: value => `${value}h` } } },
            maintainAspectRatio: false,
        }
    });
};