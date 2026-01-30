import vm from "vm";
import type { ShowStartEvent } from "../types";

export type ShowStartSearchParams = {
  cityCode?: string;
  keyword?: string;
  showStyle?: string;
  page?: number;
  pageSize?: number;
  url?: string;
};

const DEFAULT_BASE_URL = "https://www.showstart.com/event/list";

const buildUrl = (params: ShowStartSearchParams) => {
  if (params.url) return params.url;
  const url = new URL(DEFAULT_BASE_URL);
  if (params.cityCode) url.searchParams.set("cityCode", params.cityCode);
  if (params.keyword) url.searchParams.set("keyword", params.keyword);
  if (params.showStyle) url.searchParams.set("showStyle", params.showStyle);
  if (params.page) url.searchParams.set("pageNo", String(params.page));
  if (params.pageSize) url.searchParams.set("pageSize", String(params.pageSize));
  return url.toString();
};

const parseNuxtState = (html: string) => {
  const match = html.match(/window.__NUXT__=([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error("Failed to locate __NUXT__ state in ShowStart page");
  }

  const sandbox = { window: {} as any };
  vm.runInNewContext(`window.__NUXT__=${match[1]};`, sandbox, { timeout: 1000 });
  const nuxtState = sandbox.window.__NUXT__;
  const listData = nuxtState?.data?.[0]?.listData;
  if (!Array.isArray(listData)) {
    return [];
  }
  return listData as ShowStartEvent[];
};

const normalizeEvent = (item: ShowStartEvent): ShowStartEvent => {
  return {
    id: item.id,
    title: item.title,
    poster: item.poster,
    price: item.price,
    showTime: item.showTime,
    siteName: item.siteName,
    cityName: item.cityName,
    performers: item.performers,
    isExclusive: item.isExclusive,
    isGroup: item.isGroup,
    soldOut: item.soldOut,
    url: item.url || `https://www.showstart.com/event/${item.id}`,
    source: "showstart"
  };
};

export const fetchShowStartEvents = async (params: ShowStartSearchParams): Promise<{ events: ShowStartEvent[]; url: string }> => {
  const maxPages = 20;
  const pageSize = params.pageSize || 50;
  let pageNo = params.page || 1;
  const collected: ShowStartEvent[] = [];
  let lastUrl = "";

  while (pageNo <= maxPages) {
    const targetUrl = buildUrl({ ...params, page: pageNo, pageSize });
    lastUrl = targetUrl;
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "GigWatch/ShowStartScraper",
        "Accept-Language": "zh-CN,zh;q=0.9"
      }
    });

    if (!response.ok) {
      throw new Error(`ShowStart request failed (${response.status}) for ${targetUrl}`);
    }

    const html = await response.text();
    const rawEvents = parseNuxtState(html);
    const events = rawEvents.map((item) => normalizeEvent(item));
    collected.push(...events);

    if (events.length === 0 || events.length < pageSize) {
      break;
    }
    pageNo += 1;
  }

  return { events: collected, url: lastUrl };
};
