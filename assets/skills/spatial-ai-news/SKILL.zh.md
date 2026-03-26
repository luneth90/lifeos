---
name: spatial-ai-news
description: 空间智能周报汇总：搜索最近一周的 Spatial AI 领域信息（3DGS、NeRF、SLAM、具身智能、世界模型、自动驾驶感知、空间推理等），整理成摘要存入 00_草稿/。当用户说"/spatial-ai-news"、"空间智能资讯"、"spatial AI 周报"、"3D 视觉新闻"、"抓取空间智能最新进展"时触发。
version: 1.0.0
dependencies:
  templates: []
  prompts: []
  schemas:
    - path: "{系统目录}/{规范子目录}/Frontmatter_Schema.md"
  agents: []
---

你是 LifeOS 的空间智能信息汇总助手。执行以下任务，搜集最近一周的 Spatial AI 领域进展，合并成一份周报存入 Obsidian。

---

# 任务 A：RSS 订阅 + arXiv 论文抓取

运行以下 Python 脚本，同时抓取 RSS 订阅和 arXiv 最新论文：

```python
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "feedparser", "requests", "--break-system-packages", "-q"], check=True)

import feedparser, requests, json, re, os
import urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET

cutoff = datetime.now(timezone.utc) - timedelta(days=7)

# ===== Part 1: RSS Feeds =====
opml_path = os.path.expanduser("~/code/notes/luneth/90_系统/RSS/SpatialAI.opml")
tree = ET.parse(opml_path)
opml_root = tree.getroot()

feeds = []
for outline in opml_root.iter("outline"):
    xml_url = outline.get("xmlUrl")
    title = outline.get("title") or outline.get("text")
    if xml_url:
        feeds.append({"title": title, "url": xml_url})

rss_articles = []
for feed in feeds:
    try:
        resp = requests.get(feed["url"], timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        parsed = feedparser.parse(resp.content)
        for entry in parsed.entries:
            pub = None
            for attr in ["published", "updated"]:
                if hasattr(entry, attr):
                    try:
                        pub = parsedate_to_datetime(getattr(entry, attr))
                        break
                    except:
                        pass
            if pub is None:
                pub = datetime.now(timezone.utc)
            if pub.tzinfo is None:
                pub = pub.replace(tzinfo=timezone.utc)
            if pub >= cutoff:
                summary = re.sub(r"<[^>]+>", "", getattr(entry, "summary", "") or "")[:300]
                rss_articles.append({
                    "source": feed["title"],
                    "title": entry.get("title", "无标题"),
                    "link": entry.get("link", ""),
                    "published": pub.strftime("%Y-%m-%d"),
                    "summary": summary.strip()
                })
    except Exception as e:
        rss_articles.append({"source": feed["title"], "title": f"[抓取失败: {e}]", "link": "", "published": "", "summary": ""})

# ===== Part 2: arXiv API Search =====
keywords = [
    '"gaussian splatting"', '"radiance field"', '"NeRF"',
    '"spatial intelligence"', '"embodied AI"', '"world model"',
    '"3D reconstruction"', '"novel view synthesis"', '"visual SLAM"',
    '"scene understanding"', '"spatial reasoning"', '"depth estimation"',
    '"3D generation"', '"3D scene"', '"point cloud"',
    '"pose estimation"', '"3D object detection"', '"visual localization"',
    '"occupancy network"', '"robotic perception"', '"robot manipulation"',
    '"autonomous driving"', '"spatial computing"', '"digital twin"',
    '"multi-view"', '"stereo matching"', '"visual odometry"', '"3D vision"'
]

search_parts = [f'abs:{kw}' for kw in keywords]
search_query = ' OR '.join(search_parts)

params = urllib.parse.urlencode({
    'search_query': search_query,
    'start': 0,
    'max_results': 200,
    'sortBy': 'submittedDate',
    'sortOrder': 'descending'
})

arxiv_papers = []
try:
    req = urllib.request.Request(
        f"http://export.arxiv.org/api/query?{params}",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    resp = urllib.request.urlopen(req, timeout=60)
    xml_data = resp.read()
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    arxiv_root = ET.fromstring(xml_data)
    for entry in arxiv_root.findall('atom:entry', ns):
        id_elem = entry.find('atom:id', ns)
        published_elem = entry.find('atom:published', ns)
        if id_elem is None or published_elem is None:
            continue
        pub_date = datetime.fromisoformat(published_elem.text.replace('Z', '+00:00'))
        if pub_date >= cutoff:
            title = entry.find('atom:title', ns).text.strip().replace('\n', ' ').replace('  ', ' ')
            summary = entry.find('atom:summary', ns).text.strip()[:300].replace('\n', ' ')
            link = id_elem.text
            categories = [c.get('term') for c in entry.findall('atom:category', ns)]
            authors = [a.find('atom:name', ns).text for a in entry.findall('atom:author', ns)]
            arxiv_papers.append({
                "title": title,
                "link": link,
                "published": pub_date.strftime("%Y-%m-%d"),
                "summary": summary,
                "categories": ', '.join(categories[:5]),
                "authors": ', '.join(authors[:3]) + (' 等' if len(authors) > 3 else '')
            })
except Exception as e:
    arxiv_papers.append({"title": f"[arXiv 抓取失败: {e}]", "link": "", "published": "", "summary": "", "categories": "", "authors": ""})

# ===== Output =====
result = {
    "rss_articles": rss_articles,
    "arxiv_papers": arxiv_papers,
    "stats": {
        "rss_count": len([a for a in rss_articles if not a["title"].startswith("[")]),
        "arxiv_count": len([p for p in arxiv_papers if not p["title"].startswith("[")])
    }
}
print(json.dumps(result, ensure_ascii=False))
```

