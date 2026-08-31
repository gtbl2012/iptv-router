import type { PublicGuideData, PublicGuideProgramme } from "./api"
import { dateWindow } from "./programme-guide"

interface DemoProgrammeSpec {
  title: string
  duration: number
  category: string
}

interface DemoChannelSpec {
  id: string
  name: string
  groupName: string
  startOffset: number
  programmes: readonly DemoProgrammeSpec[]
}

const CHANNELS: readonly DemoChannelSpec[] = [
  {
    id: "demo-news",
    name: "新闻综合",
    groupName: "新闻",
    startOffset: -30,
    programmes: [
      { title: "午夜新闻", duration: 60, category: "新闻" },
      { title: "世界现场", duration: 90, category: "纪实" },
      { title: "晨间第一线", duration: 120, category: "新闻" },
      { title: "城市漫步", duration: 90, category: "生活" },
      { title: "午间新闻", duration: 60, category: "新闻" },
      { title: "焦点访谈", duration: 120, category: "新闻" },
      { title: "大国工匠", duration: 180, category: "纪实" },
      { title: "晚间剧场", duration: 240, category: "电视剧" },
      { title: "今日观察", duration: 90, category: "新闻" },
    ],
  },
  {
    id: "demo-movie",
    name: "电影高清",
    groupName: "影视",
    startOffset: 0,
    programmes: [
      { title: "经典影院：海边的夏天", duration: 150, category: "电影" },
      { title: "幕后制作特辑", duration: 45, category: "电影" },
      { title: "光影早班车", duration: 135, category: "电影" },
      { title: "环球银幕", duration: 180, category: "电影" },
      { title: "午后影院：归途", duration: 150, category: "电影" },
      { title: "电影人物", duration: 60, category: "访谈" },
      { title: "黄金影院：远方来信", duration: 180, category: "电影" },
      { title: "佳片有约", duration: 180, category: "电影" },
    ],
  },
  {
    id: "demo-sports",
    name: "体育赛事",
    groupName: "体育",
    startOffset: 20,
    programmes: [
      { title: "赛事集锦", duration: 70, category: "体育" },
      { title: "世界田径巡回赛", duration: 150, category: "体育" },
      { title: "体坛快讯", duration: 40, category: "新闻" },
      { title: "篮球联赛重播", duration: 140, category: "体育" },
      { title: "赛场直击", duration: 60, category: "体育" },
      { title: "足球超级联赛", duration: 150, category: "体育" },
      { title: "冠军之路", duration: 100, category: "纪实" },
      { title: "晚间体育新闻", duration: 60, category: "新闻" },
      { title: "网球公开赛", duration: 210, category: "体育" },
    ],
  },
  {
    id: "demo-documentary",
    name: "国家地理",
    groupName: "纪实",
    startOffset: -15,
    programmes: [
      { title: "地球脉动", duration: 90, category: "纪实" },
      { title: "深海探秘", duration: 90, category: "纪实" },
      { title: "飞越山河", duration: 120, category: "纪实" },
      { title: "古城一日", duration: 60, category: "人文" },
      { title: "自然的建筑师", duration: 150, category: "纪实" },
      { title: "宇宙旅行指南", duration: 120, category: "科学" },
      { title: "亚洲秘境", duration: 180, category: "纪实" },
      { title: "文明的足迹", duration: 150, category: "人文" },
    ],
  },
  {
    id: "demo-kids",
    name: "少儿动画",
    groupName: "少儿",
    startOffset: 0,
    programmes: [
      { title: "睡前故事", duration: 60, category: "少儿" },
      { title: "动画乐园", duration: 120, category: "少儿" },
      { title: "科学小实验", duration: 45, category: "少儿" },
      { title: "冒险小队", duration: 105, category: "动画" },
      { title: "午间剧场", duration: 120, category: "动画" },
      { title: "手工创意营", duration: 60, category: "少儿" },
      { title: "超级伙伴", duration: 150, category: "动画" },
      { title: "晚安故事会", duration: 90, category: "少儿" },
    ],
  },
] as const

function programmesForChannel(
  channel: DemoChannelSpec,
  fromMs: number,
  toMs: number
): PublicGuideProgramme[] {
  const result: PublicGuideProgramme[] = []
  let cursor = fromMs + channel.startOffset * 60_000
  let index = 0
  while (cursor < toMs) {
    const spec = channel.programmes[index % channel.programmes.length]
    if (!spec) break
    const stop = cursor + spec.duration * 60_000
    if (stop > fromMs) {
      result.push({
        id: `${channel.id}-${String(index)}`,
        title: spec.title,
        description: `${spec.title}，精彩内容正在播出。此为离线演示节目数据。`,
        category: spec.category,
        startAt: new Date(cursor).toISOString(),
        stopAt: new Date(stop).toISOString(),
      })
    }
    cursor = stop
    index += 1
  }
  return result
}

export function createDemoPublicGuide(dateKey: string): PublicGuideData {
  const window = dateWindow(dateKey)
  if (window === null) {
    return {
      output: { name: "家庭电视" },
      from: new Date(0).toISOString(),
      to: new Date(24 * 60 * 60 * 1_000).toISOString(),
      channels: [],
    }
  }
  const fromMs = Date.parse(window.from)
  const toMs = Date.parse(window.to)
  return {
    output: { name: "家庭电视" },
    from: window.from,
    to: window.to,
    channels: CHANNELS.map((channel, position) => ({
      id: channel.id,
      name: channel.name,
      groupName: channel.groupName,
      logoUrl: null,
      position,
      streamUrl: `/stream/demo/${channel.id}`,
      programmes: programmesForChannel(channel, fromMs, toMs),
    })),
  }
}
