# ⚡ Learning Status Overview

```dataviewjs
// ===== LifeOS DOM-injected dynamic dashboard (soft eye-friendly palette) =====
(function() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const todayDate = now.getDate();

    const oneDayMs = 1000 * 60 * 60 * 24;

    function getMillis(dt) {
        if (!dt) return Date.now();
        if (typeof dt.toMillis === 'function') return dt.toMillis();
        if (typeof dt.getTime === 'function') return dt.getTime();
        if (typeof dt.ts === 'number') return dt.ts;
        if (typeof dt === 'number') return dt;
        try { return (new Date(dt)).getTime(); } catch(e) { return Date.now(); }
    }

    // Collect base data
    const allKnowledge = dv.pages('"{{knowledge_notes}}"').where(n => n && n.type === "knowledge");
    const totalNotes = allKnowledge.length || 0;

    const masteredCount = allKnowledge.where(n => n.status === "mastered").length;
    const reviewCount = allKnowledge.where(n => n.status === "review" || n.status === "revised").length;
    const draftCount = allKnowledge.where(n => n.status === "draft").length;

    const masteryPct = totalNotes > 0 ? Math.round((masteredCount / totalNotes) * 100) : 0;
    const reviewPct = totalNotes > 0 ? Math.round((reviewCount / totalNotes) * 100) : 0;
    const draftPct = totalNotes > 0 ? Math.round((draftCount / totalNotes) * 100) : 0;

    const activeProjCount = dv.pages('"{{projects}}"').where(p => p && p.status === "active").length;
    const pendingCount = reviewCount + draftCount;

    // ===== 1. Top 4-column Bento KPI cards (soft teal & light blue palette) =====
    const kpiDom = dv.el('div', '');
    kpiDom.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px;">
      <div style="background: var(--background-secondary); border-top: 3px solid #2dd4bf; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🟢 Mastery Rate</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #2dd4bf; margin: 2px 0;">${masteryPct}%</div>
        <div style="font-size: 0.75em; opacity: 0.6;">Mastered ${masteredCount} / ${totalNotes} total</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #f43f5e; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🚨 Due for Review</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #f43f5e; margin: 2px 0;">${pendingCount}</div>
        <div style="font-size: 0.75em; opacity: 0.6;">Drafts & consolidating</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #fb923c; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">📚 Active Projects</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #fb923c; margin: 2px 0;">${activeProjCount}</div>
        <div style="font-size: 0.75em; opacity: 0.6;">Projects in progress</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #38bdf8; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🌐 Knowledge Notes</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #38bdf8; margin: 2px 0;">${totalNotes}</div>
        <div style="font-size: 0.75em; opacity: 0.6;">All notes in the vault</div>
      </div>
    </div>
    `;

    // ===== 2. Monthly learning / review / draft / research activity heatmap (soft teal) =====
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const dayActivityMap = {};
    for (let i = 1; i <= daysInMonth; i++) dayActivityMap[i] = 0;

    const allActivityPages = dv.pages('"{{knowledge_notes}}" or "{{research}}" or "{{diary}}" or "{{drafts}}" or "{{archive_root}}"');
    let monthlyTotalActivity = 0;

    for (let p of allActivityPages) {
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
    const heatmapDom = dv.el('div', '');

    let heatCellsHtml = '';
    for (let day = 1; day <= daysInMonth; day++) {
        const count = dayActivityMap[day];
        let bgColor = 'rgba(255,255,255,0.04)';
        let borderStyle = '1px solid rgba(255,255,255,0.07)';
        
        if (count > 0 && count <= 2) {
            bgColor = 'rgba(45, 212, 191, 0.2)';
            borderStyle = '1px solid rgba(45, 212, 191, 0.35)';
        } else if (count >= 3 && count <= 5) {
            bgColor = 'rgba(45, 212, 191, 0.5)';
            borderStyle = '1px solid #2dd4bf';
        } else if (count >= 6) {
            bgColor = '#2dd4bf';
            borderStyle = '1px solid #ffffff';
        }

        const isToday = (day === todayDate);
        const todayGlow = isToday ? 'box-shadow: 0 0 8px rgba(45, 212, 191, 0.6); font-weight:bold;' : '';

        heatCellsHtml += `
        <div title="${monthName}-${day}: ${count} activities" style="background: ${bgColor}; border: ${borderStyle}; border-radius: 4px; aspect-ratio: 1; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:0.7em; color: ${count > 5 ? '#0f172a' : 'var(--text-normal)'}; ${todayGlow} transition: transform 0.15s ease;">
          <span>${day}</span>
        </div>
        `;
    }

    heatmapDom.innerHTML = `
    <div style="background: var(--background-secondary); border-radius: 10px; padding: 16px; border: 1px solid var(--background-modifier-border); margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <h4 style="margin:0; color:#2dd4bf; font-size: 0.98em;">🗓️ Monthly Activity Heatmap (${monthName})</h4>
        <span style="font-size:0.75em; opacity:0.7;">Monthly activity: <b>${monthlyTotalActivity}</b></span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(28px, 1fr)); gap: 6px; margin-bottom: 10px;">
        ${heatCellsHtml}
      </div>

      <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; font-size:0.72em; opacity:0.75;">
        <span>No activity</span>
        <span style="width:10px; height:10px; background:rgba(255,255,255,0.04); border-radius:2px; border:1px solid rgba(255,255,255,0.08);"></span>
        <span style="width:10px; height:10px; background:rgba(45, 212, 191, 0.2); border-radius:2px;"></span>
        <span style="width:10px; height:10px; background:rgba(45, 212, 191, 0.5); border-radius:2px;"></span>
        <span style="width:10px; height:10px; background:#2dd4bf; border-radius:2px;"></span>
        <span>Frequent</span>
      </div>
    </div>
    `;

    // ===== 3. Knowledge lifecycle distribution bar (soft palette) =====
    const funnelDom = dv.el('div', '');
    funnelDom.innerHTML = `
    <div style="background: var(--background-secondary); border-radius: 10px; padding: 14px 16px; border: 1px solid var(--background-modifier-border); margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <h4 style="margin:0; font-size: 0.95em;">⏳ Knowledge Lifecycle Flow</h4>
        <span style="font-size:0.75em; opacity:0.7;">Mastered ${masteryPct}% | Reviewing ${reviewPct}% | Learning ${draftPct}%</span>
      </div>
      <div style="display: flex; height: 10px; width: 100%; border-radius: 5px; overflow: hidden; background: rgba(255,255,255,0.08);">
        <div style="width: ${masteryPct}%; background: #2dd4bf;" title="Mastered (${masteredCount})"></div>
        <div style="width: ${reviewPct}%; background: #fb923c;" title="In review (${reviewCount})"></div>
        <div style="width: ${draftPct}%; background: #38bdf8;" title="Learning (${draftCount})"></div>
      </div>
      <div style="display:flex; gap:16px; margin-top:8px; font-size:0.75em; opacity:0.85;">
        <div><span style="color:#2dd4bf;">●</span> Mastered: <b>${masteredCount}</b> (${masteryPct}%)</div>
        <div><span style="color:#fb923c;">●</span> In review: <b>${reviewCount}</b> (${reviewPct}%)</div>
        <div><span style="color:#38bdf8;">●</span> Learning: <b>${draftCount}</b> (${draftPct}%)</div>
      </div>
    </div>
    `;

    // ===== 4. Ebbinghaus forgetting curve (soft palette) =====
    let freshCount = 0;
    let warmCount = 0;
    let decayCount = 0;

    for (let n of allKnowledge) {
        const nTime = getMillis(n.file.mtime);
        const dDays = Math.floor((now.getTime() - nTime) / oneDayMs);
        if (dDays < 3) freshCount++;
        else if (dDays <= 6) warmCount++;
        else decayCount++;
    }

    const freshPct = totalNotes > 0 ? Math.round((freshCount / totalNotes) * 100) : 0;
    const warmPct = totalNotes > 0 ? Math.round((warmCount / totalNotes) * 100) : 0;
    const decayPct = totalNotes > 0 ? Math.round((decayCount / totalNotes) * 100) : 0;

    const decayDom = dv.el('div', '');
    decayDom.innerHTML = `
    <div style="background: var(--background-secondary); border-radius: 10px; padding: 16px; border: 1px solid var(--background-modifier-border); margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <h4 style="margin:0; color:#f43f5e; font-size: 0.98em;">🧠 Ebbinghaus Forgetting Curve</h4>
        <span style="font-size:0.75em; opacity:0.7;">By last edit & review time</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        <div style="background: var(--background-primary); border-left: 3px solid #2dd4bf; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🟢 Recently reviewed (< 3 days)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#2dd4bf;">${freshCount}</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${freshPct}%</div>
        </div>
        
        <div style="background: var(--background-primary); border-left: 3px solid #fb923c; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🟠 Golden review window (3~6 days)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#fb923c;">${warmCount}</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${warmPct}%</div>
        </div>
        
        <div style="background: var(--background-primary); border-left: 3px solid #f43f5e; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🔴 Decay zone (≥ 7 days)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#f43f5e;">${decayCount}</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${decayPct}%</div>
        </div>
      </div>
    </div>
    `;

})();
```

---

## 🚨 Due for Review

```dataview
TABLE WITHOUT ID
    file.link as "🚨 Note",
    status as "Status",
    domain as "Domain",
    dateformat(file.mtime, "yyyy-MM-dd HH:mm") as "Last Modified"
FROM "{{knowledge_notes}}"
WHERE type = "knowledge" AND status != "mastered"
SORT file.mtime ASC
```

---

## 📚 Active Projects

```dataview
TABLE WITHOUT ID
    file.link as "📖 Project",
    category as "Category",
    priority as "Priority",
    domain as "Domain",
    status as "Status"
FROM "{{projects}}"
WHERE status = "active"
```
