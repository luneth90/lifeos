# ⚡ Learning Status Overview

```dataviewjs
// ===== LifeOS Dynamic Command Center (Fully Refactored) =====
(function() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const todayDate = now.getDate();
    const oneDayMs = 1000 * 60 * 60 * 24;

    // 1. Color system & theme variables (prefer Obsidian CSS variables)
    const C = {
        mint:   '#2dd4bf',  // mastered, healthy
        rose:   '#f43f5e',  // urgent, needs review, decay
        amber:  '#fb923c',  // consolidating, golden window, active
        sky:    '#38bdf8',  // learning, info
        slate:  '#64748b',  // frozen, secondary
        bgCard: 'var(--background-secondary)',
        bgBase: 'var(--background-primary)',
        border: 'var(--background-modifier-border)',
        text:   'var(--text-normal)',
        muted:  'var(--text-muted)',
        shadow: '0 2px 8px rgba(0,0,0,0.08)', // card shadow (works in light & dark themes)
    };

    // 2. Utility functions
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
        // frozen projects (reuse the project pages already loaded at the entry)
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
        // archived projects (including {archive projects directory}/ and all its subdirectories)
        for (const p of dv.pages('"{{archive_root}}/Projects"')) {
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
            case "draft": return { text: "Learning", color: C.sky, bg: "color-mix(in srgb, #38bdf8 15%, transparent)" };
            case "review": return { text: "Needs review", color: C.rose, bg: "color-mix(in srgb, #f43f5e 15%, transparent)" };
            case "revised": return { text: "Consolidating", color: C.amber, bg: "color-mix(in srgb, #fb923c 15%, transparent)" };
            case "mastered": return { text: "Mastered", color: C.mint, bg: "color-mix(in srgb, #2dd4bf 15%, transparent)" };
            default: return { text: status || "Unknown", color: C.slate, bg: "color-mix(in srgb, #64748b 15%, transparent)" };
        }
    }

    // 3. Data preloading & aggregation (load all pages once; each section reuses them)
    const allProjectPages = dv.pages('"{{projects}}"');
    const allKnowledgePages = dv.pages('"{{knowledge_notes}}"');

    const excludeSet = buildExcludeSet(dv, allProjectPages);

    const allKnowledge = allKnowledgePages.where(n => n && n.type === "knowledge");
    const totalNotes = allKnowledge.length || 0;
    const masteredNotes = allKnowledge.where(n => n.status === "mastered");
    const masteredCount = masteredNotes.length;

    // Notes in the active review chain (excluding frozen & archived projects)
    const knowledgeInReviewChain = allKnowledge.where(n => !isExcluded(n, excludeSet));
    const activeReviewNotes = knowledgeInReviewChain.where(n => n.status === "review" || n.status === "revised");
    const activeDraftNotes = knowledgeInReviewChain.where(n => n.status === "draft");

    const reviewCount = activeReviewNotes.length;
    const draftCount = activeDraftNotes.length;

    // Lifecycle funnel: full counts (including excluded notes), consistent with the planning data model
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

    // Review records: support both review-record (early) and revise-record (later) types
    const allReviewRecords = allKnowledgePages.where(r => r && (r.type === "review-record" || r.type === "revise-record") && r.status === "graded");

    // ===== Section 1: 🎯 Today's Focus =====
    function renderFocusBlock(container) {
        // Urgent reviews: status ∈ {review, revised}, not in the exclude set, top 5 by mtime ASC
        const urgentList = Array.from(activeReviewNotes)
            .sort((a, b) => getMillis(a.file ? a.file.mtime : null) - getMillis(b.file ? b.file.mtime : null))
            .slice(0, 5);

        // Pending drafts: top 3 by created/mtime DESC
        const draftList = Array.from(pendingDrafts)
            .sort((a, b) => getMillis(b.created || (b.file ? b.file.mtime : null)) - getMillis(a.created || (a.file ? a.file.mtime : null)))
            .slice(0, 3);

        let urgentContentHtml = '';
        if (urgentList.length === 0) {
            urgentContentHtml = `
            <div style="padding: 16px; text-align: center; color: ${C.mint}; background: var(--background-primary); border-radius: 6px; font-size: 0.9em;">
                ✅ No urgent reviews today — keep up the great pace!
            </div>`;
        } else {
            urgentContentHtml = urgentList.map(note => {
                const badge = getStatusBadge(note.status);
                const nTime = getMillis(note.file ? note.file.mtime : null);
                const daysAgo = Math.floor((now.getTime() - nTime) / oneDayMs);
                const daysText = daysAgo === 0 ? 'modified today' : (daysAgo === 1 ? 'modified yesterday' : `modified ${daysAgo} days ago`);
                const noteName = note.file ? note.file.name.replace(/\.md$/, '') : (note.title || 'note');
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
                ✨ No pending drafts — your idea inbox is nicely organized!
            </div>`;
        } else {
            draftContentHtml = draftList.map(draft => {
                const draftName = draft.file ? draft.file.name.replace(/\.md$/, '') : (draft.title || 'draft');
                const draftPath = draft.file ? draft.file.path : '';
                const dTime = getMillis(draft.created || (draft.file ? draft.file.mtime : null));
                const daysAgo = Math.floor((now.getTime() - dTime) / oneDayMs);
                const daysText = daysAgo === 0 ? 'today' : `${daysAgo}d ago`;

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
                    🎯 Today's Focus <span style="font-size: 0.75em; font-weight: normal; color: ${C.muted};">What to do today</span>
                </h3>
                <span style="font-size: 0.75em; color: ${C.muted};">Prioritize high-value tasks and those needing consolidation</span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 12px;">
                <div style="background: var(--background-primary); border-radius: 8px; padding: 12px; border: 1px solid ${C.border};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; font-size: 0.85em; color: ${C.rose};">🔥 Most Urgent Reviews (${urgentList.length}/${reviewCount})</span>
                        <span style="font-size: 0.72em; color: ${C.muted};">Sorted by longest untouched</span>
                    </div>
                    ${urgentContentHtml}
                </div>

                <div style="background: var(--background-primary); border-radius: 8px; padding: 12px; border: 1px solid ${C.border};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; font-size: 0.85em; color: ${C.sky};">📝 Pending Drafts (${draftList.length}/${pendingDrafts.length})</span>
                        <span style="font-size: 0.72em; color: ${C.muted};">Latest captured ideas</span>
                    </div>
                    ${draftContentHtml}
                </div>
            </div>

            <div style="font-size: 0.78em; color: ${C.muted}; padding: 6px 10px; background: var(--background-primary); border-radius: 6px; display: flex; align-items: center; gap: 6px;">
                <span>💡</span>
                <span><b>Suggested action:</b> use <code>/revise</code> to clear the review backlog, or <code>/knowledge</code> to turn drafts into structured knowledge notes.</span>
            </div>
        </div>`;
    }

    // ===== Section 2: 📊 Global KPI × 4 + ⏳ Knowledge Lifecycle Flow =====
    function renderKpiAndFunnelBlock(container) {
        container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px;">
            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.mint}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">🟢 Vault Mastery Rate</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.mint}; margin: 2px 0;">${masteryPct}%</div>
                <div style="font-size: 0.72em; color: ${C.muted};">Mastered ${masteredCount} / ${totalNotes} notes</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.rose}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">🚨 Needs Review</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.rose}; margin: 2px 0;">${reviewCount} notes</div>
                <div style="font-size: 0.72em; color: ${C.muted};">Organized, awaiting review</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.sky}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">📝 Learning</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.sky}; margin: 2px 0;">${draftCount} notes</div>
                <div style="font-size: 0.72em; color: ${C.muted};">Drafts in progress</div>
            </div>

            <div style="background: ${C.bgCard}; border-top: 3px solid ${C.amber}; border-radius: 8px; padding: 12px; text-align: center; box-shadow: ${C.shadow}; border-left: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                <div style="font-size: 0.8em; color: ${C.muted};">📚 Active Projects</div>
                <div style="font-size: 1.55em; font-weight: bold; color: ${C.amber}; margin: 2px 0;">${activeProjCount}</div>
                <div style="font-size: 0.72em; color: ${C.muted};">Projects in motion</div>
            </div>
        </div>

        <div style="background: ${C.bgCard}; border-radius: 10px; padding: 14px 16px; border: 1px solid ${C.border}; margin-bottom: 20px; box-shadow: ${C.shadow};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 0.92em; display: flex; align-items: center; gap: 6px;">
                    ⏳ Knowledge Lifecycle Flow
                </h4>
                <span style="font-size: 0.75em; color: ${C.muted};">Mastered ${masteryPct}% | Consolidating ${funnelReviewPct}% | Learning ${funnelDraftPct}%</span>
            </div>
            <div style="display: flex; height: 9px; width: 100%; border-radius: 5px; overflow: hidden; background: var(--background-modifier-border); margin-bottom: 10px;">
                <div style="width: ${masteryPct}%; background: ${C.mint};" title="Mastered (${masteredCount} notes)"></div>
                <div style="width: ${funnelReviewPct}%; background: ${C.amber};" title="Needs review / consolidating (${funnelReviewCount} notes)"></div>
                <div style="width: ${funnelDraftPct}%; background: ${C.sky};" title="Learning (${funnelDraftCount} notes)"></div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.75em; color: ${C.text};">
                <div><span style="color: ${C.mint};">●</span> Mastered: <b>${masteredCount} notes</b> (${masteryPct}%)</div>
                <div><span style="color: ${C.amber};">●</span> Needs review / consolidating: <b>${funnelReviewCount} notes</b> (${funnelReviewPct}%)</div>
                <div><span style="color: ${C.sky};">●</span> Learning: <b>${funnelDraftCount} notes</b> (${funnelDraftPct}%)</div>
            </div>
        </div>`;
    }

    // ===== Section 3: 📚 Active Project Progress Matrix =====
    function renderProjectMatrix(container) {
        let projectsHtml = '';

        if (activeProjects.length === 0) {
            projectsHtml = `
            <div style="padding: 16px; text-align: center; color: ${C.muted}; background: var(--background-primary); border-radius: 6px; font-size: 0.9em;">
                No active projects — start a new one with <code>/project</code>.
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

                const projName = proj.title || (proj.file ? proj.file.basename : 'Untitled project');
                const projPath = proj.file ? proj.file.path : '';

                let dotsHtml = '';
                if (total === 0) {
                    dotsHtml = `<span style="color: ${C.muted}; font-size: 0.78em;">(no linked knowledge notes yet)</span>`;
                } else {
                    dotsHtml = projNotes.map(n => {
                        const dot = getStatusDot(n.status);
                        const nName = n.file ? n.file.basename : (n.title || 'note');
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
                            Mastery <b style="color: ${pct === 100 ? C.mint : (pct > 0 ? C.amber : C.muted)};">${pct}%</b> (${mastered}/${total})
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
                            ⚪ Learning 🔴 Needs review 🟡 Consolidating 🟢 Mastered
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        container.innerHTML = `
        <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; margin-bottom: 20px; box-shadow: ${C.shadow};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; font-size: 0.98em; display: flex; align-items: center; gap: 6px; color: ${C.amber};">
                    📚 Active Project Progress Matrix
                </h4>
                <span style="font-size: 0.75em; color: ${C.muted};">Mastery and note status across active projects</span>
            </div>

            ${projectsHtml}

            <div style="margin-top: 10px; padding: 8px 12px; background: var(--background-primary); border-radius: 6px; font-size: 0.8em; color: ${C.muted}; display: flex; align-items: center; justify-content: space-between;">
                <span>❄️ Plus <b>${frozenProjCount}</b> frozen projects</span>
                <span style="font-size: 0.75em; opacity: 0.85;">(paused; excluded from the review queue)</span>
            </div>
        </div>`;
    }

    // ===== Section 4: 🗓️ Monthly Heatmap + 🧠 Forgetting Decay (side-by-side grid) =====
    function renderHeatmapAndDecay(container) {
        // --- 4.1 Heatmap calculation (active learning paths only: knowledge notes, research, drafts; excludes archive) ---
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

        const monthName = `${currentYear}-${currentMonth + 1}`;
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
            <div title="${monthName} ${day}: ${count} learning activities" style="background: ${bgColor}; border: ${borderStyle}; border-radius: 4px; aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 0.68em; color: ${textColor}; ${todayStyle}">
                <span>${day}</span>
            </div>`;
        }

        // --- 4.2 Forgetting decay calculation (latest review record date, fallback to mtime; active-chain notes only) ---
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
            <!-- Heatmap card -->
            <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; box-shadow: ${C.shadow};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="margin: 0; color: ${C.mint}; font-size: 0.95em; display: flex; align-items: center; gap: 6px;">
                        🗓️ Monthly Learning Heatmap (${monthName})
                    </h4>
                    <span style="font-size: 0.72em; color: ${C.muted};">Total activity: <b>${monthlyTotalActivity}</b></span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(24px, 1fr)); gap: 5px; margin-bottom: 10px;">
                    ${heatCellsHtml}
                </div>

                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 6px; font-size: 0.7em; color: ${C.muted};">
                    <span>No activity</span>
                    <span style="width: 9px; height: 9px; background: var(--background-primary); border-radius: 2px; border: 1px solid ${C.border};"></span>
                    <span style="width: 9px; height: 9px; background: rgba(45, 212, 191, 0.2); border-radius: 2px;"></span>
                    <span style="width: 9px; height: 9px; background: rgba(45, 212, 191, 0.5); border-radius: 2px;"></span>
                    <span style="width: 9px; height: 9px; background: ${C.mint}; border-radius: 2px;"></span>
                    <span>Frequent</span>
                </div>
            </div>

            <!-- Forgetting decay card -->
            <div style="background: ${C.bgCard}; border-radius: 10px; padding: 16px; border: 1px solid ${C.border}; box-shadow: ${C.shadow}; display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h4 style="margin: 0; color: ${C.rose}; font-size: 0.95em; display: flex; align-items: center; gap: 6px;">
                            🧠 Ebbinghaus Forgetting Decay
                        </h4>
                        <span style="font-size: 0.72em; color: ${C.muted};">Based on actual review records</span>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div style="background: var(--background-primary); border-left: 3px solid ${C.mint}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🟢 Recently Reviewed (< 3 days)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.mint};">${freshCount} notes</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${freshPct}%</div>
                        </div>

                        <div style="background: var(--background-primary); border-left: 3px solid ${C.amber}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🟠 Golden Review Window (3–6 days)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.amber};">${warmCount} notes</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${warmPct}%</div>
                        </div>

                        <div style="background: var(--background-primary); border-left: 3px solid ${C.rose}; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid ${C.border}; border-right: 1px solid ${C.border}; border-bottom: 1px solid ${C.border};">
                            <div>
                                <div style="font-size: 0.76em; color: ${C.muted};">🔴 Decay Zone (≥ 7 days)</div>
                                <div style="font-size: 1.15em; font-weight: bold; color: ${C.rose};">${decayCount} notes</div>
                            </div>
                            <div style="font-size: 0.85em; font-weight: bold; color: ${C.muted};">${decayPct}%</div>
                        </div>
                    </div>
                </div>

                <div style="font-size: 0.72em; color: ${C.muted}; margin-top: 8px; text-align: right;">
                    Prefers the review record <code>created</code>; falls back to <code>mtime</code> when missing
                </div>
            </div>
        </div>`;
    }

    // 4. Execute the modular renders in order
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

## 🚨 Needs Review

<!-- Note: this table only lists notes with review / revised status (drafts must first be processed via /knowledge, so they are not included), and excludes notes linked to frozen (status: frozen) or archived (files under {archive projects directory}) projects; notes whose project link cannot be resolved (title form / plain string / pointing to a non-existent file) are also hidden, to avoid leaking notes from frozen or archived projects. -->

```dataview
TABLE WITHOUT ID
    file.link as "🚨 Note Name",
    status as "Current Status",
    domain as "Domain",
    dateformat(file.mtime, "yyyy-MM-dd HH:mm") as "Last Modified"
FROM "{{knowledge_notes}}"
WHERE type = "knowledge" AND (status = "review" OR status = "revised")
  AND ( !project OR ( project.file != null AND !contains(project.file.path, "{{archive_root}}/Projects") AND project.status != "frozen" ) )
SORT file.mtime ASC
```

## 📚 Active Projects

```dataview
TABLE WITHOUT ID
    file.link as "📖 Project Name",
    category as "Category",
    priority as "Priority",
    domain as "Primary Domain",
    status as "Current Status"
FROM "{{projects}}"
WHERE status = "active"
```
