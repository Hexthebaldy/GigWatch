import type { Database } from "bun:sqlite";
import type { DamaiProject, DailyReport } from "../types";
import type { MonitoringConfig } from "../types";
import { searchDamaiProjects } from "../clients/damai";
import { searchBaidu } from "../clients/baidu";
import { generateReportWithModel } from "../clients/openai";
import { nowInTz, toIso } from "../utils";

const upsertProject = (db: Database, project: DamaiProject, fetchedAt: string) => {
  const stmt = db.prepare(`
    INSERT INTO projects (
      external_id,
      name,
      city_name,
      venue_name,
      show_time,
      perform_start_time,
      category_name,
      sub_category_name,
      artist_name,
      actors,
      tours,
      price_str,
      promotion_price,
      site_status,
      buy_url,
      source,
      raw_json,
      first_seen_at,
      last_seen_at
    ) VALUES (
      @external_id,
      @name,
      @city_name,
      @venue_name,
      @show_time,
      @perform_start_time,
      @category_name,
      @sub_category_name,
      @artist_name,
      @actors,
      @tours,
      @price_str,
      @promotion_price,
      @site_status,
      @buy_url,
      @source,
      @raw_json,
      @first_seen_at,
      @last_seen_at
    )
    ON CONFLICT(name, venue_name, show_time, city_name, perform_start_time)
    DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      site_status = excluded.site_status,
      price_str = excluded.price_str,
      promotion_price = excluded.promotion_price,
      buy_url = excluded.buy_url,
      raw_json = excluded.raw_json
  `);

  stmt.run({
    external_id: null,
    name: project.name || "",
    city_name: project.city_name || project.venue_city || "",
    venue_name: project.venue_name || "",
    show_time: project.show_time || "",
    perform_start_time: project.perform_start_time || "",
    category_name: project.category_name || "",
    sub_category_name: project.sub_category_name || "",
    artist_name: project.artist_name || "",
    actors: project.actors || "",
    tours: project.tours || "",
    price_str: project.price_str || "",
    promotion_price: project.promotion_price || "",
    site_status: project.site_status || "",
    buy_url: project.extra_info_map?.buy_url || "",
    source: "damai",
    raw_json: JSON.stringify(project),
    first_seen_at: fetchedAt,
    last_seen_at: fetchedAt
  });
};

const insertArtistNews = (db: Database, artist: string, items: { title?: string; url?: string; date?: string; content?: string }[], fetchedAt: string) => {
  const stmt = db.prepare(`
    INSERT INTO artist_news (artist, title, url, date, content, source, fetched_at)
    VALUES (@artist, @title, @url, @date, @content, @source, @fetched_at)
  `);

  for (const item of items) {
    stmt.run({
      artist,
      title: item.title || "",
      url: item.url || "",
      date: item.date || "",
      content: item.content || "",
      source: "baidu",
      fetched_at: fetchedAt
    });
  }
};

const loadRecentProjects = (db: Database, sinceIso: string): DamaiProject[] => {
  const stmt = db.prepare(`
    SELECT raw_json FROM projects
    WHERE first_seen_at >= ?
    ORDER BY last_seen_at DESC
  `);
  const rows = stmt.all(sinceIso) as Array<{ raw_json: string }>;
  return rows.map((row) => JSON.parse(row.raw_json) as DamaiProject);
};

const storeReport = (db: Database, report: DailyReport) => {
  const stmt = db.prepare(`
    INSERT INTO reports (run_at, report_text, report_json)
    VALUES (@run_at, @report_text, @report_json)
  `);
  stmt.run({
    run_at: report.runAt,
    report_text: report.summary,
    report_json: JSON.stringify(report)
  });
};

const buildProfiles = (config: MonitoringConfig) => {
  if (config.monitoring.profiles && config.monitoring.profiles.length > 0) {
    return config.monitoring.profiles;
  }

  return [
    {
      name: "default",
      filters: {
        cities: config.monitoring.cities,
        categories: config.monitoring.categories,
        subCategories: config.monitoring.subCategories,
        artists: [],
        keywords: config.monitoring.keywords
      }
    }
  ];
};

export const runDailyReport = async (db: Database, config: MonitoringConfig) => {
  const timezone = config.app?.timezone || "Asia/Shanghai";
  const reportWindowHours = config.app?.reportWindowHours || 24;
  const fetchedAt = toIso(new Date());

  const profiles = buildProfiles(config);
  for (const profile of profiles) {
    const projects = await searchDamaiProjects({
      cities: profile.filters.cities,
      categories: profile.filters.categories,
      subCategories: profile.filters.subCategories,
      artists: profile.filters.artists,
      keywords: profile.filters.keywords,
      pageSize: config.damai?.pageSize || 30,
      sortType: config.damai?.sortType ?? 2,
      channels: config.damai?.channels,
      dateType: config.damai?.dateType ?? 4
    });

    for (const project of projects) {
      upsertProject(db, project, fetchedAt);
    }
  }

  const focusUpdates: Record<string, { title?: string; url?: string; date?: string; content?: string }[]> = {};
  for (const artist of config.monitoring.focusArtists) {
    const queryKeywords = [artist, ...(config.monitoring.keywords || []), "巡演", "计划"]
      .filter(Boolean)
      .join(" ");
    const references = await searchBaidu({
      query: queryKeywords,
      recency: config.search?.recency,
      siteAllowList: config.search?.siteAllowList,
      topK: 6
    });

    const sanitized = references.map((ref) => ({
      title: ref.title,
      url: ref.url,
      date: ref.date,
      content: ref.content
    }));

    focusUpdates[artist] = sanitized;
    insertArtistNews(db, artist, sanitized, fetchedAt);
  }

  const since = new Date(Date.now() - reportWindowHours * 60 * 60 * 1000).toISOString();
  const projects = loadRecentProjects(db, since);

  const report = await generateReportWithModel({
    timezone,
    runAt: nowInTz(timezone),
    projects,
    focusUpdates
  });

  storeReport(db, report);
  return report;
};
