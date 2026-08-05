# ⚡ 学习状态总览

```dataviewjs
// ===== LifeOS 纯 DOM 注入动态指挥舱 (高级柔和护眼调色板版) =====
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

    // 基础数据搜罗
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

    // ===== 1. 顶部 4 列 Bento KPI 数字卡片 (使用高级舒缓水青与柔蓝色系) =====
    const kpiDom = dv.el('div', '');
    kpiDom.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px;">
      <div style="background: var(--background-secondary); border-top: 3px solid #2dd4bf; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🟢 全库掌握率</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #2dd4bf; margin: 2px 0;">${masteryPct}%</div>
        <div style="font-size: 0.75em; opacity: 0.6;">已掌握 ${masteredCount} / 共 ${totalNotes} 篇</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #f43f5e; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🚨 待复习与升阶</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #f43f5e; margin: 2px 0;">${pendingCount} 篇</div>
        <div style="font-size: 0.75em; opacity: 0.6;">草稿与巩固中</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #fb923c; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">📚 活跃项目</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #fb923c; margin: 2px 0;">${activeProjCount} 个</div>
        <div style="font-size: 0.75em; opacity: 0.6;">正在推进的项目</div>
      </div>
      <div style="background: var(--background-secondary); border-top: 3px solid #38bdf8; border-radius: 8px; padding: 12px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size: 0.8em; opacity: 0.7;">🌐 体系知识卡</div>
        <div style="font-size: 1.6em; font-weight: bold; color: #38bdf8; margin: 2px 0;">${totalNotes} 篇</div>
        <div style="font-size: 0.75em; opacity: 0.6;">知识库全量卡片</div>
      </div>
    </div>
    `;

    // ===== 2. 当月学习、复习、草稿与研究活动热力图 (柔和不刺眼的水青色系) =====
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

    const monthName = `${currentYear}年${currentMonth + 1}月`;
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
        <div title="${monthName}${day}日: ${count} 次活动动态" style="background: ${bgColor}; border: ${borderStyle}; border-radius: 4px; aspect-ratio: 1; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:0.7em; color: ${count > 5 ? '#0f172a' : 'var(--text-normal)'}; ${todayGlow} transition: transform 0.15s ease;">
          <span>${day}</span>
        </div>
        `;
    }

    heatmapDom.innerHTML = `
    <div style="background: var(--background-secondary); border-radius: 10px; padding: 16px; border: 1px solid var(--background-modifier-border); margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <h4 style="margin:0; color:#2dd4bf; font-size: 0.98em;">🗓️ 当月学习复习热力图 (${monthName})</h4>
        <span style="font-size:0.75em; opacity:0.7;">本月累计动态: <b>${monthlyTotalActivity}</b> 次</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(28px, 1fr)); gap: 6px; margin-bottom: 10px;">
        ${heatCellsHtml}
      </div>

      <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; font-size:0.72em; opacity:0.75;">
        <span>无活动</span>
        <span style="width:10px; height:10px; background:rgba(255,255,255,0.04); border-radius:2px; border:1px solid rgba(255,255,255,0.08);"></span>
        <span style="width:10px; height:10px; background:rgba(45, 212, 191, 0.2); border-radius:2px;"></span>
        <span style="width:10px; height:10px; background:rgba(45, 212, 191, 0.5); border-radius:2px;"></span>
        <span style="width:10px; height:10px; background:#2dd4bf; border-radius:2px;"></span>
        <span>频繁</span>
      </div>
    </div>
    `;

    // ===== 3. 知识生命周期流转比例槽 (柔和调色) =====
    const funnelDom = dv.el('div', '');
    funnelDom.innerHTML = `
    <div style="background: var(--background-secondary); border-radius: 10px; padding: 14px 16px; border: 1px solid var(--background-modifier-border); margin-bottom: 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
        <h4 style="margin:0; font-size: 0.95em;">⏳ 知识生命周期流转</h4>
        <span style="font-size:0.75em; opacity:0.7;">已掌握 ${masteryPct}% | 巩固中 ${reviewPct}% | 学习中 ${draftPct}%</span>
      </div>
      <div style="display: flex; height: 10px; width: 100%; border-radius: 5px; overflow: hidden; background: rgba(255,255,255,0.08);">
        <div style="width: ${masteryPct}%; background: #2dd4bf;" title="已掌握 (${masteredCount}篇)"></div>
        <div style="width: ${reviewPct}%; background: #fb923c;" title="巩固中 (${reviewCount}篇)"></div>
        <div style="width: ${draftPct}%; background: #38bdf8;" title="学习中 (${draftCount}篇)"></div>
      </div>
      <div style="display:flex; gap:16px; margin-top:8px; font-size:0.75em; opacity:0.85;">
        <div><span style="color:#2dd4bf;">●</span> 已掌握: <b>${masteredCount} 篇</b> (${masteryPct}%)</div>
        <div><span style="color:#fb923c;">●</span> 巩固中: <b>${reviewCount} 篇</b> (${reviewPct}%)</div>
        <div><span style="color:#38bdf8;">●</span> 学习中: <b>${draftCount} 篇</b> (${draftPct}%)</div>
      </div>
    </div>
    `;

    // ===== 4. 艾宾浩斯遗忘曲线 (柔和调色) =====
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
        <h4 style="margin:0; color:#f43f5e; font-size: 0.98em;">🧠 艾宾浩斯遗忘曲线</h4>
        <span style="font-size:0.75em; opacity:0.7;">按最后编辑与温习时间统计</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        <div style="background: var(--background-primary); border-left: 3px solid #2dd4bf; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🟢 新近温习 (< 3天)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#2dd4bf;">${freshCount} 篇</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${freshPct}%</div>
        </div>
        
        <div style="background: var(--background-primary); border-left: 3px solid #fb923c; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🟠 黄金温习期 (3~6天)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#fb923c;">${warmCount} 篇</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${warmPct}%</div>
        </div>
        
        <div style="background: var(--background-primary); border-left: 3px solid #f43f5e; border-radius: 6px; padding: 10px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:0.78em; opacity:0.7;">🔴 遗忘衰减区 (≥ 7天)</div>
            <div style="font-size:1.2em; font-weight:bold; color:#f43f5e;">${decayCount} 篇</div>
          </div>
          <div style="font-size:0.9em; font-weight:bold; opacity:0.8;">${decayPct}%</div>
        </div>
      </div>
    </div>
    `;

})();
```

---

## 🚨 待复习与升阶章节

```dataview
TABLE WITHOUT ID
    file.link as "🚨 章节笔记名称",
    status as "当前状态",
    domain as "所属领域",
    dateformat(file.mtime, "yyyy-MM-dd HH:mm") as "最后修改时间"
FROM "{{knowledge_notes}}"
WHERE type = "knowledge" AND status != "mastered"
SORT file.mtime ASC
```

---

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
