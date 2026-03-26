---
name: spatial-ai-news
description: "Spatial AI weekly digest: searches for the past week's Spatial AI developments (3DGS, NeRF, SLAM, embodied intelligence, world models, autonomous driving perception, spatial reasoning, etc.), compiles summaries and saves them to {drafts directory}/. Triggered when the user says \"/spatial-ai-news\", \"spatial AI news\", \"spatial AI weekly\", \"3D vision news\", or \"fetch latest spatial AI updates\"."
version: 1.0.0
dependencies:
  templates: []
  prompts: []
  schemas:
    - path: "{system directory}/{schema subdirectory}/Frontmatter_Schema.md"
  agents: []
---

You are LifeOS's Spatial AI information aggregation assistant. Execute the following tasks to collect the past week's Spatial AI developments and compile them into a weekly digest saved to Obsidian.

---

# Task A: RSS Feeds + arXiv Paper Retrieval

Run the following Python script to simultaneously fetch RSS feeds and the latest arXiv papers:

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
                    "title": entry.get("title", "Untitled"),
                    "link": entry.get("link", ""),
                    "published": pub.strftime("%Y-%m-%d"),
                    "summary": summary.strip()
                })
    except Exception as e:
        rss_articles.append({"source": feed["title"], "title": f"[Fetch failed: {e}]", "link": "", "published": "", "summary": ""})

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
                "authors": ', '.join(authors[:3]) + (' et al.' if len(authors) > 3 else '')
            })
except Exception as e:
    arxiv_papers.append({"title": f"[arXiv fetch failed: {e}]", "link": "", "published": "", "summary": "", "categories": "", "authors": ""})

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

Record the JSON data output by the script for use in the final summary.

---

# Task B: Web Search Supplement

Use the WebSearch tool to search the following keyword combinations (limited to the past week) to supplement important information not covered by RSS and arXiv:

| Search Query | Target Coverage |
| --- | --- |
| `"spatial AI" OR "spatial intelligence" news {this week's date range}` | Spatial intelligence industry updates |
| `"3D gaussian splatting" OR "NeRF" latest 2026` | Latest 3DGS/NeRF developments |
| `"embodied AI" OR "humanoid robot" news {this week's date range}` | Embodied intelligence / humanoid robots |
| `"world model" AI latest {this week's date range}` | World model developments |
| `"autonomous driving" perception AI {this week's date range}` | Autonomous driving perception |
| `site:worldlabs.ai OR site:waymo.com OR site:tesla.com AI` | Key company updates |

**Supplementary sources for web search (no RSS, require web search coverage):**
- **World Labs** (`worldlabs.ai/blog`): Fei-Fei Li's spatial intelligence company
- **Think Autonomous** (`thinkautonomous.ai/blog`): Autonomous driving perception focus
- **Meta AI Blog** (`ai.meta.com/blog`): FAIR research (3D scenes, perception encoders)
- **Microsoft Research Blog** (`microsoft.com/en-us/research/blog`): 3D vision, HoloLens
- **OpenAI Research** (`openai.com/research`): Multimodal, spatial understanding
- **Waymo Blog** (`waymo.com/blog`): Autonomous driving perception
- **Apple ML** (`machinelearning.apple.com`): 3D reconstruction, spatial reasoning

For high-value articles discovered through search, use the `obsidian:defuddle` skill to extract article summaries.

---

# Task C: Hugging Face Trending Papers Check

Use WebFetch to access `https://huggingface.co/papers` and filter trending papers related to spatial intelligence (keywords: 3D, spatial, gaussian, NeRF, SLAM, embodied, robot, autonomous, world model, scene, depth, point cloud, pose).

Record paper titles, links, and brief descriptions. Deduplicate against arXiv results from Task A.

---

# Task D: Merge Summary and Write to Obsidian

Consolidate data from all three sources and organize by the following categories. Summarize each item in **1-2 sentences in Chinese**, with original links attached.

**Category System:**

- **📄 Key Papers**: The 3-5 most impactful papers of the week (selected from arXiv + HF trending, prioritizing those with high citation/discussion volume)
- **🔬 3D Vision & Reconstruction**: NeRF, 3DGS, 3D generation, novel view synthesis, multi-view reconstruction, stereo matching
- **🤖 Embodied Intelligence & Robotics**: Robot perception, manipulation, navigation, imitation learning, humanoid robots
- **🚗 Autonomous Driving Perception**: Sensor fusion, BEV, end-to-end driving, occupancy networks, LiDAR
- **🌐 World Models & Video Generation**: World Models, physics simulation, video diffusion, digital twins
- **🧠 Spatial Reasoning**: VLM/LLM spatial understanding, 3D QA, visual localization, visual odometry
- **🕶️ Spatial Computing**: AR/VR/XR, spatial interaction, SLAM, mapping
- **📰 Industry News**: Funding, product launches, conference deadlines, open-source projects

**Deduplication rules:** Keep only one entry per paper/article (prefer the most detailed source).

Write the results to `{drafts directory}/SpatialAI-{this week's date range}.md` in the Vault, with filename format `SpatialAI-MMDD-MMDD.md` (e.g., `SpatialAI-0226-0304.md`).

Frontmatter:

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

Document header:

```markdown
# Spatial AI Weekly Digest · YYYY-MM-DD ~ YYYY-MM-DD

> Auto-aggregated · RSS {{N}} articles · arXiv {{M}} papers · Web supplement {{K}} items · Generated at {{HH:MM}}
```

Append an information sources list at the end of the document:

```markdown
---

## 📚 Information Sources

**RSS Feeds:** Radiance Fields, Import AI, The Batch + TLDR AI (kill-the-newsletter), Last Week in AI, Turing Post, It Can Think!, Weekly Robotics, BAIR Blog, Lil'Log, Google AI Blog, HF Blog, NVIDIA Blog, PyImageSearch, LearnOpenCV
**arXiv Search:** cs.CV, cs.RO, cs.GR, cs.AI (keyword filtered)
**Web Search:** World Labs, Think Autonomous, Meta AI, Microsoft Research, OpenAI, Waymo, Apple ML, HF Daily Papers
```

Upon completion, output: `✅ Spatial AI weekly digest saved to: {drafts directory}/SpatialAI-{date range}.md, RSS {{N}} articles + arXiv {{M}} papers + Web {{K}} items`

---

# Appendix: Information Sources Overview

## Core Newsletters (RSS Configured)

| Name | URL | Focus | Frequency |
| --- | --- | --- | --- |
| Radiance Fields | radiancefields.substack.com | NeRF/3DGS dedicated tracking | Weekly |
| Import AI | importai.substack.com | AI frontier research overview | Weekly |
| The Batch | deeplearning.ai/the-batch | AI general news | Weekly |
| Last Week in AI | lastweekin.ai | AI industry overview | Weekly |
| It Can Think! | itcanthink.substack.com | Embodied AI / Robotics | Monthly |
| Weekly Robotics | weeklyrobotics.com | Robotics technology | Weekly |

## Research Blogs (RSS Configured)

| Name | URL | Focus |
| --- | --- | --- |
| BAIR Blog | bair.berkeley.edu/blog | Robotics / 3D vision / embodied AI |
| Lil'Log | lilianweng.github.io | In-depth technical surveys |
| Google AI Blog | blog.google/technology/ai | DeepMind / World Models / 3D |
| Hugging Face Blog | huggingface.co/blog | Open-source AI community |
| NVIDIA AI Blog | blogs.nvidia.com | Cosmos / Omniverse / 3DGS |
| PyImageSearch | pyimagesearch.com | CV hands-on tutorials |
| LearnOpenCV | learnopencv.com | 3DGS / NeRF tutorials |

## Web Search Supplementary Sources (No RSS)

| Name | URL | Focus |
| --- | --- | --- |
| TLDR AI | tldr.tech/ai | AI daily digest |
| World Labs | worldlabs.ai/blog | Spatial intelligence / World Models |
| Think Autonomous | thinkautonomous.ai/blog | Autonomous driving perception |
| Meta AI (FAIR) | ai.meta.com/blog | 3D scenes / perception |
| Microsoft Research | microsoft.com/research/blog | 3D vision / HoloLens |
| OpenAI Research | openai.com/research | Multimodal / spatial understanding |
| Waymo | waymo.com/blog | Autonomous driving |
| Apple ML | machinelearning.apple.com | 3D reconstruction / spatial reasoning |
| Hugging Face Papers | huggingface.co/papers | Daily trending papers |

## arXiv Key Categories

| Category | Topics Covered |
| --- | --- |
| cs.CV | Computer vision, 3D reconstruction, NeRF, 3DGS |
| cs.RO | Robotics, SLAM, navigation |
| cs.GR | Computer graphics, rendering |
| cs.AI | General AI, spatial reasoning |

## Recommended Twitter/X Accounts

| Account | Focus |
| --- | --- |
| @_akhaliq | Daily arXiv paper highlights |
| @drfeifei | Spatial intelligence / World Labs |
| @JonBarron | NeRF / 3D vision |
| @poolio (Matt Tancik) | Nerfstudio |
| @alexkendall | End-to-end autonomous driving |
| @YannLeCun | World Models |

## GitHub Awesome Lists (Continuously Updated)

| Repository | Content |
| --- | --- |
| MrNeRF/awesome-3D-gaussian-splatting | Most comprehensive 3DGS papers + code list |
| longxiang-ai/awesome-gaussians | arXiv 3DGS daily auto-updates |
| 3D-Vision-World/awesome-NeRF-and-3DGS-SLAM | NeRF + 3DGS + SLAM crossover |
| dtc111111/awesome-3dgs-for-robotics | 3DGS robotics applications |

## Academic Conference Calendar

| Conference | Timing | Core Topics |
| --- | --- | --- |
| CVPR | June | All CV, 3D, NeRF/3DGS |
| ICCV | Odd years, December | Same as CVPR |
| ECCV | Even years, September | Same as CVPR |
| ICRA | May-July | Robot perception / SLAM |
| RSS | July | Robot science / embodied AI |
| SIGGRAPH | August | Graphics / rendering / 3DGS |
| CoRL | November | Robot learning |
| 3DV | March | 3D vision dedicated |

# Memory System Integration

> All memory operations are called via MCP tools. `db_path` and `vault_root` are automatically injected at runtime — no need to specify them in the skill.

### File Change Notification

After the weekly digest file is written to the Vault, immediately call:

```
memory_notify(file_path="{drafts directory}/SpatialAI-MMDD-MMDD.md")
```

### Skill Completion

```
memory_skill_complete(
  skill_name="spatial-ai-news",
  summary="Generated Spatial AI weekly digest MMDD-MMDD",
  related_files=["{drafts directory}/SpatialAI-MMDD-MMDD.md"],
  scope="spatial-ai-news",
  refresh_targets=["TaskBoard", "UserProfile"]
)
```

### Session Wrap-up (When this skill is the last operation of the session)

1. `memory_log(entry_type="session_bridge", summary="<session summary>", scope="spatial-ai-news")`
2. `memory_checkpoint()`