记录脚本输出的 JSON 数据，供最终汇总使用。

---

# 任务 B：Web 搜索补充

使用 WebSearch 工具搜索以下关键词组合（限定最近一周），补充 RSS 和 arXiv 未覆盖的重要信息：

| 搜索查询 | 目标覆盖 |
| --- | --- |
| `"spatial AI" OR "spatial intelligence" news {本周日期范围}` | 空间智能行业动态 |
| `"3D gaussian splatting" OR "NeRF" latest 2026` | 3DGS/NeRF 最新进展 |
| `"embodied AI" OR "humanoid robot" news {本周日期范围}` | 具身智能/人形机器人 |
| `"world model" AI latest {本周日期范围}` | 世界模型进展 |
| `"autonomous driving" perception AI {本周日期范围}` | 自动驾驶感知 |
| `site:worldlabs.ai OR site:waymo.com OR site:tesla.com AI` | 重点公司动态 |

**搜索补充来源（无 RSS，需 Web 搜索覆盖）：**
- **World Labs** (`worldlabs.ai/blog`)：Fei-Fei Li 空间智能公司
- **Think Autonomous** (`thinkautonomous.ai/blog`)：自动驾驶感知专项
- **Meta AI Blog** (`ai.meta.com/blog`)：FAIR 研究（3D 场景、感知编码器）
- **Microsoft Research Blog** (`microsoft.com/en-us/research/blog`)：3D 视觉、HoloLens
- **OpenAI Research** (`openai.com/research`)：多模态、空间理解
- **Waymo Blog** (`waymo.com/blog`)：自动驾驶感知
- **Apple ML** (`machinelearning.apple.com`)：3D 重建、空间推理

对于搜索发现的高价值文章，使用 `obsidian:defuddle` 技能提取正文摘要。

---

# 任务 C：Hugging Face 热门论文检查

使用 WebFetch 访问 `https://huggingface.co/papers`，筛选与空间智能相关的热门论文（关键词：3D、spatial、gaussian、NeRF、SLAM、embodied、robot、autonomous、world model、scene、depth、point cloud、pose）。

