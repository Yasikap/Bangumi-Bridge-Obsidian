// 原作者：@北漠海
// 原项目地址：https://github.com/beimohai/Bangumi-to-obsidian-lite
// 修改版作者：@一般の智人
// 批量导入版- 支持三个列表导入
// 功能：支持批量导入Bangumi用户的"已看"、"想看"和"在看"列表

const notice = (msg) => new Notice(msg, 10000);
const log = (msg) => console.log(msg);

// 统一的请求头
const headers = {
    "Content-Type": "text/html; charset=utf-8",
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.100.4758.11 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
}

module.exports = bangumiBatchImport

let QuickAdd;
let currentListType = ""; // 当前导入的列表类型
let statusFilePath = "";  // 动态状态文件路径

/* ======================
   配置项
   ====================== */
const BASIC_FOLDER_PATH = "ACG/Anime";// 修改为你自己的笔记存储路径

// 列表类型配置
const LIST_TYPES = {
    collect: {
        name: "已看",
        path: "collect",
        state: "已看",
        statusFile: "批量导入状态_已看.md"
    },
    wish: {
        name: "想看", 
        path: "wish",
        state: "想看",
        statusFile: "批量导入状态_想看.md"
    },
    do: {
        name: "在看",
        path: "do",
        state: "在看",
        statusFile: "批量导入状态_在看.md"
    }
};

// 批量导入配置
const BATCH_CONFIG = {
    userId: "595130", // 您的Bangumi用户ID
    delayBetweenPages: 3000, // 页与页之间延迟（3秒）
    delayBetweenItems: 2000, // 作品详情请求间延迟（2秒）
    skipExistingNotes: true, // 跳过已存在的笔记
    createDownloadFolder: false, // 批量导入时不创建下载文件夹
};

/* ======================
   工具函数
   ====================== */

// 进度显示
function showProgress(current, total, message) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const progressBar = createProgressBar(percent, 20);
    const progressText = `[${current}/${total}] ${progressBar} ${percent}%`;
    
    notice(`${progressText}\n${message}`);
    console.log(`${progressText} - ${message}`);
}

// 创建进度条
function createProgressBar(percent, length = 20) {
    const filled = Math.round(length * percent / 100);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// 更新状态文件
async function updateStatus(status) {
    try {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
        const listType = currentListType ? LIST_TYPES[currentListType].name : "未知";
        
        let content = `# 🚀 Bangumi批量导入 - 实时状态\n\n`;
        content += `**导入列表**: ${listType}\n`;
        content += `**最后更新**: ${timeStr}\n`;
        content += `**运行状态**: ${status.isRunning ? '🟢 进行中' : '✅ 已完成'}\n\n`;
        
        content += `## 📊 进度概览\n\n`;
        
        if (status.totalItems > 0) {
            const percent = Math.round((status.processedItems / status.totalItems) * 100);
            const progressBar = createProgressBar(percent, 30);
            content += `**总体进度**: ${status.processedItems}/${status.totalItems} (${percent}%)\n`;
            content += `${progressBar}\n\n`;
        }
        
        content += `### 统计信息\n`;
        content += `- 列表类型: ${listType}\n`;
        content += `- 已处理页数: ${status.totalPages || 0}\n`;
        content += `- 发现番剧总数: ${status.totalItems || 0}\n`;
        content += `- 已处理番剧: ${status.processedItems || 0}\n`;
        content += `- 成功创建笔记: ${status.createdNotes || 0}\n`;
        content += `- 跳过已存在: ${status.skippedNotes || 0}\n`;
        content += `- 处理失败: ${status.failedItems || 0}\n`;
        
        if (status.currentPage) {
            content += `- 当前页面: 第 ${status.currentPage} 页\n`;
        }
        
        if (status.currentItem) {
            content += `- 正在处理: **${status.currentItem}**\n`;
        }
        
        if (status.startTime) {
            const elapsed = Date.now() - status.startTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            content += `- 运行时间: ${minutes}分${seconds}秒\n`;
        }
        
        if (status.failedList && status.failedList.length > 0) {
            content += `\n## ❌ 失败列表\n\n`;
            status.failedList.forEach((item, index) => {
                content += `${index + 1}. **${item.title}**\n`;
                content += `   - 原因: ${item.reason}\n`;
            });
        }
        
        content += `\n## 📝 最新日志\n\n`;
        if (status.recentLogs && status.recentLogs.length > 0) {
            status.recentLogs.forEach(log => {
                content += `- ${log}\n`;
            });
        } else {
            content += `暂无日志\n`;
        }
        
        // 确保基础文件夹存在
        const folderPath = statusFilePath.substring(0, statusFilePath.lastIndexOf('/'));
        if (!app.vault.getAbstractFileByPath(folderPath)) {
            await app.vault.createFolder(folderPath);
        }
        
        // 创建或更新状态文件
        const existingFile = app.vault.getAbstractFileByPath(statusFilePath);
        if (existingFile) {
            await app.vault.modify(existingFile, content);
        } else {
            await app.vault.create(statusFilePath, content);
        }
        
    } catch (error) {
        console.error("更新状态文件失败:", error);
    }
}

// 添加日志
function addLog(status, message) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const listType = currentListType ? LIST_TYPES[currentListType].name : "未知";
    const logEntry = `[${timeStr}] [${listType}] ${message}`;
    console.log(logEntry);
    
    if (!status.recentLogs) {
        status.recentLogs = [];
    }
    
    status.recentLogs.push(logEntry);
    
    // 只保留最近50条日志
    if (status.recentLogs.length > 50) {
        status.recentLogs = status.recentLogs.slice(-50);
    }
}

