export const exportToPdf = (reportMonth, projectName, dailyChartImg, projectChartImg, timestamps, totalDuration) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text(`${reportMonth}月 稼働実績レポート`, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`プロジェクト: ${projectName}`, 14, 32);
    doc.text(`合計稼働時間: ${totalDuration.toFixed(2)} 時間`, 14, 38);
    if (dailyChartImg && projectChartImg) {
        doc.setFontSize(14);
        doc.text('稼働時間サマリー', 14, 55);
        doc.addImage(dailyChartImg, 'PNG', 14, 60, 90, 60);
        doc.addImage(projectChartImg, 'PNG', 110, 60, 90, 60);
    }
    const tableColumn = ["日付", "プロジェクト", "出勤", "退勤", "稼働時間 (h)"];
    const tableRows = timestamps.map(ts => [
        ts.clockInTime.toDate().toLocaleDateString('ja-JP'),
        ts.project.name,
        ts.clockInTime.toDate().toLocaleTimeString('ja-JP'),
        ts.clockOutTime.toDate().toLocaleTimeString('ja-JP'),
        { content: ts.durationHours.toFixed(2), styles: { halign: 'right' } }
    ]);
    doc.autoTable({ head: [tableColumn], body: tableRows, startY: 130, theme: 'grid' });
    doc.save(`sidepocket-report-${reportMonth}.pdf`);
};