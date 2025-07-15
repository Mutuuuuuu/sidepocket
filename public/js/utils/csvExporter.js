export const exportToCsv = (data, headers, filename) => {
    const headerKeys = Object.keys(headers);
    const csvRows = [Object.values(headers).join(',')];
    data.forEach(row => {
        const values = headerKeys.map(key => {
            let cell = row[key] ?? '';
            if (cell instanceof Date) cell = cell.toLocaleString('ja-JP');
            if (String(cell).includes(',')) cell = `"${cell}"`;
            return cell;
        });
        csvRows.push(values.join(','));
    });
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
};