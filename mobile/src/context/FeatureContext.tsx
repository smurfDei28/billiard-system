import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../constants';

export type AppModule =
  | 'MEMBERSHIP' | 'TABLE_MANAGEMENT' | 'RESERVATIONS' | 'POS_INVENTORY'
  | 'TOURNAMENTS' | 'CREDITS_PAYMENTS' | 'LOYALTY_REWARDS'
  | 'NOTIFICATIONS' | 'REPORTS_ANALYTICS' | 'CAMERA_SCORING';

export type AppModuleGroup =
  | 'CORE_OPERATIONS' | 'COMMERCE' | 'TOURNAMENTS_LOYALTY'
  | 'BUSINESS_ANALYTICS' | 'VISION_SCORING';

const ALL_MODULES: AppModule[] = [
  'MEMBERSHIP', 'TABLE_MANAGEMENT', 'RESERVATIONS', 'POS_INVENTORY',
  'TOURNAMENTS', 'CREDITS_PAYMENTS', 'LOYALTY_REWARDS', 'NOTIFICATIONS',
  'REPORTS_ANALYTICS', 'CAMERA_SCORING',
];

interface FeatureContextValue {
  enabledGroups: AppModuleGroup[];
  enabledModules: AppModule[];
  hasGroup: (groupName: AppModuleGroup) => boolean;
  hasModule: (moduleName: AppModule) => boolean;
}

const FeatureContext = createContext<FeatureContextValue>({
  enabledGroups: [],
  enabledModules: ALL_MODULES,
  hasGroup: (_groupName: AppModuleGroup) => false,
  hasModule: (_moduleName: AppModule) => true,
});

export function FeatureProvider({ children }: { children: React.ReactNode }) {
  const [enabledGroups, setEnabledGroups] = useState<AppModuleGroup[]>([]);
  const [enabledModules, setEnabledModules] = useState<AppModule[]>(ALL_MODULES);

  useEffect(() => {
    axios.get(`${API_URL}/api/features`)
      .then(({ data }) => {
        if (Array.isArray(data?.enabledGroups)) setEnabledGroups(data.enabledGroups);
        if (Array.isArray(data?.enabledModules)) setEnabledModules(data.enabledModules);
      })
      .catch(() => {
        // The API remains the entitlement authority. Keeping the complete menu
        // during a temporary network outage lets users retry after reconnecting.
      });
  }, []);

  return (
    <FeatureContext.Provider value={{
      enabledGroups,
      enabledModules,
      hasGroup: (groupName) => enabledGroups.includes(groupName),
      hasModule: (moduleName) => enabledModules.includes(moduleName),
    }}>
      {children}
    </FeatureContext.Provider>
  );
}

export const useFeatures = () => useContext(FeatureContext);