记录论文标题、链接和简要描述。注意与任务 A 的 arXiv 结果去重。

---

# 任务 D：合并汇总并写入 Obsidian

综合三个来源的数据，按以下分类整理。每条用 **1-2 句中文** 提炼核心内容，附原文链接。

**分类体系：**

- **📄 重要论文**：本周影响力最大的 3-5 篇论文（从 arXiv + HF 热门中筛选，优先选择引用/讨论度高的）
- **🔬 3D 视觉与重建**：NeRF、3DGS、3D 生成、新视角合成、多视图重建、立体匹配
- **🤖 具身智能与机器人**：机器人感知、操作、导航、模仿学习、人形机器人
- **🚗 自动驾驶感知**：传感器融合、BEV、端到端驾驶、占用网络、LiDAR
- **🌐 世界模型与视频生成**：World Models、物理模拟、视频扩散、数字孪生
- **🧠 空间推理**：VLM/LLM 空间理解、3D 问答、视觉定位、视觉里程计
- **🕶️ 空间计算**：AR/VR/XR、空间交互、SLAM、地图构建
- **📰 行业动态**：融资、产品发布、会议 deadline、开源项目

**去重规则：** 同一论文/文章只保留一条（优先保留最详细的来源）。

将结果写入 Vault 的 `00_草稿/SpatialAI-{本周起止日期}.md`，文件名格式 `SpatialAI-MMDD-MMDD.md`（如 `SpatialAI-0226-0304.md`）。

Frontmatter：

```yaml
---
created: "YYYY-MM-DD"
type: draft
status: pending
tags:
  - spatial-ai
  - weekly-digest
  - 3d-vision
  - embodied-ai
---
```

正文开头：

```markdown
# 空间智能周报 · YYYY-MM-DD ~ YYYY-MM-DD

> 自动汇总 · RSS {{N}}篇 · arXiv {{M}}篇 · Web 补充 {{K}}条 · 生成时间 {{HH:MM}}
```

正文结尾附信息来源清单：

```markdown
---

## 📚 信息来源

**RSS 订阅：** Radiance Fields, Import AI, The Batch + TLDR AI (kill-the-newsletter), Last Week in AI, Turing Post, It Can Think!, Weekly Robotics, BAIR Blog, Lil'Log, Google AI Blog, HF Blog, NVIDIA Blog, PyImageSearch, LearnOpenCV
**arXiv 搜索：** cs.CV, cs.RO, cs.GR, cs.AI（关键词过滤）
**Web 搜索：** World Labs, Think Autonomous, Meta AI, Microsoft Research, OpenAI, Waymo, Apple ML, HF Daily Papers
```

完成后输出：`✅ 空间智能周报已写入：00_草稿/SpatialAI-{起止日期}.md，RSS {{N}} 篇 + arXiv {{M}} 篇 + Web {{K}} 条`

---

# 附录：信息来源总览

## 核心 Newsletter（已配置 RSS）

| 名称 | URL | 方向 | 频率 |
| --- | --- | --- | --- |
| Radiance Fields | radiancefields.substack.com | NeRF/3DGS 专项追踪 | 周刊 |
| Import AI | importai.substack.com | AI 前沿研究综述 | 周刊 |
| The Batch | deeplearning.ai/the-batch | AI 综合新闻 | 周刊 |
| Last Week in AI | lastweekin.ai | AI 行业综合 | 周刊 |
| It Can Think! | itcanthink.substack.com | Embodied AI / 机器人 | 月刊 |
| Weekly Robotics | weeklyrobotics.com | 机器人技术 | 周刊 |

## 研究博客（已配置 RSS）

