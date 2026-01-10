// 原作者：@北漠海
// 原项目地址：https://github.com/beimohai/Bangumi-to-obsidian-lite
// 修改版作者：@一般の智人
// 新增功能：自动从Bangumi页面检测改编类型，智能处理多种检测结果
// 新增功能：自动创建对应的物理文件夹，方便后续动画下载管理
// 其余功能：保留用户自定义内容（已观看集数、观看网址、个人总结）

const notice = (msg) => new Notice(msg, 5000);
const log = (msg) => console.log(msg);

// 统一的请求头
const headers = {
    "Content-Type": "text/html; charset=utf-8",
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.100.4758.11 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
}

module.exports = bangumi

let QuickAdd;
var pageNum = 1;

/* ======================
   配置项
   ====================== */
const AUTO_LOOP = false;
const OPEN_IN_MAIN_LEAF = true;
const BASIC_FOLDER_PATH = "ACG/Anime";// 修改为你自己的笔记存储路径

// 物理文件夹映射配置
const PHYSICAL_FOLDER_MAPPING = {
    "ACG/Anime": "D:/Videos/Anime",// 修改为你自己的笔记存储路径和本地动画存储路径，注意斜杠方向
};

// 文件夹命名选项
const FOLDER_OPTIONS = {
    replaceIllegalChars: true,
    illegalCharsReplacement: "_",
    maxLength: 100
};

/* ======================
   工具函数
   ====================== */

// 网络请求
async function requestGet(url, customHeaders = headers) {
    try {
        const res = await request({ url, method: "GET", cache: "no-cache", headers: customHeaders });
        return res || null;
    } catch (err) {
        notice(`请求失败: ${err.message}`);
        return null;
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
        console.error("解析Netaba URL失败:", e);
        return null;
    }
    return null;
}

