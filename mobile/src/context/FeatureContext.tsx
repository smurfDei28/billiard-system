import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../constants';

export type AppModule =
  | 'MEMBERSHIP' | 'TABLE_MANAGEMENT' | 'RESERVATIONS' | 'POS_INVENTORY'
  | 'TOURNAMENTS' | 'CREDITS_PAYMENTS' | 'LOYALTY_REWARDS'
  | 'NOTIFICATIONS' | 'REPORTS_ANALYTICS' | 'CAMERA_SCORING';

const ALL_MODULES: AppModule[] = [
  'MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'POS_INVENTORY',
  'TOURNAMENTS', 'CREDITS_PAYMENTS', 'LOYALTY_REWARDS', 'NOTIFICATIONS',
  'REPORTS_ANALYTICS', 'CAMERA_SCORING',
];

interface FeatureContextValue {
  enabledModules: AppModule[];
  hasModule: (moduleName: AppModule) => boolean;
}

const FeatureContext = createContext<FeatureContextValue>({
  enabledModules: ALL_MODULES,
  hasModule: (_moduleName: AppModule) => true,
});

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const [enabledModules, setEnabledModules] = useState<AppModule[]>(ALL_MODULES);

  useEffect(() => {
    axios.get(`${API_URL}/api/features`)
      .then(({ data }) => {
        if (Array.isArray(data?.enabledModules)) setEnabledModules(data.enabledModules);
      })
      .catch(() => {
        // The API remains the entitlement authority. Keeping the complete menu
        // during a temporary network outage lets users retry after reconnecting.
      });
  }, []);

  return (
    <FeatureContext.Provider value={{
      enabledModules,
      hasModule: (moduleName) => enabledModules.includes(moduleName),
    }}>
      {children}
    </FeatureContext.Provider>
  );
}

export const useFeatures = () => useContext(FeatureContext);
