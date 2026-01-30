export type MonitoringQuery = {
  name: string;
  cityCode?: string;
  keyword?: string;
  showStyle?: string;
  url?: string;
  page?: number;
  pageSize?: number;
};

export type MonitoringConfig = {
  app?: {
    timezone?: string;
    reportWindowHours?: number;
  };
  monitoring: {
    focusArtists: string[];
    queries: MonitoringQuery[];
  };
};

export type ShowStartEvent = {
  id: number;
  title: string;
  poster?: string;
  price?: string;
  showTime?: string;
  siteName?: string;
  cityName?: string;
  performers?: string;
  url: string;
  isExclusive?: number;
  isGroup?: number;
  soldOut?: number;
  source?: string;
};

export type DailyReport = {
  runAt: string;
  timezone: string;
  summary: string;
  focusArtists: Array<{
    artist: string;
    events: Array<{
      title: string;
      url: string;
      city?: string;
      site?: string;
      showTime?: string;
      price?: string;
    }>;
  }>;
  events: ShowStartEvent[];
};
