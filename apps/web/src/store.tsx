import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { DictEntry, MonitoringPayload } from "@gigwatch/shared";
import { api } from "./api";

interface StoreValue {
  /** Dictionary data — loaded once at init */
  cities: DictEntry[];
  showStyles: DictEntry[];
  /** Current monitoring config */
  monitoring: MonitoringPayload;
  /** Whether initial load is done */
  ready: boolean;
  /** Save monitoring config to backend and update local state */
  saveMonitoring: (payload: MonitoringPayload) => Promise<void>;
}

const StoreContext = createContext<StoreValue>(null!);

export const useStore = () => useContext(StoreContext);

export const StoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [cities, setCities] = useState<DictEntry[]>([]);
  const [showStyles, setShowStyles] = useState<DictEntry[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringPayload>({
    focusArtists: [],
    cityCodes: [],
    showStyles: [],
    keywords: [],
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getConfig(),
      api.getDictionary("cities"),
      api.getDictionary("showStyles"),
    ])
      .then(([cfg, cityDict, styleDict]) => {
        const m = cfg.monitoring;
        setMonitoring({
          focusArtists: m.focusArtists ?? [],
          cityCodes: m.cityCodes ?? [],
          showStyles: m.showStyles ?? [],
          keywords: m.keywords ?? [],
        });
        setCities(cityDict);
        setShowStyles(styleDict);
      })
      .catch(console.error)
      .finally(() => setReady(true));
  }, []);

  const saveMonitoring = useCallback(async (payload: MonitoringPayload) => {
    await api.saveMonitoring(payload);
    setMonitoring(payload);
  }, []);

  return (
    <StoreContext.Provider value={{ cities, showStyles, monitoring, ready, saveMonitoring }}>
      {children}
    </StoreContext.Provider>
  );
};
