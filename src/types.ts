export type MonitoringProfile = {
  name: string;
  filters: {
    cities?: string[];
    categories?: string[];
    subCategories?: string[];
    artists?: string[];
    keywords?: string[];
  };
};

export type MonitoringConfig = {
  app?: {
    timezone?: string;
    daysAhead?: number;
    reportWindowHours?: number;
  };
  monitoring: {
    cities?: string[];
    categories?: string[];
    subCategories?: string[];
    keywords?: string[];
    focusArtists: string[];
    profiles?: MonitoringProfile[];
  };
  damai?: {
    pageSize?: number;
    sortType?: number;
    channels?: string[];
    dateType?: number;
  };
  search?: {
    recency?: "week" | "month" | "semiyear" | "year";
    siteAllowList?: string[];
  };
};

export type DamaiProject = {
  city_name?: string;
  show_time?: string;
  category_name?: string;
  perform_start_time?: string;
  vertical_pic?: string;
  name?: string;
  actors?: string;
  venue_city?: string;
  sell_end_time?: number;
  venue_name?: string;
  promotion_price?: string;
  up_time?: string;
  artist_name?: string;
  sub_category_name?: string;
  tours?: string;
  brand_name?: string;
  site_status?: string;
  sub_head?: string;
  extra_info_map?: {
    buy_url?: string;
  };
  is_e_ticket?: string;
  is_select_seat?: string;
  sub_title?: string;
  price_str?: string;
  venue_id?: number;
  latitude?: string;
  longitude?: string;
};

export type BaiduReference = {
  title?: string;
  url?: string;
  date?: string;
  content?: string;
  website?: string;
  type?: string;
};

export type DailyReport = {
  runAt: string;
  timezone: string;
  summary: string;
  highlights: string[];
  focusArtists: Array<{
    artist: string;
    updates: Array<{
      title?: string;
      url?: string;
      date?: string;
      content?: string;
    }>;
  }>;
  projects: DamaiProject[];
};
