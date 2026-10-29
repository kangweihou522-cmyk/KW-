import { createContext, useContext } from 'react';
import type { ReaderSettings } from '../../types/reader';
export const ReaderPreferencesContext = createContext<{
  settings: ReaderSettings;
  updateSetting: <Key extends keyof ReaderSettings>(key: Key, value: ReaderSettings[Key]) => void;
} | null>(null);
export function useReaderPreferences() { return useContext(ReaderPreferencesContext); }
