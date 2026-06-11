import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './en.json';
i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
    resources: { en: { translation: en } },
    fallbackLng: 'en',
    returnEmptyString: false,
    interpolation: { escapeValue: false },
    missingKeyHandler: (_lngs, _ns, key) => {
        // Log missing keys in non-production; Sentry integration lives in T7.4
        if (import.meta.env['MODE'] !== 'production') {
            console.warn(`[i18n] missing key: "${key}"`);
        }
    },
    saveMissing: true,
});
export default i18n;