// 清理文件名
const cleanFileName = (str) => str ? str.replace(/[\*"\\\/<>:\|?]/g, ' ').trim() : '';

/* ======================
   文件系统操作
   ====================== */

async function createPhysicalFolder(notePath, animeName) {
    try {
        // 查找物理路径映射
        let physicalRoot = "", noteRoot = "";
        for (const [noteBase, physicalBase] of Object.entries(PHYSICAL_FOLDER_MAPPING)) {
            if (notePath.startsWith(noteBase) && noteBase.length > noteRoot.length) {
                physicalRoot = physicalBase;
                noteRoot = noteBase;
            }
        }
        if (!physicalRoot) return null;

        // 计算相对路径
        let relativePath = notePath.substring(noteRoot.length).replace(/\/[^\/]+\.md$/, '');
        if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);

        // 清理文件夹名
        let folderName = cleanFolderName(animeName);
        const fullPath = `${physicalRoot}/${relativePath}/${folderName}`.replace(/\/+/g, '/');

        await ensureFolderExists(fullPath);
        return fullPath;
    } catch (error) {
        notice(`创建文件夹失败: ${error.message}`);
        return null;
    }
}

function cleanFolderName(name) {
    if (!name) return "未命名";
    let clean = name.replace(/\.[^/.]+$/, '');
    if (FOLDER_OPTIONS.replaceIllegalChars) {
        clean = clean.replace(/[<>:"|?*\\/]/g, FOLDER_OPTIONS.illegalCharsReplacement)
                     .trim().replace(/^\.+|\.+$/g, '');
        if (clean.length > FOLDER_OPTIONS.maxLength) clean = clean.substring(0, FOLDER_OPTIONS.maxLength);
    }
    return clean || "未命名";
}

async function ensureFolderExists(folderPath) {
    return new Promise((resolve, reject) => {
        try {
            const fs = require('fs'), path = require('path');
            function mkdirRecursive(dir) {
                if (fs.existsSync(dir)) return true;
                mkdirRecursive(path.dirname(dir));
                fs.mkdirSync(dir);
                return true;
            }
            mkdirRecursive(folderPath);
            resolve(folderPath);
        } catch (error) { reject(error); }
    });
}

/* ======================
   自动检测改编类型函数
   ====================== */

function detectAdaptationTypeFromPage(doc, url) {
    try {
        const detectedTypes = [];
        
        // 1. 从标签区域检测
        const tagSection = doc.querySelector('h2.subtitle');
        if (tagSection && tagSection.textContent.includes('标注为')) {
            const tagContainer = tagSection.nextElementSibling;
            if (tagContainer && tagContainer.classList.contains('inner')) {
                const tags = tagContainer.querySelectorAll('a.l.meta, a.l');
                const allTags = [];
                
                tags.forEach(tag => {
                    const span = tag.querySelector('span');
                    if (span) {
                        allTags.push(span.textContent.trim());
                    }
                });
                
                // 关键词匹配
                const adaptationKeywords = {
                    "小说改编": ["轻小说改", "轻改", "小说改", "小说改编"],
                    "漫画改编": ["漫画改", "漫画改编"],
                    "游戏改编": ["游戏改", "游戏改编"],
                    "原创动画": ["原创"]
                };
                
                for (const [category, keywords] of Object.entries(adaptationKeywords)) {
                    for (const keyword of keywords) {
                        if (allTags.some(tag => tag.includes(keyword))) {
                            if (!detectedTypes.includes(category)) {
                                detectedTypes.push(category);
                            }
                        }
                    }
                }
            }
        }
        
        // 2. 从infobox中的原作信息检测
        const infoboxItems = doc.querySelectorAll('#infobox > li');
        for (const item of infoboxItems) {
            const text = item.textContent;
            
            if (text.includes('原作') || text.includes('原案')) {
                if (text.includes('漫画') && !detectedTypes.includes("漫画改编")) {
                    detectedTypes.push("漫画改编");
                } else if ((text.includes('小说') || text.includes('ノベル') || text.includes('ライトノベル')) && !detectedTypes.includes("小说改编")) {
                    detectedTypes.push("小说改编");
                } else if ((text.includes('ゲーム') || text.includes('游戏')) && !detectedTypes.includes("游戏改编")) {
                    detectedTypes.push("游戏改编");
                }
            }
        }
        
        return detectedTypes;
        
    } catch (error) {
        console.error("检测改编类型失败:", error);
        return [];
    }
}

// 智能选择改编类型的函数
async function getAdaptationTypeWithAutoDetect(detectedTypes, animeName) {
    const ALL_CATEGORIES = ["小说改编", "漫画改编", "原创动画", "游戏改编", "其它"];
    
    // 情况1：没有检测到任何类型
    if (!detectedTypes || detectedTypes.length === 0) {
        notice(`未检测到改编类型，请手动选择: ${animeName}`);
        return await QuickAdd.quickAddApi.suggester(ALL_CATEGORIES, ALL_CATEGORIES);
    }
    
    // 情况2：只检测到一种类型 - 自动选择
    if (detectedTypes.length === 1) {
        notice(`✅ 自动检测到改编类型: ${animeName} → ${detectedTypes[0]}`);
        return detectedTypes[0];
    }
    
    // 情况3：检测到多种类型 - 让用户选择
    notice(`检测到多种改编类型: ${animeName}`);
    
    // 构建选择列表，标注自动检测的类型
    const choices = detectedTypes.map(type => `✅ ${type}`).concat(
        ALL_CATEGORIES.filter(cat => !detectedTypes.includes(cat))
    );
    const values = detectedTypes.concat(
        ALL_CATEGORIES.filter(cat => !detectedTypes.includes(cat))
    );
    
    const selected = await QuickAdd.quickAddApi.suggester(
        choices,
        values
    );
    
    return selected;
}

/* ======================
   用户内容提取函数
   ====================== */

/**
 * 从旧笔记中提取用户填写的内容
 * @param {string} oldContent - 旧笔记内容
 * @returns {Object} 提取的用户内容
 */
function extractUserContent(oldContent) {
    const result = {
        watchedEpisodes: '0',
        watchUrl: '',
        personalSummary: ''
    };
    
    try {
        // 1. 提取已观看集数
        const watchedMatch = oldContent.match(/\*\*已观看集数：\*\*\s*(\d+)/);
        if (watchedMatch && watchedMatch[1]) {
            result.watchedEpisodes = watchedMatch[1].trim();
        }
        
        // 2. 提取观看网址
        const urlMatch = oldContent.match(/\*\*观看网址：\*\*\s*([^\n]*)/);
        if (urlMatch && urlMatch[1]) {
            result.watchUrl = urlMatch[1].trim();
        }
        
        // 3. 提取个人总结
        const summaryMatch = oldContent.match(/#\s*个人总结\s*\n+([\s\S]*?)(?=\n#|\n---|\n*$)/);
        if (summaryMatch && summaryMatch[1]) {
            result.personalSummary = summaryMatch[1].trim();
        }
        
    } catch (error) {
        console.error("提取用户内容失败:", error);
    }
    
    return result;
}

/* ======================
   主流程函数
   ====================== */

async function bangumi(QuickAddInstance) {
    QuickAdd = QuickAddInstance;
    let Info = {};

    // 1. 作品名输入
    const name = await QuickAdd.quickAddApi.inputPrompt("输入查询的作品名称");
    if (!name) { notice("没有输入任何内容"); return; }

    // 2. 搜索
    const searchUrl = "https://bgm.tv/subject_search/" + name + "?cat=2";
    let searchResult = await searchBangumi(searchUrl);
    if (!searchResult) { notice("找不到你搜索的内容"); return; }

    // 3. 选择结果
    let choice;
    while (true) {
        choice = await QuickAdd.quickAddApi.suggester((obj) => obj.text, searchResult);
        if (!choice) { notice("没有选择内容"); return; }
        if (choice.typeId === 8) { // 下一页
            searchResult = await searchBangumi(choice.link);
            if (!searchResult) { notice("找不到你搜索的内容"); return; }
            continue;
        } else {
            Info = await getAnimeByurl(choice.link);
            notice("正在生成动画笔记");
            break;
        }
    }

    // 4. 记录日期
    const now = new Date();
    Info.recordDate = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;

    // 5. 观看状态
    Info.state = await QuickAdd.quickAddApi.suggester(["已看", "在看", "想看", "抛弃"], ["已看", "在看", "想看", "抛弃"]);
    
    // 6. 🔥 智能获取改编类型
    Info.catego = await getAdaptationTypeWithAutoDetect(Info.detectedCategories, Info.CN || Info.JP || "未知作品");

    // 7. 是否创建下载路径
    const createDownloadChoice = await QuickAdd.quickAddApi.suggester(
        ["创建下载路径", "不创建下载路径"], 
        ["创建下载路径", "不创建下载路径"]
    );
    Info.createDownloadFolder = (createDownloadChoice === "创建下载路径");

    Info.url = choice.link;

    // 8. 季度推导
    let seasonFolder = "未知季度", seasonYear = "";
    if (Info.date && Info.date.includes("年")) {
        const year = Info.date.split("年")[0];
        seasonYear = year;
        const monthPart = Info.date.split("年")[1];
        if (monthPart && monthPart.includes("月")) {
            const m = parseInt(monthPart.split("月")[0]);
            if (m === 12) seasonYear = (parseInt(year) + 1).toString();
            if ([12,1,2].includes(m)) seasonFolder = "01月新番";
            else if ([3,4,5].includes(m)) seasonFolder = "04月新番";
            else if ([6,7,8].includes(m)) seasonFolder = "07月新番";
            else if ([9,10,11].includes(m)) seasonFolder = "10月新番";
        }
    }
    Info.season = seasonFolder;
    Info.year = seasonYear;

    // 9. 尝试获取Netaba评分趋势
    try {
        const netabaUrl = getNetabaSubjectUrl(Info.url);
        if (netabaUrl) {
            Info.netaba = netabaUrl;
            const netabaHtml = await requestGet(netabaUrl);
            if (netabaHtml) Info.netabaHtml = netabaHtml;
        }
    } catch (e) { 
        console.error("Netaba抓取失败，但继续流程:", e); 
        Info.netaba = null;
    }

    // 10. 构建笔记路径
    const noteFolderPath = seasonYear && seasonFolder !== "未知季度" 
        ? `${BASIC_FOLDER_PATH}/${seasonYear}/${seasonFolder}`
        : BASIC_FOLDER_PATH;

    // 11. 创建笔记
    await createNote(QuickAdd, Info.fileName, noteFolderPath, Info);

    // 12. 自动循环
    if (AUTO_LOOP) try { await bangumi(QuickAdd); } catch (e) { console.error("自动继续出错", e); }
}

/* ======================
   搜索功能
   ====================== */

async function searchBangumi(url) {
    const res = await requestGet(url);
    if (!res) return null;

    const doc = parseHtmlToDom(res);
    const $ = s => doc.querySelector(s);
    const re = $("#browserItemList");
    if (!re) return null;

    const result = re.querySelectorAll(".inner");
    const itemList = [];

    // 添加"下一页"
    itemList.push({ 
        text: "下一页", 
        link: url + "&page=" + (++pageNum), 
        type: "none", 
        typeId: 8 
    });

    // 添加搜索结果
    for (let item of result) {
        const value = item.querySelector("h3 span")?.getAttribute("class") || "";
        if (value.includes("ico_subject_type subject_type_2")) {
            itemList.push({
                text: "🎞️ 《" + item.querySelector("h3 a").textContent.trim() + "》 \n" + item.querySelector(".info.tip").textContent.trim(),
                type: "anime",
                typeId: 2,
                link: "https://bgm.tv" + item.querySelector("h3 a").getAttribute("href")
            });
        }
    }

    if (itemList.length <= 1) return null; // 只有下一页按钮
    itemList.sort((a, b) => a.typeId - b.typeId);
    return itemList;
}

/* ======================
   抓取动画信息
   ====================== */

async function getAnimeByurl(url) {
    const page = await requestGet(url);
    if (!page) { notice("No results found."); return; }

    const doc = parseHtmlToDom(page);
    const $ = s => doc.querySelector(s);
    const $$ = s => doc.querySelectorAll(s);

    let workinginfo = {};

    // 验证类型
    if ($("#headerSubject")?.getAttribute('typeof') != "v:Movie") { 
        notice("您输入的作品不是动画！"); 
        return; 
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
        } catch (e) { console.error("日期转换失败", e); }
    }
    workinginfo.date = startdate;
    
    // 🔥 新增：自动检测改编类型
    workinginfo.detectedCategories = detectAdaptationTypeFromPage(doc, url);

    return workinginfo;
}

/* ======================
   模板生成（添加用户自定义字段）
   ====================== */

function generateTemplateContent(Info, downloadFolderPath = '', watchedEpisodes = '0', watchUrl = '', personalSummary = '') {
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
  
    // 用户自定义字段
    content += `**已观看集数**： ${watchedEpisodes}\n`;
    content += `**观看网址**： ${watchUrl}\n\n`;
    
    // 动画信息表格
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
    
    content += `\n---\n\n`;
    

    // Netaba评分趋势图表（如果可用）
    if (Info.netaba) {
        content += `<!-- Netaba评分趋势图 -->\n`;
        content += `<div style="width:100%;height:600px;max-width:100%;border:1px solid #ddd;border-radius:5px;overflow:hidden;">\n`;
        content += `<iframe src="${Info.netaba}" style="width:100%;height:600px;border:0;"></iframe>\n`;
        content += `</div>\n\n`;
    }
    
    // 个人总结区域
    content += `# 个人总结\n\n`;
    if (personalSummary) {
        content += `${personalSummary}\n\n`;
    } else {
        content += `<!-- 在这里写下您对这部动画的感想和评价 -->\n\n`;
    }
    
    return content.trim() + '\n';
}

/* ======================
   创建/更新笔记（保留用户自定义内容）
   ====================== */

async function createNote(QuickAdd, fileName, folderPath, Info) {
    const filePath = `${folderPath}/${fileName}.md`;
    let file, downloadFolderPath = null;

    // 1. 确保文件夹存在
    if (!app.vault.getAbstractFileByPath(folderPath)) {
        await app.vault.createFolder(folderPath);
    }

    // 2. 创建物理文件夹（如果用户选择）
    if (Info.createDownloadFolder) {
        downloadFolderPath = await createPhysicalFolder(filePath, Info.CN || Info.JP || fileName) || "无";
    } else {
        downloadFolderPath = "无";
    }

    // 3. 检查文件是否已存在
    file = app.vault.getAbstractFileByPath(filePath);
    
    if (file) {
        // 笔记已存在，询问是否覆盖
        const overwrite = await QuickAdd.quickAddApi.yesNoPrompt(
            "笔记已存在", 
            "是否覆盖现有笔记？\\n\\n✅ 将更新动画信息\\n✅ 保留您设置的'已观看集数'\\n✅ 保留您设置的'观看网址'\\n✅ 保留您撰写的'个人总结'"
        );
        
        if (!overwrite) return;
        
        // 读取旧笔记，提取用户内容
        const oldContent = await app.vault.read(file);
        const userContent = extractUserContent(oldContent);
        
        // 生成新内容，保留用户填写的内容
        const newContent = generateTemplateContent(
            Info, 
            downloadFolderPath, 
            userContent.watchedEpisodes, 
            userContent.watchUrl, 
            userContent.personalSummary
        );
        
        // 覆盖笔记
        await app.vault.modify(file, newContent);
        notice(`✅ 已更新笔记: ${fileName}，保留用户填写的内容`);
        
    } else {
        // 4. 文件不存在，创建新笔记
        const content = generateTemplateContent(Info, downloadFolderPath, '0', '', '');
        
        try {
            file = await app.vault.create(filePath, content);
            notice(`✅ 已创建笔记: ${fileName}${downloadFolderPath !== "无" ? " (含下载文件夹)" : ""}`);
        } catch (err) {
            notice(`创建笔记失败: ${err.message}`);
            return;
        }
    }

    // 5. 打开笔记
    if (file && OPEN_IN_MAIN_LEAF) {
        let targetLeaf = null;
        app.workspace.iterateAllLeaves(leaf => {
            let current = leaf.parent;
            while (current) {
                if (current === app.workspace.rootSplit) {
                    targetLeaf = leaf;
                    return;
                }
                current = current.parent;
            }
        });
        
        if (!targetLeaf) targetLeaf = app.vault.createLeafInParent(app.workspace.rootSplit);
        app.workspace.setActiveLeaf(targetLeaf);
        await targetLeaf.openFile(file);
    }
}