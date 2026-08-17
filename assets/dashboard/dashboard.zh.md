# ⚡ 学习状态总览

```dataviewjs
// ===== LifeOS 动态指挥舱 (全面重构版) =====
(function() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const todayDate = now.getDate();
    const oneDayMs = 1000 * 60 * 60 * 24;

    // 1. 颜色系统与主题变量（优先使用 Obsidian CSS 变量）
    const C = {
        mint:   '#2dd4bf',  // 已掌握、健康
        rose:   '#f43f5e',  // 紧急、待复习、衰减
        amber:  '#fb923c',  // 巩固中、黄金期、活跃
        sky:    '#38bdf8',  // 学习中、信息
        slate:  '#64748b',  // 冻结、次要
        bgCard: 'var(--background-secondary)',
        bgBase: 'var(--background-primary)',
        border: 'var(--background-modifier-border)',
        text:   'var(--text-normal)',
        muted:  'var(--text-muted)',
        shadow: '0 2px 8px rgba(0,0,0,0.08)', // 卡片阴影（深浅主题通用）
    };

    // 2. 工具函数
    function getMillis(dt) {
        if (!dt) return Date.now();
        if (typeof dt.toMillis === 'function') return dt.toMillis();
        if (typeof dt.getTime === 'function') return dt.getTime();
        if (typeof dt.ts === 'number') return dt.ts;
        if (typeof dt === 'number') return dt;
        try { return (new Date(dt)).getTime(); } catch(e) { return Date.now(); }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildExcludeSet(dv, projectPages) {
        const keys = new Set();
        // frozen 项目（复用入口已加载的项目页面）
        for (const p of projectPages) {
            if (!p || p.status !== "frozen") continue;
            if (p.file && p.file.path) {
                keys.add(p.file.path);
                keys.add(p.file.path.replace(/\.md$/, ''));
            }
            if (p.file && p.file.name) keys.add(p.file.name);
            if (p.file && p.file.basename) keys.add(p.file.basename);
            if (p.title) keys.add(String(p.title));
            if (p.id) keys.add(String(p.id));
        }
        // 归档项目（含 {归档项目目录}/ 及其所有子目录）
        for (const p of dv.pages('"{{archive_root}}/项目"')) {
            if (p.file && p.file.path) {
                keys.add(p.file.path);
                keys.add(p.file.path.replace(/\.md$/, ''));
            }
            if (p.file && p.file.name) keys.add(p.file.name);
            if (p.file && p.file.basename) keys.add(p.file.basename);
            if (p.title) keys.add(String(p.title));
            if (p.id) keys.add(String(p.id));
        }
        return keys;
    }

    function isExcluded(note, excludeSet) {
        if (!note || !note.project) return false;
        const p = note.project;
        if (typeof p === 'object') {
            if (p.path) {
                const pathKey = String(p.path).replace(/\.md$/, '');
                if (excludeSet.has(pathKey) || excludeSet.has(String(p.path))) return true;
            }
            if (p.file && p.file.path) {
                const pathKey = String(p.file.path).replace(/\.md$/, '');
                if (excludeSet.has(pathKey) || excludeSet.has(String(p.file.path))) return true;
            }
        }
        if (typeof p === 'string') {
            const name = p.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
            if (excludeSet.has(name) || excludeSet.has(name.replace(/\.md$/, ''))) return true;
        }
        return false;
    }

    function matchProject(note, proj) {
        if (!note || !note.project || !proj || !proj.file) return false;
        const p = note.project;
        const targets = new Set([
            proj.file.path,
            proj.file.path.replace(/\.md$/, ''),
            proj.file.name,
            proj.file.basename,
            proj.title ? String(proj.title) : null,
            proj.id ? String(proj.id) : null,
        ].filter(Boolean));

        if (typeof p === 'object') {
            if (p.path && (targets.has(p.path) || targets.has(String(p.path).replace(/\.md$/, '')))) return true;
            if (p.file && p.file.path && (targets.has(p.file.path) || targets.has(String(p.file.path).replace(/\.md$/, '')))) return true;
            if (p.file && p.file.name && targets.has(p.file.name)) return true;
            if (p.file && p.file.basename && targets.has(p.file.basename)) return true;
        }
        if (typeof p === 'string') {
            const clean = p.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
            if (targets.has(clean) || targets.has(clean.replace(/\.md$/, ''))) return true;
        }
        return false;
    }

    function getLastReviewDate(note, reviewRecords) {
        const folder = note.file ? note.file.folder : null;
        if (!folder) return getMillis(note.file ? note.file.mtime : null);
        
        const matched = reviewRecords.filter(r => 
            r.file && r.file.folder === folder && 
            (r.type === "review-record" || r.type === "revise-record") && 
            r.status === "graded"
        );
        if (matched.length > 0) {
            matched.sort((a, b) => getMillis(b.created || (b.file ? b.file.mtime : null)) - getMillis(a.created || (a.file ? a.file.mtime : null)));
            return getMillis(matched[0].created || (matched[0].file ? matched[0].file.mtime : null));
        }
        return getMillis(note.file ? note.file.mtime : null);
    }

    function getStatusDot(status) {
        switch (status) {
            case "draft": return "⚪";
            case "review": return "🔴";
            case "revised": return "🟡";
            case "mastered": return "🟢";
            default: return "⚪";
        }
    }

    function getStatusBadge(status) {
        switch (status) {
            case "draft": return { text: "学习中", color: C.sky, bg: "color-mix(in srgb, #38bdf8 15%, transparent)" };
            case "review": return { text: "待复习", color: C.rose, bg: "color-mix(in srgb, #f43f5e 15%, transparent)" };
            case "revised": return { text: "巩固中", color: C.amber, bg: "color-mix(in srgb, #fb923c 15%, transparent)" };
            case "mastered": return { text: "已掌握", color: C.mint, bg: "color-mix(in srgb, #2dd4bf 15%, transparent)" };
            default: return { text: status || "未知", color: C.slate, bg: "color-mix(in srgb, #64748b 15%, transparent)" };
        }
    }

    // 3. 数据预加载与聚合（一次性加载全量页面，各区块复用）
    const allProjectPages = dv.pages('"{{projects}}"');
    const allKnowledgePages = dv.pages('"{{knowledge_notes}}"');

    const excludeSet = buildExcludeSet(dv, allProjectPages);

    const allKnowledge = allKnowledgePages.where(n => n && n.type === "knowledge");
    const totalNotes = allKnowledge.length || 0;
    const masteredNotes = allKnowledge.where(n => n.status === "mastered");
    const masteredCount = masteredNotes.length;

    // 活跃复习链路笔记（排除 frozen 与归档项目）
    const knowledgeInReviewChain = allKnowledge.where(n => !isExcluded(n, excludeSet));
    const activeReviewNotes = knowledgeInReviewChain.where(n => n.status === "review" || n.status === "revised");
    const activeDraftNotes = knowledgeInReviewChain.where(n => n.status === "draft");

    const reviewCount = activeReviewNotes.length;
    const draftCount = activeDraftNotes.length;

    // 生命周期流转：全量统计（含排除集内笔记），与计划数据模型一致
    const funnelReviewCount = allKnowledge.where(n => n.status === "review" || n.status === "revised").length;
    const funnelDraftCount = allKnowledge.where(n => n.status === "draft").length;

    const masteryPct = totalNotes > 0 ? Math.round((masteredCount / totalNotes) * 100) : 0;
    const funnelReviewPct = totalNotes > 0 ? Math.round((funnelReviewCount / totalNotes) * 100) : 0;
    const funnelDraftPct = totalNotes > 0 ? Math.round((funnelDraftCount / totalNotes) * 100) : 0;

    const activeProjects = allProjectPages.where(p => p && p.status === "active");
    const activeProjCount = activeProjects.length;

    const frozenProjects = allProjectPages.where(p => p && p.status === "frozen");
    const frozenProjCount = frozenProjects.length;

    const allDrafts = dv.pages('"{{drafts}}"').where(d => d && (d.status === "pending" || d.type === "draft"));
    const pendingDrafts = allDrafts.where(d => d.status === "pending");

    // 复习记录：兼容 review-record（早期）与 revise-record（后期）两种 type
    const allReviewRecords = allKnowledgePages.where(r => r && (r.type === "review-record" || r.type === "revise-record") && r.status === "graded");

    // ===== 区块 1：🎯 今日焦点 (Focus) =====
    function renderFocusBlock(container) {
        // 紧急复习：status ∈ {review, revised} 且不在排除集，按 mtime ASC 取 top 5
        const urgentList = Array.from(activeReviewNotes)
            .sort((a, b) => getMillis(a.file ? a.file.mtime : null) - getMillis(b.file ? b.file.mtime : null))
            .slice(0, 5);

        // 待处理草稿：按 created/mtime DESC 取 top 3
        const draftList = Array.from(pendingDrafts)
            .sort((a, b) => getMillis(b.created || (b.file ? b.file.mtime : null)) - getMillis(a.created || (a.file ? a.file.mtime : null)))
            .slice(0, 3);

        let urgentContentHtml = '';
        if (urgentList.length === 0) {
            urgentContentHtml = `
            <div style="padding: 16px; text-align: center; color: ${C.mint}; background: var(--background-primary); border-radius: 6px; font-size: 0.9em;">
                ✅ 今日无紧急复习，保持好节奏！
            </div>`;
        } else {
            urgentContentHtml = urgentList.map(note => {
                const badge = getStatusBadge(note.status);
                const nTime = getMillis(note.file ? note.file.mtime : null);
                const daysAgo = Math.floor((now.getTime() - nTime) / oneDayMs);
                const daysText = daysAgo === 0 ? '今天修改' : (daysAgo === 1 ? '昨天修改' : `${daysAgo} 天前修改`);
                const noteName = note.file ? note.file.name.replace(/\.md$/, '') : (note.title || '笔记');
                const notePath = note.file ? note.file.path : '';

                return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--background-modifier-border);">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; font-size: 0.88em;">
                        📄 <a class="internal-link" href="${esc(notePath)}">${esc(noteName)}</a>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 0.76em;">
                        <span style="background: ${badge.bg}; color: ${badge.color}; padding: 1px 6px; border-radius: 4px; font-weight: 500;">${badge.text}</span>
                        <span style="color: ${C.muted};">${daysText}</span>
                    </div>
                </div>`;
            }).join('');
        }

        let draftContentHtml = '';
        if (draftList.length === 0) {
            draftContentHtml = `
            <div style="padding: 16px; text-align: center; color: ${C.muted}; background: var(--background-primary); border-radius: 6px; font-size: 0.9em;">
                ✨ 暂无待处理草稿，灵感库井然有序！
            </div>`;
        } else {
            draftContentHtml = draftList.map(draft => {
                const draftName = draft.file ? draft.file.name.replace(/\.md$/, '') : (draft.title || '草稿');
                const draftPath = draft.file ? draft.file.path : '';
                const dTime = getMillis(draft.created || (draft.file ? draft.file.mtime : null));
                const daysAgo = Math.floor((now.getTime() - dTime) / oneDayMs);
                const daysText = daysAgo === 0 ? '今天' : `${daysAgo}天前`;

                return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px dashed var(--background-modifier-border);">
                    <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px; font-size: 0.88em;">
                        💡 <a class="internal-link" href="${esc(draftPath)}">${esc(draftName)}</a>
                    </div>
                    <span style="color: ${C.muted}; font-size: 0.76em; flex-shrink: 0;">${daysText}</span>
                </div>`;
            }).join('');
        }

        container.innerHTML = `
        <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; margin-bottom: 20px; box-shadow: ${C.shadow};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <h3 style="margin: 0; font-size: 1.05em; display: flex; align-items: center; gap: 6px;">
                    🎯 今日焦点 <span style="font-size: 0.75em; font-weight: normal; color: ${C.muted};">Today's Focus</span>
                </h3>
                <span style="font-size: 0.75em; color: ${C.muted};">优先推进高价值与亟需巩固任务</span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 12px;">
                <div style="background: var(--background-primary); border-radius: 8px; padding: 12px; border: 1px solid ${C.border};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; font-size: 0.85em; color: ${C.rose};">🔥 最紧急待复习 (${urgentList.length}/${reviewCount})</span>
                        <span style="font-size: 0.72em; color: ${C.muted};">按最久未触排序</span>
                    </div>
                    ${urgentContentHtml}
                </div>

                <div style="background: var(--background-primary); border-radius: 8px; padding: 12px; border: 1px solid ${C.border};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; font-size: 0.85em; color: ${C.sky};">📝 待处理草稿 (${draftList.length}/${pendingDrafts.length})</span>
                        <span style="font-size: 0.72em; color: ${C.muted};">最新捕获灵感</span>
                    </div>
                    ${draftContentHtml}
                </div>
            </div>

            <div style="font-size: 0.78em; color: ${C.muted}; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; display: flex; align-items: center; gap: 6px;">
                <span>💡</span>
                <span><b>行动建议：</b>优先使用 <code>/revise</code> 消除紧急复习积压，或使用 <code>/knowledge</code> 将草稿转化为结构化知识笔记。</span>
            </div>
        </div>`;
    }

    // ===== 区块 2：📊 全局 KPI × 4 + ⏳ 知识生命周期流转 =====
    function renderKpiAndFunnelBlock(container) {
        container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px;">
            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.mint}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">🟢 全库掌握率</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.mint}; margin: 2px 0;">${masteryPct}%</div>
                <div style="font-size: 0.72em; color: ${C.muted};">已掌握 ${masteredCount} / 共 ${totalNotes} 篇</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.rose}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">🚨 待复习</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.rose}; margin: 2px 0;">${reviewCount} 篇</div>
                <div style="font-size: 0.72em; color: ${C.muted};">已整理待巩固</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.sky}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">📝 学习中</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.sky}; margin: 2px 0;">${draftCount} 篇</div>
                <div style="font-size: 0.72em; color: ${C.muted};">草稿与整理中</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.amber}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">📚 活跃项目</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.amber}; margin: 2px 0;">${activeProjCount} 个</div>
                <div style="font-size: 0.72em; color: ${C.muted};">正在推进的项目</div>
            </div>
        </div>

        <div style="background: ${C.bgCard}; border-radius: 10px; padding: 14px 16px; border: 1px solid ${C.border}; margin-bottom: 20px; box-shadow: ${C.shadow};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 0.92em; display: flex; align-items: center; gap: 6px;">
                    ⏳ 知识生命周期流转
                </h4>
                <span style="font-size: 0.75em; color: ${C.muted};">掌握 ${masteryPct}% | 巩固中 ${funnelReviewPct}% | 学习中 ${funnelDraftPct}%</span>
            </div>
            <div style="display: flex; height: 9px; width: 100%; border-radius: 5px; overflow: hidden; background: var(--background-modifier-border); margin-bottom: 10px;">
                <div style="width: ${masteryPct}%; background: ${C.mint};" title="已掌握 (${masteredCount}篇)"></div>
                <div style="width: ${funnelReviewPct}%; background: ${C.amber};" title="待复习/巩固中 (${funnelReviewCount}篇)"></div>
                <div style="width: ${funnelDraftPct}%; background: ${C.sky};" title="学习中 (${funnelDraftCount}篇)"></div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.75em; color: ${C.text};">
                <div><span style="color: ${C.mint};">●</span> 已掌握: <b>${masteredCount} 篇</b> (${masteryPct}%)</div>
                <div><span style="color: ${C.amber};">●</span> 待复习/巩固: <b>${funnelReviewCount} 篇</b> (${funnelReviewPct}%)</div>
                <div><span style="color: ${C.sky};">●</span> 学习中: <b>${funnelDraftCount} 篇</b> (${funnelDraftPct}%)</div>
            </div>
        </div>`;
    }

    // ===== 区块 3：📚 活跃项目进度矩阵 =====
    function renderProjectMatrix(container) {
        let projectsHtml = '';

        if (activeProjects.length === 0) {
            projectsHtml = `
            <div style="padding: 16px; text-align: center; color: ${C.muted}; background: var(--background-primary); border-radius: 6px; font-size: 0.9em;">
                暂无活跃项目，可使用 <code>/project</code> 启动新项目。
            </div>`;
        } else {
            projectsHtml = Array.from(activeProjects).map(proj => {
                const projNotes = Array.from(allKnowledge.where(n => matchProject(n, proj)))
                    .sort((a, b) => {
                        const pathA = a.file ? a.file.path : '';
                        const pathB = b.file ? b.file.path : '';
                        return pathA.localeCompare(pathB, 'zh-CN');
                    });

                const total = projNotes.length;
                const mastered = projNotes.filter(n => n.status === "mastered").length;
                const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

                const projName = proj.title || (proj.file ? proj.file.basename : '未命名项目');
                const projPath = proj.file ? proj.file.path : '';

                let dotsHtml = '';
                if (total === 0) {
                    dotsHtml = `<span style="color: ${C.muted}; font-size: 0.78em;">（暂无关联知识笔记）</span>`;
                } else {
                    dotsHtml = projNotes.map(n => {
                        const dot = getStatusDot(n.status);
                        const nName = n.file ? n.file.basename : (n.title || '笔记');
                        const nPath = n.file ? n.file.path : '';
                        const badge = getStatusBadge(n.status);
                        return `<a class="internal-link" style="text-decoration: none; font-size: 0.92em; padding: 0 1px;" href="${esc(nPath)}" title="${esc(nName)} · ${esc(badge.text)}">${dot}</a>`;
                    }).join(' ');
                }

                return `
                <div style="background: var(--background-primary); border-radius: 8px; padding: 12px 14px; border: 1px solid ${C.border}; margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
                        <div style="font-weight: 600; font-size: 0.92em;">
                            📖 <a class="internal-link" href="${esc(projPath)}">${esc(projName)}</a>
                        </div>
                        <div style="font-size: 0.78em; color: ${C.muted};">
                            掌握度 <b style="color: ${pct === 100 ? C.mint : (pct > 0 ? C.amber : C.muted)};">${pct}%</b> (${mastered}/${total})
                        </div>
                    </div>
                    
                    <div style="display: flex; height: 6px; width: 100%; border-radius: 3px; overflow: hidden; background: var(--background-modifier-border); margin-bottom: 8px;">
                        <div style="width: ${pct}%; background: ${C.mint};"></div>
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            ${dotsHtml}
                        </div>
                        <div style="font-size: 0.72em; color: ${C.muted};">
                            ⚪学习中 🔴待复习 🟡巩固中 🟢已掌握
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        container.innerHTML = `
        <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; margin-bottom: 20px; box-shadow: ${C.shadow};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; font-size: 0.98em; display: flex; align-items: center; gap: 6px; color: ${C.amber};">
                    📚 活跃项目进度矩阵
                </h4>
                <span style="font-size: 0.75em; color: ${C.muted};">推进中的项目掌握度与章节状态</span>
            </div>

            ${projectsHtml}

            <div style="margin-top: 10px; padding: 8px 12px; background: var(--background-primary); border-radius: 6px; font-size: 0.8em; color: ${C.muted}; display: flex; align-items: center; justify-content: space-between;">
                <span>❄️ 另有 <b>${frozenProjCount}</b> 个冻结项目</span>
                <span style="font-size: 0.75em; opacity: 0.85;">（已暂停推进，不计入待复习队列）</span>
            </div>
        </div>`;
    }

    // ===== 区块 4：🗓️ 月度热力图 + 🧠 遗忘衰减 (并排网格) =====
    function renderHeatmapAndDecay(container) {
        // --- 4.1 热力图计算 (仅主动学习路径：知识/笔记、研究、草稿；排除归档) ---
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const dayActivityMap = {};
        for (let i = 1; i <= daysInMonth; i++) dayActivityMap[i] = 0;

        const activityPages = dv.pages('"{{knowledge_notes}}" or "{{research}}" or "{{drafts}}"')
            .where(p => p && p.file && p.file.path && !p.file.path.includes("{{archive_root}}"));

        let monthlyTotalActivity = 0;

        for (let p of activityPages) {
            if (!p.file || !p.file.mtime) continue;
            const pTime = new Date(getMillis(p.file.mtime));
            if (pTime.getFullYear() === currentYear && pTime.getMonth() === currentMonth) {
                const dayNum = pTime.getDate();
                if (dayActivityMap[dayNum] !== undefined) {
                    dayActivityMap[dayNum] += 1;
                    monthlyTotalActivity += 1;
                }
            }
        }

        const monthName = `${currentYear}年${currentMonth + 1}月`;
        let heatCellsHtml = '';
        for (let day = 1; day <= daysInMonth; day++) {
            const count = dayActivityMap[day];
            let bgColor = 'var(--background-primary)';
            let borderStyle = `1px solid ${C.border}`;
            let textColor = 'var(--text-normal)';

            if (count > 0 && count <= 2) {
                bgColor = 'rgba(45, 212, 191, 0.2)';
                borderStyle = '1px solid rgba(45, 212, 191, 0.35)';
            } else if (count >= 3 && count <= 5) {
                bgColor = 'rgba(45, 212, 191, 0.5)';
                borderStyle = `1px solid ${C.mint}`;
            } else if (count >= 6) {
                bgColor = C.mint;
                borderStyle = '1px solid var(--text-accent, #2dd4bf)';
                textColor = '#0f172a';
            }

            const isToday = (day === todayDate);
            const todayStyle = isToday ? `box-shadow: 0 0 0 2px ${C.mint}; font-weight: bold;` : '';

            heatCellsHtml += `
            <div title="${monthName}${day}日: ${count} 次学习活动" style="background: ${bgColor}; border: ${borderStyle}; border-radius: 4px; aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.68em; color: ${textColor}; ${todayStyle}">
                <span>${day}</span>
            </div>`;
        }

        // --- 4.2 遗忘衰减计算 (基于最新复习记录日期，兜底 mtime；仅统计活跃链路笔记) ---
        const decayBaseNotes = knowledgeInReviewChain;
        const decayBaseCount = decayBaseNotes.length || 0;
        let freshCount = 0;
        let warmCount = 0;
        let decayCount = 0;

        for (let n of decayBaseNotes) {
            const lastTime = getLastReviewDate(n, allReviewRecords);
            const dDays = Math.floor((now.getTime() - lastTime) / oneDayMs);
            if (dDays < 3) freshCount++;
            else if (dDays <= 6) warmCount++;
            else decayCount++;
        }

        const freshPct = decayBaseCount > 0 ? Math.round((freshCount / decayBaseCount) * 100) : 0;
        const warmPct = decayBaseCount > 0 ? Math.round((warmCount / decayBaseCount) * 100) : 0;
        const decayPct = decayBaseCount > 0 ? Math.round((decayCount / decayBaseCount) * 100) : 0;

        container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-bottom: 20px;">
            <!-- 热力图卡片 -->
            <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; box-shadow: ${C.shadow};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: ${C.mint}; font-size: 0.95em; display: flex; align-items: center; gap: 6px;">
                        🗓️ 当月学习热力图 (${monthName})
                    </h4>
                    <span style="font-size: 0.72em; color: ${C.muted};">累计动态: <b>${monthlyTotalActivity}</b> 次</span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(24px, 1fr)); gap: 5px; margin-bottom: 10px;">
                    ${heatCellsHtml}
                </div>

                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 6px; font-size: 0.7em; color: ${C.muted};">
                    <span>无活动</span>
                    <span style="width: 9px; height: 9px; background: var(--background-primary); border-radius: 2px; border: 1px solid ${C.border};"></span>
                    <span style="width: 9px; height: 9px; background: rgba(45, 212, 191, 0.2); border-radius: 2px;"></span>
                    <span style="width: 9px; height: 9px; background: rgba(45, 212, 191, 0.5); border-radius: 2px;"></span>
                    <span style="width: 9px; height: 9px; background: ${C.mint}; border-radius: 2px;"></span>
                    <span>频繁</span>
                </div>
            </div>

            <!-- 遗忘衰减卡片 -->
            <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; box-shadow: ${C.shadow}; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h4 style="margin: 0; color: ${C.rose}; font-size: 0.95em; display: flex; align-items: center; gap: 6px;">
                            🧠 艾宾浩斯遗忘衰减
                        </h4>
                        <span style="font-size: 0.72em; color: ${C.muted};">基于实际复习记录</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="background: var(--background-primary); border-left: 3px solid ${C.mint}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🟢 新近温习 (< 3天)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.mint};">${freshCount} 篇</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${freshPct}%</div>
                        </div>

                        <div style="background: var(--background-primary); border-left: 3px solid ${C.amber}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🟠 黄金温习期 (3~6天)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.amber};">${warmCount} 篇</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${warmPct}%</div>
                        </div>

                        <div style="background: var(--background-primary); border-left: 3px solid ${C.rose}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🔴 遗忘衰减区 (≥ 7天)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.rose};">${decayCount} 篇</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${decayPct}%</div>
                        </div>
                    </div>
                </div>

                <div style="font-size: 0.72em; color: ${C.muted}; margin-top: 8px; text-align: right;">
                    优先使用复习记录 <code>created</code>，无记录时兜底 <code>mtime</code>
                </div>
            </div>
        </div>`;
    }

    // 4. 按顺序执行模块化渲染
    const focusDom = dv.el('div', '');
    renderFocusBlock(focusDom);

    const kpiDom = dv.el('div', '');
    renderKpiAndFunnelBlock(kpiDom);

    const matrixDom = dv.el('div', '');
    renderProjectMatrix(matrixDom);

    const heatmapDecayDom = dv.el('div', '');
    renderHeatmapAndDecay(heatmapDecayDom);

})();
```

## 🚨 待复习

<!-- 说明：本表仅列出 review / revised 状态（draft 需先通过 /knowledge 整理完成，不计入待复习）且排除关联冻结（status: frozen）或已归档（文件位于 {归档项目目录}）项目的笔记；project 链接无法解析（标题形式/纯字符串/指向不存在文件）的笔记同样不显示，避免冻结/归档项目笔记漏出。 -->

```dataview
TABLE WITHOUT ID
    file.link as "🚨 章节笔记名称",
    status as "当前状态",
    domain as "所属领域",
    dateformat(file.mtime, "yyyy-MM-dd HH:mm") as "最后修改时间"
FROM "{{knowledge_notes}}"
WHERE type = "knowledge" AND (status = "review" OR status = "revised")
  AND ( !project OR ( project.file != null AND !contains(project.file.path, "{{archive_root}}/项目") AND project.status != "frozen" ) )
SORT file.mtime ASC
```

## 📚 活跃项目

```dataview
TABLE WITHOUT ID
    file.link as "📖 活跃项目名称",
    category as "类别",
    priority as "优先级",
    domain as "主领域",
    status as "当前状态"
FROM "{{projects}}"
WHERE status = "active"
```
