const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 检查文件中是否包含当天的数据
function checkIfDataExists(date) {
    const filePath = path.join(__dirname, 'data.csv');
    if (fs.existsSync(filePath)) {
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            output: process.stdout,
            terminal: false
        });

        return new Promise((resolve) => {
            let lastLine = '';
            rl.on('line', (line) => {
                lastLine = line; // 记录每一行数据，最后一行就是最新的日期
            });

            rl.on('close', () => {
                const lastDate = lastLine.split(',')[0]; // 获取最后一行的日期
                resolve(lastDate === date); // 如果最后一行的日期与今天一致，则返回 true
            });
        });
    } else {
        // 如果文件不存在，则返回 false
        return Promise.resolve(false);
    }
}

// 更新当天的数据
function updateDataInFile(date, newData) {
    const filePath = path.join(__dirname, 'data.csv');
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    
    const updatedLines = lines.map(line => {
        const lineDate = line.split(',')[0];
        if (lineDate === date) {
            return [date, ...newData].join(','); // 更新当天的数据
        }
        return line; // 保持其他行不变
    });

    fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf-8');
    console.log(`Data for ${date} updated successfully.`);
}

async function scrapeData(retryCount = 0) {
    const date = new Date().toISOString().split('T')[0];
    console.log('Checking if data for today exists:', date);

    // 检查当天数据是否已经存在
    const dataExists = await checkIfDataExists(date);

    // 启动浏览器
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // 监听网络请求，确保所有数据都加载完成
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        request.continue();
    });

    // 访问页面
    await page.goto('https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/rounds-invitations.html');
    console.log('Page loaded');

    // 执行点击操作
    await page.evaluate(() => {
        document.getElementsByTagName("summary")[0].click();
    });
    console.log('Clicked on summary element');

    // 等待 5 秒钟，以确保数据加载
    await sleep(5000);
    console.log('Waiting for table data to load');

    // 显式等待表格内容加载完毕
    await page.waitForSelector('.table-responsive table tbody tr', { visible: true });
    console.log('Table rows found and visible');

    // 获取整个表格内容并解析数据
    const data = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.table-responsive tbody tr'));
        console.log('Rows found:', rows.length); // 打印表格行数

        const tableData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            const scoreRange = cells[0]?.innerText.trim();
            const numCandidates = cells[1]?.innerText.trim().replace(/,/g, ''); // 去掉千位分隔符

            // 打印每行的数据
            console.log('Row data:', scoreRange, numCandidates);

            if (scoreRange && numCandidates) {
                tableData.push({ scoreRange, numCandidates: parseInt(numCandidates) });
            }
        });

        return tableData;
    });

    console.log('Data extracted:', data); // 打印抓取的数据

    // 如果没有获取到数据，且重试次数小于10，则重试
    if (data.length === 0 && retryCount < 10) {
        console.log(`No data extracted. Retrying... (${retryCount + 1}/10)`);
        await browser.close();
        return scrapeData(retryCount + 1); // 重试
    }

    // 如果数据为空且已经尝试10次，输出错误信息并停止
    if (data.length === 0) {
        console.log('Failed to extract data after 10 retries. Exiting...');
        await browser.close();
        return;
    }

    // CSV 文件路径
    const filePath = path.join(__dirname, 'data.csv');

    // 定义完整的分数范围，并按数值从低到高排序
    const scoreRanges = [
        '0-300', '301-350', '351-400', '401-410', '411-420', '421-430', '431-440', '441-450',
        '451-460', '461-470', '471-480', '481-490', '491-500', '501-600', '601-1200'
    ];

    // 如果文件不存在，先写入表头
    if (!fs.existsSync(filePath)) {
        const header = ['Date', ...scoreRanges, 'Total'].join(',') + '\n';
        fs.writeFileSync(filePath, header);
        console.log('Header written to CSV');
    }

    // 构建数据行和总数
    const rowData = scoreRanges.map(scoreRange => {
        const matchingData = data.find(item => item.scoreRange === scoreRange);
        return matchingData ? matchingData.numCandidates : 0; // 如果没有数据则返回0
    });

    // 计算总数
    const total = rowData.reduce((acc, numCandidates) => acc + numCandidates, 0);

    // 如果当天数据已存在，则更新数据
    if (dataExists) {
        updateDataInFile(date, [...rowData, total]);
    } else {
        // 否则将新数据添加到CSV文件
        const csvContent = [date, ...rowData, total].join(',') + '\n';
        fs.appendFileSync(filePath, csvContent);
        console.log('Data saved to CSV file:', filePath);
    }

    // 关闭浏览器
    await browser.close();
}

// 执行抓取任务
scrapeData().catch(console.error);