| 名称 | URL | 方向 |
| --- | --- | --- |
| BAIR Blog | bair.berkeley.edu/blog | 机器人/3D 视觉/embodied AI |
| Lil'Log | lilianweng.github.io | 深度技术综述 |
| Google AI Blog | blog.google/technology/ai | DeepMind/World Models/3D |
| Hugging Face Blog | huggingface.co/blog | 开源 AI 社区 |
| NVIDIA AI Blog | blogs.nvidia.com | Cosmos/Omniverse/3DGS |
| PyImageSearch | pyimagesearch.com | CV 实战教程 |
| LearnOpenCV | learnopencv.com | 3DGS/NeRF 教程 |

## Web 搜索补充来源（无 RSS）

| 名称 | URL | 方向 |
| --- | --- | --- |
| TLDR AI | tldr.tech/ai | AI 日报 |
| World Labs | worldlabs.ai/blog | 空间智能/World Models |
| Think Autonomous | thinkautonomous.ai/blog | 自动驾驶感知 |
| Meta AI (FAIR) | ai.meta.com/blog | 3D 场景/感知 |
| Microsoft Research | microsoft.com/research/blog | 3D 视觉/HoloLens |
| OpenAI Research | openai.com/research | 多模态/空间理解 |
| Waymo | waymo.com/blog | 自动驾驶 |
| Apple ML | machinelearning.apple.com | 3D 重建/空间推理 |
| Hugging Face Papers | huggingface.co/papers | 每日热门论文 |

## arXiv 关键类别

| 类别 | 覆盖话题 |
| --- | --- |
| cs.CV | 计算机视觉、3D 重建、NeRF、3DGS |
| cs.RO | 机器人学、SLAM、导航 |
| cs.GR | 计算机图形学、渲染 |
| cs.AI | 通用 AI、空间推理 |

## 推荐关注的 Twitter/X 账号

| 账号 | 方向 |
| --- | --- |
| @_akhaliq | 每日 arXiv 论文速递 |
| @drfeifei | 空间智能 / World Labs |
| @JonBarron | NeRF / 3D 视觉 |
| @poolio (Matt Tancik) | Nerfstudio |
| @alexkendall | 自动驾驶端到端学习 |
| @YannLeCun | World Models |

## GitHub Awesome Lists（持续更新）

| 仓库 | 内容 |
| --- | --- |
| MrNeRF/awesome-3D-gaussian-splatting | 3DGS 论文+代码最全列表 |
| longxiang-ai/awesome-gaussians | arXiv 3DGS 每日自动更新 |
| 3D-Vision-World/awesome-NeRF-and-3DGS-SLAM | NeRF+3DGS+SLAM 交叉 |
| dtc111111/awesome-3dgs-for-robotics | 3DGS 机器人应用 |

## 学术会议日历

| 会议 | 时间 | 核心话题 |
| --- | --- | --- |
| CVPR | 6 月 | CV 全领域、3D、NeRF/3DGS |
| ICCV | 奇数年 12 月 | 同 CVPR |
| ECCV | 偶数年 9 月 | 同 CVPR |
| ICRA | 5-7 月 | 机器人感知/SLAM |
| RSS | 7 月 | 机器人科学/embodied AI |
| SIGGRAPH | 8 月 | 图形学/渲染/3DGS |
| CoRL | 11 月 | 机器人学习 |
| 3DV | 3 月 | 3D 视觉专项 |

# 记忆系统集成

> 所有记忆操作通过 MCP 工具调用，`db_path` 和 `vault_root` 由运行时自动注入，技能中无需指定。

### 文件变更通知

周报文件写入 Vault 后，立即调用：

```
memory_notify(file_path="00_草稿/SpatialAI-MMDD-MMDD.md")
```

### 技能完成

```
memory_skill_complete(
  skill_name="spatial-ai-news",
  summary="生成空间智能周报 MMDD-MMDD",
  related_files=["00_草稿/SpatialAI-MMDD-MMDD.md"],
  scope="spatial-ai-news",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### 会话收尾（本技能为会话最后一个操作时）

1. `memory_log(entry_type="session_bridge", summary="<本次会话摘要>", scope="spatial-ai-news")`
2. `memory_checkpoint()`