// 网络请求
async function requestGet(url, customHeaders = headers) {
    try {
        const res = await request({ 
            url, 
            method: "GET", 
            cache: "no-cache", 
            headers: customHeaders 
        });
        return res || null;
    } catch (err) {
        throw new Error(`请求失败: ${err.message}`);
    }
}

// HTML解析
function parseHtmlToDom(html) {
    if (!html) return new DOMParser().parseFromString("<html></html>", "text/html");
    return new DOMParser().parseFromString(html, "text/html");
}

/**
 * 由Bangumi URL推导netaba.re subject地址
 * @param {string} bgmUrl - Bangumi页面URL
 * @returns {string|null} - Netaba页面URL
 */
function getNetabaSubjectUrl(bgmUrl) {
    try {
        const m = bgmUrl.match(/subject\/(\d+)/);
        if (m) {
            const id = m[1];
            return `https://netaba.re/subject/${id}`;
        }
    } catch (e) { 
        return null;
    }
    return null;
}

// 清理文件名
const cleanFileName = (str) => str ? str.replace(/[\*"\\\/<>:\|?]/g, ' ').trim() : '';

// 延迟函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ======================
   批量导入主函数
   ====================== */

async function bangumiBatchImport(QuickAddInstance) {
    QuickAdd = QuickAddInstance;
    
    // 1. 让用户选择导入哪个列表
    const listChoice = await QuickAdd.quickAddApi.suggester(
        ["导入「已看」列表", "导入「想看」列表", "导入「在看」列表"],
        ["collect", "wish", "do"]
    );
    
    if (!listChoice) {
        notice("用户取消选择");
        return;
    }
    
    currentListType = listChoice;
    const listConfig = LIST_TYPES[currentListType];
    statusFilePath = `${BASIC_FOLDER_PATH}/${listConfig.statusFile}`;
    
    // 初始化状态
    const status = {
        isRunning: true,
        totalPages: 0,
        totalItems: 0,
        processedItems: 0,
        createdNotes: 0,
        skippedNotes: 0,
        failedItems: 0,
        startTime: Date.now(),
        currentPage: 0,
        failedList: [],
        recentLogs: []
    };
    
    try {
        // 2. 用户确认
        notice(`🚀 开始批量导入${listConfig.name}番剧...`);
        addLog(status, `脚本启动 - 导入${listConfig.name}列表`);
        
        const confirm = await QuickAdd.quickAddApi.yesNoPrompt(
            "批量导入确认",
            `即将从Bangumi导入您的${listConfig.name}番剧。\n\n` +
            `用户ID: ${BATCH_CONFIG.userId}\n` +
            `列表类型: ${listConfig.name}\n` +
            `预计时间: 25-30分钟\n` +
            `输出目录: ${BASIC_FOLDER_PATH}\n\n` +
            `是否继续？`
        );
        
        if (!confirm) {
            notice("用户取消操作");
            return;
        }
        
        // 3. 初始化状态文件
        addLog(status, "初始化状态文件");
        await updateStatus(status);
        notice(`✅ 状态文件已创建: ${listConfig.statusFile}`);
        
        // 4. 获取收藏列表（分页）
        addLog(status, "开始获取收藏列表");
        notice(`📥 正在获取${listConfig.name}列表...`);
        
        const collectionItems = await fetchAllCollectionPages(BATCH_CONFIG.userId, listConfig.path, status);
        
        if (!collectionItems || collectionItems.length === 0) {
            addLog(status, "未找到任何番剧条目");
            notice("未找到任何番剧条目");
            return;
        }
        
        status.totalItems = collectionItems.length;
        addLog(status, `找到 ${status.totalItems} 个番剧`);
        showProgress(0, status.totalItems, `开始导入${listConfig.name}列表...`);
        
        // 5. 显示导入列表供用户确认
        const itemListText = collectionItems.slice(0, 5).map((item, index) => 
            `${index + 1}. ${item.title_cn || item.title_jp || "未命名"}`
        ).join("\n");
        
        let confirmText = `将导入 ${status.totalItems} 个${listConfig.name}番剧，前5个：\n\n${itemListText}`;
        if (collectionItems.length > 5) {
            confirmText += `\n...等 ${status.totalItems} 个番剧`;
        }
        
        const proceed = await QuickAdd.quickAddApi.yesNoPrompt(
            "确认导入列表",
            confirmText
        );
        
        if (!proceed) {
            addLog(status, "用户取消导入");
            notice("用户取消导入");
            return;
        }
        
        addLog(status, "开始批量导入");
        
        // 6. 逐个处理番剧
        for (let i = 0; i < collectionItems.length; i++) {
            const item = collectionItems[i];
            const currentNum = i + 1;
            
            try {
                // 更新当前处理项
                status.currentItem = item.title_cn || item.title_jp || "未知作品";
                
                // 每处理5个或第一个时更新进度
                if (currentNum % 5 === 1 || currentNum === 1) {
                    showProgress(currentNum, status.totalItems, `正在处理: ${status.currentItem}`);
                    addLog(status, `处理 [${currentNum}/${status.totalItems}]: ${status.currentItem}`);
                }
                
                // 获取详细信息
                const animeInfo = await getAnimeByurl(item.link, status);
                if (!animeInfo) {
                    addLog(status, `获取详情失败: ${status.currentItem}`);
                    status.failedItems++;
                    status.failedList.push({
                        title: status.currentItem,
                        url: item.link,
                        reason: "获取详情失败"
                    });
                    continue;
                }
                
                // 合并收藏页信息
                animeInfo.title_cn = item.title_cn;
                animeInfo.title_jp = item.title_jp;
                animeInfo.cover = item.cover;
                
                // 🔥 重要：根据列表类型设置观看状态
                animeInfo.state = listConfig.state;
                
                // 记录日期
                const now = new Date();
                animeInfo.recordDate = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
                
                // 季度推导
                let seasonFolder = "未知季度", seasonYear = "";
                if (animeInfo.date && animeInfo.date.includes("年")) {
                    const year = animeInfo.date.split("年")[0];
                    seasonYear = year;
                    const monthPart = animeInfo.date.split("年")[1];
                    if (monthPart && monthPart.includes("月")) {
                        const m = parseInt(monthPart.split("月")[0]);
                        if (m === 12) seasonYear = (parseInt(year) + 1).toString();
                        if ([12,1,2].includes(m)) seasonFolder = "01月新番";
                        else if ([3,4,5].includes(m)) seasonFolder = "04月新番";
                        else if ([6,7,8].includes(m)) seasonFolder = "07月新番";
                        else if ([9,10,11].includes(m)) seasonFolder = "10月新番";
                    }
                }
                animeInfo.season = seasonFolder;
                animeInfo.year = seasonYear;
                animeInfo.url = item.link;
                animeInfo.fileName = animeInfo.CN || animeInfo.JP || cleanFileName(item.title_cn) || "未知作品";
                
                // 尝试获取Netaba评分
                try {
                    const netabaUrl = getNetabaSubjectUrl(animeInfo.url);
                    if (netabaUrl) {
                        animeInfo.netaba = netabaUrl;
                    }
                } catch (e) { 
                    // 忽略Netaba错误
                }
                
                // 创建笔记
                const created = await createNoteForBatch(animeInfo, status);
                if (created) {
                    status.createdNotes++;
                    addLog(status, `✓ 已创建: ${animeInfo.fileName}`);
                } else {
                    status.skippedNotes++;
                    addLog(status, `↻ 已跳过: ${animeInfo.fileName} (已存在)`);
                }
                
                status.processedItems = currentNum;
                
                // 每处理10个或最后一个时更新状态文件
                if (currentNum % 10 === 0 || currentNum === collectionItems.length) {
                    await updateStatus(status);
                }
                
                // 延迟（最后一个不延迟）
                if (i < collectionItems.length - 1) {
                    await delay(BATCH_CONFIG.delayBetweenItems);
                }
                
            } catch (error) {
                addLog(status, `❌ 处理失败: ${status.currentItem} - ${error.message}`);
                status.failedItems++;
                status.failedList.push({
                    title: status.currentItem,
                    url: item.link,
                    reason: error.message
                });
                
                await updateStatus(status);
                
                const continueAnyway = await QuickAdd.quickAddApi.yesNoPrompt(
                    "处理失败",
                    `处理失败：${status.currentItem}\n错误：${error.message}\n\n是否继续？`
                );
                
                if (!continueAnyway) {
                    addLog(status, "用户停止导入");
                    break;
                }
            }
        }
        
        // 7. 导入完成
        status.isRunning = false;
        await updateStatus(status);
        showImportSummary(status);
        
    } catch (error) {
        addLog(status, `脚本运行失败: ${error.message}`);
        status.isRunning = false;
        await updateStatus(status);
        notice(`批量导入失败: ${error.message}`);
    }
}

/* ======================
   分页获取收藏列表
   ====================== */

async function fetchAllCollectionPages(userId, listPath, status) {
    const allItems = [];
    let currentPage = 1;
    let hasNextPage = true;
    const baseUrl = `https://bgm.tv/anime/list/${userId}/${listPath}`;
    
    try {
        while (hasNextPage) {
            addLog(status, `获取第 ${currentPage} 页`);
            notice(`📄 正在获取第 ${currentPage} 页...`);
            
            const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage}`;
            const html = await requestGet(pageUrl);
            
            if (!html) {
                throw new Error(`第 ${currentPage} 页获取失败`);
            }
            
            const doc = parseHtmlToDom(html);
            
            // 解析当前页的条目
            const pageItems = parseCollectionPage(doc);
            allItems.push(...pageItems);
            status.totalPages = currentPage;
            
            const pageResultMsg = `第 ${currentPage} 页找到 ${pageItems.length} 个番剧，累计 ${allItems.length} 个`;
            addLog(status, pageResultMsg);
            
            // 更新状态文件
            status.currentPage = currentPage;
            await updateStatus(status);
            
            // 检查是否有下一页
            hasNextPage = hasNextPageLink(doc, currentPage);
            
            if (hasNextPage) {
                currentPage++;
                await delay(BATCH_CONFIG.delayBetweenPages);
            } else {
                const finalMsg = `✅ 已获取所有 ${currentPage} 页，共 ${allItems.length} 个番剧`;
                addLog(status, finalMsg);
                notice(finalMsg);
                break;
            }
        }
        
        return allItems;
        
    } catch (error) {
        addLog(status, `获取收藏列表失败: ${error.message}`);
        throw error;
    }
}

function parseCollectionPage(doc) {
    const items = [];
    const entries = doc.querySelectorAll('ul#browserItemList > li.item');
    
    for (const entry of entries) {
        try {
            // 提取中文名
            const titleLink = entry.querySelector('h3 > a.l');
            const title_cn = titleLink ? titleLink.textContent.trim() : '';
            
            // 提取日文名
            const titleJpElem = entry.querySelector('h3 > small.grey');
            const title_jp = titleJpElem ? titleJpElem.textContent.trim() : '';
            
            // 提取详情页链接
            const linkElem = titleLink || entry.querySelector('a.subjectCover');
            const link = linkElem ? 'https://bgm.tv' + linkElem.getAttribute('href') : '';
            
            // 提取封面
            const coverImg = entry.querySelector('img.cover');
            const cover = coverImg ? 'https:' + coverImg.getAttribute('src') : '';
            
            // 提取基本信息
            const infoElem = entry.querySelector('p.info.tip');
            const basic_info = infoElem ? infoElem.textContent.trim() : '';
            
            items.push({
                title_cn: cleanFileName(title_cn),
                title_jp: cleanFileName(title_jp),
                link: link,
                cover: cover,
                basic_info: basic_info
            });
            
        } catch (error) {
            // 忽略单个条目解析失败
        }
    }
    
    return items;
}

function hasNextPageLink(doc, currentPage) {
    // 检查分页区域
    const pagination = doc.querySelector('div#multipage');
    if (!pagination) {
        return false;
    }
    
    // 查找下一页链接
    const nextLinks = pagination.querySelectorAll('a.p');
    for (const link of nextLinks) {
        const href = link.getAttribute('href') || '';
        const pageMatch = href.match(/page=(\d+)/);
        if (pageMatch && parseInt(pageMatch[1]) > currentPage) {
            return true;
        }
    }
    
    return false;
}

/* ======================
   详情页抓取（含自动改编类型检测）
   ====================== */

async function getAnimeByurl(url, status) {
    try {
        addLog(status, `获取详情: ${url}`);
        const page = await requestGet(url);
        if (!page) { 
            throw new Error("无法获取详情页"); 
        }
        
        const doc = parseHtmlToDom(page);
        const $ = s => doc.querySelector(s);
        const $$ = s => doc.querySelectorAll(s);
        
        let workinginfo = {};
        
        // 验证类型
        if ($("#headerSubject")?.getAttribute('typeof') != "v:Movie") { 
            addLog(status, `警告: ${url} 不是动画类型，跳过`);
            return null;
        }
        
        // 基本信息
        const workingname = $("meta[name='keywords']")?.content || "";
        workinginfo.CN = cleanFileName((workingname.split(",")[0] || "").trim());
        workinginfo.JP = cleanFileName((workingname.split(",")[1] || "").trim());
        workinginfo.fileName = workinginfo.CN || workinginfo.JP || "未知作品";
        workinginfo.type = ($("small.grey")?.textContent || "").trim();
        workinginfo.rating = ($("span[property='v:average']")?.textContent || "未知").trim();
        
        // 封面
        let poster = $("div[align='center'] > a")?.href || "";
        poster = String(poster).replace("app://", "http://").trim();
        workinginfo.Poster = poster?.startsWith("http") ? poster : "https://via.placeholder.com/300x450?text=无封面";
        
        // 解析infobox
        const infobox = $$("#infobox > li");
        const str = Array.from(infobox).map(li => li.innerText).join("\n");
        
        // 提取各个字段
        const extractField = (regex, defaultVal) => {
            const match = regex.exec(str);
            return match ? match[1].trim().replace(/\n|\r/g, "").replace(/\s+/g, "") : defaultVal;
        };
        
        workinginfo.episode = extractField(/话数:.(\d*)/g, '0');
        
        let website = extractField(/官方网站:\s*(.*)\n/gm, '未知');
        workinginfo.website = website.match("http") ? website : "https://" + website;
        
        workinginfo.director = extractField(/导演:([^\n]*)/, '未知');
        workinginfo.AnimeMake = extractField(/动画制作:([^\n]*)/, '未知');
        workinginfo.music = extractField(/音乐:([^\n]*)/, '未知');
        
        // 放送日期
        let regstartdate;
        switch (workinginfo.type) {
            case "TV": regstartdate = /放送开始:([^\n]*)/; break;
            case "OVA": regstartdate = /发售日:([^\n]*)/; break;
            case "剧场版": regstartdate = /上映年度:([^\n]*)/; break;
            default: regstartdate = /放送开始:([^\n]*)/;
        }
        let startdate = extractField(regstartdate, '未知');
        if (startdate !== '未知') {
            try {
                const dateStr = startdate.replace('年', '-').replace('月', '-').replace('日', '');
                const dateObj = new Date(dateStr);
                const weekdays = ["星期日","星期一","星期二","星期三","星期四","星期五","星期六"];
                startdate = `${startdate} ${weekdays[dateObj.getDay()]}`;
            } catch (e) { 
                addLog(status, "日期转换失败: " + e.message);
            }
        }
        workinginfo.date = startdate;
        
        // 🔥 自动检测改编类型
        workinginfo.catego = detectAdaptationType(doc, status, workinginfo.CN || workinginfo.JP);
        
        addLog(status, `详情获取成功: ${workinginfo.CN || workinginfo.JP} [类型:${workinginfo.catego}]`);
        return workinginfo;
        
    } catch (error) {
        addLog(status, `获取详情失败 ${url}: ${error.message}`);
        return null;
    }
}

/* ======================
   自动检测改编类型函数
   ====================== */

function detectAdaptationType(doc, status, animeName) {
    try {
        // 查找标签区域
        const tagSection = doc.querySelector('h2.subtitle');
        if (!tagSection || tagSection.textContent.indexOf('标注为') === -1) {
            addLog(status, `未找到标签区域: ${animeName}`);
            return "其它";
        }
        
        // 获取标签容器
        const tagContainer = tagSection.nextElementSibling;
        if (!tagContainer || !tagContainer.classList.contains('inner')) {
            addLog(status, `未找到标签容器: ${animeName}`);
            return "其它";
        }
        
        // 获取所有标签
        const tags = tagContainer.querySelectorAll('a.l.meta, a.l');
        let allTags = [];
        
        tags.forEach(tag => {
            const span = tag.querySelector('span');
            if (span) {
                allTags.push(span.textContent.trim());
            }
        });
        
        // 关键词匹配优先级（合并小说和轻小说）
        const adaptationKeywords = {
            "小说改编": ["轻小说改", "轻改", "小说改", "小说改编"],
            "漫画改编": ["漫画改", "漫画改编"],
            "游戏改编": ["游戏改", "游戏改编"],
            "原创动画": ["原创"]
        };
        
        // 检查每个关键词
        for (const [category, keywords] of Object.entries(adaptationKeywords)) {
            for (const keyword of keywords) {
                if (allTags.some(tag => tag.includes(keyword))) {
                    addLog(status, `检测到改编类型: ${animeName} -> ${category} (关键词: ${keyword})`);
                    return category;
                }
            }
        }
        
        // 检查infobox中的制作信息
        const infoboxItems = doc.querySelectorAll('#infobox > li');
        for (const item of infoboxItems) {
            const text = item.textContent;
            
            if (text.includes('原作') || text.includes('原案')) {
                if (text.includes('漫画')) {
                    addLog(status, `从原作信息检测: ${animeName} -> 漫画改编`);
                    return "漫画改编";
                } else if (text.includes('小说') || text.includes('ノベル') || text.includes('ライトノベル')) {
                    addLog(status, `从原作信息检测: ${animeName} -> 小说改编`);
                    return "小说改编";
                } else if (text.includes('ゲーム') || text.includes('游戏')) {
                    addLog(status, `从原作信息检测: ${animeName} -> 游戏改编`);
                    return "游戏改编";
                }
            }
        }
        
        addLog(status, `未检测到改编类型，使用默认: ${animeName} -> 其它`);
        return "其它";
        
    } catch (error) {
        addLog(status, `检测改编类型失败: ${animeName} - ${error.message}`);
        return "其它";
    }
}

/* ======================
   批量创建笔记（跳过已存在）
   ====================== */

async function createNoteForBatch(animeInfo, status) {
    const filePath = getNotePath(animeInfo);
    
    // 检查笔记是否已存在
    if (BATCH_CONFIG.skipExistingNotes && app.vault.getAbstractFileByPath(filePath)) {
        return false;
    }
    
    // 确保文件夹存在
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (!app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath);
    }
    
    // 生成笔记内容
    const content = generateTemplateContent(animeInfo, "无", '0');
    
    try {
        await app.vault.create(filePath, content);
        return true;
        
    } catch (error) {
        if (error.message && error.message.includes("already exists")) {
            return false;
        } else {
            throw error;
        }
    }
}

function getNotePath(animeInfo) {
    // 构建笔记路径
    const noteFolderPath = animeInfo.year && animeInfo.season !== "未知季度" 
        ? `${BASIC_FOLDER_PATH}/${animeInfo.year}/${animeInfo.season}`
        : BASIC_FOLDER_PATH;
    
    return `${noteFolderPath}/${animeInfo.fileName}.md`;
}

/* ======================
   模板生成
   ====================== */

function generateTemplateContent(Info, downloadFolderPath = '', existingWatchedEpisodes = '0') {
    // 生成YAML Frontmatter
    let frontmatter = "---\n";
    const addField = (key, value) => frontmatter += `${key}: "${value || "未知"}"\n`;
    
    // 基本信息
    addField("中文名", Info.CN);
    addField("日文名", Info.JP);
    addField("cover", Info.Poster);
    
    // 作品信息
    addField("改编类型", Info.catego);
    addField("总集数", Info.episode);
    addField("观看状态", Info.state);
    
    // 制作信息
    addField("制作公司", Info.AnimeMake);
    addField("监督", Info.director);
    addField("音乐", Info.music);
    
    // 时间信息
    addField("开播年份", Info.year);
    addField("开播季度", Info.season);
    addField("记录日期", Info.recordDate);
    
    // 链接和评分
    addField("BGM链接", Info.url);
    addField("BGM评分", Info.rating);
    
    // 下载路径
    addField("下载路径", downloadFolderPath && downloadFolderPath !== "无" ? downloadFolderPath : "无");
    
    // Netaba链接（如果有）
    if (Info.netaba) {
        addField("Netaba链接", Info.netaba);
    }
    
    // tags属性
    addField("tags", "bangumi");
    
    frontmatter += "---\n\n";
    
    // 生成笔记正文
    let content = frontmatter;
    
    // 新增：已观看集数字段（用户可手动修改，脚本更新时保留）
    content += `**已观看集数：** ${existingWatchedEpisodes}\n\n`;
    
    content += `# 动画信息\n`;
    content += `> [!bookinfo|noicon]+ **${Info.CN || "未知作品"}**\n`;
    content += `> ![bookcover|400](${Info.Poster})\n`;
    content += `>\n`;
    content += `| 项目 | 内容 |\n`;
    content += `|:------|:------------------------------------------|\n`;
    content += `| 中文名 | ${Info.CN || "未知"} |\n`;
    content += `| 日文名 | ${Info.JP || "未知"} |\n`;
    content += `| 开播日期 | ${Info.date || "未知"} |\n`;
    content += `| 改编类型 | ${Info.catego || "未知"} |\n`;
    content += `| 动画集数 | ${Info.type || ""} 共 ${Info.episode || "0"} 话 |\n`;
    content += `| 制作公司 | ${Info.AnimeMake || "未知"} |\n`;
    content += `| 制作监督 | ${Info.director || "未知"} |\n`;
    content += `| 音乐 | ${Info.music || "未知"} |\n`;
    content += `| 观看状态 | ${Info.state || "未知"} |\n`;
    content += `| 记录日期 | ${Info.recordDate} |\n`;
    content += `| BGM 地址 | [${Info.CN || "链接"}](${Info.url}) |\n`;
    content += `| BGM 评分 | ${Info.rating || "未知"} |\n`;
    
    if (Info.netaba) {
        content += `| Netaba 评分趋势 | [查看变化](${Info.netaba}) |\n`;
    }

    if (downloadFolderPath && downloadFolderPath !== "无") {
        content += `| 下载路径 | \`${downloadFolderPath}\` |\n`;
    }
    
    // 添加Netaba评分趋势图表（如果可用）
    if (Info.netaba) {
        content += `\n\n<!-- Netaba评分趋势图 -->\n`;
        content += `<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">\n`;
        content += `<iframe src="${Info.netaba}" style="width:100%;height:600px;border:0;"></iframe>\n`;
        content += `</div>\n`;
    }
    
    return content.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ======================
   显示导入统计
   ====================== */

function showImportSummary(status) {
    const endTime = Date.now();
    const duration = Math.round((endTime - status.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    const listType = currentListType ? LIST_TYPES[currentListType].name : "未知";
    
    let summary = `✅ ${listType}批量导入完成！\n\n`;
    summary += `📊 统计信息：\n`;
    summary += `• 列表类型: ${listType}\n`;
    summary += `• 处理页数: ${status.totalPages}\n`;
    summary += `• 发现番剧: ${status.totalItems}\n`;
    summary += `• 已处理: ${status.processedItems}\n`;
    summary += `• 成功创建: ${status.createdNotes}\n`;
    summary += `• 跳过已存在: ${status.skippedNotes}\n`;
    summary += `• 处理失败: ${status.failedItems}\n`;
    summary += `• 耗时: ${minutes}分${seconds}秒\n\n`;
    
    if (status.failedList.length > 0) {
        summary += `❌ 失败列表：\n`;
        status.failedList.forEach((item, index) => {
            summary += `${index + 1}. ${item.title}: ${item.reason}\n`;
        });
    }
    
    notice(summary);
    console.log(summary);
    
    // 创建最终报告
    createFinalReport(status, duration);
}

async function createFinalReport(status, duration) {
    try {
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;
        const listType = currentListType ? LIST_TYPES[currentListType].name : "未知";
        const reportPath = `${BASIC_FOLDER_PATH}/${listType}批量导入报告_${timestamp}.md`;
        
        let reportContent = `# 📊 Bangumi批量导入报告\n\n`;
        reportContent += `**导入时间**: ${now.toLocaleString('zh-CN')}\n`;
        reportContent += `**用户ID**: ${BATCH_CONFIG.userId}\n`;
        reportContent += `**列表类型**: ${listType}\n`;
        reportContent += `**耗时**: ${Math.floor(duration/60)}分${duration%60}秒\n`;
        reportContent += `**脚本版本**: 批量导入版 v1.5\n\n`;
        
        reportContent += `## 📈 统计信息\n\n`;
        reportContent += `- 处理页数: ${status.totalPages}\n`;
        reportContent += `- 发现番剧总数: ${status.totalItems}\n`;
        reportContent += `- 已处理番剧: ${status.processedItems}\n`;
        reportContent += `- 成功创建笔记: ${status.createdNotes}\n`;
        reportContent += `- 跳过已存在: ${status.skippedNotes}\n`;
        reportContent += `- 处理失败: ${status.failedItems}\n\n`;
        
        if (status.failedList.length > 0) {
            reportContent += `## ❌ 失败列表\n\n`;
            status.failedList.forEach((item, index) => {
                reportContent += `${index + 1}. **${item.title}**\n`;
                reportContent += `   - 链接: ${item.url}\n`;
                reportContent += `   - 原因: ${item.reason}\n\n`;
            });
        }
        
        reportContent += `## 📋 运行日志\n\n\`\`\`\n`;
        if (status.recentLogs && status.recentLogs.length > 0) {
            reportContent += status.recentLogs.join('\n');
        }
        reportContent += `\n\`\`\`\n`;
        
        await app.vault.create(reportPath, reportContent);
        addLog(status, `已创建导入报告: ${reportPath}`);
        
    } catch (error) {
        console.error("创建最终报告失败:", error);
    }
}